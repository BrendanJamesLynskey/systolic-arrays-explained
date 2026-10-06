/**
 * Chapter 7: all-reduce on a 2-D torus of chips. A line-for-line port of
 * reference/torus.py (read its docstring): reduce-scatter along x, then y,
 * all-gather along y, then x, every chip sending to its + neighbour on the
 * wrap-around links. Integers only: every frame matches the reference
 * exactly (tests/unit/partb.test.ts).
 */
import { Rng } from "./model";

export type Phase = "start" | "rs-x" | "rs-y" | "ag-y" | "ag-x";
/** [x, y, x', y', chunks] */
export type Msg = [number, number, number, number, number[]];
/** state[x][y][chunk] = [value, contributions] */
export type TorusFrame = {
  t: number;
  phase: Phase;
  step: number;
  of: number;
  msgs: Msg[];
  sent: number;
  state: [number, number][][][];
};
export type TorusRun = {
  X: number;
  Y: number;
  steps: number;
  sum: number[];
  frames: TorusFrame[];
};

export function demoVectors(
  xd: number,
  yd: number,
  seed: number,
): number[][][] {
  const rng = new Rng(seed);
  const d = xd * yd;
  return Array.from({ length: xd }, () =>
    Array.from({ length: yd }, () =>
      Array.from({ length: d }, () => rng.intIn(0, 9)),
    ),
  );
}

const mod = (a: number, b: number) => ((a % b) + b) % b;

export function allreduce(data: number[][][]): TorusRun {
  const xd = data.length;
  const yd = data[0]!.length;
  const d = xd * yd;
  const val = data.map((row) => row.map((v) => [...v]));
  const cnt = data.map((row) => row.map(() => new Array<number>(d).fill(1)));
  const snap = (): [number, number][][][] =>
    val.map((row, x) =>
      row.map((v, y) =>
        v.map((value, c): [number, number] => [value, cnt[x]![y]![c]!]),
      ),
    );
  const frames: TorusFrame[] = [
    { t: 0, phase: "start", step: 0, of: 0, msgs: [], sent: 0, state: snap() },
  ];
  let sent = 0;
  const group = (g: number) => Array.from({ length: yd }, (_, j) => g * yd + j);
  const run = (
    phase: Phase,
    steps: number,
    plan: (x: number, y: number, s: number) => [[number, number], number[]],
  ) => {
    for (let s = 0; s < steps; s++) {
      const msgs: Msg[] = [];
      const oldV = val.map((row) => row.map((v) => [...v]));
      const oldC = cnt.map((row) => row.map((v) => [...v]));
      for (let x = 0; x < xd; x++)
        for (let y = 0; y < yd; y++) {
          const [[dx, dy], chunks] = plan(x, y, s);
          msgs.push([x, y, dx, dy, chunks]);
          sent += chunks.length;
          for (const c of chunks) {
            if (phase.startsWith("rs")) {
              val[dx]![dy]![c]! += oldV[x]![y]![c]!;
              cnt[dx]![dy]![c]! += oldC[x]![y]![c]!;
            } else {
              val[dx]![dy]![c] = oldV[x]![y]![c]!;
              cnt[dx]![dy]![c] = oldC[x]![y]![c]!;
            }
          }
        }
      frames.push({
        t: frames.length,
        phase,
        step: s + 1,
        of: steps,
        msgs,
        sent,
        state: snap(),
      });
    }
  };
  run("rs-x", xd - 1, (x, y, s) => [[(x + 1) % xd, y], group(mod(x - s, xd))]);
  run("rs-y", yd - 1, (x, y, s) => [
    [x, (y + 1) % yd],
    [((x + 1) % xd) * yd + mod(y - s, yd)],
  ]);
  run("ag-y", yd - 1, (x, y, s) => [
    [x, (y + 1) % yd],
    [((x + 1) % xd) * yd + mod(y + 1 - s, yd)],
  ]);
  run("ag-x", xd - 1, (x, y, s) => [
    [(x + 1) % xd, y],
    group(mod(x + 1 - s, xd)),
  ]);
  const sum: number[] = [];
  for (let c = 0; c < d; c++) {
    let t = 0;
    for (let x = 0; x < xd; x++)
      for (let y = 0; y < yd; y++) t += data[x]![y]![c]!;
    sum.push(t);
  }
  return { X: xd, Y: yd, steps: frames.length - 1, sum, frames };
}

export function stepsTorus(xd: number, yd: number): number {
  return 2 * (xd - 1) + 2 * (yd - 1);
}

export function stepsRing(chips: number): number {
  return 2 * (chips - 1);
}

export const DEMO_TORUS = { X: 4, Y: 4, seed: 7 } as const;

export function demoRun(
  xd: number = DEMO_TORUS.X,
  yd: number = DEMO_TORUS.Y,
): TorusRun {
  return allreduce(demoVectors(xd, yd, DEMO_TORUS.seed));
}
