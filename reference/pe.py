"""
Inside a processing element: the Python reference for chapter 6.

A cycle-accurate model of the author's mixed-precision MAC unit
(rtl/mac_unit.sv, vendored unchanged from Interview_RTL_LLM_Accelerators):
three pipeline stages, register for register.

  stage 1   registers the inputs: the two operands, ``valid`` and ``clear``;
  stage 2   multiplies them and registers the product: INT8 x INT8 into
            16 bits, or two 16-bit floats into an FP32 product with no
            rounding (an 11 x 11-bit significand product fits FP32's 24 bits);
  stage 3   adds the product to the accumulator: INT32 with saturation, or
            FP32 with round-to-nearest-even and subnormals flushed to zero.
            ``clear`` starts a new dot product (the accumulator takes the
            product instead of adding it).

The RTL implements INT8 and FP16. This model adds a bfloat16 mode on the same
pipeline: a bfloat16 is the top half of an FP32, so its 8-bit significands
multiply into 16 bits, again exact in FP32 (Kalamkar et al., 2019; Google's
bfloat16 notes). ``rtl/check_rtl.py`` runs the RTL in Verilator and compares
every register after every clock edge with ``mac_pipeline`` in the INT8 and
FP16 modes; the bfloat16 mode is checked against NumPy float32 arithmetic in
tests/python.

Numbers are carried as bit patterns (Python ints), so the TypeScript port
(src/lib/sa/pe.ts) reproduces them exactly. The FP32 add is computed in
double precision and rounded once to FP32: for addition, a double holds
enough bits (53 >= 2 x 24 + 2) that rounding the double result to FP32 gives
the correctly rounded FP32 sum (Figueroa, 1995), which is what the RTL's
guard, round and sticky bits compute.
"""
from __future__ import annotations

import math
import struct
from typing import Any

from systolic import Rng

# (exponent bits, mantissa bits, bias) of the 16-bit float formats
FORMATS: dict[str, tuple[int, int, int]] = {
    "fp16": (5, 10, 15),
    "bf16": (8, 7, 127),
}
MODES = ("int8", "fp16", "bf16")

INT32_MAX = 2**31 - 1
INT32_MIN = -(2**31)
FP32_MIN_NORMAL = 2.0**-126


# ---------------------------------------------------------------------------
# Bit patterns
# ---------------------------------------------------------------------------


def f32_bits(x: float) -> int:
    """The FP32 bit pattern of a double, rounded to nearest even."""
    return struct.unpack(">I", struct.pack(">f", x))[0]


def f32_value(bits: int) -> float:
    return struct.unpack(">f", struct.pack(">I", bits & 0xFFFFFFFF))[0]


def half_value(fmt: str, bits: int) -> float:
    """The value of a normal (or zero) 16-bit float; subnormals flush to 0."""
    e_bits, m_bits, bias = FORMATS[fmt]
    sign = -1.0 if (bits >> 15) & 1 else 1.0
    e = (bits >> m_bits) & ((1 << e_bits) - 1)
    m = bits & ((1 << m_bits) - 1)
    if e == 0:
        return sign * 0.0
    if e == (1 << e_bits) - 1:
        raise ValueError("Inf and NaN inputs are outside this model")
    return sign * math.ldexp((1 << m_bits) + m, e - bias - m_bits)


def fields(fmt: str, bits: int) -> tuple[int, int, int]:
    """(sign, biased exponent, mantissa) of a 16-bit float or an FP32."""
    e_bits, m_bits, _ = FORMATS[fmt] if fmt in FORMATS else (8, 23, 127)
    return (bits >> (e_bits + m_bits)) & 1, (bits >> m_bits) & ((1 << e_bits) - 1), bits & ((1 << m_bits) - 1)


def sext8(v: int) -> int:
    v &= 0xFF
    return v - 256 if v & 0x80 else v


# ---------------------------------------------------------------------------
# The two arithmetic units
# ---------------------------------------------------------------------------


def mul_to_fp32(fmt: str, a: int, b: int) -> int:
    """The FP32 product of two 16-bit floats, exact (no rounding needed).

    A zero (or flushed subnormal) operand gives a signed zero, as the RTL's
    ``fp16_mul_to_fp32`` does: its sign is the XOR of the signs.
    """
    va, vb = half_value(fmt, a), half_value(fmt, b)
    if va == 0.0 or vb == 0.0:
        return (((a ^ b) >> 15) & 1) << 31
    p = va * vb  # exact: at most 22 significant bits
    bits = f32_bits(p)
    if f32_value(bits) != p:
        raise AssertionError("product not exact in FP32")  # pragma: no cover
    return bits


def fp32_add(acc: int, p: int) -> int:
    """acc + p in FP32: round to nearest even, flush subnormal results to +0.

    An exact zero is +0 (the RTL returns 32'd0), whatever the operands' signs.
    """
    s = f32_value(acc) + f32_value(p)  # double; rounded once below
    r = f32_bits(s)
    v = f32_value(r)
    if v == 0.0 or abs(v) < FP32_MIN_NORMAL:
        return 0
    return r


def sat32(v: int) -> int:
    return max(INT32_MIN, min(INT32_MAX, v))


# ---------------------------------------------------------------------------
# The pipeline, cycle by cycle
# ---------------------------------------------------------------------------


def mac_pipeline(mode: str, ops: list[list[int]], drain: int = 3) -> dict[str, Any]:
    """Run a sequence of operations through the three-stage MAC.

    ``ops`` is one entry per clock cycle: ``[a, b, clear, valid]``, with a
    and b as 16-bit patterns (an INT8 operand sign-extended to 16 bits, as
    the RTL's port expects). ``drain`` idle cycles follow, so the last
    product reaches the accumulator. Frame t is every register after the
    rising edge that ends cycle t:

      ``s1``   [a, b, valid, clear]       the registered inputs
      ``s2``   [product, valid, clear]    INT16 value, or FP32 bits
      ``acc``  the accumulator            INT32 value, or FP32 bits
      ``vout`` stage 3's valid (the RTL's valid_out)

    ``event`` says what stage 3 did in this cycle (``clear``, ``add``,
    ``hold``), with the accumulator before the edge, for the captions.
    """
    if mode not in MODES:
        raise ValueError(f"unknown mode {mode!r}")
    fp = mode != "int8"
    s1 = [0, 0, 0, 0]
    s2 = [0, 0, 0]
    acc = 0
    vout = 0
    frames: list[dict[str, Any]] = []
    seq = list(ops) + [[0, 0, 0, 0]] * drain
    macs = 0
    for t, (a, b, clear, valid) in enumerate(seq):
        # stage 3 (from the old s2)
        p, v2, c2 = s2
        before = acc
        if c2:
            acc = p if v2 else 0
            event = "clear"
        elif v2:
            acc = fp32_add(acc, p) if fp else sat32(acc + p)
            event = "add"
        else:
            event = "hold"
        if v2:
            macs += 1
        vout = v2
        # stage 2 (from the old s1)
        a1, b1, v1, c1 = s1
        prod = mul_to_fp32(mode, a1, b1) if fp and v1 else (sext8(a1) * sext8(b1) if not fp else 0)
        s2 = [prod, v1, c1]
        # stage 1 (the inputs)
        s1 = [a & 0xFFFF, b & 0xFFFF, valid, clear]
        frames.append(
            {
                "t": t,
                "in": [a & 0xFFFF, b & 0xFFFF, clear, valid],
                "s1": list(s1),
                "s2": list(s2),
                "acc": acc,
                "vout": vout,
                "event": [event, before],
                "macs": macs,
            }
        )
    return {"mode": mode, "cycles": len(frames), "frames": frames}


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------


def demo_half(fmt: str, rng: Rng, e_lo: int, e_hi: int) -> int:
    """A random normal 16-bit float with unbiased exponent in [e_lo, e_hi]."""
    e_bits, m_bits, bias = FORMATS[fmt]
    sign = rng.u32() & 1
    e = bias + rng.int_in(e_lo, e_hi)
    m = rng.u32() & ((1 << m_bits) - 1)
    return (sign << 15) | (e << m_bits) | m


def demo_ops(mode: str, count: int, seed: int, every: int = 0, e_lo: int = -3, e_hi: int = 3, gaps: bool = False) -> list[list[int]]:
    """``count`` operations: random operands, ``clear`` on the first (and
    every ``every``-th), and with ``gaps`` some idle (valid = 0) cycles."""
    rng = Rng(seed)
    ops = []
    for i in range(count):
        if mode == "int8":
            a = rng.int_in(-128, 127) & 0xFFFF
            b = rng.int_in(-128, 127) & 0xFFFF
        else:
            a = demo_half(mode, rng, e_lo, e_hi)
            b = demo_half(mode, rng, e_lo, e_hi)
        clear = 1 if i == 0 or (every and i % every == 0) else 0
        valid = 0 if gaps and not clear and rng.u32() % 5 == 0 else 1
        if not valid:
            a = b = 0
        ops.append([a, b, clear, valid])
    return ops


def dot_reference(mode: str, ops: list[list[int]]) -> list[float | int]:
    """The dot products the MAC should produce, one per ``clear`` group,
    accumulated in order with one rounding per add (FP32) or exactly (INT)."""
    out: list[float | int] = []
    acc: float | int | None = None
    for a, b, clear, valid in ops:
        if clear:
            if acc is not None:
                out.append(acc)
            acc = 0
        if not valid:
            continue
        if mode == "int8":
            acc = sat32(int(acc) + sext8(a) * sext8(b))  # type: ignore[arg-type]
        else:
            p = half_value(mode, a) * half_value(mode, b)
            acc = f32_value(f32_bits(acc + p)) if clear == 0 else p  # type: ignore[operator]
    if acc is not None:
        out.append(acc)
    return out


DEMO_PE: dict[str, Any] = {
    # chapter 6: two dot products of four terms, one after the other
    "count": 8,
    "every": 4,
    "seed": {"int8": 41, "fp16": 42, "bf16": 49},
    # unbiased exponents of the operands: bfloat16's products have 16
    # significant bits, so a wider spread is needed before an FP32 add rounds
    "exp": {"int8": [0, 0], "fp16": [-3, 3], "bf16": [-4, 4]},
}


def demo_trace(mode: str) -> dict[str, Any]:
    d = DEMO_PE
    lo, hi = d["exp"][mode]
    return mac_pipeline(mode, demo_ops(mode, d["count"], d["seed"][mode], d["every"], lo, hi))
