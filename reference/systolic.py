"""
Systolic arrays: the Python reference.

A cycle-accurate model of a parameterised R x C systolic array computing
C = A B (A is M x K, B is K x N) in three dataflows, plus Eyeriss's
row-stationary dataflow for a 2-D convolution as a reference. Plain Python,
integers only, so the TypeScript port (``src/lib/sa/model.ts``) reproduces
every register of every PE in every cycle exactly. ``scripts/make_fixtures.py``
writes the fixtures that port must match, ``tests/python`` checks this file
against a direct matrix multiply and its own closed forms, and
``rtl/check_rtl.py`` runs a SystemVerilog output-stationary array in a
simulator and compares its accumulators with this model's, cycle by cycle.

The model is synchronous: a frame is the state of every register after the
clock edge that ends a cycle, computed only from the previous frame and the
values entering at the array's edges in that cycle (exactly how flip-flops
behave). Each PE has up to four registers:

  ``s``    the stationary operand (a weight in weight-stationary, an input in
           input-stationary), loaded before the computation starts;
  ``h``    the operand moving right, one PE per cycle;
  ``v``    the value moving down, one PE per cycle: a partial sum in
           weight- and input-stationary, an operand in output-stationary;
  ``acc``  output-stationary's accumulator, which never moves until the
           results drain out.

Each register holds a tag or ``None`` (a bubble). An operand's tag is
``[value, i, j]``: the element's value and its row and column in A or B. A
partial sum's tag is ``[value, m, n, terms]``: the running sum for C[m][n]
and how many of its K products it holds.

Dataflows (the names follow Chen, Emer and Sze's taxonomy, ISCA 2016):

  ``ws``  weight-stationary: B is loaded into a K x N block of PEs (K cycles,
          shifting down the columns); row m of A enters row k of the array
          at compute cycle m + k (the skew), moves right, and the partial
          sums move down, so C[m][n] leaves the bottom of column n at compute
          cycle m + (K - 1) + n. This is the TPU's matrix unit (Jouppi et al.,
          ISCA 2017).
  ``os``  output-stationary: PE(m, n) accumulates C[m][n]. A[m][k] enters
          row m at cycle k + m and B[k][n] enters column n at cycle k + n,
          so both meet in PE(m, n) at cycle k + m + n. The results then
          drain out of the bottom, one row per cycle (M cycles).
  ``is``  input-stationary: A is held (PE(k, m) holds A[m][k]); the columns
          of B stream in from the left and the partial sums move down. It is
          weight-stationary on the transposed problem, C^T = B^T A^T.
  ``rs``  row-stationary (``simulate_rs``), for a 2-D convolution: PE(i, j)
          keeps filter row i, convolves it with input row i + j, and the
          column of PEs sums the rows into output row j (Chen et al., 2016).

Everything here is integer arithmetic, so there is no rounding to agree on.
"""
from __future__ import annotations

from typing import Any

SOURCES: dict[str, dict[str, str]] = {
    "kung1982": {
        "title": "H. T. Kung, Why systolic architectures?, IEEE Computer 15(1), 1982",
        "url": "https://doi.org/10.1109/MC.1982.1653825",
    },
    "jouppi2017": {
        "title": "Jouppi et al., In-Datacenter Performance Analysis of a Tensor Processing Unit, ISCA 2017 (arXiv 1704.04760)",
        "url": "https://arxiv.org/abs/1704.04760",
    },
    "eyeriss": {
        "title": "Chen, Emer and Sze, Eyeriss: A Spatial Architecture for Energy-Efficient Dataflow for Convolutional Neural Networks, ISCA 2016",
        "url": "https://doi.org/10.1109/ISCA.2016.40",
    },
}

DATAFLOWS = ("ws", "os", "is")

# ---------------------------------------------------------------------------
# Data: seeded integer matrices
# ---------------------------------------------------------------------------


def xorshift32(x: int) -> int:
    x ^= (x << 13) & 0xFFFFFFFF
    x ^= x >> 17
    x ^= (x << 5) & 0xFFFFFFFF
    return x & 0xFFFFFFFF


class Rng:
    """xorshift32 (Marsaglia, 2003)."""

    def __init__(self, seed: int) -> None:
        self.x = (seed & 0xFFFFFFFF) or 1

    def u32(self) -> int:
        self.x = xorshift32(self.x)
        return self.x

    def int_in(self, lo: int, hi: int) -> int:
        """An integer in [lo, hi] (modulo bias is irrelevant here)."""
        return lo + self.u32() % (hi - lo + 1)


def demo_matrix(rows: int, cols: int, seed: int, lo: int = -4, hi: int = 5) -> list[list[int]]:
    """A rows x cols matrix of small integers, the same in Python and TS."""
    rng = Rng(seed)
    return [[rng.int_in(lo, hi) for _ in range(cols)] for _ in range(rows)]


def matmul(a: list[list[int]], b: list[list[int]]) -> list[list[int]]:
    """The direct triple loop, the model's ground truth."""
    m, k, n = len(a), len(b), len(b[0])
    out = []
    for i in range(m):
        row = []
        for j in range(n):
            s = 0
            for p in range(k):
                s += a[i][p] * b[p][j]
            row.append(s)
        out.append(row)
    return out


def transpose(a: list[list[int]]) -> list[list[int]]:
    return [[a[i][j] for i in range(len(a))] for j in range(len(a[0]))]


# ---------------------------------------------------------------------------
# The cycle-accurate array
# ---------------------------------------------------------------------------

COUNTERS = ("macs", "reads", "writes", "hops", "psumHops", "regWrites")


def _empty_grid(rows: int, cols: int) -> list[list[list[Any]]]:
    # a PE: [s, h, v, acc, mac]; mac is [x, y] when it multiplied this cycle
    return [[[None, None, None, None, None] for _ in range(cols)] for _ in range(rows)]


def _frame(t: int, phase: str, pe, in_left, in_top, out, cnt) -> dict[str, Any]:
    return {
        "t": t,
        "phase": phase,
        "pe": pe,
        "inL": in_left,
        "inT": in_top,
        "out": out,
        "cnt": dict(cnt),
    }


def _check_fit(dataflow: str, m: int, k: int, n: int, rows: int, cols: int) -> None:
    need = {"ws": (k, n), "os": (m, n), "is": (k, m)}[dataflow]
    if need[0] > rows or need[1] > cols:
        raise ValueError(
            f"{dataflow}: a {need[0]} x {need[1]} block does not fit a {rows} x {cols} array (tile it)"
        )


def simulate(
    dataflow: str,
    a: list[list[int]],
    b: list[list[int]],
    rows: int,
    cols: int,
) -> dict[str, Any]:
    """Run C = A B on a rows x cols array, one frame per cycle.

    The block of the array the problem needs must fit (weight-stationary:
    K x N; output-stationary: M x N; input-stationary: K x M); the rest of
    the PEs stay idle (all-``None``), which is what utilisation counts.
    ``simulate_tiled`` splits a bigger problem.
    """
    if dataflow not in DATAFLOWS:
        raise ValueError(f"unknown dataflow {dataflow!r}")
    m, k, n = len(a), len(b), len(b[0])
    if len(a[0]) != k:
        raise ValueError("inner dimensions differ")
    _check_fit(dataflow, m, k, n, rows, cols)
    if dataflow == "os":
        frames = _run_os(a, b, rows, cols)
    else:
        frames = _run_stationary(dataflow, a, b, rows, cols)
    result = [[0] * n for _ in range(m)]
    for f in frames:
        for mm, nn, val in f["out"]:
            result[mm][nn] = val
    return {
        "dataflow": dataflow,
        "rows": rows,
        "cols": cols,
        "M": m,
        "K": k,
        "N": n,
        "cycles": len(frames),
        "C": result,
        "frames": frames,
        "totals": dict(frames[-1]["cnt"]),
    }


def _run_stationary(dataflow: str, a, b, rows: int, cols: int) -> list[dict[str, Any]]:
    """Weight-stationary (B held) or input-stationary (A held).

    Both are one machine: a K x Q block holds W[k][q] and a stream of P
    vectors S[p][0..K-1] enters from the left, row k delayed by k cycles;
    the partial sum for (p, q) moves down column q and leaves the bottom
    complete. Weight-stationary: S = A (P = M), W = B (Q = N). Input-
    stationary: S = B^T (P = N), W = A^T (Q = M), and output (p, q) is
    C[q][p]. Tags always name the element in A, B and C.
    """
    m, k, n = len(a), len(b), len(b[0])
    if dataflow == "ws":
        p_len, q_len = m, n

        def s_tag(p: int, kk: int) -> list[int]:
            return [a[p][kk], p, kk]

        def w_tag(kk: int, q: int) -> list[int]:
            return [b[kk][q], kk, q]

        def c_idx(p: int, q: int) -> tuple[int, int]:
            return p, q

    else:
        p_len, q_len = n, m

        def s_tag(p: int, kk: int) -> list[int]:
            return [b[kk][p], kk, p]

        def w_tag(kk: int, q: int) -> list[int]:
            return [a[q][kk], q, kk]

        def c_idx(p: int, q: int) -> tuple[int, int]:
            return q, p

    cnt = {c: 0 for c in COUNTERS}
    frames: list[dict[str, Any]] = []
    prev = _empty_grid(rows, cols)
    t = 0
    # Load: the stationary block shifts down the columns, one row per cycle;
    # row K - 1 - l enters at the top in load cycle l, so after K cycles
    # PE(kk, q) holds W[kk][q].
    for l in range(k):
        grid = _empty_grid(rows, cols)
        in_top: list[Any] = [None] * cols
        for q in range(q_len):
            in_top[q] = w_tag(k - 1 - l, q)
            cnt["reads"] += 1
        for kk in range(k):
            for q in range(q_len):
                s_in = in_top[q] if kk == 0 else prev[kk - 1][q][0]
                grid[kk][q][0] = s_in
                if s_in is not None:
                    cnt["regWrites"] += 1
                    if kk > 0:
                        cnt["hops"] += 1
        frames.append(_frame(t, "load", grid, [None] * rows, in_top, [], cnt))
        prev = grid
        t += 1
    # Compute: vector p enters row kk at compute cycle p + kk.
    total = p_len + k + q_len - 2
    for tc in range(total):
        grid = _empty_grid(rows, cols)
        in_left: list[Any] = [None] * rows
        for kk in range(k):
            p = tc - kk
            if 0 <= p < p_len:
                in_left[kk] = s_tag(p, kk)
                cnt["reads"] += 1
        out: list[list[int]] = []
        for kk in range(k):
            for q in range(q_len):
                cell = grid[kk][q]
                cell[0] = prev[kk][q][0]  # the stationary value stays
                if q == 0:
                    h_in = in_left[kk]
                else:
                    h_in = prev[kk][q - 1][1]
                    if h_in is not None:
                        cnt["hops"] += 1
                cell[1] = h_in
                if h_in is None:
                    continue
                cnt["regWrites"] += 1
                p = h_in[1] if dataflow == "ws" else h_in[2]
                mi, ni = c_idx(p, q)
                if kk == 0:
                    p_val, terms = 0, 0
                else:
                    above = prev[kk - 1][q][2]
                    if above is None or above[1] != mi or above[2] != ni or above[3] != kk:
                        raise AssertionError("partial sum out of step")  # pragma: no cover
                    p_val, terms = above[0], above[3]
                    cnt["hops"] += 1
                    cnt["psumHops"] += 1
                w_val = cell[0][0]
                cell[4] = [h_in[0], w_val]
                cnt["macs"] += 1
                cell[2] = [p_val + h_in[0] * w_val, mi, ni, terms + 1]
                cnt["regWrites"] += 1
                if kk == k - 1:
                    out.append([mi, ni, cell[2][0]])
                    cnt["writes"] += 1
        frames.append(_frame(t, "compute", grid, in_left, [None] * cols, out, cnt))
        prev = grid
        t += 1
    return frames


def _run_os(a, b, rows: int, cols: int) -> list[dict[str, Any]]:
    """Output-stationary: A from the left, B from the top, C stays put."""
    m, k, n = len(a), len(b), len(b[0])
    cnt = {c: 0 for c in COUNTERS}
    frames: list[dict[str, Any]] = []
    prev = _empty_grid(rows, cols)
    for mm in range(m):
        for nn in range(n):
            prev[mm][nn][3] = [0, mm, nn, 0]  # cleared accumulators
    t = 0
    total = k + m + n - 2
    for tc in range(total):
        grid = _empty_grid(rows, cols)
        in_left: list[Any] = [None] * rows
        in_top: list[Any] = [None] * cols
        for mm in range(m):
            kk = tc - mm
            if 0 <= kk < k:
                in_left[mm] = [a[mm][kk], mm, kk]
                cnt["reads"] += 1
        for nn in range(n):
            kk = tc - nn
            if 0 <= kk < k:
                in_top[nn] = [b[kk][nn], kk, nn]
                cnt["reads"] += 1
        for mm in range(m):
            for nn in range(n):
                cell = grid[mm][nn]
                h_in = in_left[mm] if nn == 0 else prev[mm][nn - 1][1]
                v_in = in_top[nn] if mm == 0 else prev[mm - 1][nn][2]
                for src, edge in ((h_in, nn == 0), (v_in, mm == 0)):
                    if src is not None:
                        cnt["regWrites"] += 1
                        if not edge:
                            cnt["hops"] += 1
                cell[1] = h_in
                cell[2] = v_in
                acc = prev[mm][nn][3]
                if h_in is not None and v_in is not None:
                    if h_in[2] != v_in[1]:
                        raise AssertionError("operands out of step")  # pragma: no cover
                    cell[4] = [h_in[0], v_in[0]]
                    cnt["macs"] += 1
                    cnt["regWrites"] += 1
                    acc = [acc[0] + h_in[0] * v_in[0], mm, nn, acc[3] + 1]
                cell[3] = acc
        frames.append(_frame(t, "compute", grid, in_left, in_top, [], cnt))
        prev = grid
        t += 1
    # Drain: the accumulators shift down one row per cycle; the bottom row
    # of the block is written out each cycle (M cycles).
    for d in range(m):
        grid = _empty_grid(rows, cols)
        out: list[list[int]] = []
        for nn in range(n):
            leaving = prev[m - 1][nn][3]
            if leaving is not None:
                out.append([leaving[1], leaving[2], leaving[0]])
                cnt["writes"] += 1
        for mm in range(m):
            for nn in range(n):
                moved = prev[mm - 1][nn][3] if mm > 0 else None
                grid[mm][nn][3] = moved
                if moved is not None:
                    cnt["hops"] += 1
                    cnt["psumHops"] += 1
                    cnt["regWrites"] += 1
        frames.append(_frame(t, "drain", grid, [None] * rows, [None] * cols, out, cnt))
        prev = grid
        t += 1
    return frames


# ---------------------------------------------------------------------------
# Closed forms (each checked against the simulator in tests/python)
# ---------------------------------------------------------------------------


def cycles(dataflow: str, m: int, k: int, n: int) -> int:
    """Cycles for one problem that fits the array (load + compute + drain)."""
    if dataflow == "ws":
        return k + (m + k + n - 2)
    if dataflow == "os":
        return (k + m + n - 2) + m
    if dataflow == "is":
        return k + (n + k + m - 2)
    raise ValueError(dataflow)


def traffic(dataflow: str, m: int, k: int, n: int) -> dict[str, int]:
    """Total counters for one problem that fits the array."""
    if dataflow == "ws":
        return {
            "macs": m * k * n,
            "reads": k * n + m * k,
            "writes": m * n,
            "hops": n * k * (k - 1) // 2 + m * k * (n - 1) + m * n * (k - 1),
            "psumHops": m * n * (k - 1),
            "regWrites": n * k * (k + 1) // 2 + 2 * m * k * n,
        }
    if dataflow == "os":
        return {
            "macs": m * k * n,
            "reads": m * k + k * n,
            "writes": m * n,
            "hops": m * k * (n - 1) + k * n * (m - 1) + n * m * (m - 1) // 2,
            "psumHops": n * m * (m - 1) // 2,
            "regWrites": 3 * m * k * n + n * m * (m - 1) // 2,
        }
    if dataflow == "is":
        return {
            "macs": m * k * n,
            "reads": m * k + k * n,
            "writes": m * n,
            "hops": m * k * (k - 1) // 2 + n * k * (m - 1) + m * n * (k - 1),
            "psumHops": m * n * (k - 1),
            "regWrites": m * k * (k + 1) // 2 + 2 * m * k * n,
        }
    raise ValueError(dataflow)


def utilisation(macs: int, rows: int, cols: int, cyc: int) -> float:
    """Useful MACs over the MACs the whole array could have done."""
    return macs / (rows * cols * cyc)


def active_per_cycle(trace: dict[str, Any]) -> list[int]:
    """How many PEs multiplied in each cycle (the wavefront's size)."""
    out = []
    for f in trace["frames"]:
        c = 0
        for row in f["pe"]:
            for cell in row:
                if cell[4] is not None:
                    c += 1
        out.append(c)
    return out


def wavefront_size(m: int, k: int, n: int, t: int) -> int:
    """Weight-stationary compute cycle t: PEs (kk, q) with t - kk - q in [0, M)."""
    c = 0
    for kk in range(k):
        for q in range(n):
            if 0 <= t - kk - q < m:
                c += 1
    return c


# ---------------------------------------------------------------------------
# Tiling a problem that does not fit (each tile run on its own, in order)
# ---------------------------------------------------------------------------


def _ceil_div(x: int, y: int) -> int:
    return -(-x // y)


def tiles(dataflow: str, m: int, k: int, n: int, rows: int, cols: int) -> list[tuple[int, int, int, int, int, int]]:
    """The tiles, as (m0, m1, k0, k1, n0, n1) ranges, in the order they run."""
    out = []
    if dataflow == "ws":
        for n0 in range(0, n, cols):
            for k0 in range(0, k, rows):
                out.append((0, m, k0, min(k, k0 + rows), n0, min(n, n0 + cols)))
    elif dataflow == "os":
        for m0 in range(0, m, rows):
            for n0 in range(0, n, cols):
                out.append((m0, min(m, m0 + rows), 0, k, n0, min(n, n0 + cols)))
    elif dataflow == "is":
        for m0 in range(0, m, cols):
            for k0 in range(0, k, rows):
                out.append((m0, min(m, m0 + cols), k0, min(k, k0 + rows), 0, n))
    else:
        raise ValueError(dataflow)
    return out


def tiled_cycles(dataflow: str, m: int, k: int, n: int, rows: int, cols: int) -> int:
    """Cycles with the tiles run one after another (no overlap)."""
    c = 0
    for m0, m1, k0, k1, n0, n1 in tiles(dataflow, m, k, n, rows, cols):
        c += cycles(dataflow, m1 - m0, k1 - k0, n1 - n0)
    return c


def simulate_tiled(dataflow: str, a, b, rows: int, cols: int) -> dict[str, Any]:
    """Run every tile through ``simulate`` and add the partial results.

    A tile that covers only part of K produces partial sums, which the
    output buffer adds up (each such add reads and writes the buffer;
    counted as ``accReads``).
    """
    m, k, n = len(a), len(b), len(b[0])
    result = [[0] * n for _ in range(m)]
    seen = [[False] * n for _ in range(m)]
    totals = {c: 0 for c in COUNTERS}
    totals["accReads"] = 0
    cyc = 0
    for m0, m1, k0, k1, n0, n1 in tiles(dataflow, m, k, n, rows, cols):
        sub_a = [row[k0:k1] for row in a[m0:m1]]
        sub_b = [row[n0:n1] for row in b[k0:k1]]
        tr = simulate(dataflow, sub_a, sub_b, rows, cols)
        cyc += tr["cycles"]
        for c in COUNTERS:
            totals[c] += tr["totals"][c]
        for i in range(m1 - m0):
            for j in range(n1 - n0):
                if seen[m0 + i][n0 + j]:
                    totals["accReads"] += 1
                result[m0 + i][n0 + j] += tr["C"][i][j]
                seen[m0 + i][n0 + j] = True
    return {"C": result, "cycles": cyc, "totals": totals, "tiles": len(tiles(dataflow, m, k, n, rows, cols))}


# ---------------------------------------------------------------------------
# Higher-level views the chapters draw
# ---------------------------------------------------------------------------


def reuse_steps(beta: int, n_max: int) -> list[dict[str, Any]]:
    """The memory-wall argument (chapter 1), one step per array size n.

    An n x n grid of MAC units fed by a memory that delivers ``beta`` words
    per cycle. Without reuse every MAC fetches its two operands, so at most
    beta / 2 MACs run per cycle. In an output-stationary systolic array each
    word entering at an edge is used by n PEs: 2n words per cycle feed n^2
    MACs, so the array runs min(n^2, beta * n / 2) MACs per cycle.
    Throughputs are stored as exact halves (x2) to stay integer.
    """
    out = []
    for n in range(1, n_max + 1):
        peak = n * n
        naive2 = min(2 * peak, beta)  # 2 x MACs per cycle
        sys2 = min(2 * peak, beta * n)
        out.append(
            {
                "n": n,
                "peak": peak,
                "naive2": naive2,
                "systolic2": sys2,
                "wordsPerCycle": 2 * n,
                "macsPerWord2": n,  # n / 2 MACs per word, doubled
            }
        )
    return out


def util_steps(dataflow: str, rows: int, cols: int, k: int, n: int, m_max: int) -> list[dict[str, Any]]:
    """Chapter 4: utilisation against the stream length (rows of A for
    weight-stationary, K for output-stationary), the array's block full."""
    out = []
    for x in range(1, m_max + 1):
        if dataflow == "ws":
            mm, kk, nn = x, k, n
        elif dataflow == "os":
            mm, kk, nn = k, x, n
        else:
            mm, kk, nn = n, k, x
        cyc = cycles(dataflow, mm, kk, nn)
        macs = mm * kk * nn
        out.append({"x": x, "cycles": cyc, "macs": macs, "util": utilisation(macs, rows, cols, cyc)})
    return out


def shape_steps(dataflow: str, rows: int, cols: int, m: int, k: int, n_max: int) -> list[dict[str, Any]]:
    """Chapter 4: utilisation against N with tiling (the ragged last tile)."""
    out = []
    for n in range(1, n_max + 1):
        cyc = tiled_cycles(dataflow, m, k, n, rows, cols)
        macs = m * k * n
        out.append(
            {
                "n": n,
                "tiles": len(tiles(dataflow, m, k, n, rows, cols)),
                "cycles": cyc,
                "util": utilisation(macs, rows, cols, cyc),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Row-stationary (Eyeriss) for a 2-D convolution: a reference dataflow
# ---------------------------------------------------------------------------


def conv2d(x: list[list[int]], f: list[list[int]]) -> list[list[int]]:
    """Direct 'valid' 2-D correlation (what CNN layers call convolution)."""
    h, w = len(x), len(x[0])
    r, s = len(f), len(f[0])
    out = []
    for i in range(h - r + 1):
        row = []
        for j in range(w - s + 1):
            acc = 0
            for di in range(r):
                for dj in range(s):
                    acc += x[i + di][j + dj] * f[di][dj]
            row.append(acc)
        out.append(row)
    return out


def simulate_rs(x: list[list[int]], f: list[list[int]]) -> dict[str, Any]:
    """Row-stationary: an R x E array of PEs (R filter rows, E output rows).

    PE(i, j) keeps filter row i and slides it along input row i + j, one MAC
    per cycle, starting i cycles late; local cycle u = t - i computes output
    column u // S, tap u % S. When it finishes an output column it adds the
    partial sum PE(i - 1, j) finished the cycle before and passes the total
    down; the bottom row writes output row j. A PE frame is
    [col, tap, mac or None, acc, v].
    """
    h, w = len(x), len(x[0])
    r, s = len(f), len(f[0])
    e, fo = h - r + 1, w - s + 1
    cnt = {"macs": 0, "psumHops": 0, "writes": 0}
    frames = []
    prev_v = [[None] * e for _ in range(r)]
    acc = [[0] * e for _ in range(r)]
    total = r - 1 + fo * s
    out_mat = [[0] * fo for _ in range(e)]
    for t in range(total):
        grid = []
        v_now = [[None] * e for _ in range(r)]
        out = []
        for i in range(r):
            row = []
            for j in range(e):
                u = t - i
                if u < 0 or u >= fo * s:
                    row.append([None, None, None, None, None])
                    continue
                col, tap = u // s, u % s
                prod_x, prod_w = x[i + j][col + tap], f[i][tap]
                acc[i][j] = (0 if tap == 0 else acc[i][j]) + prod_x * prod_w
                cnt["macs"] += 1
                v = None
                if tap == s - 1:
                    above = prev_v[i - 1][j] if i > 0 else None
                    if i > 0:
                        if above is None or above[1] != col:
                            raise AssertionError("row partial sum out of step")  # pragma: no cover
                        cnt["psumHops"] += 1
                    v = [acc[i][j] + (above[0] if above is not None else 0), col]
                    v_now[i][j] = v
                    if i == r - 1:
                        out.append([j, col, v[0]])
                        out_mat[j][col] = v[0]
                        cnt["writes"] += 1
                row.append([col, tap, [prod_x, prod_w], acc[i][j], v])
            grid.append(row)
        frames.append({"t": t, "pe": grid, "out": out, "cnt": dict(cnt)})
        prev_v = v_now
    return {"R": r, "S": s, "E": e, "F": fo, "cycles": total, "O": out_mat, "frames": frames}


# ---------------------------------------------------------------------------
# The demonstrations the chapters animate (src/lib/sa/values.ts repeats these)
# ---------------------------------------------------------------------------

DEMO: dict[str, Any] = {
    "seedA": 1,
    "seedB": 2,
    # chapter 1: the hero (weight-stationary, 4 x 4, eight rows of A)
    "hero": {"M": 8, "K": 4, "N": 4},
    # chapter 1: the memory wall
    "beta": 32,
    "reuseMax": 16,
    # chapter 2: weight-stationary cycle by cycle
    "ws": {"M": 5, "K": 4, "N": 4},
    # chapter 3: the three dataflows side by side on one matmul
    "cmp": {"M": 3, "K": 3, "N": 3},
    # chapter 4: the wavefront, and utilisation against size and shape
    "wave": {"M": 10, "K": 4, "N": 4},
    "array": 8,
    "utilMax": 64,
    "shape": {"M": 32, "K": 8, "nMax": 40},
    # the ranges the widgets let the reader choose
    "range": {"M": [1, 8], "K": [2, 4], "N": [2, 4]},
    # row-stationary reference: 6 x 7 input, 3 x 3 filter
    "rs": {"H": 6, "W": 7, "R": 3, "S": 3, "seedX": 5, "seedF": 6},
}


def demo_pair(m: int, k: int, n: int) -> tuple[list[list[int]], list[list[int]]]:
    """The A and B every demonstration uses for an M x K x N problem."""
    return demo_matrix(m, k, DEMO["seedA"]), demo_matrix(k, n, DEMO["seedB"])
