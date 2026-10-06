"""Tests of the Python reference (reference/systolic.py).

The model is checked against things it does not use: numpy's matmul and a
direct convolution for the results; the textbook timing (an element meets
its partner in PE(i, j) at cycle i + j + k) read back from the frames; and
counts of the data movement derived by hand (``traffic``), recounted from
the frames. rtl/check_rtl.py adds the RTL comparison.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference"))

import systolic as S  # noqa: E402

SHAPES = [(1, 1, 1), (1, 3, 2), (3, 3, 3), (5, 4, 4), (8, 2, 3), (2, 7, 5), (6, 1, 6)]


def block(df, m, k, n):
    return {"ws": (k, n), "os": (m, n), "is": (k, m)}[df]


@pytest.mark.parametrize("df", S.DATAFLOWS)
@pytest.mark.parametrize("shape", SHAPES)
@pytest.mark.parametrize("extra", [0, 2])
def test_result_is_the_matmul(df, shape, extra):
    m, k, n = shape
    a = S.demo_matrix(m, k, 7 + m, -128, 127)
    b = S.demo_matrix(k, n, 9 + n, -128, 127)
    r, c = block(df, m, k, n)
    tr = S.simulate(df, a, b, r + extra, c + extra)
    assert tr["C"] == (np.array(a, dtype=np.int64) @ np.array(b, dtype=np.int64)).tolist()
    assert tr["C"] == S.matmul(a, b)


@pytest.mark.parametrize("df", S.DATAFLOWS)
@pytest.mark.parametrize("shape", SHAPES)
def test_closed_forms_equal_the_counts(df, shape):
    m, k, n = shape
    a, b = S.demo_pair(m, k, n)
    r, c = block(df, m, k, n)
    tr = S.simulate(df, a, b, r, c)
    assert tr["cycles"] == S.cycles(df, m, k, n)
    assert tr["totals"] == S.traffic(df, m, k, n)
    assert tr["totals"]["macs"] == m * k * n


@pytest.mark.parametrize("df", S.DATAFLOWS)
def test_textbook_timing(df):
    """Every product happens where and when the textbook says."""
    m, k, n = 5, 3, 4
    a, b = S.demo_pair(m, k, n)
    r, c = block(df, m, k, n)
    tr = S.simulate(df, a, b, r, c)
    load = k if df in ("ws", "is") else 0
    seen = set()
    for f in tr["frames"]:
        for i, row in enumerate(f["pe"]):
            for j, cell in enumerate(row):
                if cell[4] is None:
                    continue
                tc = f["t"] - load
                if df == "ws":  # PE(k, n), row m of A: cycle m + k + n
                    mm = cell[1][1]
                    assert cell[1][2] == i and tc == mm + i + j
                    assert cell[4] == [a[mm][i], b[i][j]]
                    seen.add((mm, i, j))
                elif df == "os":  # PE(m, n), step k: cycle k + m + n
                    kk = cell[1][2]
                    assert tc == kk + i + j
                    assert cell[4] == [a[i][kk], b[kk][j]]
                    seen.add((i, kk, j))
                else:  # PE(k, m), column n of B: cycle n + k + m
                    nn = cell[1][2]
                    assert tc == nn + i + j
                    assert cell[4] == [b[i][nn], a[j][i]]
                    seen.add((j, i, nn))
    assert len(seen) == m * k * n


@pytest.mark.parametrize("df", ["ws", "is"])
def test_operands_move_one_pe_per_cycle(df):
    m, k, n = 4, 3, 3
    a, b = S.demo_pair(m, k, n)
    r, c = block(df, m, k, n)
    fr = S.simulate(df, a, b, r, c)["frames"]
    for t in range(k, len(fr) - 1):
        for i in range(r):
            for j in range(c - 1):
                assert fr[t + 1]["pe"][i][j + 1][1] == fr[t]["pe"][i][j][1]
            for j in range(c):
                assert fr[t + 1]["pe"][i][j][0] == fr[t]["pe"][i][j][0]  # stationary


def test_os_operands_and_drain():
    m, k, n = 3, 4, 3
    a, b = S.demo_pair(m, k, n)
    tr = S.simulate("os", a, b, m, n)
    fr = tr["frames"]
    for t in range(len(fr) - m - 1):
        for i in range(m):
            for j in range(n - 1):
                assert fr[t + 1]["pe"][i][j + 1][1] == fr[t]["pe"][i][j][1]
        for i in range(m - 1):
            for j in range(n):
                assert fr[t + 1]["pe"][i + 1][j][2] == fr[t]["pe"][i][j][2]
    # the drain writes the bottom row first
    drain = [f for f in fr if f["phase"] == "drain"]
    assert len(drain) == m
    assert [o[0] for o in drain[0]["out"]] == [m - 1] * n
    assert [o[0] for o in drain[-1]["out"]] == [0] * n


@pytest.mark.parametrize("df", ["ws", "is"])
def test_outputs_leave_when_complete(df):
    m, k, n = 4, 3, 2
    a, b = S.demo_pair(m, k, n)
    r, c = block(df, m, k, n)
    tr = S.simulate(df, a, b, r, c)
    for f in tr["frames"]:
        for mm, nn, val in f["out"]:
            tc = f["t"] - k
            if df == "ws":
                assert tc == mm + (k - 1) + nn
            else:
                assert tc == nn + (k - 1) + mm
            assert val == S.matmul(a, b)[mm][nn]


def test_wavefront():
    m, k, n = S.DEMO["wave"]["M"], S.DEMO["wave"]["K"], S.DEMO["wave"]["N"]
    tr = S.simulate("ws", *S.demo_pair(m, k, n), k, n)
    act = S.active_per_cycle(tr)
    assert act[:k] == [0] * k
    assert act[k:] == [S.wavefront_size(m, k, n, t) for t in range(len(act) - k)]
    assert sum(act) == m * k * n


@pytest.mark.parametrize("df", S.DATAFLOWS)
@pytest.mark.parametrize("arr", [(3, 4), (4, 4), (2, 3), (16, 16)])
def test_tiling(df, arr):
    m, k, n = 7, 9, 5
    a, b = S.demo_matrix(m, k, 3), S.demo_matrix(k, n, 4)
    r, c = arr
    res = S.simulate_tiled(df, a, b, r, c)
    assert res["C"] == S.matmul(a, b)
    assert res["cycles"] == S.tiled_cycles(df, m, k, n, r, c)
    assert res["totals"]["macs"] == m * k * n
    k_tiles = -(-k // r)
    if df == "ws":
        assert res["tiles"] == k_tiles * -(-n // c)
        assert res["totals"]["accReads"] == m * n * (k_tiles - 1)
    if df == "os":
        assert res["totals"]["accReads"] == 0


def test_fit_is_enforced():
    a, b = S.demo_pair(3, 5, 2)
    with pytest.raises(ValueError):
        S.simulate("ws", a, b, 4, 4)
    with pytest.raises(ValueError):
        S.simulate("xx", a, b, 8, 8)
    with pytest.raises(ValueError):
        S.simulate("ws", a, S.demo_matrix(4, 2, 1), 8, 8)


def test_reuse_and_utilisation():
    st = S.reuse_steps(32, 16)
    for s in st:
        n = s["n"]
        assert s["naive2"] == min(2 * n * n, 32)
        assert s["systolic2"] == min(2 * n * n, 32 * n)
        assert s["systolic2"] >= s["naive2"]
    # n = 16 under 32 words per cycle: 16 MACs per cycle without reuse, 256 with
    assert st[-1]["naive2"] // 2 == 16 and st[-1]["systolic2"] // 2 == 256
    u = S.util_steps("ws", 8, 8, 8, 8, 64)
    assert all(x["util"] < 1 for x in u)
    assert all(u[i + 1]["util"] > u[i]["util"] for i in range(len(u) - 1))
    # M = 64 rows through an 8 x 8 weight-stationary array: 64*8*8 / (64 * (8 + 64 + 14))
    assert u[-1]["util"] == 4096 / (64 * 86)
    sh = S.shape_steps("ws", 8, 8, 32, 8, 40)
    assert sh[7]["tiles"] == 1 and sh[8]["tiles"] == 2
    assert sh[8]["util"] < sh[7]["util"]  # N = 9 leaves the second tile nearly empty


def test_row_stationary():
    rs = S.DEMO["rs"]
    x = S.demo_matrix(rs["H"], rs["W"], rs["seedX"])
    f = S.demo_matrix(rs["R"], rs["S"], rs["seedF"])
    tr = S.simulate_rs(x, f)
    assert tr["O"] == S.conv2d(x, f)
    e, fo = rs["H"] - rs["R"] + 1, rs["W"] - rs["S"] + 1
    assert tr["cycles"] == rs["R"] - 1 + fo * rs["S"]
    last = tr["frames"][-1]["cnt"]
    assert last["macs"] == e * fo * rs["R"] * rs["S"]
    assert last["psumHops"] == e * fo * (rs["R"] - 1)
    assert last["writes"] == e * fo
    # direct convolution vs numpy
    xa, fa = np.array(x), np.array(f)
    ref = [[int((xa[i:i + rs["R"], j:j + rs["S"]] * fa).sum()) for j in range(fo)] for i in range(e)]
    assert tr["O"] == ref


def test_rtl_summary_is_consistent():
    """rtl/rtl_check.json (written by rtl/check_rtl.py in Verilator)."""
    s = json.loads((ROOT / "rtl" / "rtl_check.json").read_text())
    assert s["ok"] is True
    for case in s["cases"]:
        assert case["mismatches"] == 0
        assert case["values"] == case["edges"] * case["N"] ** 2
        assert case["validOutEdges"] == [case["K"] + 2 * (case["N"] - 1)]
        assert case["modelComputeCycles"] == S.cycles("os", case["N"], case["K"], case["N"]) - case["N"]
