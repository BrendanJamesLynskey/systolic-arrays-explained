"""
RTL cross-check: run the owner's output-stationary systolic array
(rtl/systolic_array_os.sv, vendored from Interview_RTL_LLM_Accelerators) in
Verilator and compare every accumulator after every clock edge with the
Python model's output-stationary frames (reference/systolic.py).

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
rtl/traces/ and the summary the site quotes to rtl/rtl_check.json.
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


def main() -> int:
    if shutil.which("verilator") is None:
        print("verilator not found on PATH", file=sys.stderr)
        return 2
    ver = subprocess.run(["verilator", "--version"], capture_output=True, text=True).stdout.split()[1]
    with tempfile.TemporaryDirectory() as tmp:
        results = [run_case(*case, Path(tmp)) for case in CASES]
    vend = json.loads((HERE / "VENDORED.json").read_text())
    summary = {
        "simulator": f"Verilator {ver}",
        "source": vend,
        "cases": results,
        "ok": all(r["mismatches"] == 0 and r["validOutEdges"] == [r["lastMacEdge"]] for r in results),
    }
    out = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    target = HERE / "rtl_check.json"
    for r in results:
        print(f"{r['name']}: {r['edges']} edges, {r['values']} accumulator values, "
              f"{r['mismatches']} mismatches, valid_out at {r['validOutEdges']} (last MAC edge {r['lastMacEdge']})")
    if "--check" in sys.argv:
        old = target.read_text() if target.exists() else ""
        # the Verilator patch version may differ on the CI runner
        strip = lambda s: {k: v for k, v in json.loads(s).items() if k != "simulator"} if s else {}
        if strip(old) != strip(out):
            print("rtl/rtl_check.json is out of date", file=sys.stderr)
            return 1
    elif SHIFT == 0:
        target.write_text(out)
    print("RTL = model on every edge" if summary["ok"] else "MISMATCH")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    os.environ.setdefault("PYTHONHASHSEED", "0")
    sys.exit(main())
