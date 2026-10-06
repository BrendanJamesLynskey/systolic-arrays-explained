/**
 * The chapter 5-9 TypeScript models against their Python references, exactly
 * (tests/fixtures/sa_fixtures_b.json, written by scripts/make_fixtures.py):
 * tiles back to back (stream.ts), the processing element (pe.ts), the
 * torus all-reduce (torus.ts) and the ONNX lowering (lower.ts). Full traces
 * for the chapters' demonstrations, SHA-256 digests for every other choice
 * the widgets offer.
 */
import { describe, expect, it } from "vitest";

import fx from "../fixtures/sa_fixtures_b.json";
import fa from "../fixtures/sa_fixtures.json";
import { digest } from "./helpers/digest";

import {
  DEMO_LOWER,
  TINY_CNN,
  approxCycles,
  convDirect,
  im2col,
  lower,
  lowerSteps,
  runConv,
  sampleInput,
  weightMatrix,
} from "@/lib/sa/lower";
import { DATAFLOWS, DEMO, demoPair, matmul, tiledCycles } from "@/lib/sa/model";
import {
  DEMO_PE,
  FORMATS,
  MODES,
  demoOps,
  demoTrace,
  f32Bits,
  f32Value,
  fields,
  fp32Add,
  halfValue,
  macPipeline,
  mulToFp32,
  sat32,
} from "@/lib/sa/pe";
import { simulateWsStream, streamSchedule, tiledWords } from "@/lib/sa/stream";
import {
  DEMO_TORUS,
  allreduce,
  demoRun,
  demoVectors,
  stepsRing,
  stepsTorus,
} from "@/lib/sa/torus";

function streamRun(m: number, shadow: boolean, bw: number, buffers: number) {
  const s = DEMO.stream;
  const [a, b] = demoPair(m, s.K, s.N);
  return simulateWsStream(a, b, s.array, s.array, bw || null, buffers, shadow);
}

describe("chapter 5: tiles back to back", () => {
  it("DEMO is the reference's", () => {
    expect(DEMO).toEqual(fa.demo);
  });
  it("full traces equal the reference's, frame by frame", () => {
    const s = DEMO.stream;
    const cases: [keyof typeof fx.stream, boolean, number, number][] = [
      ["default", true, 0, 2],
      ["noShadow", false, 0, 2],
      ["bw1single", true, 1, 1],
    ];
    for (const [key, shadow, bw, buffers] of cases) {
      const ts = streamRun(s.M, shadow, bw, buffers);
      const py = fx.stream[key];
      expect(ts.schedule).toEqual(py.schedule);
      expect(ts.frames.length).toBe(py.frames.length);
      ts.frames.forEach((f, i) =>
        expect(f, `${key} ${i}`).toEqual(py.frames[i]),
      );
      expect(ts.C).toEqual(py.C);
      expect(ts.totals).toEqual(py.totals);
    }
  });
  it("every choice the widget offers equals the reference (digests)", () => {
    const s = DEMO.stream;
    let n = 0;
    for (let m = s.mRange[0]; m <= s.mRange[1]; m++)
      for (const shadow of [true, false])
        for (const bw of s.bws)
          for (const buffers of [1, 2]) {
            const key = `${m}-${shadow ? 1 : 0}-${bw}-${buffers}`;
            const want = fx.streamSweep[key as keyof typeof fx.streamSweep];
            const tr = streamRun(m, shadow, bw, buffers);
            expect(tr.cycles, key).toBe(want.cycles);
            expect(digest(tr), key).toBe(want.digest);
            expect(tr.C).toEqual(matmul(...demoPair(m, s.K, s.N)));
            n++;
          }
    expect(n).toBe(Object.keys(fx.streamSweep).length);
  });
  it("without double-buffering it is tiles in sequence", () => {
    expect(streamSchedule(6, 6, 6, 3, 3, null, 2, false).cycles).toBe(
      tiledCycles("ws", 6, 6, 6, 3, 3),
    );
  });
  it("buffer traffic by operand", () => {
    for (const df of DATAFLOWS)
      expect(tiledWords(df, 7, 9, 5, 3, 4)).toEqual(fx.tiledWords[df]);
    for (const m of DEMO.bw.Ms) {
      const rows = fx.bandwidth[String(m) as keyof typeof fx.bandwidth];
      DEMO.bw.arrays.forEach((r, i) => {
        for (const df of DATAFLOWS) {
          expect(tiledWords(df, m, DEMO.bw.K, DEMO.bw.N, r, r)).toEqual(
            rows[i]![df].words,
          );
          expect(tiledCycles(df, m, DEMO.bw.K, DEMO.bw.N, r, r)).toBe(
            rows[i]![df].cycles,
          );
        }
      });
    }
  });
});

describe("chapter 6: the processing element", () => {
  it("the demonstrations equal the reference's, frame by frame", () => {
    expect(DEMO_PE).toEqual(fx.peDemo);
    for (const mode of MODES) {
      expect(
        demoOps(
          mode,
          DEMO_PE.count,
          DEMO_PE.seed[mode],
          DEMO_PE.every,
          ...DEMO_PE.exp[mode],
        ),
      ).toEqual(fx.peOps[mode]);
      expect(demoTrace(mode)).toEqual(fx.pe[mode]);
    }
  });
  it("long runs with gaps and wide exponents (digests)", () => {
    for (const mode of MODES) {
      const wide = mode === "fp16" ? [-14, 15] : [-30, 30];
      const tr = macPipeline(
        mode,
        demoOps(mode, 200, 90, 17, wide[0], wide[1], true),
      );
      expect(digest(tr), mode).toBe(fx.peLong[mode]);
    }
  });
  it("bit patterns", () => {
    expect(f32Bits(1)).toBe(0x3f800000);
    expect(f32Value(0xc0000000)).toBe(-2);
    expect(halfValue("fp16", 0x3c00)).toBe(1);
    expect(halfValue("bf16", 0x3f80)).toBe(1);
    expect(halfValue("fp16", 0x8000)).toBe(-0);
    expect(() => halfValue("fp16", 0x7c00)).toThrow(/Inf and NaN/);
    expect(fields("fp16", 0xbc00)).toEqual([1, 15, 0]);
    expect(fields("fp32", 0x3fc00000)).toEqual([0, 127, 0x400000]);
    expect(FORMATS.bf16).toEqual([8, 7, 127]);
    expect(mulToFp32("fp16", 0x8000, 0x3c00)).toBe(0x80000000);
    expect(fp32Add(f32Bits(-1), f32Bits(1))).toBe(0);
    expect(fp32Add(f32Bits(2 ** -126), f32Bits(-(2 ** -126) * 1.5))).toBe(0);
    expect(fp32Add(f32Bits(1), f32Bits(2 ** -24))).toBe(f32Bits(1));
    expect(sat32(2 ** 40)).toBe(2 ** 31 - 1);
    expect(sat32(-(2 ** 40))).toBe(-(2 ** 31));
  });
});

describe("chapter 7: all-reduce on a torus", () => {
  it("the demonstration equals the reference's, frame by frame", () => {
    expect(DEMO_TORUS).toEqual(fx.torusDemo);
    expect(demoRun()).toEqual(fx.torus);
  });
  it("every size the widget offers (digests)", () => {
    for (let x = 2; x <= 4; x++)
      for (let y = 2; y <= 4; y++) {
        const r = demoRun(x, y);
        expect(digest(r), `${x}x${y}`).toBe(
          fx.torusSweep[`${x}-${y}` as keyof typeof fx.torusSweep],
        );
        expect(r.steps).toBe(stepsTorus(x, y));
        expect(r.frames[r.frames.length - 1]!.sent).toBe(
          x * y * stepsRing(x * y),
        );
      }
  });
  it("ends with the sum on every chip", () => {
    const data = demoVectors(3, 2, 5);
    const r = allreduce(data);
    for (const row of r.frames[r.frames.length - 1]!.state)
      for (const chip of row) expect(chip.map(([v]) => v)).toEqual(r.sum);
  });
});

describe("chapter 9: from graph to silicon", () => {
  it("the layers and steps equal the reference's on every array size", () => {
    for (const r of [4, 8, 16]) {
      const key = String(r) as keyof typeof fx.lower.layers;
      expect(lower(TINY_CNN, r, r)).toEqual(fx.lower.layers[key]);
      expect(lowerSteps(TINY_CNN, r, r)).toEqual(fx.lower.steps[key]);
    }
    expect(DEMO_LOWER).toEqual(fx.lower.demo);
  });
  it("the convolution on the array", () => {
    const run = runConv(TINY_CNN, DEMO_LOWER.array, DEMO_LOWER.array);
    expect(run).toEqual(fx.lower.conv);
    // im2col then matmul is the convolution
    const prod = matmul(run.A, run.B);
    run.direct.forEach((plane, f) =>
      plane.forEach((row, i) =>
        row.forEach((v, j) => expect(prod[i * 6 + j]![f]).toBe(v)),
      ),
    );
  });
  it("helpers", () => {
    const x = sampleInput(1, 3, 3);
    expect(im2col(x, 3, 3)).toEqual([x[0]!.flat()]);
    expect(weightMatrix([[[[1, 2]]], [[[3, 4]]]])).toEqual([
      [1, 3],
      [2, 4],
    ]);
    expect(convDirect([[[1, 2, 3]]], [[[[1, 1]]]])).toEqual([[[3, 5]]]);
    expect(approxCycles(1, 36, 27, 8, 8, 8)).toBe(151);
  });
});
