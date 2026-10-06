/**
 * The TypeScript model against the Python reference: every register of
 * every PE in every cycle, exactly (tests/fixtures/sa_fixtures.json, written
 * by scripts/make_fixtures.py). Full traces for the chapters' demos, SHA-256
 * digests for every other size the widgets offer.
 */
import { describe, expect, it } from "vitest";

import fx from "../fixtures/sa_fixtures.json";
import { digest } from "./helpers/digest";

import {
  DATAFLOWS,
  DEMO,
  activePerCycle,
  conv2d,
  cycles,
  demoMatrix,
  demoPair,
  matmul,
  reuseSteps,
  shapeSteps,
  simulate,
  simulateRs,
  simulateTiled,
  tiledCycles,
  tiles,
  traffic,
  utilSteps,
  wavefrontSize,
  type Dataflow,
} from "@/lib/sa/model";

function run(
  df: Dataflow,
  m: number,
  k: number,
  n: number,
  rows?: number,
  cols?: number,
) {
  const [a, b] = demoPair(m, k, n);
  const need = df === "ws" ? [k, n] : df === "os" ? [m, n] : [k, m];
  return simulate(df, a, b, rows ?? need[0]!, cols ?? need[1]!);
}

describe("data", () => {
  it("DEMO is the reference's", () => {
    expect(DEMO).toEqual(fx.demo);
  });
  it("seeded matrices", () => {
    expect(demoMatrix(5, 4, DEMO.seedA)).toEqual(fx.matrices.a54);
    expect(demoMatrix(4, 4, DEMO.seedB)).toEqual(fx.matrices.b44);
    expect(demoMatrix(3, 6, 99, -128, 127)).toEqual(fx.matrices.wide);
  });
});

describe("full traces", () => {
  const cases: [
    keyof typeof fx.traces,
    Dataflow,
    number,
    number,
    number,
    number?,
    number?,
  ][] = [
    ["hero", "ws", DEMO.hero.M, DEMO.hero.K, DEMO.hero.N],
    ["ws", "ws", DEMO.ws.M, DEMO.ws.K, DEMO.ws.N],
    ["cmp_ws", "ws", DEMO.cmp.M, DEMO.cmp.K, DEMO.cmp.N],
    ["cmp_os", "os", DEMO.cmp.M, DEMO.cmp.K, DEMO.cmp.N],
    ["cmp_is", "is", DEMO.cmp.M, DEMO.cmp.K, DEMO.cmp.N],
    ["wave", "ws", DEMO.wave.M, DEMO.wave.K, DEMO.wave.N],
    ["os_in_5x6", "os", 3, 4, 2, 5, 6],
  ];
  for (const [key, df, m, k, n, r, c] of cases)
    it(key, () => {
      const tr = run(df, m, k, n, r, c);
      expect(tr).toEqual(fx.traces[key]);
      expect(tr.C).toEqual(matmul(...demoPair(m, k, n)));
    });
});

describe("every size the widgets offer (digests)", () => {
  const sweep = fx.sweep as Record<string, { cycles: number; digest: string }>;
  it("covers 3 dataflows x 8 x 3 x 3", () => {
    expect(Object.keys(sweep)).toHaveLength(216);
  });
  for (const df of DATAFLOWS)
    it(df, () => {
      for (let m = DEMO.range.M[0]; m <= DEMO.range.M[1]; m++)
        for (let k = DEMO.range.K[0]; k <= DEMO.range.K[1]; k++)
          for (let n = DEMO.range.N[0]; n <= DEMO.range.N[1]; n++) {
            const tr = run(df, m, k, n);
            const want = sweep[`${df}-${m}-${k}-${n}`]!;
            expect(tr.cycles).toBe(want.cycles);
            expect(digest(tr)).toBe(want.digest);
          }
    });
});

describe("closed forms", () => {
  const closed = fx.closed as Record<
    string,
    { cycles: number; traffic: unknown }
  >;
  for (const [key, want] of Object.entries(closed))
    it(key, () => {
      const [df, m, k, n] = key.split("-") as [
        Dataflow,
        string,
        string,
        string,
      ];
      expect(cycles(df, +m, +k, +n)).toBe(want.cycles);
      expect(traffic(df, +m, +k, +n)).toEqual(want.traffic);
    });
  it("equal the simulated totals", () => {
    for (const df of DATAFLOWS) {
      const tr = run(df, 4, 3, 2);
      expect(tr.totals).toEqual(traffic(df, 4, 3, 2));
      expect(tr.cycles).toBe(cycles(df, 4, 3, 2));
    }
  });
});

describe("tiling", () => {
  const a = demoMatrix(7, 9, 3);
  const b = demoMatrix(9, 5, 4);
  for (const df of DATAFLOWS)
    it(df, () => {
      const want = fx.tiled[df];
      expect(tiles(df, 7, 9, 5, 3, 4)).toEqual(want.tiles);
      expect(tiledCycles(df, 7, 9, 5, 3, 4)).toBe(want.cycles);
      const r = simulateTiled(df, a, b, 3, 4);
      expect(r).toEqual(want.run);
      expect(r.C).toEqual(matmul(a, b));
    });
  it("refuses a block that does not fit", () => {
    const [a2, b2] = demoPair(3, 5, 2);
    expect(() => simulate("ws", a2, b2, 4, 4)).toThrow(/tile it/);
    expect(() => simulate("ws", a2, demoMatrix(4, 2, 1), 8, 8)).toThrow(
      /inner/,
    );
  });
});

describe("higher-level views", () => {
  it("reuse", () => {
    expect(reuseSteps(DEMO.beta, DEMO.reuseMax)).toEqual(fx.reuse);
  });
  it("utilisation and shape", () => {
    for (const df of DATAFLOWS) {
      expect(
        utilSteps(
          df,
          DEMO.array,
          DEMO.array,
          DEMO.array,
          DEMO.array,
          DEMO.utilMax,
        ),
      ).toEqual(fx.util[df]);
      expect(
        shapeSteps(
          df,
          DEMO.array,
          DEMO.array,
          DEMO.shape.M,
          DEMO.shape.K,
          DEMO.shape.nMax,
        ),
      ).toEqual(fx.shape[df]);
    }
  });
  it("wavefront", () => {
    const tr = run("ws", DEMO.wave.M, DEMO.wave.K, DEMO.wave.N);
    const act = activePerCycle(tr);
    expect(act).toEqual(fx.active);
    for (let t = 0; t < act.length - DEMO.wave.K; t++)
      expect(act[t + DEMO.wave.K]).toBe(
        wavefrontSize(DEMO.wave.M, DEMO.wave.K, DEMO.wave.N, t),
      );
  });
  it("row-stationary", () => {
    const tr = simulateRs(fx.rs.x, fx.rs.f);
    expect(tr).toEqual(fx.rs.trace);
    expect(tr.O).toEqual(conv2d(fx.rs.x, fx.rs.f));
  });
});
