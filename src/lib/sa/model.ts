/**
 * The cycle-accurate systolic-array model: a line-for-line port of the
 * Python reference, reference/systolic.py (read its docstring for the
 * conventions). Integers only, so every register of every PE in every
 * cycle matches the reference exactly (tests/unit/model.test.ts against
 * tests/fixtures/sa_fixtures.json), and the reference's output-stationary
 * frames match the author's RTL in Verilator (rtl/check_rtl.py).
 *
 * A frame is the state of every register after the clock edge that ends a
 * cycle. A PE is [s, h, v, acc, mac]:
 *   s    the stationary operand (weight- and input-stationary);
 *   h    the operand moving right;
 *   v    what moves down: a partial sum (WS, IS) or an operand (OS);
 *   acc  output-stationary's accumulator;
 *   mac  [x, y] when the PE multiplied x by y in this cycle.
 * An operand tag is [value, i, j] (its row and column in A or B); a
 * partial-sum tag is [value, m, n, terms].
 */

export const DATAFLOWS = ["ws", "os", "is"] as const;
export type Dataflow = (typeof DATAFLOWS)[number];

export type Matrix = number[][];
/** [value, row, col] of an element of A or B. */
export type OpTag = [number, number, number];
/** [value, m, n, terms] of a running sum for C[m][n]. */
export type SumTag = [number, number, number, number];
export type Mac = [number, number];
export type Pe = [
  OpTag | null,
  OpTag | null,
  OpTag | SumTag | null,
  SumTag | null,
  Mac | null,
];

export const COUNTERS = [
  "macs",
  "reads",
  "writes",
  "hops",
  "psumHops",
  "regWrites",
] as const;
export type Counter = (typeof COUNTERS)[number];
export type Counts = Record<Counter, number>;

export type Phase = "load" | "compute" | "drain";

export type Frame = {
  t: number;
  phase: Phase;
  pe: Pe[][];
  inL: (OpTag | null)[];
  inT: (OpTag | null)[];
  /** [m, n, value]: results written out in this cycle. */
  out: [number, number, number][];
  cnt: Counts;
};

export type Trace = {
  dataflow: Dataflow;
  rows: number;
  cols: number;
  M: number;
  K: number;
  N: number;
  cycles: number;
  C: Matrix;
  frames: Frame[];
  totals: Counts;
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export function xorshift32(x: number): number {
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x >>> 0;
}

export class Rng {
  x: number;
  constructor(seed: number) {
    this.x = seed >>> 0 || 1;
  }
  u32(): number {
    this.x = xorshift32(this.x);
    return this.x;
  }
  intIn(lo: number, hi: number): number {
    return lo + (this.u32() % (hi - lo + 1));
  }
}

export function demoMatrix(
  rows: number,
  cols: number,
  seed: number,
  lo = -4,
  hi = 5,
): Matrix {
  const rng = new Rng(seed);
  const out: Matrix = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) row.push(rng.intIn(lo, hi));
    out.push(row);
  }
  return out;
}

export function matmul(a: Matrix, b: Matrix): Matrix {
  const m = a.length;
  const k = b.length;
  const n = b[0]!.length;
  const out: Matrix = [];
  for (let i = 0; i < m; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += a[i]![p]! * b[p]![j]!;
      row.push(s);
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cycle-accurate array
// ---------------------------------------------------------------------------

function zero(): Counts {
  return {
    macs: 0,
    reads: 0,
    writes: 0,
    hops: 0,
    psumHops: 0,
    regWrites: 0,
  };
}

function emptyGrid(rows: number, cols: number): Pe[][] {
  const g: Pe[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Pe[] = [];
    for (let c = 0; c < cols; c++) row.push([null, null, null, null, null]);
    g.push(row);
  }
  return g;
}

function nulls<T>(n: number): (T | null)[] {
  return new Array<T | null>(n).fill(null);
}

function checkFit(
  df: Dataflow,
  m: number,
  k: number,
  n: number,
  rows: number,
  cols: number,
): void {
  const need =
    df === "ws" ? [k, n] : df === "os" ? [m, n] : ([k, m] as number[]);
  if (need[0]! > rows || need[1]! > cols)
    throw new Error(
      `${df}: a ${need[0]} x ${need[1]} block does not fit a ${rows} x ${cols} array (tile it)`,
    );
}

export function simulate(
  df: Dataflow,
  a: Matrix,
  b: Matrix,
  rows: number,
  cols: number,
): Trace {
  const m = a.length;
  const k = b.length;
  const n = b[0]!.length;
  if (a[0]!.length !== k) throw new Error("inner dimensions differ");
  checkFit(df, m, k, n, rows, cols);
  const frames =
    df === "os" ? runOs(a, b, rows, cols) : runStationary(df, a, b, rows, cols);
  const result: Matrix = [];
  for (let i = 0; i < m; i++) result.push(new Array<number>(n).fill(0));
  for (const f of frames)
    for (const [mm, nn, val] of f.out) result[mm]![nn] = val;
  return {
    dataflow: df,
    rows,
    cols,
    M: m,
    K: k,
    N: n,
    cycles: frames.length,
    C: result,
    frames,
    totals: { ...frames[frames.length - 1]!.cnt },
  };
}

function runStationary(
  df: "ws" | "is",
  a: Matrix,
  b: Matrix,
  rows: number,
  cols: number,
): Frame[] {
  const m = a.length;
  const k = b.length;
  const n = b[0]!.length;
  const ws = df === "ws";
  const pLen = ws ? m : n;
  const qLen = ws ? n : m;
  const sTag = (p: number, kk: number): OpTag =>
    ws ? [a[p]![kk]!, p, kk] : [b[kk]![p]!, kk, p];
  const wTag = (kk: number, q: number): OpTag =>
    ws ? [b[kk]![q]!, kk, q] : [a[q]![kk]!, q, kk];
  const cIdx = (p: number, q: number): [number, number] =>
    ws ? [p, q] : [q, p];

  const cnt = zero();
  const frames: Frame[] = [];
  let prev = emptyGrid(rows, cols);
  let t = 0;
  for (let l = 0; l < k; l++) {
    const grid = emptyGrid(rows, cols);
    const inT = nulls<OpTag>(cols);
    for (let q = 0; q < qLen; q++) {
      inT[q] = wTag(k - 1 - l, q);
      cnt.reads += 1;
    }
    for (let kk = 0; kk < k; kk++)
      for (let q = 0; q < qLen; q++) {
        const sIn = kk === 0 ? inT[q]! : prev[kk - 1]![q]![0];
        grid[kk]![q]![0] = sIn;
        if (sIn !== null) {
          cnt.regWrites += 1;
          if (kk > 0) cnt.hops += 1;
        }
      }
    frames.push({
      t,
      phase: "load",
      pe: grid,
      inL: nulls<OpTag>(rows),
      inT,
      out: [],
      cnt: { ...cnt },
    });
    prev = grid;
    t += 1;
  }
  const total = pLen + k + qLen - 2;
  for (let tc = 0; tc < total; tc++) {
    const grid = emptyGrid(rows, cols);
    const inL = nulls<OpTag>(rows);
    for (let kk = 0; kk < k; kk++) {
      const p = tc - kk;
      if (p >= 0 && p < pLen) {
        inL[kk] = sTag(p, kk);
        cnt.reads += 1;
      }
    }
    const out: [number, number, number][] = [];
    for (let kk = 0; kk < k; kk++)
      for (let q = 0; q < qLen; q++) {
        const cell = grid[kk]![q]!;
        cell[0] = prev[kk]![q]![0];
        let hIn: OpTag | null;
        if (q === 0) hIn = inL[kk]!;
        else {
          hIn = prev[kk]![q - 1]![1];
          if (hIn !== null) cnt.hops += 1;
        }
        cell[1] = hIn;
        if (hIn === null) continue;
        cnt.regWrites += 1;
        const p = ws ? hIn[1] : hIn[2];
        const [mi, ni] = cIdx(p, q);
        let pVal: number;
        let terms: number;
        if (kk === 0) {
          pVal = 0;
          terms = 0;
        } else {
          const above = prev[kk - 1]![q]![2] as SumTag | null;
          /* c8 ignore next 2 */
          if (
            above === null ||
            above[1] !== mi ||
            above[2] !== ni ||
            above[3] !== kk
          )
            throw new Error("partial sum out of step");
          pVal = above[0];
          terms = above[3];
          cnt.hops += 1;
          cnt.psumHops += 1;
        }
        const wVal = cell[0]![0];
        cell[4] = [hIn[0], wVal];
        cnt.macs += 1;
        cell[2] = [pVal + hIn[0] * wVal, mi, ni, terms + 1];
        cnt.regWrites += 1;
        if (kk === k - 1) {
          out.push([mi, ni, cell[2][0]]);
          cnt.writes += 1;
        }
      }
    frames.push({
      t,
      phase: "compute",
      pe: grid,
      inL,
      inT: nulls<OpTag>(cols),
      out,
      cnt: { ...cnt },
    });
    prev = grid;
    t += 1;
  }
  return frames;
}

function runOs(a: Matrix, b: Matrix, rows: number, cols: number): Frame[] {
  const m = a.length;
  const k = b.length;
  const n = b[0]!.length;
  const cnt = zero();
  const frames: Frame[] = [];
  let prev = emptyGrid(rows, cols);
  for (let mm = 0; mm < m; mm++)
    for (let nn = 0; nn < n; nn++) prev[mm]![nn]![3] = [0, mm, nn, 0];
  let t = 0;
  const total = k + m + n - 2;
  for (let tc = 0; tc < total; tc++) {
    const grid = emptyGrid(rows, cols);
    const inL = nulls<OpTag>(rows);
    const inT = nulls<OpTag>(cols);
    for (let mm = 0; mm < m; mm++) {
      const kk = tc - mm;
      if (kk >= 0 && kk < k) {
        inL[mm] = [a[mm]![kk]!, mm, kk];
        cnt.reads += 1;
      }
    }
    for (let nn = 0; nn < n; nn++) {
      const kk = tc - nn;
      if (kk >= 0 && kk < k) {
        inT[nn] = [b[kk]![nn]!, kk, nn];
        cnt.reads += 1;
      }
    }
    for (let mm = 0; mm < m; mm++)
      for (let nn = 0; nn < n; nn++) {
        const cell = grid[mm]![nn]!;
        const hIn = nn === 0 ? inL[mm]! : prev[mm]![nn - 1]![1];
        const vIn =
          mm === 0 ? inT[nn]! : (prev[mm - 1]![nn]![2] as OpTag | null);
        for (const [src, edge] of [
          [hIn, nn === 0],
          [vIn, mm === 0],
        ] as const) {
          if (src !== null) {
            cnt.regWrites += 1;
            if (!edge) cnt.hops += 1;
          }
        }
        cell[1] = hIn;
        cell[2] = vIn;
        let acc = prev[mm]![nn]![3]!;
        if (hIn !== null && vIn !== null) {
          /* c8 ignore next */
          if (hIn[2] !== vIn[1]) throw new Error("operands out of step");
          cell[4] = [hIn[0], vIn[0]];
          cnt.macs += 1;
          cnt.regWrites += 1;
          acc = [acc[0] + hIn[0] * vIn[0], mm, nn, acc[3] + 1];
        }
        cell[3] = acc;
      }
    frames.push({
      t,
      phase: "compute",
      pe: grid,
      inL,
      inT,
      out: [],
      cnt: { ...cnt },
    });
    prev = grid;
    t += 1;
  }
  for (let d = 0; d < m; d++) {
    const grid = emptyGrid(rows, cols);
    const out: [number, number, number][] = [];
    for (let nn = 0; nn < n; nn++) {
      const leaving = prev[m - 1]![nn]![3];
      if (leaving !== null) {
        out.push([leaving[1], leaving[2], leaving[0]]);
        cnt.writes += 1;
      }
    }
    for (let mm = 0; mm < m; mm++)
      for (let nn = 0; nn < n; nn++) {
        const moved = mm > 0 ? prev[mm - 1]![nn]![3] : null;
        grid[mm]![nn]![3] = moved;
        if (moved !== null) {
          cnt.hops += 1;
          cnt.psumHops += 1;
          cnt.regWrites += 1;
        }
      }
    frames.push({
      t,
      phase: "drain",
      pe: grid,
      inL: nulls<OpTag>(rows),
      inT: nulls<OpTag>(cols),
      out,
      cnt: { ...cnt },
    });
    prev = grid;
    t += 1;
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Closed forms
// ---------------------------------------------------------------------------

export function cycles(df: Dataflow, m: number, k: number, n: number): number {
  if (df === "ws") return k + (m + k + n - 2);
  if (df === "os") return k + m + n - 2 + m;
  return k + (n + k + m - 2);
}

export function traffic(df: Dataflow, m: number, k: number, n: number): Counts {
  if (df === "ws")
    return {
      macs: m * k * n,
      reads: k * n + m * k,
      writes: m * n,
      hops: (n * k * (k - 1)) / 2 + m * k * (n - 1) + m * n * (k - 1),
      psumHops: m * n * (k - 1),
      regWrites: (n * k * (k + 1)) / 2 + 2 * m * k * n,
    };
  if (df === "os")
    return {
      macs: m * k * n,
      reads: m * k + k * n,
      writes: m * n,
      hops: m * k * (n - 1) + k * n * (m - 1) + (n * m * (m - 1)) / 2,
      psumHops: (n * m * (m - 1)) / 2,
      regWrites: 3 * m * k * n + (n * m * (m - 1)) / 2,
    };
  return {
    macs: m * k * n,
    reads: m * k + k * n,
    writes: m * n,
    hops: (m * k * (k - 1)) / 2 + n * k * (m - 1) + m * n * (k - 1),
    psumHops: m * n * (k - 1),
    regWrites: (m * k * (k + 1)) / 2 + 2 * m * k * n,
  };
}

export function utilisation(
  macs: number,
  rows: number,
  cols: number,
  cyc: number,
): number {
  return macs / (rows * cols * cyc);
}

export function activePerCycle(trace: Trace): number[] {
  return trace.frames.map((f) => {
    let c = 0;
    for (const row of f.pe)
      for (const cell of row) if (cell[4] !== null) c += 1;
    return c;
  });
}

export function wavefrontSize(
  m: number,
  k: number,
  n: number,
  t: number,
): number {
  let c = 0;
  for (let kk = 0; kk < k; kk++)
    for (let q = 0; q < n; q++) {
      const p = t - kk - q;
      if (p >= 0 && p < m) c += 1;
    }
  return c;
}

// ---------------------------------------------------------------------------
// Tiling
// ---------------------------------------------------------------------------

export type Tile = [number, number, number, number, number, number];

export function tiles(
  df: Dataflow,
  m: number,
  k: number,
  n: number,
  rows: number,
  cols: number,
): Tile[] {
  const out: Tile[] = [];
  if (df === "ws") {
    for (let n0 = 0; n0 < n; n0 += cols)
      for (let k0 = 0; k0 < k; k0 += rows)
        out.push([
          0,
          m,
          k0,
          Math.min(k, k0 + rows),
          n0,
          Math.min(n, n0 + cols),
        ]);
  } else if (df === "os") {
    for (let m0 = 0; m0 < m; m0 += rows)
      for (let n0 = 0; n0 < n; n0 += cols)
        out.push([
          m0,
          Math.min(m, m0 + rows),
          0,
          k,
          n0,
          Math.min(n, n0 + cols),
        ]);
  } else {
    for (let m0 = 0; m0 < m; m0 += cols)
      for (let k0 = 0; k0 < k; k0 += rows)
        out.push([
          m0,
          Math.min(m, m0 + cols),
          k0,
          Math.min(k, k0 + rows),
          0,
          n,
        ]);
  }
  return out;
}

export function tiledCycles(
  df: Dataflow,
  m: number,
  k: number,
  n: number,
  rows: number,
  cols: number,
): number {
  let c = 0;
  for (const [m0, m1, k0, k1, n0, n1] of tiles(df, m, k, n, rows, cols))
    c += cycles(df, m1 - m0, k1 - k0, n1 - n0);
  return c;
}

export type TiledResult = {
  C: Matrix;
  cycles: number;
  totals: Counts & { accReads: number };
  tiles: number;
};

export function simulateTiled(
  df: Dataflow,
  a: Matrix,
  b: Matrix,
  rows: number,
  cols: number,
): TiledResult {
  const m = a.length;
  const k = b.length;
  const n = b[0]!.length;
  const result: Matrix = [];
  const seen: boolean[][] = [];
  for (let i = 0; i < m; i++) {
    result.push(new Array<number>(n).fill(0));
    seen.push(new Array<boolean>(n).fill(false));
  }
  const totals = { ...zero(), accReads: 0 };
  let cyc = 0;
  const ts = tiles(df, m, k, n, rows, cols);
  for (const [m0, m1, k0, k1, n0, n1] of ts) {
    const subA = a.slice(m0, m1).map((r) => r.slice(k0, k1));
    const subB = b.slice(k0, k1).map((r) => r.slice(n0, n1));
    const tr = simulate(df, subA, subB, rows, cols);
    cyc += tr.cycles;
    for (const c of COUNTERS) totals[c] += tr.totals[c];
    for (let i = 0; i < m1 - m0; i++)
      for (let j = 0; j < n1 - n0; j++) {
        if (seen[m0 + i]![n0 + j]) totals.accReads += 1;
        result[m0 + i]![n0 + j]! += tr.C[i]![j]!;
        seen[m0 + i]![n0 + j] = true;
      }
  }
  return { C: result, cycles: cyc, totals, tiles: ts.length };
}

// ---------------------------------------------------------------------------
// Higher-level views
// ---------------------------------------------------------------------------

export type ReuseStep = {
  n: number;
  peak: number;
  naive2: number;
  systolic2: number;
  wordsPerCycle: number;
  macsPerWord2: number;
};

export function reuseSteps(beta: number, nMax: number): ReuseStep[] {
  const out: ReuseStep[] = [];
  for (let n = 1; n <= nMax; n++) {
    const peak = n * n;
    out.push({
      n,
      peak,
      naive2: Math.min(2 * peak, beta),
      systolic2: Math.min(2 * peak, beta * n),
      wordsPerCycle: 2 * n,
      macsPerWord2: n,
    });
  }
  return out;
}

export type UtilStep = {
  x: number;
  cycles: number;
  macs: number;
  util: number;
};

export function utilSteps(
  df: Dataflow,
  rows: number,
  cols: number,
  k: number,
  n: number,
  mMax: number,
): UtilStep[] {
  const out: UtilStep[] = [];
  for (let x = 1; x <= mMax; x++) {
    const [mm, kk, nn] =
      df === "ws" ? [x, k, n] : df === "os" ? [k, x, n] : [n, k, x];
    const cyc = cycles(df, mm, kk, nn);
    const macs = mm * kk * nn;
    out.push({
      x,
      cycles: cyc,
      macs,
      util: utilisation(macs, rows, cols, cyc),
    });
  }
  return out;
}

export type ShapeStep = {
  n: number;
  tiles: number;
  cycles: number;
  util: number;
};

export function shapeSteps(
  df: Dataflow,
  rows: number,
  cols: number,
  m: number,
  k: number,
  nMax: number,
): ShapeStep[] {
  const out: ShapeStep[] = [];
  for (let n = 1; n <= nMax; n++) {
    const cyc = tiledCycles(df, m, k, n, rows, cols);
    out.push({
      n,
      tiles: tiles(df, m, k, n, rows, cols).length,
      cycles: cyc,
      util: utilisation(m * k * n, rows, cols, cyc),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row-stationary (Eyeriss), a reference dataflow
// ---------------------------------------------------------------------------

export function conv2d(x: Matrix, f: Matrix): Matrix {
  const h = x.length;
  const w = x[0]!.length;
  const r = f.length;
  const s = f[0]!.length;
  const out: Matrix = [];
  for (let i = 0; i < h - r + 1; i++) {
    const row: number[] = [];
    for (let j = 0; j < w - s + 1; j++) {
      let acc = 0;
      for (let di = 0; di < r; di++)
        for (let dj = 0; dj < s; dj++) acc += x[i + di]![j + dj]! * f[di]![dj]!;
      row.push(acc);
    }
    out.push(row);
  }
  return out;
}

/** [col, tap, mac, acc, v]; v is [sum, col] when the PE passes a sum down. */
export type RsPe = [
  number | null,
  number | null,
  Mac | null,
  number | null,
  [number, number] | null,
];
export type RsFrame = {
  t: number;
  pe: RsPe[][];
  out: [number, number, number][];
  cnt: { macs: number; psumHops: number; writes: number };
};
export type RsTrace = {
  R: number;
  S: number;
  E: number;
  F: number;
  cycles: number;
  O: Matrix;
  frames: RsFrame[];
};

export function simulateRs(x: Matrix, f: Matrix): RsTrace {
  const h = x.length;
  const w = x[0]!.length;
  const r = f.length;
  const s = f[0]!.length;
  const e = h - r + 1;
  const fo = w - s + 1;
  const cnt = { macs: 0, psumHops: 0, writes: 0 };
  const frames: RsFrame[] = [];
  const grid2 = <T>(v: T): T[][] =>
    Array.from({ length: r }, () => new Array<T>(e).fill(v));
  let prevV = grid2<[number, number] | null>(null);
  const acc = grid2<number>(0);
  const total = r - 1 + fo * s;
  const outMat: Matrix = Array.from({ length: e }, () =>
    new Array<number>(fo).fill(0),
  );
  for (let t = 0; t < total; t++) {
    const grid: RsPe[][] = [];
    const vNow = grid2<[number, number] | null>(null);
    const out: [number, number, number][] = [];
    for (let i = 0; i < r; i++) {
      const row: RsPe[] = [];
      for (let j = 0; j < e; j++) {
        const u = t - i;
        if (u < 0 || u >= fo * s) {
          row.push([null, null, null, null, null]);
          continue;
        }
        const col = Math.floor(u / s);
        const tap = u % s;
        const px = x[i + j]![col + tap]!;
        const pw = f[i]![tap]!;
        acc[i]![j] = (tap === 0 ? 0 : acc[i]![j]!) + px * pw;
        cnt.macs += 1;
        let v: [number, number] | null = null;
        if (tap === s - 1) {
          const above = i > 0 ? prevV[i - 1]![j]! : null;
          if (i > 0) {
            /* c8 ignore next */
            if (above === null || above[1] !== col)
              throw new Error("row partial sum out of step");
            cnt.psumHops += 1;
          }
          v = [acc[i]![j]! + (above !== null ? above[0] : 0), col];
          vNow[i]![j] = v;
          if (i === r - 1) {
            out.push([j, col, v[0]]);
            outMat[j]![col] = v[0];
            cnt.writes += 1;
          }
        }
        row.push([col, tap, [px, pw], acc[i]![j]!, v]);
      }
      grid.push(row);
    }
    frames.push({ t, pe: grid, out, cnt: { ...cnt } });
    prevV = vNow;
  }
  return { R: r, S: s, E: e, F: fo, cycles: total, O: outMat, frames };
}

// ---------------------------------------------------------------------------
// The demonstrations the chapters animate (reference/systolic.py DEMO)
// ---------------------------------------------------------------------------

export const DEMO = {
  seedA: 1,
  seedB: 2,
  hero: { M: 8, K: 4, N: 4 },
  beta: 32,
  reuseMax: 16,
  ws: { M: 5, K: 4, N: 4 },
  cmp: { M: 3, K: 3, N: 3 },
  wave: { M: 10, K: 4, N: 4 },
  array: 8,
  utilMax: 64,
  shape: { M: 32, K: 8, nMax: 40 },
  range: { M: [1, 8], K: [2, 4], N: [2, 4] },
  rs: { H: 6, W: 7, R: 3, S: 3, seedX: 5, seedF: 6 },
} as const;

export function demoPair(m: number, k: number, n: number): [Matrix, Matrix] {
  return [demoMatrix(m, k, DEMO.seedA), demoMatrix(k, n, DEMO.seedB)];
}
