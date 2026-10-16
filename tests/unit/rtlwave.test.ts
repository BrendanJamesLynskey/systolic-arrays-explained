/**
 * The waveform panel: the VCD-derived registers (rtl/ws_wave.json) against
 * the TypeScript model, checked against the Python record of the same
 * comparison (rtl/check_rtl.py): 0 mismatches aligned, and exactly
 * Python's count, edge by edge, with the model one cycle late.
 */
import { describe, expect, it } from "vitest";

import rtl from "../../rtl/rtl_check.json";

import {
  WAVE,
  compareWave,
  laneMismatch,
  lanes,
  waveCaption,
  waveModel,
} from "@/lib/sa/rtlwave";

const demo = rtl.ws.find((c) => c.name === "ws_demo")!;
const tr = waveModel();

describe("RTL waveform panel", () => {
  it("replays chapter 5's demonstration", () => {
    expect(WAVE.case).toMatchObject({ M: 6, K: 6, N: 6, rows: 3, cols: 3 });
    expect(WAVE.edges).toHaveLength(demo.edges);
    expect(tr.frames).toHaveLength(demo.edges);
    expect(demo.cResultsMatch).toBe(true);
  });

  it("the VCD equals the TS model on every register (Python: 0)", () => {
    const c = compareWave(WAVE, tr, 0);
    expect(c.values).toBe(demo.values);
    expect(c.mismatches).toBe(0);
    expect(c.bad.map((b) => b.size)).toEqual(WAVE.mismatchesPerEdge.aligned);
  });

  it("shifted one cycle, it mismatches exactly as the Python check says", () => {
    const c = compareWave(WAVE, tr, 1);
    expect(c.mismatches).toBe(demo.mismatchesShifted);
    expect(c.bad.map((b) => b.size)).toEqual(WAVE.mismatchesPerEdge.shifted);
    expect(c.mismatches).toBeGreaterThan(0);
  });

  it("lanes agree with the model everywhere when aligned", () => {
    for (const view of ["weights", "data"] as const)
      for (const col of [0, 1, 2]) {
        const ls = lanes(WAVE, tr, view, col, 0);
        expect(ls.length).toBe(view === "weights" ? 7 : 6);
        for (const l of ls)
          for (let i = 0; i < WAVE.edges.length; i++)
            expect(laneMismatch(l, i)).toBe(false);
      }
  });

  it("every shadow weight in the VCD is a weight of B", () => {
    const B = new Set<number>();
    for (const e of WAVE.edges) for (const t of e.top) if (t[0]) B.add(t[3]);
    for (const e of WAVE.edges)
      for (const row of e.pe)
        for (const pe of row) if (pe.sh[0]) expect(B.has(pe.sh[2])).toBe(true);
  });

  it("captions report the swaps and the verdict", () => {
    const c0 = compareWave(WAVE, tr, 0);
    const c1 = compareWave(WAVE, tr, 1);
    // edge 1: column 0 starts loading
    expect(waveCaption(WAVE, c0, 0, 0)).toBe(
      "edge 1; weights shifting into column 0. RTL = model on all 36 registers.",
    );
    // edge 4: tile 1's first activation reaches PE(0,0), which swaps
    expect(waveCaption(WAVE, c0, 3, 0)).toContain(
      "PE(0,0) swaps the shadow weight in",
    );
    expect(waveCaption(WAVE, c1, 10, 1)).toContain(
      `${WAVE.mismatchesPerEdge.shifted[10]} of 36 registers differ (model shifted one cycle)`,
    );
  });
});
