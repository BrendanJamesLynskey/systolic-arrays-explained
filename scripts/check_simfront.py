"""
Cross-checks chapter 9's lowering against the author's Torch_Sim_Frontend
(simfront): runs simfront's own ONNX front end (``trace_onnx``) and GEMM
shape rule (``simfront.accel.lower.gemm_dims``) on reference/data/
tiny_cnn.onnx, and its array timing formula (``AccelConfig.array_cycles``)
on an 8 x 8 array, and records that they agree with this site's lowering
(reference/lower.py) in reference/simfront_check.json.

Manual (needs a Torch_Sim_Frontend checkout with its virtual environment);
the JSON is committed and tests/python checks the site still agrees with it:

    ~/Claude_sandbox/Torch_Sim_Frontend/.venv/bin/python scripts/check_simfront.py \
        ~/Claude_sandbox/Torch_Sim_Frontend
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "reference"))

import lower as L  # noqa: E402

ARRAY = 8


def main() -> int:
    sf = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(sf / "src"))
    from simfront.accel.hw import AccelConfig
    from simfront.accel.lower import gemm_dims
    from simfront.capture.onnx_walk import trace_onnx

    commit = subprocess.run(["git", "-C", str(sf), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    path = ROOT / "reference" / "data" / "tiny_cnn.onnx"
    trace = trace_onnx(path)
    cfg = AccelConfig(array_rows=ARRAY, array_cols=ARRAY)
    site = {e["name"]: e for e in L.lower(L.describe(str(path)), ARRAY, ARRAY)}
    nodes = []
    ok = True
    for op, name in zip(trace.ops, [n["name"] for n in L.describe(str(path))["nodes"]]):
        dims = gemm_dims(op)
        row = {"name": name, "op": op.name, "category": op.category, "simfront": [list(d) for d in dims]}
        e = site[name]
        if dims:
            b, m, k, n = dims[0]
            row["simfrontCycles"] = cfg.array_cycles(b, m, k, n)
            row["site"] = e["gemm"]
            row["siteApprox"] = e["approx"]
            row["agree"] = list(dims[0]) == e["gemm"] and row["simfrontCycles"] == e["approx"]
        else:
            row["agree"] = e["unit"] != "array"
        ok &= row["agree"]
        nodes.append(row)
    out = {"simfront": {"repo": "https://github.com/BrendanJamesLynskey/Torch_Sim_Frontend", "commit": commit}, "array": ARRAY, "nodes": nodes, "ok": ok}
    (ROOT / "reference" / "simfront_check.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    for r in nodes:
        print(r)
    print("simfront agrees" if ok else "MISMATCH")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
