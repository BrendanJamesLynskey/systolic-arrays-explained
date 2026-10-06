/**
 * The live captions of chapters 5-9 (one line per animation step, also read
 * out through an aria-live region). Each is a pure function of a model
 * state, so the frame tests can check that the caption the site shows for a
 * step is the caption of the Python reference's state for that step.
 */
import { int, minus, sub, trim } from "@/lib/format";

import { DATAFLOW_SHORT } from "./captions";
import type { Layer, LowerStep } from "./lower";
import type { Dataflow, RsTrace } from "./model";
import { f32Value, halfValue, sext8, type Mode, type PeTrace } from "./pe";
import type { StreamTrace, Words } from "./stream";
import type { TorusFrame } from "./torus";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------
// Chapter 5
// ---------------------------------------------------------------------------

/** What each tile is doing in cycle t. */
export function tileActivity(
  tr: StreamTrace,
  t: number,
): { j: number; what: "fetch" | "load" | "stream" | "drain" }[] {
  const out: { j: number; what: "fetch" | "load" | "stream" | "drain" }[] = [];
  for (const tl of tr.schedule.tiles) {
    if (tl.fetch !== null && tl.fetch[0] <= t && t < tl.fetch[1])
      out.push({ j: tl.j, what: "fetch" });
    if (tl.load <= t && t <= tl.loadEnd) out.push({ j: tl.j, what: "load" });
    if (tl.stream <= t && t < tl.stream + tr.M)
      out.push({ j: tl.j, what: "stream" });
    else if (tl.stream + tr.M <= t && t < tl.end)
      out.push({ j: tl.j, what: "drain" });
  }
  return out;
}

/** PEs whose stationary weight changed in cycle t (a swap). */
export function swapsAt(tr: StreamTrace, t: number): number {
  if (t === 0) return 0;
  let c = 0;
  const a = tr.frames[t - 1]!.pe;
  const b = tr.frames[t]!.pe;
  b.forEach((row, r) =>
    row.forEach((cell, q) => {
      const old = a[r]![q]![0];
      if (cell[0] !== null && (old === null || old[3] !== cell[0][3])) c += 1;
    }),
  );
  return c;
}

export function streamCaption(tr: StreamTrace, t: number): string {
  const f = tr.frames[t]!;
  const parts = tileActivity(tr, t).map(({ j, what }) => {
    const tl = tr.schedule.tiles[j]!;
    if (what === "fetch")
      return `tile ${j + 1} is fetched from HBM (${tl.k * tl.n} words)`;
    if (what === "load")
      return `tile ${j + 1} shifts into the shadow registers`;
    if (what === "stream")
      return `tile ${j + 1} streams row ${t - tl.stream + 1} of ${tr.M}`;
    return `tile ${j + 1} drains`;
  });
  let busy = 0;
  for (const row of f.pe) for (const cell of row) if (cell[4] !== null) busy++;
  const sw = swapsAt(tr, t);
  const head = `Cycle ${t + 1}: ${parts.length ? parts.join("; ") : "waiting"}.`;
  const swap = sw
    ? ` ${plural(sw, "PE")} swap${sw === 1 ? "s" : ""} in a new weight.`
    : "";
  const out = f.out.length
    ? ` ${plural(f.out.length, "result")} leave${f.out.length === 1 ? "s" : ""} the bottom.`
    : "";
  return `${head} ${busy} of ${tr.rows * tr.cols} PEs multiply.${swap}${out}`;
}

/** Buffer words per MAC of each dataflow (chapter 5's bandwidth widget). */
export function wordsPerMac(w: Words, macs: number): number {
  return (w.a + w.b + w.c + w.acc) / macs;
}

export function bandwidthCaption(
  r: number,
  m: number,
  per: Record<Dataflow, number>,
): string {
  const order = (["ws", "os", "is"] as const)
    .slice()
    .sort((x, y) => per[x] - per[y]);
  const list = (["ws", "os", "is"] as const)
    .map((df) => `${DATAFLOW_SHORT[df]} ${trim(per[df], 3)}`)
    .join(", ");
  return `${r} × ${r} array, M = ${m}: buffer words per MAC ${list}. Fewest: ${DATAFLOW_SHORT[order[0]!]}.`;
}

// ---------------------------------------------------------------------------
// Chapter 6
// ---------------------------------------------------------------------------

/** A register's value as a number: INT8/INT32 integers or decoded floats. */
export function operand(mode: Mode, bits: number): number {
  return mode === "int8" ? sext8(bits) : halfValue(mode, bits);
}

export function peValue(mode: Mode, bits: number): number {
  return mode === "int8" ? bits : f32Value(bits);
}

const fmt = (v: number) =>
  Number.isInteger(v) ? minus(String(v)) : trim(v, 6);

export function peCaption(
  mode: Mode,
  tr: PeTrace,
  count: number,
  t: number,
): string {
  const f = tr.frames[t]!;
  const parts: string[] = [];
  // stage 1 holds operation t, stage 2 operation t - 1, stage 3 added t - 2
  if (t < count && f.s1[2])
    parts.push(
      `stage 1 latches a${sub(t)} = ${fmt(operand(mode, f.s1[0]))}, b${sub(t)} = ${fmt(operand(mode, f.s1[1]))}`,
    );
  if (t >= 1 && t - 1 < count && f.s2[1])
    parts.push(
      `stage 2 multiplies: a${sub(t - 1)}b${sub(t - 1)} = ${fmt(peValue(mode, f.s2[0]))}${mode === "int8" ? "" : " (exact in FP32)"}`,
    );
  const [ev, before] = f.event;
  const i = t - 2;
  if (ev === "clear")
    parts.push(
      `stage 3 starts a new dot product with a${sub(i)}b${sub(i)}: acc = ${fmt(peValue(mode, f.acc))}`,
    );
  else if (ev === "add") {
    const p = peValue(mode, tr.frames[t - 1]!.s2[0]);
    const exact = peValue(mode, before) + p;
    const got = peValue(mode, f.acc);
    const r =
      mode !== "int8" && got !== exact
        ? `, rounded to FP32 from ${fmt(exact)}`
        : "";
    parts.push(
      `stage 3 adds a${sub(i)}b${sub(i)}: ${fmt(peValue(mode, before))} + ${fmt(p)} = ${fmt(got)}${r}`,
    );
  } else parts.push("stage 3 holds the accumulator");
  return `Cycle ${t + 1}: ${parts.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// Chapter 7
// ---------------------------------------------------------------------------

export const PHASE_NAME: Record<TorusFrame["phase"], string> = {
  start: "start",
  "rs-x": "reduce-scatter along x",
  "rs-y": "reduce-scatter along y",
  "ag-y": "all-gather along y",
  "ag-x": "all-gather along x",
};

export function torusCaption(f: TorusFrame, xd: number, yd: number): string {
  const chips = xd * yd;
  const done = f.state[0]![0]!.filter(([, c]) => c === chips).length;
  if (f.phase === "start")
    return `Start: each of the ${chips} chips holds its own ${chips} numbers, and every chip needs the sum of all ${chips} vectors.`;
  const m = f.msgs[0]!;
  const dir = f.phase.endsWith("x") ? "+x" : "+y";
  const verb = f.phase.startsWith("rs")
    ? "adds them to its own"
    : "copies them";
  return `Step ${f.t} (${PHASE_NAME[f.phase]}, ${f.step} of ${f.of}): every chip sends ${plural(m[4].length, "number")} to its ${dir} neighbour, which ${verb}. Chip (0,0) holds ${done} of ${chips} finished sums.`;
}

// ---------------------------------------------------------------------------
// Chapter 8
// ---------------------------------------------------------------------------

export function rsCaption(tr: RsTrace, t: number): string {
  const f = tr.frames[t]!;
  // the caption follows the first PE (row-major) that passes a sum on, or
  // else the last one that multiplied
  let busy = 0;
  let focus: [number, number] | null = null;
  let passing: [number, number] | null = null;
  f.pe.forEach((row, i) =>
    row.forEach((cell, j) => {
      if (cell[2] !== null) {
        busy++;
        focus = [i, j];
      }
      if (cell[4] !== null && passing === null) passing = [i, j];
    }),
  );
  if (passing !== null) focus = passing;
  const head = `Cycle ${t + 1}: ${busy} of ${tr.R * tr.E} PEs multiply.`;
  if (focus === null) return head;
  const [i, j] = focus as [number, number];
  const [col, tap, mac, , v] = f.pe[i]![j]!;
  const [x, w] = mac!;
  let tail = "";
  if (v !== null)
    tail =
      i === tr.R - 1
        ? ` Its column finishes o${sub(j, col!)} = ${minus(String(v[0]))}.`
        : ` It passes the partial row sum ${minus(String(v[0]))} down.`;
  return `${head} PE(${i},${j}) keeps filter row ${i} and multiplies x${sub(i + j, col! + tap!)} = ${minus(String(x))} by f${sub(i, tap!)} = ${minus(String(w))} (output row ${j}, column ${col}, tap ${tap! + 1} of ${tr.S}).${tail}`;
}

// ---------------------------------------------------------------------------
// Chapter 9
// ---------------------------------------------------------------------------

export function lowerCaption(
  s: LowerStep,
  layers: Layer[],
  rows: number,
  outW: number,
  kernel: number,
): string {
  const L = layers[s.layer]!;
  if (s.kind === "im2col") {
    const i = Math.floor(s.row / outW);
    const j = s.row % outW;
    const g = L.gemm!;
    return `im2col row ${s.row + 1} of ${g[1]}: output pixel (${i}, ${j}) sees the ${kernel} × ${kernel} patch at rows ${i}–${i + kernel - 1}, columns ${j}–${j + kernel - 1} of every channel: ${g[2]} numbers, one row of A.`;
  }
  if (s.kind === "tile")
    return `Tile ${s.tile + 1} of ${L.tiles}: rows ${s.k0}–${s.k0 + s.k - 1} of B (K) by filters ${s.n0}–${s.n0 + s.n - 1}, held in the ${rows} × ${rows} array; all ${L.gemm![1]} rows of A stream through from cycle ${s.stream + 1}, the last result leaves in cycle ${s.end}.`;
  if (s.kind === "summary") {
    const arr = layers.filter((l) => l.unit === "array");
    const parts = arr.map(
      (l) =>
        `${l.name} ${int(l.stream!)} cycles (${Math.round(l.util! * 1000) / 10}% busy; the approximate formula says ${int(l.approx!)})`,
    );
    return `On a ${rows} × ${rows} array: ${parts.join(", ")}.`;
  }
  if (L.unit === "array") {
    const [, m, k, n] = L.gemm!;
    if (L.op === "Conv")
      return `${L.name} (Conv): lowered by im2col to a GEMM, A ${m} × ${k} (one row per output pixel) times B ${k} × ${n} (one column per filter): ${int(L.macs!)} MACs.`;
    return `${L.name} (Gemm): A ${m} × ${k} times B ${k} × ${n}. One row of A, so each ${rows} × ${rows} weight tile serves a single row: ${L.tiles} tiles, ${int(L.stream!)} cycles, ${Math.round(L.util! * 1000) / 10}% busy.`;
  }
  if (L.unit === "vector")
    return `${L.name} (Relu): ${int(L.elements!)} elements on the vector unit, not the array.`;
  return `${L.name} (Flatten): a view. The numbers stay where they are; only the shape changes, to ${L.out.join(" × ")}.`;
}
