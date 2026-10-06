/**
 * Chapter 5: weight-stationary tiles back to back on one array, with
 * double-buffered weights, and the buffer traffic of a tiled GEMM. A
 * line-for-line port of `stream_schedule`, `simulate_ws_stream` and
 * `tiled_words` in reference/systolic.py (read their docstrings); integers
 * only, so every register in every cycle matches the reference exactly
 * (tests/unit/partb.test.ts against tests/fixtures/sa_fixtures_b.json).
 *
 * A PE is [s, h, v, sh, mac]: the stationary weight, the activation moving
 * right, the partial sum moving down, the shadow weight and the product
 * made this cycle. Every tag ends with its tile's index.
 */
import { tiles, type Dataflow, type Matrix, type Mac } from "./model";

const ceilDiv = (x: number, y: number) => Math.floor((x + y - 1) / y);

/** [value, k, n, tile] of a weight; [value, m, k, tile] of an activation. */
export type WTag = [number, number, number, number];
/** [value, m, n, terms, tile] of a partial sum. */
export type PTag = [number, number, number, number, number];
export type StreamPe = [
  WTag | null,
  WTag | null,
  PTag | null,
  WTag | null,
  Mac | null,
];

export type TileTimes = {
  j: number;
  k0: number;
  k: number;
  n0: number;
  n: number;
  fetch: [number, number] | null;
  load: number;
  loadEnd: number;
  stream: number;
  end: number;
};

export type Schedule = {
  tiles: TileTimes[];
  cycles: number;
  M: number;
  K: number;
  N: number;
  rows: number;
  cols: number;
};

export function streamSchedule(
  m: number,
  k: number,
  n: number,
  rows: number,
  cols: number,
  bw: number | null = null,
  buffers = 2,
  shadow = true,
): Schedule {
  const ts = tiles("ws", m, k, n, rows, cols);
  const out: TileTimes[] = [];
  let dmaFree = 0;
  ts.forEach(([, , k0, k1, n0, n1], j) => {
    const kj = k1 - k0;
    const nj = n1 - n0;
    let fetch: [number, number] | null = null;
    let ready = 0;
    if (bw !== null) {
      // the buffer this tile uses is free once tile j - buffers is loaded
      const free = j < buffers ? 0 : out[j - buffers]!.loadEnd;
      const start = Math.max(dmaFree, free);
      const end = start + ceilDiv(kj * nj, bw);
      dmaFree = end;
      fetch = [start, end];
      ready = end;
    }
    let load: number;
    if (j === 0) load = ready;
    else if (shadow) load = Math.max(out[j - 1]!.stream, ready);
    else load = Math.max(out[j - 1]!.end, ready);
    let stream =
      j === 0 ? load + kj : Math.max(out[j - 1]!.stream + m, load + kj);
    if (!shadow && j > 0) stream = load + kj;
    out.push({
      j,
      k0,
      k: kj,
      n0,
      n: nj,
      fetch,
      load,
      loadEnd: load + nj - 1 + kj,
      stream,
      end: stream + m + kj + nj - 2,
    });
  });
  return {
    tiles: out,
    cycles: out[out.length - 1]!.end,
    M: m,
    K: k,
    N: n,
    rows,
    cols,
  };
}

export type StreamCounts = {
  macs: number;
  reads: number;
  writes: number;
  accReads: number;
  hops: number;
  fetched: number;
};

export type StreamFrame = {
  t: number;
  pe: StreamPe[][];
  inL: (WTag | null)[];
  inT: (WTag | null)[];
  out: [number, number, number][];
  cnt: StreamCounts;
};

export type StreamTrace = {
  M: number;
  K: number;
  N: number;
  rows: number;
  cols: number;
  cycles: number;
  C: Matrix;
  schedule: Schedule;
  frames: StreamFrame[];
  totals: StreamCounts;
};

export function simulateWsStream(
  a: Matrix,
  b: Matrix,
  rows: number,
  cols: number,
  bw: number | null = null,
  buffers = 2,
  shadow = true,
): StreamTrace {
  const m = a.length;
  const k = b.length;
  const n = b[0]!.length;
  const sched = streamSchedule(m, k, n, rows, cols, bw, buffers, shadow);
  const ts = sched.tiles;
  const total = sched.cycles;
  const cnt: StreamCounts = {
    macs: 0,
    reads: 0,
    writes: 0,
    accReads: 0,
    hops: 0,
    fetched: 0,
  };
  const empty = (): StreamPe[][] =>
    Array.from({ length: rows }, () =>
      Array.from(
        { length: cols },
        (): StreamPe => [null, null, null, null, null],
      ),
    );
  const frames: StreamFrame[] = [];
  let prev = empty();
  const result: Matrix = Array.from({ length: m }, () =>
    new Array<number>(n).fill(0),
  );
  const seen: boolean[][] = Array.from({ length: m }, () =>
    new Array<boolean>(n).fill(false),
  );
  for (let t = 0; t < total; t++) {
    const grid = empty();
    const inLeft: (WTag | null)[] = new Array<WTag | null>(rows).fill(null);
    const inTop: (WTag | null)[] = new Array<WTag | null>(cols).fill(null);
    const loadStep: (number | null)[] = new Array<number | null>(cols).fill(
      null,
    );
    for (const tl of ts) {
      for (let q = 0; q < tl.n; q++) {
        const l = t - tl.load - q;
        if (l >= 0 && l < tl.k) {
          const kk = tl.k - 1 - l;
          /* c8 ignore next */
          if (inTop[q] !== null)
            throw new Error("two tiles load one column at once");
          inTop[q] = [b[tl.k0 + kk]![tl.n0 + q]!, tl.k0 + kk, tl.n0 + q, tl.j];
          loadStep[q] = l;
          cnt.reads += 1;
        }
      }
      for (let kk = 0; kk < tl.k; kk++) {
        const p = t - tl.stream - kk;
        if (p >= 0 && p < m) {
          /* c8 ignore next */
          if (inLeft[kk] !== null)
            throw new Error("two tiles feed one row at once");
          inLeft[kk] = [a[p]![tl.k0 + kk]!, p, tl.k0 + kk, tl.j];
          cnt.reads += 1;
        }
      }
    }
    const out: [number, number, number][] = [];
    for (let kk = 0; kk < rows; kk++) {
      for (let q = 0; q < cols; q++) {
        const cell = grid[kk]![q]!;
        const old = prev[kk]![q]!;
        // the shadow chain: rows the load has reached shift down
        const ls = loadStep[q]!;
        if (ls !== null && kk <= ls) {
          cell[3] = kk === 0 ? inTop[q]! : prev[kk - 1]![q]![3];
          if (kk > 0) cnt.hops += 1;
        } else cell[3] = old[3];
        // the activation arriving from the left
        let hIn = q === 0 ? inLeft[kk]! : prev[kk]![q - 1]![1];
        if (hIn !== null && q > 0) cnt.hops += 1;
        if (hIn !== null && q >= ts[hIn[3]]!.n) hIn = null;
        cell[1] = hIn;
        let s = old[0];
        if (hIn !== null && (s === null || s[3] !== hIn[3])) {
          s = old[3];
          /* c8 ignore next */
          if (s === null || s[3] !== hIn[3] || s[1] !== hIn[2])
            throw new Error("weight not loaded in time");
        }
        cell[0] = s;
        if (hIn === null) continue;
        const tl = ts[hIn[3]]!;
        const p = hIn[1];
        const nn = tl.n0 + q;
        let pVal = 0;
        let terms = 0;
        if (kk > 0) {
          const above = prev[kk - 1]![q]![2];
          /* c8 ignore next 7 */
          if (
            above === null ||
            above[1] !== p ||
            above[2] !== nn ||
            above[4] !== hIn[3]
          )
            throw new Error("partial sum out of step");
          pVal = above[0];
          terms = above[3];
          cnt.hops += 1;
        }
        cell[4] = [hIn[0], s![0]];
        cnt.macs += 1;
        cell[2] = [pVal + hIn[0] * s![0], p, nn, terms + 1, hIn[3]];
        if (kk === tl.k - 1) {
          const val = cell[2][0];
          if (seen[p]![nn]) cnt.accReads += 1;
          result[p]![nn]! += val;
          seen[p]![nn] = true;
          out.push([p, nn, val]);
          cnt.writes += 1;
        }
      }
    }
    for (const tl of ts) {
      if (tl.fetch !== null && tl.fetch[0] <= t && t < tl.fetch[1]) {
        const words = tl.k * tl.n;
        const dur = tl.fetch[1] - tl.fetch[0];
        const i = t - tl.fetch[0];
        cnt.fetched +=
          Math.floor((words * (i + 1)) / dur) - Math.floor((words * i) / dur);
      }
    }
    frames.push({ t, pe: grid, inL: inLeft, inT: inTop, out, cnt: { ...cnt } });
    prev = grid;
  }
  return {
    M: m,
    K: k,
    N: n,
    rows,
    cols,
    cycles: total,
    C: result,
    schedule: sched,
    frames,
    totals: { ...cnt },
  };
}

export type Words = { a: number; b: number; c: number; acc: number };

/** Buffer traffic of a tiled GEMM by operand (tiles in sequence). */
export function tiledWords(
  df: Dataflow,
  m: number,
  k: number,
  n: number,
  rows: number,
  cols: number,
): Words {
  const out: Words = { a: 0, b: 0, c: 0, acc: 0 };
  const seen = new Set<string>();
  for (const [m0, m1, k0, k1, n0, n1] of tiles(df, m, k, n, rows, cols)) {
    const mt = m1 - m0;
    const kt = k1 - k0;
    const nt = n1 - n0;
    out.a += mt * kt;
    out.b += kt * nt;
    out.c += mt * nt;
    const key = `${m0},${n0}`;
    if (seen.has(key)) out.acc += mt * nt;
    seen.add(key);
  }
  return out;
}
