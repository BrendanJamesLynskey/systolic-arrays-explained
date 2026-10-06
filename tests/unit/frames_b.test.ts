/**
 * Frame tests for chapters 5-9 (visual standard §4): for key frames of every
 * animation, the state the site draws equals the Python reference's state
 * for that frame (tests/fixtures/sa_fixtures_b.json), and the caption built
 * from the reference's state is the caption the site shows. A few captions
 * are also pinned word for word. tests/e2e/frames.spec.ts then checks the
 * pages.
 */
import { describe, expect, it } from "vitest";

import fa from "../fixtures/sa_fixtures.json";
import fx from "../fixtures/sa_fixtures_b.json";

import {
  bandwidthCaption,
  lowerCaption,
  operand,
  peCaption,
  peValue,
  rsCaption,
  streamCaption,
  swapsAt,
  tileActivity,
  torusCaption,
  wordsPerMac,
} from "@/lib/sa/captionsB";
import {
  DEMO_LOWER,
  TINY_CNN,
  lower,
  lowerSteps,
  type Layer,
  type LowerStep,
} from "@/lib/sa/lower";
import {
  DATAFLOWS,
  DEMO,
  demoPair,
  simulateRs,
  type RsTrace,
} from "@/lib/sa/model";
import { DEMO_PE, MODES, demoTrace, type PeTrace } from "@/lib/sa/pe";
import { simulateWsStream, type StreamTrace } from "@/lib/sa/stream";
import { demoRun, type TorusFrame } from "@/lib/sa/torus";
import { bandwidthRows, rsDemo } from "@/lib/sa/views";

const S = DEMO.stream;

describe("chapter 5: tiles back to back", () => {
  const py = fx.stream.default as unknown as StreamTrace;
  const ts = simulateWsStream(...demoPair(S.M, S.K, S.N), S.array, S.array);
  const swap = ts.frames.findIndex((_, t) => t > S.K && swapsAt(ts, t) > 0);
  const out = ts.frames.findIndex((f) => f.out.length > 0);
  for (const t of [0, swap, out, Math.floor(py.cycles / 2), py.cycles - 1])
    it(`cycle ${t + 1}`, () => {
      expect(ts.frames[t]).toEqual(py.frames[t]);
      expect(streamCaption(ts, t)).toBe(streamCaption(py, t));
    });
  it("says what happens, in words", () => {
    expect(streamCaption(ts, 0)).toBe(
      "Cycle 1: tile 1 shifts into the shadow registers. 0 of 9 PEs multiply.",
    );
    expect(streamCaption(ts, 3)).toBe(
      "Cycle 4: tile 1 shifts into the shadow registers; tile 1 streams row 1 of 6; tile 2 shifts into the shadow registers. 1 of 9 PEs multiply. 1 PE swaps in a new weight.",
    );
    expect(streamCaption(ts, py.cycles - 1)).toMatch(
      /^Cycle 31: tile 4 drains\. 1 of 9 PEs multiply\. 1 result leaves the bottom\.$/,
    );
  });
  it("fetches from HBM", () => {
    const bw = fx.stream.bw1single as unknown as StreamTrace;
    expect(tileActivity(bw, 0)).toEqual([{ j: 0, what: "fetch" }]);
    expect(streamCaption(bw, 0)).toBe(
      "Cycle 1: tile 1 is fetched from HBM (9 words). 0 of 9 PEs multiply.",
    );
    // a cycle where nothing is happening to any tile is "waiting"
    const idle = bw.frames.findIndex(
      (_, t) => tileActivity(bw, t).length === 0,
    );
    if (idle >= 0) expect(streamCaption(bw, idle)).toContain("waiting");
    expect(swapsAt(bw, 0)).toBe(0);
  });
  it("buffer bandwidth", () => {
    for (const m of DEMO.bw.Ms) {
      const rows = bandwidthRows(m);
      const pyRows = fx.bandwidth[String(m) as keyof typeof fx.bandwidth];
      rows.forEach((r, i) => {
        const per = {} as Record<(typeof DATAFLOWS)[number], number>;
        for (const df of DATAFLOWS) {
          expect(r.words[df]).toEqual(pyRows[i]![df].words);
          per[df] = wordsPerMac(
            pyRows[i]![df].words,
            m * DEMO.bw.K * DEMO.bw.N,
          );
          expect(r.perMac[df]).toBe(per[df]);
        }
        expect(bandwidthCaption(r.array, m, r.perMac)).toBe(
          bandwidthCaption(pyRows[i]!.array, m, per),
        );
      });
    }
    const r8 = bandwidthRows(512)[0]!;
    expect(bandwidthCaption(8, 512, r8.perMac)).toBe(
      "8 × 8 array, M = 512: buffer words per MAC WS 0.376, OS 0.251, IS 0.375. Fewest: OS.",
    );
  });
});

describe("chapter 6: the processing element", () => {
  for (const mode of MODES) {
    const py = fx.pe[mode] as unknown as PeTrace;
    const ts = demoTrace(mode);
    for (const t of [0, 2, 3, 6, py.cycles - 1])
      it(`${mode} cycle ${t + 1}`, () => {
        expect(ts.frames[t]).toEqual(py.frames[t]);
        expect(peCaption(mode, ts, DEMO_PE.count, t)).toBe(
          peCaption(mode, py, DEMO_PE.count, t),
        );
      });
  }
  it("says what happens, in words", () => {
    const tr = demoTrace("int8");
    expect(peCaption("int8", tr, DEMO_PE.count, 0)).toMatch(
      /^Cycle 1: stage 1 latches a₀ = −?\d+, b₀ = −?\d+; stage 3 holds the accumulator\.$/,
    );
    expect(peCaption("int8", tr, DEMO_PE.count, 2)).toContain(
      "stage 3 starts a new dot product with a₀b₀",
    );
    expect(peCaption("int8", tr, DEMO_PE.count, 3)).toContain(
      "stage 3 adds a₁b₁",
    );
    // FP: an add that rounds says so
    const fp = demoTrace("fp16");
    const rounded = fp.frames.findIndex((_, t) =>
      peCaption("fp16", fp, DEMO_PE.count, t).includes("rounded to FP32"),
    );
    expect(rounded).toBeGreaterThan(0);
    expect(peCaption("fp16", fp, DEMO_PE.count, 2)).toContain(
      "(exact in FP32)",
    );
    expect(operand("int8", 0xff)).toBe(-1);
    expect(peValue("fp16", 0x3f800000)).toBe(1);
  });
});

describe("chapter 7: the torus", () => {
  const py = fx.torus.frames as unknown as TorusFrame[];
  const ts = demoRun();
  for (const t of [0, 1, 4, 7, 10, py.length - 1])
    it(`step ${t}`, () => {
      expect(ts.frames[t]).toEqual(py[t]);
      expect(torusCaption(ts.frames[t]!, 4, 4)).toBe(
        torusCaption(py[t]!, 4, 4),
      );
    });
  it("says what happens, in words", () => {
    expect(torusCaption(ts.frames[0]!, 4, 4)).toBe(
      "Start: each of the 16 chips holds its own 16 numbers, and every chip needs the sum of all 16 vectors.",
    );
    expect(torusCaption(ts.frames[1]!, 4, 4)).toBe(
      "Step 1 (reduce-scatter along x, 1 of 3): every chip sends 4 numbers to its +x neighbour, which adds them to its own. Chip (0,0) holds 0 of 16 finished sums.",
    );
    expect(torusCaption(ts.frames[12]!, 4, 4)).toBe(
      "Step 12 (all-gather along x, 3 of 3): every chip sends 4 numbers to its +x neighbour, which copies them. Chip (0,0) holds 16 of 16 finished sums.",
    );
    expect(torusCaption(ts.frames[5]!, 4, 4)).toContain(
      "sends 1 number to its +y neighbour",
    );
  });
});

describe("chapter 8: row-stationary", () => {
  const py = fa.rs.trace as unknown as RsTrace;
  const { x, f } = rsDemo();
  const ts = simulateRs(x, f);
  it("the widget's data is the reference's", () => {
    expect(x).toEqual(fa.rs.x);
    expect(f).toEqual(fa.rs.f);
  });
  for (const t of [0, 2, 8, py.cycles - 1])
    it(`cycle ${t + 1}`, () => {
      expect(ts.frames[t]).toEqual(py.frames[t]);
      expect(rsCaption(ts, t)).toBe(rsCaption(py, t));
    });
  it("says what happens, in words", () => {
    expect(rsCaption(ts, 0)).toMatch(
      /^Cycle 1: 4 of 12 PEs multiply\. PE\(0,3\) keeps filter row 0 and multiplies x₃₀ = −?\d by f₀₀ = −?\d \(output row 3, column 0, tap 1 of 3\)\.$/,
    );
    // somewhere a PE passes a partial row sum down, and the bottom finishes outputs
    const all = ts.frames.map((_, t) => rsCaption(ts, t));
    expect(all.some((c) => c.includes("passes the partial row sum"))).toBe(
      true,
    );
    expect(all.some((c) => c.includes("Its column finishes"))).toBe(true);
  });
});

describe("chapter 9: from graph to silicon", () => {
  const rows = DEMO_LOWER.array;
  const pyLayers = fx.lower.layers["8"] as unknown as Layer[];
  const pySteps = fx.lower.steps["8"] as unknown as LowerStep[];
  const layers = lower(TINY_CNN, rows, rows);
  const steps = lowerSteps(TINY_CNN, rows, rows);
  const kinds = new Set<string>();
  steps.forEach((s, i) => {
    const key = `${s.kind}-${s.layer}`;
    if (kinds.has(key) && s.kind !== "im2col") return;
    if (s.kind === "im2col" && ![0, 7, 35].includes(s.row)) return;
    kinds.add(key);
    it(`step ${i + 1} (${s.kind})`, () => {
      expect(s).toEqual(pySteps[i]);
      expect(lowerCaption(s, layers, rows, 6, 3)).toBe(
        lowerCaption(pySteps[i]!, pyLayers, rows, 6, 3),
      );
    });
  });
  it("says what happens, in words", () => {
    expect(lowerCaption(steps[0]!, layers, rows, 6, 3)).toBe(
      "conv (Conv): lowered by im2col to a GEMM, A 36 × 27 (one row per output pixel) times B 27 × 8 (one column per filter): 7,776 MACs.",
    );
    expect(lowerCaption(steps[8]!, layers, rows, 6, 3)).toBe(
      "im2col row 8 of 36: output pixel (1, 1) sees the 3 × 3 patch at rows 1–3, columns 1–3 of every channel: 27 numbers, one row of A.",
    );
    const last = steps.length - 1;
    expect(lowerCaption(steps[last]!, layers, rows, 6, 3)).toMatch(
      /^On a 8 × 8 array: conv 161 cycles .*, fc 585 cycles .*\.$/,
    );
    expect(lowerCaption(steps[last - 1]!, layers, rows, 6, 3)).toContain(
      "72 tiles, 585 cycles",
    );
    expect(lowerCaption(steps[last - 2]!, layers, rows, 6, 3)).toContain(
      "(Flatten): a view",
    );
    expect(lowerCaption(steps[last - 3]!, layers, rows, 6, 3)).toContain(
      "288 elements on the vector unit",
    );
  });
});
