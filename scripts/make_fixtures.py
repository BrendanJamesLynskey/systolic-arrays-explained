"""
Writes the parity fixtures from the Python reference (reference/systolic.py):

  tests/fixtures/sa_fixtures.json   results the TypeScript port must reproduce
                                    exactly (tests/unit/model.test.ts and the
                                    frame tests), chapters 1-4
  tests/fixtures/sa_fixtures_b.json the same for chapters 5-9: tiles back to
                                    back (systolic.py), the processing element
                                    (pe.py), the torus all-reduce (torus.py),
                                    the ONNX lowering (lower.py)
  src/lib/sa/tiny_cnn.json          the ONNX model chapter 9 lowers, as plain
                                    data the site imports (lower.describe)

Every frame of the chapters' demonstrations is stored in full; every other
problem size the widgets offer (every dataflow, M 1-8, K 2-4, N 2-4) is
stored as a digest: a SHA-256 over the IEEE bit patterns of every number in
the trace (see ``digest``), which the TypeScript tests recompute.

    python3 scripts/make_fixtures.py          # write
    python3 scripts/make_fixtures.py --check  # fail if out of date (CI)

The model is integer arithmetic (utilisation is one IEEE division), so the
check is byte for byte: there is no maths-library tolerance to allow.
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "reference"))

import lower as L  # noqa: E402
import pe as P  # noqa: E402
import systolic as S  # noqa: E402
import torus as T  # noqa: E402


def hexf(x: float) -> str:
    return struct.pack(">d", float(x)).hex()


def flat(obj, out: list[str]) -> None:
    if isinstance(obj, bool):
        out.append("t" if obj else "f")
    elif isinstance(obj, (int, float)):
        out.append(hexf(obj))
    elif isinstance(obj, (list, tuple)):
        out.append("[")
        for o in obj:
            flat(o, out)
        out.append("]")
    elif isinstance(obj, dict):
        out.append("{")
        for k in sorted(obj):
            out.append(k)
            flat(obj[k], out)
        out.append("}")
    elif obj is None:
        out.append("null")
    else:
        out.append(str(obj))


def digest(obj) -> str:
    """SHA-256 of a canonical serialisation (tests/unit/helpers/digest.ts)."""
    parts: list[str] = []
    flat(obj, parts)
    return hashlib.sha256(",".join(parts).encode()).hexdigest()


def run(df: str, m: int, k: int, n: int, rows: int | None = None, cols: int | None = None):
    a, b = S.demo_pair(m, k, n)
    need = {"ws": (k, n), "os": (m, n), "is": (k, m)}[df]
    return S.simulate(df, a, b, rows or need[0], cols or need[1])


def fixtures() -> dict:
    d = S.DEMO
    out: dict = {"demo": d}
    out["matrices"] = {
        "a54": S.demo_matrix(5, 4, d["seedA"]),
        "b44": S.demo_matrix(4, 4, d["seedB"]),
        "wide": S.demo_matrix(3, 6, 99, -128, 127),
    }
    # full traces of the chapters' default demonstrations
    h, w, c, wv = d["hero"], d["ws"], d["cmp"], d["wave"]
    out["traces"] = {
        "hero": run("ws", h["M"], h["K"], h["N"]),
        "ws": run("ws", w["M"], w["K"], w["N"]),
        "cmp_ws": run("ws", c["M"], c["K"], c["N"]),
        "cmp_os": run("os", c["M"], c["K"], c["N"]),
        "cmp_is": run("is", c["M"], c["K"], c["N"]),
        "wave": run("ws", wv["M"], wv["K"], wv["N"]),
        # a block smaller than the array: idle PEs stay empty
        "os_in_5x6": run("os", 3, 4, 2, 5, 6),
    }
    # every size the widgets offer, as digests
    rng = d["range"]
    sweep = {}
    for df in S.DATAFLOWS:
        for m in range(rng["M"][0], rng["M"][1] + 1):
            for k in range(rng["K"][0], rng["K"][1] + 1):
                for n in range(rng["N"][0], rng["N"][1] + 1):
                    tr = run(df, m, k, n)
                    sweep[f"{df}-{m}-{k}-{n}"] = {"cycles": tr["cycles"], "digest": digest(tr)}
    out["sweep"] = sweep
    out["closed"] = {
        f"{df}-{m}-{k}-{n}": {"cycles": S.cycles(df, m, k, n), "traffic": S.traffic(df, m, k, n)}
        for df in S.DATAFLOWS
        for (m, k, n) in [(1, 1, 1), (3, 3, 3), (5, 4, 4), (8, 2, 3), (256, 256, 256)]
    }
    a, b = S.demo_matrix(7, 9, 3), S.demo_matrix(9, 5, 4)
    out["tiled"] = {
        df: {
            "tiles": S.tiles(df, 7, 9, 5, 3, 4),
            "cycles": S.tiled_cycles(df, 7, 9, 5, 3, 4),
            "run": S.simulate_tiled(df, a, b, 3, 4),
        }
        for df in S.DATAFLOWS
    }
    out["reuse"] = S.reuse_steps(d["beta"], d["reuseMax"])
    out["util"] = {
        df: S.util_steps(df, d["array"], d["array"], d["array"], d["array"], d["utilMax"]) for df in S.DATAFLOWS
    }
    out["shape"] = {
        df: S.shape_steps(df, d["array"], d["array"], d["shape"]["M"], d["shape"]["K"], d["shape"]["nMax"])
        for df in S.DATAFLOWS
    }
    wave = out["traces"]["wave"]
    out["active"] = S.active_per_cycle(wave)
    rs = d["rs"]
    x = S.demo_matrix(rs["H"], rs["W"], rs["seedX"])
    f = S.demo_matrix(rs["R"], rs["S"], rs["seedF"])
    out["rs"] = {"x": x, "f": f, "trace": S.simulate_rs(x, f)}
    return out


def stream_run(m: int, shadow: bool, bw: int, buffers: int):
    d = S.DEMO["stream"]
    a, b = S.demo_pair(m, d["K"], d["N"])
    return S.simulate_ws_stream(a, b, d["array"], d["array"], bw or None, buffers, shadow)


def fixtures_b() -> dict:
    d = S.DEMO
    out: dict = {}
    st = d["stream"]
    # chapter 5: full traces of the default and two variants
    out["stream"] = {
        "default": stream_run(st["M"], True, 0, 2),
        "noShadow": stream_run(st["M"], False, 0, 2),
        "bw1single": stream_run(st["M"], True, 1, 1),
    }
    sweep = {}
    for m in range(st["mRange"][0], st["mRange"][1] + 1):
        for shadow in (True, False):
            for bw in st["bws"]:
                for buffers in (1, 2):
                    tr = stream_run(m, shadow, bw, buffers)
                    sweep[f"{m}-{int(shadow)}-{bw}-{buffers}"] = {"cycles": tr["cycles"], "digest": digest(tr)}
    out["streamSweep"] = sweep
    bwd = d["bw"]
    out["bandwidth"] = {
        str(m): [
            {
                "array": r,
                **{
                    df: {
                        "words": S.tiled_words(df, m, bwd["K"], bwd["N"], r, r),
                        "cycles": S.tiled_cycles(df, m, bwd["K"], bwd["N"], r, r),
                    }
                    for df in S.DATAFLOWS
                },
            }
            for r in bwd["arrays"]
        ]
        for m in bwd["Ms"]
    }
    a, b = S.demo_matrix(7, 9, 3), S.demo_matrix(9, 5, 4)
    out["tiledWords"] = {df: S.tiled_words(df, 7, 9, 5, 3, 4) for df in S.DATAFLOWS}
    # chapter 6: the processing element, every mode's demonstration in full
    out["pe"] = {mode: P.demo_trace(mode) for mode in P.MODES}
    out["peDemo"] = P.DEMO_PE
    out["peOps"] = {
        mode: P.demo_ops(mode, P.DEMO_PE["count"], P.DEMO_PE["seed"][mode], P.DEMO_PE["every"], *P.DEMO_PE["exp"][mode])
        for mode in P.MODES
    }
    out["peLong"] = {
        mode: digest(P.mac_pipeline(mode, P.demo_ops(mode, 200, 90, 17, -14 if mode == "fp16" else -30, 15 if mode == "fp16" else 30, True)))
        for mode in P.MODES
    }
    # chapter 7: the torus, the default in full and every size as a digest
    out["torus"] = T.demo_run()
    out["torusDemo"] = T.DEMO_TORUS
    out["torusSweep"] = {f"{x}-{y}": digest(T.demo_run(x, y)) for x in range(2, 5) for y in range(2, 5)}
    # chapter 9: the ONNX model, lowered onto three array sizes
    desc = L.describe(str(ROOT / "reference" / "data" / "tiny_cnn.onnx"))
    arr = L.DEMO_LOWER["array"]
    out["lower"] = {
        "layers": {str(r): L.lower(desc, r, r) for r in (4, 8, 16)},
        "steps": {str(r): L.lower_steps(desc, r, r) for r in (4, 8, 16)},
        "conv": L.run_conv(desc, arr, arr),
        "demo": L.DEMO_LOWER,
    }
    return out


def describe_json() -> str:
    desc = L.describe(str(ROOT / "reference" / "data" / "tiny_cnn.onnx"))
    return json.dumps(desc, indent=1, sort_keys=True) + "\n"


def dump(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), sort_keys=True, allow_nan=False) + "\n"


TARGETS = {
    ROOT / "tests" / "fixtures" / "sa_fixtures.json": lambda: dump(fixtures()),
    ROOT / "tests" / "fixtures" / "sa_fixtures_b.json": lambda: dump(fixtures_b()),
    ROOT / "src" / "lib" / "sa" / "tiny_cnn.json": describe_json,
}


def main() -> int:
    bad = 0
    for target, make in TARGETS.items():
        text = make()
        rel = target.relative_to(ROOT)
        if "--check" in sys.argv:
            if not target.exists() or target.read_text() != text:
                print(f"out of date (run python3 scripts/make_fixtures.py): {rel}")
                bad += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        print(f"wrote {rel} ({len(text):,} bytes)")
    if "--check" in sys.argv and not bad:
        print("fixtures are up to date")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
