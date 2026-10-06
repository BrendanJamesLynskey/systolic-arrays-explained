/**
 * Chapter 6: inside a processing element. A line-for-line port of
 * reference/pe.py (read its docstring): the author's three-stage
 * mixed-precision MAC unit (rtl/mac_unit.sv), register for register, in
 * INT8, FP16 and bfloat16. Numbers are bit patterns; the FP32 add is
 * computed in double precision and rounded once to FP32 (Math.fround),
 * which gives the correctly rounded FP32 sum. Every frame matches the
 * Python reference exactly (tests/unit/partb.test.ts), and the reference
 * matches the RTL in Verilator in the INT8 and FP16 modes
 * (rtl/check_rtl.py).
 */
import { Rng } from "./model";

export const MODES = ["int8", "fp16", "bf16"] as const;
export type Mode = (typeof MODES)[number];
export type HalfFormat = "fp16" | "bf16";

/** [exponent bits, mantissa bits, bias] */
export const FORMATS: Record<HalfFormat, [number, number, number]> = {
  fp16: [5, 10, 15],
  bf16: [8, 7, 127],
};

export const INT32_MAX = 2 ** 31 - 1;
export const INT32_MIN = -(2 ** 31);
const FP32_MIN_NORMAL = 2 ** -126;

const view = new DataView(new ArrayBuffer(4));

/** The FP32 bit pattern of a double, rounded to nearest even. */
export function f32Bits(x: number): number {
  view.setFloat32(0, x);
  return view.getUint32(0);
}

export function f32Value(bits: number): number {
  view.setUint32(0, bits >>> 0);
  return view.getFloat32(0);
}

/** The value of a normal (or zero) 16-bit float; subnormals flush to 0. */
export function halfValue(fmt: HalfFormat, bits: number): number {
  const [eBits, mBits, bias] = FORMATS[fmt];
  const sign = (bits >> 15) & 1 ? -1 : 1;
  const e = (bits >> mBits) & ((1 << eBits) - 1);
  const m = bits & ((1 << mBits) - 1);
  if (e === 0) return sign * 0;
  if (e === (1 << eBits) - 1)
    throw new Error("Inf and NaN inputs are outside this model");
  return sign * ((1 << mBits) + m) * 2 ** (e - bias - mBits);
}

/** [sign, biased exponent, mantissa] of a 16-bit float or an FP32. */
export function fields(
  fmt: HalfFormat | "fp32",
  bits: number,
): [number, number, number] {
  const [eBits, mBits] = fmt === "fp32" ? [8, 23] : FORMATS[fmt];
  return [
    Math.floor(bits / 2 ** (eBits + mBits)) & 1,
    Math.floor(bits / 2 ** mBits) & ((1 << eBits) - 1),
    bits % 2 ** mBits,
  ];
}

export function sext8(v: number): number {
  const b = v & 0xff;
  return b & 0x80 ? b - 256 : b;
}

/** The FP32 product of two 16-bit floats, exact. */
export function mulToFp32(fmt: HalfFormat, a: number, b: number): number {
  const va = halfValue(fmt, a);
  const vb = halfValue(fmt, b);
  if (va === 0 || vb === 0) return (((a ^ b) >> 15) & 1) * 2 ** 31;
  return f32Bits(va * vb);
}

/** acc + p in FP32: round to nearest even, flush subnormal results to +0. */
export function fp32Add(acc: number, p: number): number {
  const r = f32Bits(f32Value(acc) + f32Value(p));
  const v = f32Value(r);
  if (v === 0 || Math.abs(v) < FP32_MIN_NORMAL) return 0;
  return r;
}

export function sat32(v: number): number {
  return Math.max(INT32_MIN, Math.min(INT32_MAX, v));
}

export type PeEvent = ["clear" | "add" | "hold", number];
export type PeFrame = {
  t: number;
  /** [a, b, clear, valid] presented in this cycle */
  in: [number, number, number, number];
  /** [a, b, valid, clear] */
  s1: [number, number, number, number];
  /** [product, valid, clear] */
  s2: [number, number, number];
  acc: number;
  vout: number;
  event: PeEvent;
  macs: number;
};
export type PeTrace = { mode: Mode; cycles: number; frames: PeFrame[] };
export type Op = [number, number, number, number];

export function macPipeline(mode: Mode, ops: Op[], drain = 3): PeTrace {
  const fp = mode !== "int8";
  let s1: [number, number, number, number] = [0, 0, 0, 0];
  let s2: [number, number, number] = [0, 0, 0];
  let acc = 0;
  let vout = 0;
  let macs = 0;
  const frames: PeFrame[] = [];
  const seq: Op[] = [...ops];
  for (let i = 0; i < drain; i++) seq.push([0, 0, 0, 0]);
  seq.forEach(([a, b, clear, valid], t) => {
    // stage 3 (from the old s2)
    const [p, v2, c2] = s2;
    const before = acc;
    let event: PeEvent[0];
    if (c2) {
      acc = v2 ? p : 0;
      event = "clear";
    } else if (v2) {
      acc = fp ? fp32Add(acc, p) : sat32(acc + p);
      event = "add";
    } else event = "hold";
    if (v2) macs += 1;
    vout = v2;
    // stage 2 (from the old s1)
    const [a1, b1, v1, c1] = s1;
    const prod = fp
      ? v1
        ? mulToFp32(mode as HalfFormat, a1, b1)
        : 0
      : sext8(a1) * sext8(b1) + 0; // + 0: no negative zero (Python has none)
    s2 = [prod, v1, c1];
    // stage 1 (the inputs)
    s1 = [a & 0xffff, b & 0xffff, valid, clear];
    frames.push({
      t,
      in: [a & 0xffff, b & 0xffff, clear, valid],
      s1: [...s1],
      s2: [...s2],
      acc,
      vout,
      event: [event, before],
      macs,
    });
  });
  return { mode, cycles: frames.length, frames };
}

/** A random normal 16-bit float with unbiased exponent in [eLo, eHi]. */
export function demoHalf(
  fmt: HalfFormat,
  rng: Rng,
  eLo: number,
  eHi: number,
): number {
  const [, mBits, bias] = FORMATS[fmt];
  const sign = rng.u32() & 1;
  const e = bias + rng.intIn(eLo, eHi);
  const m = rng.u32() & ((1 << mBits) - 1);
  return (sign << 15) | (e << mBits) | m;
}

export function demoOps(
  mode: Mode,
  count: number,
  seed: number,
  every = 0,
  eLo = -3,
  eHi = 3,
  gaps = false,
): Op[] {
  const rng = new Rng(seed);
  const ops: Op[] = [];
  for (let i = 0; i < count; i++) {
    let a: number;
    let b: number;
    if (mode === "int8") {
      a = rng.intIn(-128, 127) & 0xffff;
      b = rng.intIn(-128, 127) & 0xffff;
    } else {
      a = demoHalf(mode, rng, eLo, eHi);
      b = demoHalf(mode, rng, eLo, eHi);
    }
    const clear = i === 0 || (every && i % every === 0) ? 1 : 0;
    const valid = gaps && !clear && rng.u32() % 5 === 0 ? 0 : 1;
    if (!valid) {
      a = 0;
      b = 0;
    }
    ops.push([a, b, clear, valid]);
  }
  return ops;
}

export const DEMO_PE = {
  count: 8,
  every: 4,
  seed: { int8: 41, fp16: 42, bf16: 49 },
  // bfloat16's products have 16 significant bits: a wider spread of
  // exponents is needed before an FP32 add rounds
  exp: { int8: [0, 0], fp16: [-3, 3], bf16: [-4, 4] },
} as const;

export function demoTrace(mode: Mode): PeTrace {
  const [lo, hi] = DEMO_PE.exp[mode];
  return macPipeline(
    mode,
    demoOps(mode, DEMO_PE.count, DEMO_PE.seed[mode], DEMO_PE.every, lo, hi),
  );
}
