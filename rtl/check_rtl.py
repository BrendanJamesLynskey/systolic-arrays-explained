"""
RTL cross-check, in three parts:

1. the owner's output-stationary systolic array (rtl/systolic_array_os.sv,
   vendored from Interview_RTL_LLM_Accelerators) in Verilator: every
   accumulator after every clock edge against the Python model's
   output-stationary frames (reference/systolic.py);
2. the owner's mixed-precision MAC unit (rtl/mac_unit.sv, from the same
   repository): every pipeline register after every clock edge against the
   Python model of a processing element (reference/pe.py), in its INT8 and
   FP16 modes (rtl/tb_mac_trace.sv). In FP16 mode the stage-1 operands, the
   FP32 product, the FP32 accumulator and the valid/clear bits are compared;
   in INT8 mode the low operand bytes, the INT16 product and the INT32
   accumulator (each mode's registers; the other mode's datapath also runs,
   on the same bits, but nothing reads it);
3. the weight-stationary array with shadow weights (rtl/systolic_array_ws.sv,
   written for this site): the testbench (rtl/tb_ws_trace.sv) replays the
   model's edge inputs from ``simulate_ws_stream`` (the weights entering
   each column, the skewed activations entering each row) and every
   register of every PE (stationary weight, shadow weight, activation,
   partial sum: valid bit, tile tag and value) is compared after every
   edge with the model's frames, on seven problems (partial tiles, full-range
   INT8, M = 1, single weight registers, an HBM-limited fetch, nine tiles).
   The results C are also read from the RTL (each tile's last row) and
   compared with A B. For chapter 5's demonstration the run also writes a
   VCD, which becomes rtl/ws_wave.json, the site's waveform panel. Every
   case also records the negative control (each edge against the next
   model cycle), which must mismatch.

Timing: the RTL skews its inputs internally, so the edge that samples the
first valid input (edge 1) is the model's compute cycle 0, and after edge p
PE(i, j) holds the sum of the products with k <= p - 1 - i - j: exactly the
model's accumulator in frame p - 1. After the last product (edge
K + 2(N - 1)) the RTL holds its results in place (it is read in parallel)
and pulses valid_out once, while the model drains them out of the bottom;
for those edges the RTL must hold C = A B.

    python3 rtl/check_rtl.py            # build, run, compare; write the summary
    python3 rtl/check_rtl.py --check    # also fail if rtl/rtl_check.json changes

Needs Verilator 5 (--binary --timing) on PATH. It writes the raw traces to
rtl/traces/, the summary the site quotes to rtl/rtl_check.json and the
VCD-derived waveform to rtl/ws_wave.json.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "reference"))

import pe as P  # noqa: E402
import systolic as S  # noqa: E402

# --shift 1 compares each edge with the next model cycle: a negative control
# that must report mismatches (it shows the comparison can fail).
SHIFT = int(sys.argv[sys.argv.index("--shift") + 1]) if "--shift" in sys.argv else 0

# (name, N, K, seed of A, seed of B, lo, hi)
CASES = [
    ("n4_k4_small", 4, 4, 11, 12, -4, 5),
    ("n4_k7_int8", 4, 7, 21, 22, -128, 127),
    ("n3_k5_small", 3, 5, 31, 32, -4, 5),
]


def hex8(v: int) -> str:
    return format(v & 0xFF, "02x")


def run_case(name: str, n: int, k: int, sa: int, sb: int, lo: int, hi: int, work: Path) -> dict:
    a = S.demo_matrix(n, k, sa, lo, hi)
    b = S.demo_matrix(k, n, sb, lo, hi)
    d = work / name
    d.mkdir()
    (d / "a.mem").write_text("\n".join(hex8(a[i][p]) for i in range(n) for p in range(k)) + "\n")
    (d / "b.mem").write_text("\n".join(hex8(b[p][j]) for p in range(k) for j in range(n)) + "\n")
    subprocess.run(
        [
            "verilator", "--binary", "--timing", "-j", "2", "-Wno-fatal", "-Wno-lint", "-Wno-style",
            "--top-module", "tb_trace", f"-GN={n}", f"-GK={k}",
            str(HERE / "systolic_array_os.sv"), str(HERE / "tb_trace.sv"),
            "--Mdir", str(d / "obj"),
        ],
        check=True, cwd=d, stdout=subprocess.DEVNULL,
    )
    res = subprocess.run([str(d / "obj" / "Vtb_trace")], check=True, cwd=d, capture_output=True, text=True)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("P ")]
    (HERE / "traces").mkdir(exist_ok=True)
    (HERE / "traces" / f"{name}.txt").write_text("\n".join(lines) + "\n")

    trace = S.simulate("os", a, b, n, n)
    compute = [f for f in trace["frames"] if f["phase"] == "compute"]
    c = S.matmul(a, b)
    last = k + 2 * (n - 1)
    mismatches = 0
    compared = 0
    valid_edges = []
    for ln in lines:
        parts = ln.split()
        p, valid = int(parts[1]), int(parts[2])
        vals = [int(x) for x in parts[3:]]
        if valid:
            valid_edges.append(p)
        for i in range(n):
            for j in range(n):
                if p - 1 < len(compute):
                    want = compute[min(p - 1 + SHIFT, len(compute) - 1)]["pe"][i][j][3][0]
                else:
                    want = c[i][j]
                compared += 1
                if vals[i * n + j] != want:
                    mismatches += 1
    return {
        "name": name,
        "N": n,
        "K": k,
        "range": [lo, hi],
        "edges": len(lines),
        "values": compared,
        "mismatches": mismatches,
        "lastMacEdge": last,
        "validOutEdges": valid_edges,
        "modelComputeCycles": len(compute),
        "C": c,
    }


# (name, mode, count, seed, clear every, exponent range, idle gaps)
MAC_CASES = [
    ("mac_fp16_demo", "fp16", P.DEMO_PE["count"], P.DEMO_PE["seed"]["fp16"], P.DEMO_PE["every"], (-3, 3), False),
    ("mac_int8_demo", "int8", P.DEMO_PE["count"], P.DEMO_PE["seed"]["int8"], P.DEMO_PE["every"], (0, 0), False),
    ("mac_fp16_wide", "fp16", 400, 51, 16, (-14, 15), True),
    ("mac_fp16_long", "fp16", 400, 52, 100, (-6, 6), True),
    ("mac_int8_rand", "int8", 400, 53, 16, (0, 0), True),
]


def run_mac_case(name: str, mode: str, count: int, seed: int, every: int, er: tuple[int, int], gaps: bool, work: Path) -> dict:
    ops = P.demo_ops(mode, count, seed, every, er[0], er[1], gaps)
    d = work / name
    d.mkdir()
    (d / "ops.mem").write_text(
        "\n".join(format((c << 33) | (v << 32) | (a << 16) | b, "09x") for a, b, c, v in ops) + "\n"
    )
    subprocess.run(
        [
            "verilator", "--binary", "--timing", "-j", "2", "-Wno-fatal", "-Wno-lint", "-Wno-style",
            "--top-module", "tb_mac_trace", f"-GMODE={1 if mode == 'fp16' else 0}", f"-GCOUNT={count}",
            str(HERE / "mac_unit.sv"), str(HERE / "tb_mac_trace.sv"),
            "--Mdir", str(d / "obj"),
        ],
        check=True, cwd=d, stdout=subprocess.DEVNULL,
    )
    res = subprocess.run([str(d / "obj" / "Vtb_mac_trace")], check=True, cwd=d, capture_output=True, text=True)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("M ")]
    (HERE / "traces").mkdir(exist_ok=True)
    (HERE / "traces" / f"{name}.txt").write_text("\n".join(lines) + "\n")

    trace = P.mac_pipeline(mode, ops)
    frames = trace["frames"]
    mismatches = 0
    compared = 0
    for ln in lines:
        x = ln.split()
        e = int(x[1])
        f = frames[min(e - 1 + SHIFT, len(frames) - 1)]
        s1a, s1b, s1v, s1c = int(x[2], 16), int(x[3], 16), int(x[4]), int(x[5])
        fprod, iprod, s2v, s2c = int(x[6], 16), int(x[7]), int(x[8]), int(x[9])
        facc, iacc, vout = int(x[10], 16), int(x[11]), int(x[12])
        if mode == "int8":
            got = [s1a, s1b, s1v, s1c, iprod, s2v, s2c, iacc, vout]
            want = [f["s1"][0] & 0xFF, f["s1"][1] & 0xFF, f["s1"][2], f["s1"][3], f["s2"][0], f["s2"][1], f["s2"][2], f["acc"], f["vout"]]
        else:
            got = [s1a, s1b, s1v, s1c, fprod, s2v, s2c, facc, vout]
            want = [f["s1"][0], f["s1"][1], f["s1"][2], f["s1"][3], f["s2"][0], f["s2"][1], f["s2"][2], f["acc"], f["vout"]]
        compared += len(got)
        mismatches += sum(1 for g, w in zip(got, want) if g != w)
    groups = P.dot_reference(mode, ops)
    return {
        "name": name,
        "mode": mode,
        "ops": count,
        "valid": sum(1 for o in ops if o[3]),
        "dots": len(groups),
        "edges": len(lines),
        "values": compared,
        "mismatches": mismatches,
    }


# ---------------------------------------------------------------------------
# 3. The weight-stationary array with shadow weights (rtl/systolic_array_ws.sv)
# ---------------------------------------------------------------------------

# (name, M, K, N, array rows, array cols, HBM words per cycle, buffers,
#  shadow registers, seed of A, seed of B, lo, hi); None seeds = the site's
# demo matrices (S.demo_pair)
WS_CASES = [
    ("ws_demo", 6, 6, 6, 3, 3, None, 2, True, None, None, -4, 5),  # chapter 5's animation
    ("ws_ragged", 5, 6, 6, 4, 4, None, 2, True, 61, 62, -4, 5),  # partial tiles in K and N
    ("ws_int8", 8, 8, 8, 4, 4, None, 2, True, 63, 64, -128, 127),  # full-range signed INT8
    ("ws_m1", 1, 6, 6, 3, 3, None, 2, True, 65, 66, -4, 5),  # M = 1: loads back to back
    ("ws_single", 6, 6, 6, 3, 3, None, 2, False, 67, 68, -4, 5),  # single weight registers
    ("ws_hbm", 6, 6, 6, 3, 3, 1, 1, True, 69, 70, -4, 5),  # one HBM word a cycle, one buffer
    ("ws_nine", 12, 10, 9, 4, 4, None, 2, True, 71, 72, -128, 127),  # nine tiles, 2-bit tags wrap
]
WS_TAG_W = 2
WS_REGS = ("s", "sh", "h", "v")  # the model's PE is [s, h, v, sh, mac]
WS_SLOT = {"s": 0, "h": 1, "v": 2, "sh": 3}
WS_DEMO = "ws_demo"  # the case the site's waveform panel replays from the VCD


def ws_inputs(trace: dict, rows: int, cols: int) -> tuple[list[list[int]], list[list[int]]]:
    """The model's edge inputs, cycle by cycle, as the testbench's words."""
    ts = trace["schedule"]["tiles"]
    tops, lefts = [], []
    for f in trace["frames"]:
        t = f["t"]
        top = []
        for q in range(cols):
            w = f["inT"][q]
            if w is None:
                top.append(0)
                continue
            first = 0
            for tl in ts:
                l = t - tl["load"] - q
                if tl["j"] == w[3] and 0 <= l < tl["k"]:
                    first = 1 if l == 0 else 0
            top.append((1 << 11) | (first << 10) | ((w[3] % (1 << WS_TAG_W)) << 8) | (w[0] & 0xFF))
        left = []
        for r in range(rows):
            x = f["inL"][r]
            left.append(0 if x is None else (1 << 10) | ((x[3] % (1 << WS_TAG_W)) << 8) | (x[0] & 0xFF))
        tops.append(top)
        lefts.append(left)
    return tops, lefts


def ws_model_reg(cell: list, reg: str) -> list[int]:
    """[valid, tag, value] of one model register (tile tags as the RTL's TAG_W bits)."""
    x = cell[WS_SLOT[reg]]
    if x is None:
        return [0, 0, 0]
    tile = x[4] if reg == "v" else x[3]
    return [1, tile % (1 << WS_TAG_W), x[0]]


def parse_ws_line(ln: str, rows: int, cols: int) -> tuple[int, list[list[dict[str, list[int]]]]]:
    x = ln.split()
    e = int(x[1])
    vals = [int(v) for v in x[2:]]
    grid = []
    i = 0
    for _ in range(rows):
        row = []
        for _ in range(cols):
            pe = {}
            for reg in WS_REGS:
                pe[reg] = vals[i:i + 3]
                i += 3
            row.append(pe)
        grid.append(row)
    return e, grid


def same_reg(got: list[int], want: list[int]) -> bool:
    """An invalid register's tag and value are don't-cares (they hold stale bits)."""
    if got[0] != want[0]:
        return False
    return want[0] == 0 or got[1:] == want[1:]


def read_vcd(path: Path, rows: int, cols: int) -> list[dict]:
    """The testbench-level signals of waves.vcd, sampled at every rising edge
    after reset: the registers just after the edge, the inputs just before it.
    """
    ids: dict[str, tuple[str, int]] = {}
    scope: list[str] = []
    changes: list[tuple[int, str, str]] = []
    t = 0
    body = False
    for raw in path.read_text().splitlines():
        ln = raw.strip()
        if not body:
            if ln.startswith("$scope"):
                scope.append(ln.split()[2])
            elif ln.startswith("$upscope"):
                scope.pop()
            elif ln.startswith("$var") and scope and scope[-1] == "tb_ws_trace":
                parts = ln.split()
                ids.setdefault(parts[3], (parts[4], int(parts[2])))
            elif ln.startswith("$enddefinitions"):
                body = True
            continue
        if not ln or ln.startswith("$"):
            continue
        if ln[0] == "#":
            t = int(ln[1:])
        elif ln[0] == "b":
            bits, code = ln[1:].split()
            if code in ids:
                changes.append((t, code, bits))
        elif ln[0] in "01xz" and ln[1:] in ids:
            changes.append((t, ln[1:], ln[0]))
    names = {code: name for code, (name, _) in ids.items()}
    width = {name: w for name, w in ids.values()}
    # the value of every signal over time
    hist: dict[str, list[tuple[int, int]]] = {}
    for tt, code, bits in changes:
        v = int(bits.replace("x", "0").replace("z", "0"), 2)
        hist.setdefault(names[code], []).append((tt, v))

    def at(name: str, tt: int) -> int:
        v = 0
        for ct, cv in hist[name]:
            if ct > tt:
                break
            v = cv
        return v

    clk = hist["clk"]
    rst_high = next(ct for ct, cv in hist["rst_n"] if cv == 1)
    posedges = [ct for (ct, cv) in clk if cv == 1 and ct > rst_high]

    def elem(name: str, tt: int, r: int, c: int, w: int, signed: bool = True) -> int:
        word = at(name, tt)
        v = (word >> ((r * cols + c) * w)) & ((1 << w) - 1)
        return v - (1 << w) if signed and v >> (w - 1) else v

    def vec(name: str, tt: int, i: int, w: int, signed: bool = False) -> int:
        word = at(name, tt)
        v = (word >> (i * w)) & ((1 << w) - 1)
        return v - (1 << w) if signed and v >> (w - 1) else v

    assert width["v_data"] == rows * cols * 32
    out = []
    for e, tt in enumerate(posedges, start=1):
        before = tt - 1
        regs = []
        for r in range(rows):
            row = []
            for c in range(cols):
                pe = {}
                for reg, w in (("s", 8), ("sh", 8), ("h", 8), ("v", 32)):
                    pe[reg] = [
                        elem(f"{reg}_valid", tt, r, c, 1, False),
                        elem(f"{reg}_tag", tt, r, c, WS_TAG_W, False),
                        elem(f"{reg}_data", tt, r, c, w),
                    ]
                row.append(pe)
            regs.append(row)
        out.append({
            "edge": e,
            "top": [[vec("w_valid", before, q, 1), vec("w_first", before, q, 1),
                     vec("w_tag", before, q, WS_TAG_W), vec("w_data", before, q, 8, True)] for q in range(cols)],
            "left": [[vec("a_valid", before, r, 1), vec("a_tag", before, r, WS_TAG_W),
                      vec("a_data", before, r, 8, True)] for r in range(rows)],
            "pe": regs,
        })
    return out


def run_ws_case(name, m, k, n, rows, cols, bw, buffers, shadow, sa, sb, lo, hi, work: Path) -> dict:
    if sa is None:
        a, b = S.demo_pair(m, k, n)
    else:
        a, b = S.demo_matrix(m, k, sa, lo, hi), S.demo_matrix(k, n, sb, lo, hi)
    trace = S.simulate_ws_stream(a, b, rows, cols, bw, buffers, shadow)
    frames = trace["frames"]
    cycles = len(frames)
    tops, lefts = ws_inputs(trace, rows, cols)
    d = work / name
    d.mkdir()
    (d / "top.mem").write_text("\n".join(format(w, "03x") for row in tops for w in row) + "\n")
    (d / "left.mem").write_text("\n".join(format(w, "03x") for row in lefts for w in row) + "\n")
    waves = name == WS_DEMO
    subprocess.run(
        [
            "verilator", "--binary", "--timing", "-j", "2", "-Wno-fatal", "-Wno-lint", "-Wno-style",
            "--top-module", "tb_ws_trace", f"-GROWS={rows}", f"-GCOLS={cols}", f"-GCYCLES={cycles}",
            *(["--trace", "-DWAVES"] if waves else []),
            str(HERE / "systolic_array_ws.sv"), str(HERE / "tb_ws_trace.sv"),
            "--Mdir", str(d / "obj"),
        ],
        check=True, cwd=d, stdout=subprocess.DEVNULL,
    )
    res = subprocess.run([str(d / "obj" / "Vtb_ws_trace")], check=True, cwd=d, capture_output=True, text=True)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("W ")]
    (HERE / "traces").mkdir(exist_ok=True)
    (HERE / "traces" / f"{name}.txt").write_text("\n".join(lines) + "\n")

    ts = trace["schedule"]["tiles"]
    compared = mismatches = shifted = 0
    per_edge: dict[str, list[int]] = {"aligned": [], "shifted": []}
    c_rtl = [[0] * n for _ in range(m)]
    rtl_grids = {}
    for ln in lines:
        e, grid = parse_ws_line(ln, rows, cols)
        rtl_grids[e] = grid
        m0, s0 = mismatches, shifted
        f = frames[min(e - 1 + SHIFT, cycles - 1)]
        # the negative control, always recorded: against the next cycle's frame
        g = frames[min(e, cycles - 1)]
        for r in range(rows):
            for c in range(cols):
                for reg in WS_REGS:
                    compared += 1
                    if not same_reg(grid[r][c][reg], ws_model_reg(f["pe"][r][c], reg)):
                        mismatches += 1
                    if not same_reg(grid[r][c][reg], ws_model_reg(g["pe"][r][c], reg)):
                        shifted += 1
        per_edge["aligned"].append(mismatches - m0)
        per_edge["shifted"].append(shifted - s0)
    # the results, read from the RTL: the partial sum leaving each tile's last row
    for f in frames:
        grid = rtl_grids[f["t"] + 1]
        for r in range(rows):
            for c in range(cols):
                v = f["pe"][r][c][2]
                if v is not None and r == ts[v[4]]["k"] - 1:
                    c_rtl[v[1]][v[2]] += grid[r][c]["v"][2]
    want_c = S.matmul(a, b)
    out = {
        "name": name,
        "M": m,
        "K": k,
        "N": n,
        "rows": rows,
        "cols": cols,
        "bw": bw,
        "buffers": buffers,
        "shadow": shadow,
        "range": [lo, hi],
        "tiles": len(ts),
        "edges": len(lines),
        "values": compared,
        "mismatches": mismatches,
        "mismatchesShifted": shifted,
        "cResultsMatch": c_rtl == want_c,
    }
    if waves and SHIFT == 0:
        vcd = read_vcd(d / "waves.vcd", rows, cols)
        # the VCD and the printed trace are the same simulation
        for w in vcd[:len(lines)]:
            for r in range(rows):
                for c in range(cols):
                    for reg in WS_REGS:
                        assert same_reg(w["pe"][r][c][reg], rtl_grids[w["edge"]][r][c][reg]), (w["edge"], r, c, reg)
        out["vcd"] = vcd[:len(lines)]
        out["perEdge"] = per_edge
    return out


def main() -> int:
    if shutil.which("verilator") is None:
        print("verilator not found on PATH", file=sys.stderr)
        return 2
    ver = subprocess.run(["verilator", "--version"], capture_output=True, text=True).stdout.split()[1]
    with tempfile.TemporaryDirectory() as tmp:
        results = [run_case(*case, Path(tmp)) for case in CASES]
        mac = [run_mac_case(*case, Path(tmp)) for case in MAC_CASES]
        ws = [run_ws_case(*case, Path(tmp)) for case in WS_CASES]
    demo = next(r for r in ws if r["name"] == WS_DEMO)
    vcd = demo.pop("vcd", None)
    per_edge = demo.pop("perEdge", None)
    vend = json.loads((HERE / "VENDORED.json").read_text())
    summary = {
        "simulator": f"Verilator {ver}",
        "source": vend,
        "cases": results,
        "mac": mac,
        "macSource": json.loads((HERE / "VENDORED_MAC.json").read_text()),
        "ok": all(r["mismatches"] == 0 and r["validOutEdges"] == [r["lastMacEdge"]] for r in results)
        and all(r["mismatches"] == 0 for r in mac)
        and all(r["mismatches"] == 0 and r["mismatchesShifted"] > 0 and r["cResultsMatch"] for r in ws),
        "ws": ws,
        "wsTotals": {
            "cases": len(ws),
            "edges": sum(r["edges"] for r in ws),
            "values": sum(r["values"] for r in ws),
            "mismatches": sum(r["mismatches"] for r in ws),
            "mismatchesShifted": sum(r["mismatchesShifted"] for r in ws),
            "tagBits": WS_TAG_W,
        },
    }
    out = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    target = HERE / "rtl_check.json"
    for r in results:
        print(f"{r['name']}: {r['edges']} edges, {r['values']} accumulator values, "
              f"{r['mismatches']} mismatches, valid_out at {r['validOutEdges']} (last MAC edge {r['lastMacEdge']})")
    for r in mac:
        print(f"{r['name']}: {r['edges']} edges, {r['values']} register values, {r['mismatches']} mismatches")
    for r in ws:
        print(f"{r['name']}: {r['tiles']} tiles, {r['edges']} edges, {r['values']} register values, "
              f"{r['mismatches']} mismatches, C from the RTL {'=' if r['cResultsMatch'] else '!='} A B")
    wave_target = HERE / "ws_wave.json"
    wave = None
    if vcd is not None:
        c = next(cs for cs in WS_CASES if cs[0] == WS_DEMO)
        wave = json.dumps({
            "case": {"name": WS_DEMO, "M": c[1], "K": c[2], "N": c[3], "rows": c[4], "cols": c[5]},
            "from": "rtl/systolic_array_ws.sv in Verilator, tb_ws_trace.sv -DWAVES: waves.vcd, sampled at every rising edge",
            "tagBits": WS_TAG_W,
            "edges": vcd,
            # registers that differ at each edge, aligned and shifted one cycle
            "mismatchesPerEdge": per_edge,
        }, separators=(",", ":"), sort_keys=True) + "\n"
    if "--check" in sys.argv:
        if wave is not None and (not wave_target.exists() or wave_target.read_text() != wave):
            print("rtl/ws_wave.json is out of date", file=sys.stderr)
            return 1
        old = target.read_text() if target.exists() else ""
        # the Verilator patch version may differ on the CI runner
        strip = lambda s: {k: v for k, v in json.loads(s).items() if k != "simulator"} if s else {}
        if strip(old) != strip(out):
            print("rtl/rtl_check.json is out of date", file=sys.stderr)
            return 1
    elif SHIFT == 0:
        target.write_text(out)
        if wave is not None:
            wave_target.write_text(wave)
    print("RTL = model on every edge" if summary["ok"] else "MISMATCH")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    os.environ.setdefault("PYTHONHASHSEED", "0")
    sys.exit(main())
