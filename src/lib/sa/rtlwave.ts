/**
 * The "verified against RTL" waveform panel (chapter 5 and the model page):
 * the weight-stationary array's registers as Verilator wrote them to a VCD
 * (rtl/ws_wave.json, produced by rtl/check_rtl.py from waves.vcd), set
 * beside the model's frames (`simulateWsStream`, the TS port of
 * reference/systolic.py) for the same problem. Pure functions only, so the
 * unit tests can check them against the Python record (rtl/rtl_check.json):
 * 0 mismatches aligned, and exactly the Python's count with the model
 * shifted one cycle (the negative control).
 *
 * A register is [valid, tag, value]; an invalid register's tag and value
 * are don't-cares (flip-flops keep stale bits), exactly as in check_rtl.py.
 */
import wave from "../../../rtl/ws_wave.json";

import { minus } from "@/lib/format";

import { demoPair } from "./model";
import { simulateWsStream, type StreamPe, type StreamTrace } from "./stream";

export type Reg = [number, number, number];
export type RegName = "s" | "sh" | "h" | "v";
export type WavePe = Record<RegName, Reg>;
export type WaveEdge = {
  edge: number;
  /** each column's top input this cycle: [valid, first, tag, value] */
  top: [number, number, number, number][];
  /** each row's left input this cycle: [valid, tag, value] */
  left: Reg[];
  pe: WavePe[][];
};
export type Wave = {
  case: {
    name: string;
    M: number;
    K: number;
    N: number;
    rows: number;
    cols: number;
  };
  from: string;
  tagBits: number;
  edges: WaveEdge[];
  /** Python's count of differing registers at each edge (check_rtl.py) */
  mismatchesPerEdge: { aligned: number[]; shifted: number[] };
};

export const WAVE = wave as unknown as Wave;
export const REGS: RegName[] = ["s", "sh", "h", "v"];
const SLOT: Record<RegName, number> = { s: 0, h: 1, v: 2, sh: 3 };

/** The model run the VCD is compared with (chapter 5's demonstration). */
export function waveModel(w: Wave = WAVE): StreamTrace {
  const { M, K, N, rows, cols } = w.case;
  const [a, b] = demoPair(M, K, N);
  return simulateWsStream(a, b, rows, cols);
}

/** [valid, tag, value] of one model register, tags cut to the RTL's bits. */
export function modelReg(cell: StreamPe, reg: RegName, tagBits: number): Reg {
  const x = cell[SLOT[reg]] ?? null;
  if (x === null) return [0, 0, 0];
  const tile = reg === "v" ? x[4]! : x[3]!;
  return [1, tile % (1 << tagBits), x[0]];
}

export function sameReg(got: Reg, want: Reg): boolean {
  if (got[0] !== want[0]) return false;
  return want[0] === 0 || (got[1] === want[1] && got[2] === want[2]);
}

/** The model frame edge e is compared with (shift 1: the next cycle's). */
export function frameFor(tr: StreamTrace, edge: number, shift: 0 | 1) {
  return tr.frames[Math.min(edge - 1 + shift, tr.frames.length - 1)]!;
}

export type Comparison = {
  values: number;
  mismatches: number;
  /** per edge index, per PE, the registers that differ */
  bad: Set<string>[];
};

/** Every register of every PE at every edge, RTL (VCD) against the model. */
export function compareWave(
  w: Wave,
  tr: StreamTrace,
  shift: 0 | 1,
): Comparison {
  let values = 0;
  let mismatches = 0;
  const bad: Set<string>[] = [];
  for (const e of w.edges) {
    const f = frameFor(tr, e.edge, shift);
    const s = new Set<string>();
    e.pe.forEach((row, r) =>
      row.forEach((pe, c) => {
        for (const reg of REGS) {
          values++;
          if (!sameReg(pe[reg], modelReg(f.pe[r]![c]!, reg, w.tagBits))) {
            mismatches++;
            s.add(`${r},${c},${reg}`);
          }
        }
      }),
    );
    bad.push(s);
  }
  return { values, mismatches, bad };
}

export type View = "weights" | "data";

export type Lane = {
  key: string;
  label: string;
  /** per edge index: the RTL value (null = not valid) and its tile */
  rtl: ({ v: number; tile: number } | null)[];
  /** the same from the model frame each edge is compared with */
  model: ({ v: number; tile: number } | null)[];
  kind: "weight" | "act" | "psum";
};

const val = (x: Reg) => (x[0] ? { v: x[2], tile: x[1] } : null);

/**
 * The lanes the panel draws for one column of PEs: the weights view shows
 * the column's top input, then each row's shadow and stationary weight; the
 * data view shows each row's activation and partial sum.
 */
export function lanes(
  w: Wave,
  tr: StreamTrace,
  view: View,
  col: number,
  shift: 0 | 1,
): Lane[] {
  const out: Lane[] = [];
  const rows = w.case.rows;
  const edges = w.edges;
  const model = (r: number, reg: RegName) =>
    edges.map((e) =>
      val(modelReg(frameFor(tr, e.edge, shift).pe[r]![col]!, reg, w.tagBits)),
    );
  if (view === "weights") {
    out.push({
      key: `w${col}`,
      label: `w_data[${col}]`,
      rtl: edges.map((e) => {
        const t = e.top[col]!;
        return t[0] ? { v: t[3], tile: t[2] } : null;
      }),
      model: edges.map((e) => {
        const t = frameFor(tr, e.edge, shift).inT[col];
        return t ? { v: t[0], tile: t[3]! % (1 << w.tagBits) } : null;
      }),
      kind: "weight",
    });
    for (let r = 0; r < rows; r++) {
      for (const reg of ["sh", "s"] as const)
        out.push({
          key: `${reg}${r}`,
          label: `PE(${r},${col}).${reg}`,
          rtl: edges.map((e) => val(e.pe[r]![col]![reg])),
          model: model(r, reg),
          kind: "weight",
        });
    }
  } else {
    for (let r = 0; r < rows; r++) {
      out.push({
        key: `h${r}`,
        label: `PE(${r},${col}).h`,
        rtl: edges.map((e) => val(e.pe[r]![col]!.h)),
        model: model(r, "h"),
        kind: "act",
      });
      out.push({
        key: `v${r}`,
        label: `PE(${r},${col}).v`,
        rtl: edges.map((e) => val(e.pe[r]![col]!.v)),
        model: model(r, "v"),
        kind: "psum",
      });
    }
  }
  return out;
}

const same = (
  a: { v: number; tile: number } | null,
  b: { v: number; tile: number } | null,
) => (a === null ? b === null : b !== null && a.v === b.v && a.tile === b.tile);

/** Lane-level mismatches at one edge index (what the panel marks red). */
export function laneMismatch(l: Lane, i: number): boolean {
  return !same(l.rtl[i]!, l.model[i]!);
}

/** The live caption for edge index i. */
export function waveCaption(
  w: Wave,
  cmp: Comparison,
  i: number,
  shift: 0 | 1,
): string {
  const e = w.edges[i]!;
  const prev = i > 0 ? w.edges[i - 1]! : null;
  const swaps: string[] = [];
  const loads: number[] = [];
  e.pe.forEach((row, r) =>
    row.forEach((pe, c) => {
      const before = prev ? prev.pe[r]![c]! : null;
      if (pe.s[0] && (!before || !before.s[0] || before.s[1] !== pe.s[1]))
        swaps.push(`PE(${r},${c})`);
    }),
  );
  e.top.forEach((t, c) => {
    if (t[0]) loads.push(c);
  });
  const total = w.case.rows * w.case.cols * REGS.length;
  const bad = cmp.bad[i]!.size;
  const parts: string[] = [`edge ${e.edge}`];
  if (loads.length)
    parts.push(
      `weights shifting into column${loads.length === 1 ? "" : "s"} ${loads.join(", ")}`,
    );
  if (swaps.length)
    parts.push(
      `${swaps.length === 1 ? swaps[0] : `${swaps.length} PEs`} swap${swaps.length === 1 ? "s" : ""} the shadow weight in`,
    );
  const verdict =
    bad === 0
      ? `RTL = model on all ${total} registers`
      : `${bad} of ${total} registers differ${shift ? " (model shifted one cycle)" : ""}`;
  return `${parts.join("; ")}. ${verdict}.`;
}

/** A register value as the panel prints it (a true minus sign). */
export const show = (x: { v: number } | null) =>
  x === null ? "" : minus(String(x.v));
