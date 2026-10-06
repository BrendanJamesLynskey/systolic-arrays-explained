/**
 * Chapter 9: from graph to silicon. A line-for-line port of
 * reference/lower.py (read its docstring): the ONNX model
 * (reference/data/tiny_cnn.onnx, imported here as the plain description
 * tiny_cnn.json the reference writes) lowered onto an R x C array: a
 * convolution becomes a GEMM by im2col, each GEMM is tiled and timed by the
 * cycle-accurate model, next to Torch_Sim_Frontend's cycle-approximate
 * formula. Integers only: every value matches the reference exactly
 * (tests/unit/partb.test.ts).
 */
import desc from "./tiny_cnn.json";
import { demoMatrix, tiledCycles, utilisation, type Matrix } from "./model";
import { simulateWsStream, streamSchedule } from "./stream";

export type Node = {
  name: string;
  op: string;
  inputs: string[];
  outputs: string[];
  attrs: Record<string, number | number[] | undefined>;
};
export type Desc = {
  name: string;
  opset: number;
  nodes: Node[];
  shapes: Record<string, number[]>;
  convWeight: number[][][][];
};

export const TINY_CNN = desc as unknown as Desc;
export const SAMPLE_SEED = 63;

const ceilDiv = (x: number, y: number) => Math.floor((x + y - 1) / y);

export function sampleInput(c: number, h: number, w: number): number[][][] {
  const flat = demoMatrix(1, c * h * w, SAMPLE_SEED, -3, 3)[0]!;
  return Array.from({ length: c }, (_, ci) =>
    Array.from({ length: h }, (_, i) =>
      Array.from({ length: w }, (_, j) => flat[(ci * h + i) * w + j]!),
    ),
  );
}

/** Row (i, j) of the output: the C x R x S patch at (i, j), channel-major. */
export function im2col(x: number[][][], r: number, s: number): Matrix {
  const c = x.length;
  const h = x[0]!.length;
  const w = x[0]![0]!.length;
  const rows: Matrix = [];
  for (let i = 0; i < h - r + 1; i++)
    for (let j = 0; j < w - s + 1; j++) {
      const row: number[] = [];
      for (let ci = 0; ci < c; ci++)
        for (let di = 0; di < r; di++)
          for (let dj = 0; dj < s; dj++) row.push(x[ci]![i + di]![j + dj]!);
      rows.push(row);
    }
  return rows;
}

/** B (K x C_out): column f is filter f flattened in im2col's order. */
export function weightMatrix(wt: number[][][][]): Matrix {
  const co = wt.length;
  const c = wt[0]!.length;
  const r = wt[0]![0]!.length;
  const s = wt[0]![0]![0]!.length;
  const out: Matrix = [];
  for (let ci = 0; ci < c; ci++)
    for (let di = 0; di < r; di++)
      for (let dj = 0; dj < s; dj++) {
        const row: number[] = [];
        for (let f = 0; f < co; f++) row.push(wt[f]![ci]![di]![dj]!);
        out.push(row);
      }
  return out;
}

export function convDirect(x: number[][][], wt: number[][][][]): number[][][] {
  const c = x.length;
  const h = x[0]!.length;
  const w = x[0]![0]!.length;
  const r = wt[0]![0]!.length;
  const s = wt[0]![0]![0]!.length;
  return wt.map((filt) => {
    const plane: number[][] = [];
    for (let i = 0; i < h - r + 1; i++) {
      const row: number[] = [];
      for (let j = 0; j < w - s + 1; j++) {
        let acc = 0;
        for (let ci = 0; ci < c; ci++)
          for (let di = 0; di < r; di++)
            for (let dj = 0; dj < s; dj++)
              acc += x[ci]![i + di]![j + dj]! * filt[ci]![di]![dj]!;
        row.push(acc);
      }
      plane.push(row);
    }
    return plane;
  });
}

/** Torch_Sim_Frontend's AccelConfig.array_cycles (output-stationary). */
export function approxCycles(
  batch: number,
  m: number,
  k: number,
  n: number,
  rows: number,
  cols: number,
): number {
  return batch * ceilDiv(m, rows) * ceilDiv(n, cols) * k + rows + cols;
}

export type Layer = {
  name: string;
  op: string;
  out: number[];
  unit: "array" | "vector" | "view";
  gemm?: [number, number, number, number];
  macs?: number;
  tiles?: number;
  stream?: number;
  seqWs?: number;
  seqOs?: number;
  approx?: number;
  util?: number;
  elements?: number;
};

export function lower(d: Desc, rows: number, cols: number): Layer[] {
  const shapes = d.shapes;
  return d.nodes.map((nd): Layer => {
    const op = nd.op;
    const o = shapes[nd.outputs[0]!]!;
    if (op === "Conv" || op === "Gemm") {
      const x = shapes[nd.inputs[0]!]!;
      const w = shapes[nd.inputs[1]!]!;
      let gemm: [number, number, number, number];
      if (op === "Conv")
        gemm = [1, o[0]! * o[2]! * o[3]!, w[1]! * w[2]! * w[3]!, w[0]!];
      else {
        const transB = (nd.attrs.transB as number | undefined) ?? 0;
        gemm = [1, x[0]!, x[1]!, transB ? w[0]! : w[1]!];
      }
      const [batch, m, k, n] = gemm;
      const sched = streamSchedule(m, k, n, rows, cols);
      const macs = batch * m * k * n;
      return {
        name: nd.name,
        op,
        out: o,
        unit: "array",
        gemm,
        macs,
        tiles: sched.tiles.length,
        stream: sched.cycles,
        seqWs: tiledCycles("ws", m, k, n, rows, cols),
        seqOs: tiledCycles("os", m, k, n, rows, cols),
        approx: approxCycles(batch, m, k, n, rows, cols),
        util: utilisation(macs, rows, cols, sched.cycles),
      };
    }
    if (op === "Relu")
      return {
        name: nd.name,
        op,
        out: o,
        unit: "vector",
        elements: o.reduce((p, v) => p * v, 1),
      };
    return { name: nd.name, op, out: o, unit: "view" };
  });
}

export function runConv(d: Desc, rows: number, cols: number) {
  const w = d.convWeight;
  const xs = d.shapes.x!;
  const x = sampleInput(xs[1]!, xs[2]!, xs[3]!);
  const a = im2col(x, w[0]![0]!.length, w[0]![0]![0]!.length);
  const b = weightMatrix(w);
  const tr = simulateWsStream(a, b, rows, cols);
  return {
    x,
    A: a,
    B: b,
    C: tr.C,
    cycles: tr.cycles,
    direct: convDirect(x, w),
  };
}

export type LowerStep =
  | { kind: "node"; layer: number }
  | { kind: "im2col"; layer: number; row: number }
  | {
      kind: "tile";
      layer: number;
      tile: number;
      k0: number;
      k: number;
      n0: number;
      n: number;
      stream: number;
      end: number;
    }
  | { kind: "summary"; layer: number };

export function lowerSteps(d: Desc, rows: number, cols: number): LowerStep[] {
  const layers = lower(d, rows, cols);
  const [, m, k, n] = layers[0]!.gemm!;
  const steps: LowerStep[] = [{ kind: "node", layer: 0 }];
  for (let p = 0; p < m; p++) steps.push({ kind: "im2col", layer: 0, row: p });
  for (const tl of streamSchedule(m, k, n, rows, cols).tiles)
    steps.push({
      kind: "tile",
      layer: 0,
      tile: tl.j,
      k0: tl.k0,
      k: tl.k,
      n0: tl.n0,
      n: tl.n,
      stream: tl.stream,
      end: tl.end,
    });
  for (let i = 1; i < layers.length; i++)
    steps.push({ kind: "node", layer: i });
  steps.push({ kind: "summary", layer: layers.length - 1 });
  return steps;
}

export const DEMO_LOWER = { array: 8 } as const;
