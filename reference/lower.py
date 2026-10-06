"""
From graph to silicon: the Python reference for chapter 9.

Lowers a small ONNX model (reference/data/tiny_cnn.onnx: Conv -> Relu ->
Flatten -> Gemm, written by scripts/make_onnx.py) onto a systolic array:

* ``describe`` reads the ONNX file (the only function that needs the
  ``onnx`` package) into a plain description: the nodes, every tensor's
  shape, the Conv's attributes and its weights. The site imports that
  description as JSON (src/lib/sa/tiny_cnn.json, written by
  scripts/make_fixtures.py) and the TypeScript port lowers it again.
* A convolution becomes a GEMM by im2col: one row of A per output pixel
  (the C x R x S input patch it sees), one column of B per filter, so
  M = H_out W_out (per image), K = C R S, N = C_out. A Gemm (fully
  connected) layer is already one: M = batch, K = in, N = out. Relu goes to
  the vector unit; Flatten is a view (no data moves).
* Each GEMM is tiled onto the R x C array and timed by the cycle-accurate
  model (reference/systolic.py): weight-stationary tiles back to back with
  double-buffered weights (``stream_schedule``), and tiles in sequence for
  comparison; next to them, the cycle-approximate formula of the author's
  Torch_Sim_Frontend accelerator model (``simfront.accel``, output-
  stationary): batch x ceil(m / R) x ceil(n / C) x k + R + C.

``scripts/check_simfront.py`` runs Torch_Sim_Frontend's own ONNX front end
on the same file and records that it finds the same GEMM shapes
(reference/simfront_check.json).
"""
from __future__ import annotations

from typing import Any

import systolic as S

# The sample input image the chapter runs through the layer (not part of the
# ONNX file, which only has the weights): 3 channels of 8 x 8 small integers.
SAMPLE_SEED = 63


def describe(path: str) -> dict[str, Any]:
    """The ONNX graph as plain data (needs the onnx package)."""
    import onnx
    from onnx import numpy_helper, shape_inference

    m = shape_inference.infer_shapes(onnx.load(path))
    g = m.graph
    shapes: dict[str, list[int]] = {}
    for v in [*g.input, *g.value_info, *g.output]:
        shapes[v.name] = [d.dim_value for d in v.type.tensor_type.shape.dim]
    inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
    for name, arr in inits.items():
        shapes[name] = list(arr.shape)
    nodes = []
    for n in g.node:
        attrs = {a.name: list(a.ints) if a.ints else a.i for a in n.attribute}
        nodes.append({"name": n.name, "op": n.op_type, "inputs": list(n.input), "outputs": list(n.output), "attrs": attrs})
    conv = next(n for n in nodes if n["op"] == "Conv")
    w = inits[conv["inputs"][1]]
    return {
        "name": g.name,
        "opset": m.opset_import[0].version,
        "nodes": nodes,
        "shapes": shapes,
        "convWeight": [[[[int(v) for v in row] for row in ch] for ch in f] for f in w.tolist()],
    }


def sample_input(c: int, h: int, w: int) -> list[list[list[int]]]:
    flat = S.demo_matrix(1, c * h * w, SAMPLE_SEED, -3, 3)[0]
    return [[[flat[(ci * h + i) * w + j] for j in range(w)] for i in range(h)] for ci in range(c)]


def im2col(x: list[list[list[int]]], r: int, s: int) -> list[list[int]]:
    """Row (i, j) of the output: the C x R x S patch at (i, j), channel-major
    (stride 1, no padding: the model's Conv)."""
    c, h, w = len(x), len(x[0]), len(x[0][0])
    rows = []
    for i in range(h - r + 1):
        for j in range(w - s + 1):
            rows.append([x[ci][i + di][j + dj] for ci in range(c) for di in range(r) for dj in range(s)])
    return rows


def weight_matrix(wt: list[list[list[list[int]]]]) -> list[list[int]]:
    """B (K x C_out): column f is filter f flattened in im2col's order."""
    co, c, r, s = len(wt), len(wt[0]), len(wt[0][0]), len(wt[0][0][0])
    return [[wt[f][ci][di][dj] for f in range(co)] for ci in range(c) for di in range(r) for dj in range(s)]


def conv_direct(x: list[list[list[int]]], wt: list[list[list[list[int]]]]) -> list[list[list[int]]]:
    """out[f][i][j]: the direct triple loop, to check the lowering."""
    c, h, w = len(x), len(x[0]), len(x[0][0])
    r, s = len(wt[0][0]), len(wt[0][0][0])
    out = []
    for f in range(len(wt)):
        plane = []
        for i in range(h - r + 1):
            row = []
            for j in range(w - s + 1):
                acc = 0
                for ci in range(c):
                    for di in range(r):
                        for dj in range(s):
                            acc += x[ci][i + di][j + dj] * wt[f][ci][di][dj]
                row.append(acc)
            plane.append(row)
        out.append(plane)
    return out


def approx_cycles(batch: int, m: int, k: int, n: int, rows: int, cols: int) -> int:
    """simfront.accel's AccelConfig.array_cycles (Torch_Sim_Frontend
    src/simfront/accel/hw.py): output-stationary, each R x C block of
    outputs accumulates for k cycles, fill and drain counted once."""
    return batch * S._ceil_div(m, rows) * S._ceil_div(n, cols) * k + rows + cols


def lower(desc: dict[str, Any], rows: int, cols: int) -> list[dict[str, Any]]:
    """One entry per node: which unit runs it and, for a GEMM, its shape,
    tiles and cycles."""
    shapes = desc["shapes"]
    out = []
    for nd in desc["nodes"]:
        op = nd["op"]
        o = shapes[nd["outputs"][0]]
        entry: dict[str, Any] = {"name": nd["name"], "op": op, "out": o}
        if op in ("Conv", "Gemm"):
            if op == "Conv":
                x, w = shapes[nd["inputs"][0]], shapes[nd["inputs"][1]]
                batch, m, k, n = 1, o[0] * o[2] * o[3], w[1] * w[2] * w[3], w[0]
            else:
                x, w = shapes[nd["inputs"][0]], shapes[nd["inputs"][1]]
                trans_b = nd["attrs"].get("transB", 0)
                batch, m, k, n = 1, x[0], x[1], (w[0] if trans_b else w[1])
            sched = S.stream_schedule(m, k, n, rows, cols)
            entry.update(
                {
                    "unit": "array",
                    "gemm": [batch, m, k, n],
                    "macs": batch * m * k * n,
                    "tiles": len(sched["tiles"]),
                    "stream": sched["cycles"],
                    "seqWs": S.tiled_cycles("ws", m, k, n, rows, cols),
                    "seqOs": S.tiled_cycles("os", m, k, n, rows, cols),
                    "approx": approx_cycles(batch, m, k, n, rows, cols),
                }
            )
            entry["util"] = S.utilisation(entry["macs"], rows, cols, entry["stream"])
        elif op == "Relu":
            size = 1
            for d in o:
                size *= d
            entry.update({"unit": "vector", "elements": size})
        else:
            entry.update({"unit": "view"})
        out.append(entry)
    return out


def run_conv(desc: dict[str, Any], rows: int, cols: int) -> dict[str, Any]:
    """The Conv node, run on the cycle-accurate array: im2col, then the
    tiles back to back. Returns A, B, the array's C and the direct result."""
    w = desc["convWeight"]
    xs = desc["shapes"]["x"]
    x = sample_input(xs[1], xs[2], xs[3])
    a = im2col(x, len(w[0][0]), len(w[0][0][0]))
    b = weight_matrix(w)
    tr = S.simulate_ws_stream(a, b, rows, cols)
    return {"x": x, "A": a, "B": b, "C": tr["C"], "cycles": tr["cycles"], "direct": conv_direct(x, w)}


DEMO_LOWER: dict[str, Any] = {"array": 8}


def lower_steps(desc: dict[str, Any], rows: int, cols: int) -> list[dict[str, Any]]:
    """The animation: the Conv node, then one step per row of im2col, one
    per tile of the Conv's GEMM, then Relu, Flatten and the Gemm."""
    layers = lower(desc, rows, cols)
    conv = layers[0]
    _, m, k, n = conv["gemm"]
    steps: list[dict[str, Any]] = [{"kind": "node", "layer": 0}]
    for p in range(m):
        steps.append({"kind": "im2col", "layer": 0, "row": p})
    sched = S.stream_schedule(m, k, n, rows, cols)
    for tl in sched["tiles"]:
        steps.append({"kind": "tile", "layer": 0, "tile": tl["j"], "k0": tl["k0"], "k": tl["k"], "n0": tl["n0"], "n": tl["n"], "stream": tl["stream"], "end": tl["end"]})
    for i in range(1, len(layers)):
        steps.append({"kind": "node", "layer": i})
    steps.append({"kind": "summary", "layer": len(layers) - 1})
    return steps
