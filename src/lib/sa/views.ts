/**
 * The data some chapter 5-9 animations draw, computed from the models (kept
 * out of the widgets so the frame tests can check it without React).
 */
import { wordsPerMac } from "./captionsB";
import {
  DATAFLOWS,
  DEMO,
  demoMatrix,
  tiledCycles,
  type Dataflow,
  type Matrix,
} from "./model";
import { tiledWords, type Words } from "./stream";

export type BwRow = {
  array: number;
  words: Record<Dataflow, Words>;
  cycles: Record<Dataflow, number>;
  perMac: Record<Dataflow, number>;
};

/** Chapter 5: buffer traffic of the 1024-wide layer on every array size. */
export function bandwidthRows(m: number): BwRow[] {
  const { K, N, arrays } = DEMO.bw;
  return arrays.map((r) => {
    const words = {} as Record<Dataflow, Words>;
    const cyc = {} as Record<Dataflow, number>;
    const per = {} as Record<Dataflow, number>;
    for (const df of DATAFLOWS) {
      words[df] = tiledWords(df, m, K, N, r, r);
      cyc[df] = tiledCycles(df, m, K, N, r, r);
      per[df] = wordsPerMac(words[df], m * K * N);
    }
    return { array: r, words, cycles: cyc, perMac: per };
  });
}

/** Chapter 8: the row-stationary demonstration's input and filter. */
export function rsDemo(): { x: Matrix; f: Matrix } {
  const d = DEMO.rs;
  return {
    x: demoMatrix(d.H, d.W, d.seedX),
    f: demoMatrix(d.R, d.S, d.seedF),
  };
}
