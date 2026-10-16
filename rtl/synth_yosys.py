"""
Synthesis numbers for the site's RTL, from Yosys (open source, reproducible).

What is synthesised:

* the processing elements: the weight-stationary PE (rtl/systolic_array_ws.sv,
  INT8 x INT8 into INT32, with its shadow weight), the output-stationary PE
  (module ``pe`` of rtl/systolic_array_os.sv) and the author's mixed-precision
  MAC unit (rtl/mac_unit.sv) with both datapaths, INT8 only and FP16 only
  (its mode pin tied in rtl/synth/wrappers.v);
* the two arrays at three sizes (4 x 4, 8 x 8, 16 x 16);
* a bare unsigned W x W multiplier at several widths, to test chapter 6's
  "multiplier size scales with the square of the mantissa width".

Two flows, both in Yosys:

* ``generic``: ``synth -flatten`` to Yosys's internal gate library (AND,
  NAND, OR, NOR, XOR, XNOR, ANDNOT, ORNOT, MUX, NOT and flip-flops), then
  ``ltp -noff`` for the logic depth (gates on the longest flip-flop-to-
  flip-flop or port path), then every flip-flop mapped to a plain D
  flip-flop (enables and synchronous resets become gates) and
  ``stat -tech cmos`` for Yosys's transistor-count estimate (a static CMOS
  gate's transistor count, summed: an area proxy with no wires, no layout
  and no process node; no standard-cell library is used);
* ``xc7``: ``synth_xilinx -family xc7 -flatten`` (AMD 7-series LUT6, FDRE,
  CARRY4, DSP48E1) and ``ltp -noff`` for the levels of cells on the longest
  path. This is Yosys's FPGA mapping, not Vivado's: no placement, no
  routing and no timing, so no Fmax.

Yosys is the YoWASP build (``pip install -r rtl/requirements-synth.txt``,
a WebAssembly binary, so every machine gets the same result), and
rtl/mac_unit.sv goes through sv2v first (Yosys's own front end does not
accept its ``break``); the other designs are read directly.

    python3 rtl/synth_yosys.py           # synthesise; write rtl/synth.json
    python3 rtl/synth_yosys.py --check   # also fail if rtl/synth.json changes

Environment: YOSYS (default ``yowasp-yosys``), SV2V (default ``sv2v``).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
YOSYS = os.environ.get("YOSYS", "yowasp-yosys")
SV2V = os.environ.get("SV2V", "sv2v")

WS = HERE / "systolic_array_ws.sv"
OS = HERE / "systolic_array_os.sv"
WRAP = HERE / "synth" / "wrappers.v"
MAC_V = "mac_unit.v"  # sv2v output, in the work directory

# (key, group, label, sources, top, parameters)
DESIGNS: list[tuple[str, str, str, list, str, dict[str, int]]] = [
    ("pe-ws", "pe", "Weight-stationary PE (INT8, shadow weight)", [WS], "ws_pe", {}),
    ("pe-os", "pe", "Output-stationary PE (INT8)", [OS], "pe", {}),
    ("mac-int8", "pe", "MAC unit, INT8 mode only", [MAC_V, WRAP], "mac_int8_only", {}),
    ("mac-fp16", "pe", "MAC unit, FP16 mode only", [MAC_V, WRAP], "mac_fp16_only", {}),
    ("mac-both", "pe", "MAC unit, both modes", [MAC_V], "mac_unit_mixed_precision", {}),
    *[
        (f"ws-{n}", "array", f"Weight-stationary array {n} x {n}", [WS], "systolic_array_ws", {"ROWS": n, "COLS": n})
        for n in (4, 8, 16)
    ],
    *[
        (f"os-{n}", "array", f"Output-stationary array {n} x {n}", [OS], "systolic_array", {"N": n})
        for n in (4, 8, 16)
    ],
    *[
        (f"mul-{w}", "mul", f"Unsigned {w} x {w} multiplier", [WRAP], "umul", {"W": w})
        for w in (4, 8, 11, 16, 24)
    ],
]

FLOWS = ("generic", "xc7")


def run_yosys(script: str, cwd: Path) -> None:
    subprocess.run([YOSYS, "-q", "-p", script], check=True, cwd=cwd, stdout=subprocess.DEVNULL)


def read_cmd(sources: list, top: str, params: dict[str, int]) -> str:
    cmds = []
    for s in sources:
        s = str(s)
        cmds.append(f"read_verilog {'-sv ' if s.endswith('.sv') else ''}{s}")
    if params:
        sets = " ".join(f"-set {k} {v}" for k, v in params.items())
        cmds.append(f"chparam {sets} {top}")
    return "; ".join(cmds)


def ltp_length(path: Path) -> int:
    m = re.search(r"Longest topological path in .* \(length=(\d+)\)", path.read_text())
    if not m:
        raise RuntimeError(f"no ltp result in {path}")
    return int(m.group(1))


def design_stats(path: Path) -> dict:
    return json.loads(path.read_text())["design"]


def synth(key: str, sources: list, top: str, params: dict[str, int], work: Path) -> dict:
    d = work / key
    d.mkdir()
    # YoWASP's sandbox sees the working directory, so the sources go there
    for src in sources:
        shutil.copy(src, d / Path(src).name)
    rd = read_cmd([Path(src).name for src in sources], top, params)
    # generic gates
    run_yosys(
        f"{rd}; synth -flatten -top {top}; delete t:$scopeinfo; "
        "tee -q -o gen.json stat -json; tee -q -o gen_ltp.txt ltp -noff; "
        "dfflegalize -cell $_DFF_P_ 0; opt_clean; tee -q -o gen_cmos.json stat -json -tech cmos",
        d,
    )
    gen = design_stats(d / "gen.json")
    cells = gen["num_cells_by_type"]
    ffs = sum(v for c, v in cells.items() if "DFF" in c)
    cmos = design_stats(d / "gen_cmos.json")
    transistors = cmos["estimated_num_transistors"]
    if not str(transistors).isdigit():
        raise RuntimeError(f"{key}: incomplete transistor estimate {transistors}")
    generic = {
        "cells": gen["num_cells"],
        "flipFlops": ffs,
        "gates": gen["num_cells"] - ffs,
        "depth": ltp_length(d / "gen_ltp.txt"),
        "transistors": int(transistors),
        "byType": dict(sorted(cells.items())),
    }
    # AMD 7-series mapping
    run_yosys(
        f"{rd}; synth_xilinx -family xc7 -flatten -top {top}; delete t:$scopeinfo; "
        "tee -q -o x.json stat -json; tee -q -o x_ltp.txt ltp -noff",
        d,
    )
    x = design_stats(d / "x.json")
    xc = x["num_cells_by_type"]
    luts = sum(v for c, v in xc.items() if re.fullmatch(r"LUT\d", c))
    xc7 = {
        "luts": luts,
        "flipFlops": sum(v for c, v in xc.items() if re.fullmatch(r"FD[A-Z]*", c)),
        "carry4": xc.get("CARRY4", 0),
        "dsp48": xc.get("DSP48E1", 0),
        "muxf": xc.get("MUXF7", 0) + xc.get("MUXF8", 0),
        "levels": ltp_length(d / "x_ltp.txt"),
        "byType": dict(sorted(xc.items())),
    }
    return {"generic": generic, "xc7": xc7}


def main() -> int:
    for tool in (YOSYS, SV2V):
        if shutil.which(tool) is None:
            print(f"{tool} not found (see the docstring)", file=sys.stderr)
            return 2
    yver = subprocess.run([YOSYS, "-V"], capture_output=True, text=True, check=True).stdout.strip()
    sver = subprocess.run([SV2V, "--numeric-version"], capture_output=True, text=True, check=True).stdout.strip()
    out: dict = {
        "tools": {
            "yosys": re.sub(r" \(git sha1 ([0-9a-f]+).*", r" (git \1)", yver),
            "sv2v": sver,
            "flows": {
                "generic": "synth -flatten; ltp -noff; dfflegalize -cell $_DFF_P_ 0; stat -tech cmos",
                "xc7": "synth_xilinx -family xc7 -flatten; ltp -noff",
            },
        },
        "designs": [],
    }
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        conv = subprocess.run([SV2V, str(HERE / "mac_unit.sv")], check=True, capture_output=True, text=True)
        (work / MAC_V).write_text(conv.stdout)
        for key, group, label, sources, top, params in DESIGNS:
            srcs = [work / s if isinstance(s, str) else s for s in sources]
            r = synth(key, srcs, top, params, work)
            out["designs"].append({"key": key, "group": group, "label": label, "top": top, "params": params, **r})
            g, x = r["generic"], r["xc7"]
            print(f"{key:9s} generic {g['gates']:6d} gates {g['flipFlops']:5d} FF depth {g['depth']:3d} "
                  f"{g['transistors']:8d} T | xc7 {x['luts']:6d} LUT {x['flipFlops']:5d} FF "
                  f"{x['carry4']:4d} CARRY4 {x['dsp48']:3d} DSP levels {x['levels']}")
    text = json.dumps(out, indent=2, sort_keys=True) + "\n"
    target = HERE / "synth.json"
    if "--check" in sys.argv:
        if not target.exists() or target.read_text() != text:
            print("rtl/synth.json is out of date", file=sys.stderr)
            return 1
    else:
        target.write_text(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
