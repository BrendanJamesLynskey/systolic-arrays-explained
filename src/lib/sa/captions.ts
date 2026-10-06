/**
 * The live captions (one line per animation step, also read out through an
 * aria-live region). Each is a pure function of a model state, so the
 * frame tests can check that the caption the site shows for a step is the
 * caption of the Python reference's state for that step.
 */
import { int, minus, pct, signed, sub } from "@/lib/format";

import type {
  Counts,
  Dataflow,
  Frame,
  OpTag,
  ReuseStep,
  ShapeStep,
  SumTag,
  UtilStep,
} from "./model";

export const DATAFLOW_NAME: Record<Dataflow, string> = {
  ws: "weight-stationary",
  os: "output-stationary",
  is: "input-stationary",
};

export const DATAFLOW_SHORT: Record<Dataflow, string> = {
  ws: "WS",
  os: "OS",
  is: "IS",
};

const n = (v: number) => minus(String(v));

/** The PE the caption describes: the last one (row-major) that multiplied. */
export function focusPe(f: Frame): [number, number] | null {
  let best: [number, number] | null = null;
  f.pe.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell[4] !== null) best = [r, c];
    }),
  );
  return best;
}

function macCount(f: Frame): number {
  let c = 0;
  for (const row of f.pe) for (const cell of row) if (cell[4] !== null) c += 1;
  return c;
}

function outText(f: Frame): string {
  if (f.out.length === 0) return "";
  const parts = f.out.map(([m, nn, v]) => `c${sub(m, nn)} = ${n(v)}`);
  return ` Out: ${parts.join(", ")}.`;
}

/** One cycle of one dataflow (chapters 2 and 3). */
export function cycleCaption(
  df: Dataflow,
  dims: { M: number; K: number; N: number; rows: number; cols: number },
  f: Frame,
): string {
  const cyc = `Cycle ${f.t + 1}`;
  if (f.phase === "load") {
    const l = f.t;
    const what = df === "ws" ? "row" : "column";
    const mat = df === "ws" ? "B" : "A";
    const held = df === "ws" ? "PE(k,n) holds wₖₙ = bₖₙ" : "PE(k,m) holds aₘₖ";
    return `${cyc} (load ${l + 1} of ${dims.K}): ${what} ${dims.K - 1 - l} of ${mat} enters the top and the values already loaded shift down a row; after ${dims.K} cycles ${held}.`;
  }
  if (f.phase === "drain") {
    const d = f.t - (dims.K + dims.M + dims.N - 2);
    return `${cyc} (drain ${d + 1} of ${dims.M}): the bottom row writes its results and the accumulators above shift down one row.${outText(f)}`;
  }
  const busy = macCount(f);
  const focus = focusPe(f);
  const head = `${cyc}: ${busy} of ${dims.rows * dims.cols} PEs multiply.`;
  if (focus === null) return `${head}${outText(f)}`;
  const [r, c] = focus;
  const cell = f.pe[r]![c]!;
  const [x, y] = cell[4]!;
  const prod = x * y;
  if (df === "os") {
    const a = cell[1]!;
    const b = cell[2] as OpTag;
    const acc = cell[3]!;
    return `${head} PE(${r},${c}) gets a${sub(a[1], a[2])} = ${n(x)} from the left and b${sub(b[1], b[2])} = ${n(y)} from above: c${sub(acc[1], acc[2])} += ${n(x)} × ${signed(y)}, now ${n(acc[0])} (${acc[3]} of ${dims.K} terms).${outText(f)}`;
  }
  const h = cell[1]!;
  const s = cell[0]!;
  const p = cell[2] as SumTag;
  const moving = df === "ws" ? `a${sub(h[1], h[2])}` : `b${sub(h[1], h[2])}`;
  const held = df === "ws" ? `w${sub(s[1], s[2])}` : `a${sub(s[1], s[2])}`;
  const before = p[0] - prod;
  const sumText =
    p[3] === 1
      ? `starts c${sub(p[1], p[2])}: ${n(x)} × ${signed(y)} = ${n(p[0])}`
      : `adds ${n(x)} × ${signed(y)} to the ${n(before)} from above: ${n(p[0])}`;
  return `${head} PE(${r},${c}) holds ${held} = ${n(y)}, gets ${moving} = ${n(x)} from the left and ${sumText} (${p[3]} of ${dims.K} terms).${outText(f)}`;
}

/** The three dataflows at one cycle (chapter 3). */
export function compareCaption(
  t: number,
  counts: Record<Dataflow, Counts>,
  done: Record<Dataflow, boolean>,
): string {
  const parts = (["ws", "os", "is"] as const).map(
    (df) =>
      `${DATAFLOW_SHORT[df]} ${int(counts[df].macs)} MACs${done[df] ? " (done)" : ""}`,
  );
  return `Cycle ${t + 1}: ${parts.join(", ")}. Partial sums moved so far: WS ${int(counts.ws.psumHops)}, OS ${int(counts.os.psumHops)}, IS ${int(counts.is.psumHops)}.`;
}

/** The memory wall (chapter 1). */
export function reuseCaption(s: ReuseStep, beta: number): string {
  const naive = s.naive2 / 2;
  const sys = s.systolic2 / 2;
  const limit =
    s.systolic2 === 2 * s.peak
      ? `all ${int(s.peak)} MACs run`
      : `memory limits it to ${int(sys)} of ${int(s.peak)}`;
  return `${s.n} × ${s.n} = ${int(s.peak)} multipliers on ${beta} words a cycle. Fetching two words per MAC feeds ${int(naive)} of them; a systolic array needs only ${s.wordsPerCycle} words a cycle, so ${limit}.`;
}

/** The wavefront (chapter 4). */
export function waveCaption(
  t: number,
  load: number,
  active: number,
  pes: number,
  dims: { M: number; K: number; N: number },
): string {
  if (t < load)
    return `Cycle ${t + 1}: loading weights (${t + 1} of ${load}); no PE multiplies yet.`;
  const tc = t - load;
  const fill = dims.K + dims.N - 2;
  const phase =
    tc < fill && active < pes
      ? "filling"
      : tc >= dims.M - 1 && active < pes
        ? "draining"
        : "full";
  return `Cycle ${t + 1}: ${active} of ${pes} PEs busy (${phase}). PE(k,n) works on row m = ${tc} − k − n of A, so the busy PEs form a diagonal band.`;
}

/** Utilisation against size (chapter 4). */
export function utilCaption(
  df: Dataflow,
  mode: "stream" | "shape",
  s: UtilStep | ShapeStep,
  rows: number,
  cols: number,
): string {
  if (mode === "stream") {
    const u = s as UtilStep;
    const what = df === "ws" ? "M" : df === "os" ? "K" : "N";
    return `${what} = ${u.x}: ${int(u.macs)} MACs in ${int(u.cycles)} cycles on ${rows * cols} PEs, ${pct(u.util, 1)} busy.`;
  }
  const v = s as ShapeStep;
  return `N = ${v.n}: ${v.tiles} tile${v.tiles === 1 ? "" : "s"}, ${int(v.cycles)} cycles, ${pct(v.util, 1)} busy.`;
}

/** The hero (chapter 1 and the home page): what moves, not the numbers. */
export function heroCaption(f: Frame, pes: number): string {
  if (f.phase === "load")
    return `Cycle ${f.t + 1}: the weights (vermillion) shift down into place, one row per cycle.`;
  const busy = macCount(f);
  const out = f.out.length
    ? ` ${f.out.length} finished result${f.out.length === 1 ? "" : "s"} leave${f.out.length === 1 ? "s" : ""} the bottom.`
    : "";
  return `Cycle ${f.t + 1}: activations (blue) step right and partial sums (sky) step down; ${busy} of ${pes} PEs multiply.${out}`;
}
