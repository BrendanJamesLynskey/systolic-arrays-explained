/**
 * Every number the chapters quote comes from here: a path into the tested
 * model's results, e.g. "ws.cycles", "cmp.os.psumHops" or "rtl.values",
 * formatted by kind. The MDX writes <V of="…" fmt="…"/>, so prose cannot
 * drift from the model (tests/unit/values.test.ts checks every path the
 * chapters use resolves, and recomputes the numbers the prose spells out
 * in words).
 */
import rtl from "../../../rtl/rtl_check.json";

import { int, pct, trim } from "@/lib/format";

import {
  DATAFLOWS,
  DEMO,
  activePerCycle,
  cycles,
  demoPair,
  reuseSteps,
  shapeSteps,
  simulate,
  traffic,
  utilSteps,
  utilisation,
} from "./model";

export type Fmt = "num" | "int" | "pct" | "pct0" | "raw";

/** The smallest stream length whose utilisation reaches `target`. */
export function streamFor(rows: number, cols: number, target: number): number {
  let m = 1;
  while (
    utilisation(m * rows * cols, rows, cols, cycles("ws", m, rows, cols)) <
    target
  )
    m += 1;
  return m;
}

function build(): Record<string, unknown> {
  const t: Record<string, unknown> = { demo: DEMO };
  const { M: hm, K: hk, N: hn } = DEMO.hero;
  t.hero = { cycles: cycles("ws", hm, hk, hn) };

  const reuse = reuseSteps(DEMO.beta, DEMO.reuseMax);
  const last = reuse[reuse.length - 1]!;
  const r4 = reuse[3]!;
  t.reuse = {
    n: last.n,
    peak: last.peak,
    sys: last.systolic2 / 2,
    naive: last.naive2 / 2,
    naiveShare: last.naive2 / 2 / last.peak,
    words: last.wordsPerCycle,
    perWord: last.macsPerWord2 / 2,
    n4words: r4.wordsPerCycle,
    n4naiveWords: 2 * r4.peak,
  };

  const { M: wm, K: wk, N: wn } = DEMO.ws;
  const ws = simulate("ws", ...demoPair(wm, wk, wn), wk, wn);
  const firstOut = ws.frames.findIndex((f) => f.out.length > 0);
  const lastOut = ws.frames.length - 1;
  t.ws = {
    cycles: ws.cycles,
    load: wk,
    compute: wm + wk + wn - 2,
    firstOut: firstOut + 1,
    lastOut: lastOut + 1,
    macs: wm * wk * wn,
    pes: wk * wn,
    util: utilisation(wm * wk * wn, wk, wn, ws.cycles),
    skewRegs: (wk * (wk - 1)) / 2,
    c00: ws.C[0]![0]!,
  };

  const { M: cm, K: ck, N: cn } = DEMO.cmp;
  const cmp: Record<string, unknown> = {};
  for (const df of DATAFLOWS)
    cmp[df] = { ...traffic(df, cm, ck, cn), cycles: cycles(df, cm, ck, cn) };
  t.cmp = cmp;
  const big: Record<string, unknown> = {};
  for (const df of DATAFLOWS) {
    const tr = traffic(df, 128, 128, 128);
    // operands are 8-bit, partial sums 32-bit (INT8 in, INT32 accumulate)
    const bits = 8 * (tr.hops - tr.psumHops) + 32 * tr.psumHops;
    big[df] = { ...tr, bits, cycles: cycles(df, 128, 128, 128) };
  }
  t.big = big;

  const { M: vm, K: vk, N: vn } = DEMO.wave;
  const wave = simulate("ws", ...demoPair(vm, vk, vn), vk, vn);
  const act = activePerCycle(wave);
  t.wave = {
    cycles: wave.cycles,
    fill: vk + vn - 2,
    peak: Math.max(...act),
    pes: vk * vn,
    util: utilisation(vm * vk * vn, vk, vn, wave.cycles),
  };

  const R = DEMO.array;
  const u = utilSteps("ws", R, R, R, R, DEMO.utilMax);
  const uo = utilSteps("os", R, R, R, R, DEMO.utilMax);
  t.util = {
    array: R,
    m1: u[0]!.util,
    m8: u[7]!.util,
    m64: u[63]!.util,
    os64: uo[63]!.util,
    m90: streamFor(R, R, 0.9),
    m90big: streamFor(256, 256, 0.9),
    overhead: cycles("ws", 0, R, R),
    // a pass minus its stream: load + fill + drain
    overheadBig: cycles("ws", 0, 256, 256),
  };
  const sh = shapeSteps(
    "ws",
    R,
    R,
    DEMO.shape.M,
    DEMO.shape.K,
    DEMO.shape.nMax,
  );
  t.shape = {
    M: DEMO.shape.M,
    K: DEMO.shape.K,
    n8: sh[7]!.util,
    n9: sh[8]!.util,
    n16: sh[15]!.util,
    n17: sh[16]!.util,
  };

  let values = 0;
  let edges = 0;
  let mism = 0;
  for (const c of rtl.cases) {
    values += c.values;
    edges += c.edges;
    mism += c.mismatches;
  }
  t.rtl = {
    cases: rtl.cases.length,
    values,
    edges,
    mismatches: mism,
    simulator: rtl.simulator,
  };
  return t;
}

let TREE: Record<string, unknown> | null = null;

export function lookup(path: string): number | string | boolean {
  if (!TREE) TREE = build();
  let cur: unknown = TREE;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(k in cur))
      throw new Error(`no value at ${path}`);
    cur = (cur as Record<string, unknown>)[k];
  }
  if (
    typeof cur !== "number" &&
    typeof cur !== "string" &&
    typeof cur !== "boolean"
  )
    throw new Error(`${path} is not a number or string`);
  return cur;
}

export function formatValue(v: number | string | boolean, fmt: Fmt): string {
  if (typeof v !== "number") return String(v);
  switch (fmt) {
    case "int":
      return int(v);
    case "pct":
      return pct(v, 1);
    case "pct0":
      return pct(v, 0);
    case "raw":
      return String(v);
    default:
      return trim(v);
  }
}
