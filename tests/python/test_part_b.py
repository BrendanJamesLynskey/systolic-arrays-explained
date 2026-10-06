"""Tests of the chapter 5-9 references: tiles back to back (systolic.py),
the processing element (pe.py), the torus all-reduce (torus.py) and the
ONNX lowering (lower.py).

Each is checked against something it does not use: numpy for the results
(matmul, float16/float32 arithmetic, a direct convolution), its own closed
forms for the timing, and the recorded runs of other people's or the
author's other code (rtl/rtl_check.json for the MAC unit in Verilator,
reference/simfront_check.json for Torch_Sim_Frontend).
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference"))

import lower as L  # noqa: E402
import pe as P  # noqa: E402
import systolic as S  # noqa: E402
import torus as T  # noqa: E402

# ---------------------------------------------------------------------------
# Chapter 5: tiles back to back
# ---------------------------------------------------------------------------

STREAM_SHAPES = [(6, 6, 6, 3, 3), (1, 6, 6, 3, 3), (9, 7, 5, 3, 3), (4, 8, 8, 4, 4), (2, 3, 3, 3, 3), (12, 5, 9, 4, 2)]
OPTIONS = [(None, 2, True), (None, 2, False), (1, 2, True), (1, 1, True), (3, 2, True), (2, 1, False)]


@pytest.mark.parametrize("shape", STREAM_SHAPES)
@pytest.mark.parametrize("opt", OPTIONS)
def test_stream_result_and_timing(shape, opt):
    m, k, n, r, c = shape
    bw, buffers, shadow = opt
    a = S.demo_matrix(m, k, 3, -128, 127)
    b = S.demo_matrix(k, n, 4, -128, 127)
    tr = S.simulate_ws_stream(a, b, r, c, bw, buffers, shadow)
    assert tr["C"] == (np.array(a, dtype=np.int64) @ np.array(b, dtype=np.int64)).tolist()
    assert tr["cycles"] == len(tr["frames"]) == tr["schedule"]["cycles"]
    tot = tr["totals"]
    assert tot["macs"] == m * k * n
    words = S.tiled_words("ws", m, k, n, r, c)
    assert tot["reads"] == words["a"] + words["b"]
    assert tot["writes"] == words["c"]
    assert tot["accReads"] == words["acc"]
    assert tot["fetched"] == (k * n if bw else 0)
    # the last product is made in the last cycle
    assert any(cell[4] is not None for row in tr["frames"][-1]["pe"] for cell in row)


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_without_overlap_is_tiles_in_sequence(shape):
    m, k, n, r, c = shape
    sched = S.stream_schedule(m, k, n, r, c, shadow=False)
    assert sched["cycles"] == S.tiled_cycles("ws", m, k, n, r, c)


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_closed_form(shape):
    """Weights on chip, double-buffered: S_{j+1} = S_j + max(M, k_{j+1})."""
    m, k, n, r, c = shape
    ts = S.tiles("ws", m, k, n, r, c)
    s = ts[0][3] - ts[0][2]
    for t in ts[1:]:
        s += max(m, t[3] - t[2])
    last = ts[-1]
    want = s + m + (last[3] - last[2]) + (last[5] - last[4]) - 2
    assert S.stream_schedule(m, k, n, r, c)["cycles"] == want
    # one tile: the single pass of chapters 2-4
    assert S.stream_schedule(m, min(k, r), min(n, c), r, c)["cycles"] == S.cycles("ws", m, min(k, r), min(n, c))


@pytest.mark.parametrize("field", ["load", "stream"])
def test_stream_detects_a_schedule_that_is_too_early(monkeypatch, field):
    """The cycle model is a real check of the schedule: start the second
    tile's weight load a cycle early and a PE swaps in the wrong weight;
    start its stream a cycle early and two tiles feed one row at once."""
    real = S.stream_schedule

    def early(*args, **kw):
        out = real(*args, **kw)
        out["tiles"][1][field] -= 1
        return out

    monkeypatch.setattr(S, "stream_schedule", early)
    a, b = S.demo_pair(6, 6, 6)
    with pytest.raises(AssertionError):
        S.simulate_ws_stream(a, b, 3, 3)


def test_stream_weights_only_change_at_a_swap():
    a, b = S.demo_pair(6, 6, 6)
    tr = S.simulate_ws_stream(a, b, 3, 3)
    for f0, f1 in zip(tr["frames"], tr["frames"][1:]):
        for r0, r1 in zip(f0["pe"], f1["pe"]):
            for c0, c1 in zip(r0, r1):
                if c0[0] != c1[0]:
                    # a swap: the new weight was the shadow, and an activation of its tile arrived
                    assert c1[0] == c0[3] and c1[1] is not None and c1[1][3] == c1[0][3]


@pytest.mark.parametrize("df", S.DATAFLOWS)
@pytest.mark.parametrize("shape", [(7, 9, 5, 3, 4), (16, 16, 16, 4, 4), (5, 3, 11, 2, 3)])
def test_tiled_words_match_the_simulation(df, shape):
    m, k, n, r, c = shape
    a, b = S.demo_matrix(m, k, 3), S.demo_matrix(k, n, 4)
    tr = S.simulate_tiled(df, a, b, r, c)
    w = S.tiled_words(df, m, k, n, r, c)
    assert w["a"] + w["b"] == tr["totals"]["reads"]
    assert w["c"] == tr["totals"]["writes"]
    assert w["acc"] == tr["totals"]["accReads"]


def test_tiled_words_reuse():
    """Each operand is re-read once per tile of the dimension it does not span."""
    m, k, n, r, c = 64, 32, 48, 8, 8
    ws = S.tiled_words("ws", m, k, n, r, c)
    assert ws["b"] == k * n and ws["a"] == m * k * (n // c) and ws["acc"] == m * n * (k // r - 1)
    os_ = S.tiled_words("os", m, k, n, r, c)
    assert os_["a"] == m * k * (n // c) and os_["b"] == k * n * (m // r) and os_["acc"] == 0
    is_ = S.tiled_words("is", m, k, n, r, c)
    assert is_["a"] == m * k and is_["b"] == k * n * (m // c)


# ---------------------------------------------------------------------------
# Chapter 6: the processing element
# ---------------------------------------------------------------------------


def test_half_values_match_numpy():
    rng = S.Rng(5)
    for _ in range(500):
        h = P.demo_half("fp16", rng, -14, 15)
        assert P.half_value("fp16", h) == float(np.frombuffer(struct.pack("<H", h), dtype=np.float16)[0])
        g = P.demo_half("bf16", rng, -20, 20)
        assert P.half_value("bf16", g) == float(np.frombuffer(struct.pack("<I", g << 16), dtype=np.float32)[0])


@pytest.mark.parametrize("mode", ["fp16", "bf16"])
def test_float_pipeline_matches_numpy_float32(mode):
    ops = P.demo_ops(mode, 300, 77, 25, -6, 6, True)
    tr = P.mac_pipeline(mode, ops)
    # numpy: exact product (float32 holds it), float32 accumulate
    acc = np.float32(0)
    accs = []
    for a, b, clear, valid in ops:
        if valid:
            p = np.float32(P.half_value(mode, a)) * np.float32(P.half_value(mode, b))
            acc = p if clear else np.float32(acc + p)
        elif clear:
            acc = np.float32(0)
        accs.append(struct.unpack("<I", struct.pack("<f", acc))[0])
    # the accumulator lags the inputs by three edges
    got = [f["acc"] for f in tr["frames"]][2 : 2 + len(ops)]
    assert got == accs
    assert tr["frames"][-1]["macs"] == sum(o[3] for o in ops)


def test_int8_pipeline_and_saturation():
    ops = P.demo_ops("int8", 200, 9, 20, gaps=True)
    tr = P.mac_pipeline("int8", ops)
    groups = P.dot_reference("int8", ops)
    # the accumulator after each group's last product
    ends = [i for i in range(1, len(ops)) if ops[i][2]] + [len(ops)]
    for g, end in zip(groups, ends):
        assert tr["frames"][end + 1]["acc"] == g
    assert P.sat32(2**40) == P.INT32_MAX and P.sat32(-(2**40)) == P.INT32_MIN


def test_fp32_add_rounds_ties_to_even_and_flushes():
    one = P.f32_bits(1.0)
    half_ulp = P.f32_bits(2.0**-24)
    assert P.fp32_add(one, half_ulp) == one  # tie: stays even
    three_half = P.f32_bits(1.0 + 2.0**-23)
    assert P.fp32_add(three_half, half_ulp) == P.f32_bits(1.0 + 2.0**-22)  # tie: rounds up to even
    tiny = P.f32_bits(2.0**-126)
    assert P.fp32_add(tiny, P.f32_bits(-(2.0**-126) * 1.5)) == 0  # subnormal result -> +0
    assert P.fp32_add(P.f32_bits(-1.0), one) == 0  # exact zero is +0


def test_pe_zero_operands_and_specials():
    z = P.mul_to_fp32("fp16", 0x8000, 0x3C00)  # -0 x 1
    assert z == 0x80000000
    with pytest.raises(ValueError):
        P.half_value("fp16", 0x7C00)
    with pytest.raises(ValueError):
        P.mac_pipeline("fp8", [])


def test_mac_rtl_check_recorded():
    """rtl/check_rtl.py ran the MAC unit in Verilator: every register of
    every case matched this model."""
    rec = json.loads((ROOT / "rtl" / "rtl_check.json").read_text())
    assert rec["ok"]
    assert {c["mode"] for c in rec["mac"]} == {"fp16", "int8"}
    assert all(c["mismatches"] == 0 and c["values"] > 0 for c in rec["mac"])
    demo = next(c for c in rec["mac"] if c["name"] == "mac_fp16_demo")
    assert demo["ops"] == P.DEMO_PE["count"]


# ---------------------------------------------------------------------------
# Chapter 7: all-reduce on a torus
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("dims", [(2, 2), (2, 3), (3, 3), (4, 4), (4, 2), (3, 5)])
def test_allreduce_sums_everywhere(dims):
    x, y = dims
    data = T.demo_vectors(x, y, 11)
    r = T.allreduce(data)
    want = np.array(data).sum(axis=(0, 1)).tolist()
    assert r["sum"] == want
    last = r["frames"][-1]["state"]
    for cx in range(x):
        for cy in range(y):
            assert [v for v, _ in last[cx][cy]] == want
            assert all(c == x * y for _, c in last[cx][cy])
    assert r["steps"] == T.steps_torus(x, y)
    # every chip sends 2 (XY - 1) chunks, as in one big ring
    assert r["frames"][-1]["sent"] == x * y * T.steps_ring(x * y)


def test_allreduce_messages_go_to_neighbours():
    r = T.demo_run(4, 3)
    for f in r["frames"][1:]:
        for sx, sy, dx, dy, chunks in f["msgs"]:
            if f["phase"].endswith("x"):
                assert (dx, dy) == ((sx + 1) % 4, sy) and len(chunks) == 3
            else:
                assert (dx, dy) == (sx, (sy + 1) % 3) and len(chunks) == 1
        # reduce-scatter only ever grows a count; nothing is counted twice
        for row in f["state"]:
            for chip in row:
                assert all(1 <= c <= 12 for _, c in chip)


# ---------------------------------------------------------------------------
# Chapter 9: from graph to silicon
# ---------------------------------------------------------------------------

ONNX = ROOT / "reference" / "data" / "tiny_cnn.onnx"


def test_onnx_description_and_lowering():
    d = L.describe(str(ONNX))
    assert [n["op"] for n in d["nodes"]] == ["Conv", "Relu", "Flatten", "Gemm"]
    layers = L.lower(d, 8, 8)
    assert layers[0]["gemm"] == [1, 36, 27, 8]
    assert layers[3]["gemm"] == [1, 1, 288, 10]
    assert [l["unit"] for l in layers] == ["array", "vector", "view", "array"]
    # the site's copy of the description is the file's
    js = json.loads((ROOT / "src" / "lib" / "sa" / "tiny_cnn.json").read_text())
    assert js == d


def test_conv_on_the_array_is_the_convolution():
    d = L.describe(str(ONNX))
    r = L.run_conv(d, 8, 8)
    x = np.array(r["x"], dtype=np.int64)
    w = np.array(d["convWeight"], dtype=np.int64)
    out = np.zeros((8, 6, 6), dtype=np.int64)
    for f in range(8):
        for i in range(6):
            for j in range(6):
                out[f, i, j] = (x[:, i : i + 3, j : j + 3] * w[f]).sum()
    assert r["direct"] == out.tolist()
    assert np.array(r["C"]).T.reshape(8, 6, 6).tolist() == out.tolist()
    assert (np.array(r["A"]) @ np.array(r["B"])).tolist() == r["C"]


def test_simfront_agrees():
    rec = json.loads((ROOT / "reference" / "simfront_check.json").read_text())
    assert rec["ok"]
    site = {e["name"]: e for e in L.lower(L.describe(str(ONNX)), rec["array"], rec["array"])}
    for n in rec["nodes"]:
        if n["simfront"]:
            assert n["simfront"][0] == site[n["name"]]["gemm"]
            assert n["simfrontCycles"] == site[n["name"]]["approx"]
        else:
            assert site[n["name"]]["unit"] != "array"


def test_lower_steps_cover_everything():
    d = L.describe(str(ONNX))
    st = L.lower_steps(d, 8, 8)
    kinds = [s["kind"] for s in st]
    assert kinds.count("im2col") == 36 and kinds.count("tile") == 4
    assert kinds[0] == "node" and kinds[-1] == "summary"
