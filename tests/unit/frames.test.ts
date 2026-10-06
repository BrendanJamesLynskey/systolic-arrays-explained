/**
 * Frame tests (visual standard §4): for key frames of every animation, the
 * state the site draws equals the Python reference's state for that frame
 * (from the fixtures), and the caption built from the reference's state is
 * the caption the site shows. tests/e2e/frames.spec.ts then checks the page.
 */
import { describe, expect, it } from "vitest";

import fx from "../fixtures/sa_fixtures.json";

import {
  compareCaption,
  cycleCaption,
  focusPe,
  heroCaption,
  reuseCaption,
  utilCaption,
  waveCaption,
} from "@/lib/sa/captions";
import {
  DATAFLOWS,
  DEMO,
  activePerCycle,
  demoPair,
  reuseSteps,
  shapeSteps,
  simulate,
  utilSteps,
  type Counts,
  type Dataflow,
  type Trace,
} from "@/lib/sa/model";

const tr = (k: keyof typeof fx.traces) => fx.traces[k] as unknown as Trace;
const dims = (t: Trace) => ({
  M: t.M,
  K: t.K,
  N: t.N,
  rows: t.rows,
  cols: t.cols,
});

describe("cycle-by-cycle frames (chapters 2 and 3)", () => {
  const cases: [keyof typeof fx.traces, Dataflow][] = [
    ["ws", "ws"],
    ["cmp_os", "os"],
    ["cmp_is", "is"],
    ["cmp_ws", "ws"],
  ];
  for (const [key, df] of cases) {
    const py = tr(key);
    const ts = simulate(df, ...demoPair(py.M, py.K, py.N), py.rows, py.cols);
    for (const s of [0, Math.floor(py.cycles / 2), py.cycles - 1])
      it(`${key} cycle ${s + 1}`, () => {
        expect(ts.frames[s]).toEqual(py.frames[s]);
        expect(cycleCaption(df, dims(ts), ts.frames[s]!)).toBe(
          cycleCaption(df, dims(py), py.frames[s]!),
        );
      });
  }

  it("says what happens, in words", () => {
    const t = tr("ws");
    expect(cycleCaption("ws", dims(t), t.frames[0]!)).toBe(
      "Cycle 1 (load 1 of 4): row 3 of B enters the top and the values already loaded shift down a row; after 4 cycles PE(k,n) holds wₖₙ = bₖₙ.",
    );
    expect(cycleCaption("ws", dims(t), t.frames[t.K]!)).toBe(
      "Cycle 5: 1 of 16 PEs multiply. PE(0,0) holds w₀₀ = 4, gets a₀₀ = 5 from the left and starts c₀₀: 5 × 4 = 20 (1 of 4 terms).",
    );
    expect(cycleCaption("ws", dims(t), t.frames[7]!)).toBe(
      "Cycle 8: 10 of 16 PEs multiply. PE(3,0) holds w₃₀ = 5, gets a₀₃ = 1 from the left and adds 1 × 5 to the 20 from above: 25 (4 of 4 terms). Out: c₀₀ = 25.",
    );
    // the first result leaves the bottom
    const out = t.frames.find((fr) => fr.out.length > 0)!;
    expect(cycleCaption("ws", dims(t), out)).toContain(" Out: c₀₀ = ");
    // output-stationary: accumulate and drain
    const os = tr("cmp_os");
    expect(cycleCaption("os", dims(os), os.frames[3]!)).toBe(
      "Cycle 4: 7 of 9 PEs multiply. PE(2,1) gets a₂₀ = −2 from the left and b₀₁ = −4 from above: c₂₁ += −2 × (−4), now 8 (1 of 3 terms).",
    );
    expect(cycleCaption("os", dims(os), os.frames[os.cycles - 1]!)).toMatch(
      /^Cycle 10 \(drain 3 of 3\): the bottom row writes .* Out: c₀₀ = /,
    );
    const is = tr("cmp_is");
    expect(cycleCaption("is", dims(is), is.frames[0]!)).toContain(
      "column 2 of A enters the top",
    );
    expect(cycleCaption("is", dims(is), is.frames[4]!)).toContain("holds a");
  });

  it("a frame with no multiply has no focus PE", () => {
    const t = tr("ws");
    expect(focusPe(t.frames[0]!)).toBeNull();
    const empty = { ...t.frames[5]!, pe: [[]], out: [] };
    expect(cycleCaption("ws", dims(t), { ...empty, phase: "compute" })).toBe(
      "Cycle 6: 0 of 16 PEs multiply.",
    );
  });
});

describe("the three dataflows side by side", () => {
  it("captions from the reference's counters", () => {
    const counts = {} as Record<Dataflow, Counts>;
    const done = {} as Record<Dataflow, boolean>;
    for (const df of DATAFLOWS) {
      const t = tr(`cmp_${df}` as keyof typeof fx.traces);
      counts[df] = t.frames[t.cycles - 1]!.cnt;
      done[df] = true;
    }
    expect(compareCaption(9, counts, done)).toBe(
      "Cycle 10: WS 27 MACs (done), OS 27 MACs (done), IS 27 MACs (done). Partial sums moved so far: WS 18, OS 9, IS 18.",
    );
  });
});

describe("hero, memory wall, wavefront, utilisation", () => {
  it("hero frames", () => {
    const py = tr("hero");
    for (const s of [0, 6, py.cycles - 1])
      expect(heroCaption(py.frames[s]!, 16)).toBeTypeOf("string");
    expect(heroCaption(py.frames[0]!, 16)).toContain("shift down");
    expect(heroCaption(py.frames[py.cycles - 1]!, 16)).toContain(
      "1 finished result leaves the bottom",
    );
    expect(heroCaption(py.frames[py.cycles - 2]!, 16)).toContain(
      "2 finished results leave the bottom",
    );
    expect(heroCaption(py.frames[5]!, 16)).not.toContain("finished");
  });
  it("reuse frames", () => {
    const ts = reuseSteps(DEMO.beta, DEMO.reuseMax);
    for (const s of [0, 7, 15]) {
      expect(ts[s]).toEqual(fx.reuse[s]);
      expect(reuseCaption(ts[s]!, DEMO.beta)).toBe(
        reuseCaption(fx.reuse[s]!, DEMO.beta),
      );
    }
    expect(reuseCaption(ts[15]!, 32)).toBe(
      "16 × 16 = 256 multipliers on 32 words a cycle. Fetching two words per MAC feeds 16 of them; a systolic array needs only 32 words a cycle, so all 256 MACs run.",
    );
    expect(reuseCaption(reuseSteps(8, 16)[15]!, 8)).toContain(
      "memory limits it to 64 of 256",
    );
  });
  it("wavefront frames", () => {
    const w = DEMO.wave;
    const t = simulate("ws", ...demoPair(w.M, w.K, w.N), w.K, w.N);
    const act = activePerCycle(t);
    expect(act).toEqual(fx.active);
    expect(waveCaption(1, w.K, act[1]!, 16, w)).toContain("loading weights");
    expect(waveCaption(w.K + 2, w.K, act[w.K + 2]!, 16, w)).toContain(
      "(filling)",
    );
    expect(waveCaption(w.K + 8, w.K, act[w.K + 8]!, 16, w)).toContain(
      "16 of 16 PEs busy (full)",
    );
    expect(waveCaption(t.cycles - 1, w.K, act[t.cycles - 1]!, 16, w)).toContain(
      "(draining)",
    );
  });
  it("utilisation frames", () => {
    const R = DEMO.array;
    for (const df of DATAFLOWS) {
      const u = utilSteps(df, R, R, R, R, DEMO.utilMax);
      const sh = shapeSteps(
        df,
        R,
        R,
        DEMO.shape.M,
        DEMO.shape.K,
        DEMO.shape.nMax,
      );
      for (const s of [0, 7, 30]) {
        expect(u[s]).toEqual(fx.util[df][s]);
        expect(sh[s]).toEqual(fx.shape[df][s]);
        expect(utilCaption(df, "stream", u[s]!, R, R)).toBe(
          utilCaption(df, "stream", fx.util[df][s]!, R, R),
        );
      }
    }
    const u = utilSteps("os", R, R, R, R, 64);
    expect(utilCaption("os", "stream", u[0]!, R, R)).toMatch(/^K = 1: /);
    expect(utilCaption("is", "stream", u[0]!, R, R)).toMatch(/^N = 1: /);
    const sh = shapeSteps("ws", R, R, 32, 8, 40);
    expect(utilCaption("ws", "shape", sh[0]!, R, R)).toContain("1 tile,");
    expect(utilCaption("ws", "shape", sh[8]!, R, R)).toContain("2 tiles,");
  });
});
