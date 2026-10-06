"""
Writes the small ONNX model chapter 9 lowers onto the array:

  reference/data/tiny_cnn.onnx   x (1 x 3 x 8 x 8) -> Conv (8 filters, 3 x 3)
                                 -> Relu -> Flatten -> Gemm (288 -> 10)

built with onnx.helper (no framework needed), weights small integers stored
as float32 so the array's integer model can run the layer exactly. Run once;
the file is committed, and tests/python reads it back (reference/lower.py).

    python3 scripts/make_onnx.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "reference"))

import systolic as S  # noqa: E402

OUT = ROOT / "reference" / "data" / "tiny_cnn.onnx"


def ints(shape: tuple[int, ...], seed: int) -> np.ndarray:
    n = int(np.prod(shape))
    flat = S.demo_matrix(1, n, seed, -2, 2)[0]
    return np.array(flat, dtype=np.float32).reshape(shape)


def main() -> int:
    w1 = numpy_helper.from_array(ints((8, 3, 3, 3), 61), "conv.weight")
    w2 = numpy_helper.from_array(ints((10, 288), 62), "fc.weight")
    nodes = [
        helper.make_node("Conv", ["x", "conv.weight"], ["conv_out"], name="conv", kernel_shape=[3, 3], strides=[1, 1], pads=[0, 0, 0, 0]),
        helper.make_node("Relu", ["conv_out"], ["relu_out"], name="relu"),
        helper.make_node("Flatten", ["relu_out"], ["flat"], name="flatten", axis=1),
        helper.make_node("Gemm", ["flat", "fc.weight"], ["y"], name="fc", transB=1),
    ]
    graph = helper.make_graph(
        nodes,
        "tiny_cnn",
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 3, 8, 8])],
        [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 10])],
        initializer=[w1, w2],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="systolic-arrays-explained")
    model.ir_version = 9
    onnx.checker.check_model(model)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(OUT))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
