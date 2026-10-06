"""
All-reduce on a 2-D torus of chips: the Python reference for chapter 7.

Every chip (x, y) of an X x Y torus holds a vector of X * Y integers (one
"chunk" each, to keep the picture small) and every chip must end with the
sum of all the vectors. The algorithm is the dimension-by-dimension ring
all-reduce that torus networks use:

  1. reduce-scatter along x: in each x-ring (fixed y), chip x sends group
     (x - s) mod X of the vector to chip x + 1, which adds it, for s = 0 ..
     X - 2; afterwards chip x holds group (x + 1) mod X summed over its ring.
     A group is Y chunks (chunk c belongs to group c // Y).
  2. reduce-scatter along y, inside that group: chip (x, y) ends holding one
     chunk, (x + 1) mod X, (y + 1) mod Y, summed over all X Y chips.
  3. all-gather along y, then 4. all-gather along x: the same rings in the
     same direction, copying instead of adding.

Each step every chip sends one message to its + neighbour on the wrap-around
links, so the torus finishes in 2 (X - 1) + 2 (Y - 1) steps, where one ring
through all X Y chips needs 2 (X Y - 1); each chip sends 2 (X Y - 1) chunks
either way. Real interconnects also use both directions of every link and
both dimensions at once; this one-direction version is the textbook form
(Patarasuk and Yuan, 2009, for the ring; the TPU v4 paper, Jouppi et al.
2023, for the torus).

Integers only, so the TypeScript port (src/lib/sa/torus.ts) matches exactly.
"""
from __future__ import annotations

from typing import Any

from systolic import Rng

PHASES = ("rs-x", "rs-y", "ag-y", "ag-x")


def demo_vectors(x_dim: int, y_dim: int, seed: int) -> list[list[list[int]]]:
    """data[x][y] = chip (x, y)'s vector of X Y small integers."""
    rng = Rng(seed)
    d = x_dim * y_dim
    return [[[rng.int_in(0, 9) for _ in range(d)] for _ in range(y_dim)] for _ in range(x_dim)]


def _snapshot(val, cnt) -> list[list[list[list[int]]]]:
    # chip (x, y): [[value, contributions], ...] per chunk
    return [[[[v, c] for v, c in zip(val[x][y], cnt[x][y])] for y in range(len(val[0]))] for x in range(len(val))]


def allreduce(data: list[list[list[int]]]) -> dict[str, Any]:
    """Run the 2-D all-reduce; one frame per step (frame 0 = the start).

    A frame holds every chip's chunks as [value, contributions] (how many
    chips' vectors the value sums), the messages sent in that step as
    [x, y, x', y', [chunks]], and the words sent so far.
    """
    xd, yd = len(data), len(data[0])
    d = xd * yd
    val = [[list(data[x][y]) for y in range(yd)] for x in range(xd)]
    cnt = [[[1] * d for _ in range(yd)] for _ in range(xd)]
    frames: list[dict[str, Any]] = [
        {"t": 0, "phase": "start", "step": 0, "of": 0, "msgs": [], "sent": 0, "state": _snapshot(val, cnt)}
    ]
    sent = 0

    def group(g: int) -> list[int]:
        return [g * yd + j for j in range(yd)]

    def run(phase: str, steps: int, plan) -> None:
        nonlocal sent
        for s in range(steps):
            msgs = []
            # every message of a step reads the state before the step
            old_v = [[list(val[x][y]) for y in range(yd)] for x in range(xd)]
            old_c = [[list(cnt[x][y]) for y in range(yd)] for x in range(xd)]
            for x in range(xd):
                for y in range(yd):
                    (dx, dy), chunks = plan(x, y, s)
                    msgs.append([x, y, dx, dy, chunks])
                    sent += len(chunks)
                    for c in chunks:
                        if phase.startswith("rs"):
                            val[dx][dy][c] += old_v[x][y][c]
                            cnt[dx][dy][c] += old_c[x][y][c]
                        else:
                            val[dx][dy][c] = old_v[x][y][c]
                            cnt[dx][dy][c] = old_c[x][y][c]
            frames.append(
                {
                    "t": len(frames),
                    "phase": phase,
                    "step": s + 1,
                    "of": steps,
                    "msgs": msgs,
                    "sent": sent,
                    "state": _snapshot(val, cnt),
                }
            )

    # 1. reduce-scatter along x: chip x sends group (x - s) mod X
    run("rs-x", xd - 1, lambda x, y, s: (((x + 1) % xd, y), group((x - s) % xd)))
    # 2. reduce-scatter along y inside the group chip x now owns
    run("rs-y", yd - 1, lambda x, y, s: ((x, (y + 1) % yd), [((x + 1) % xd) * yd + (y - s) % yd]))
    # 3. all-gather along y: pass the finished chunks round the y-ring
    run("ag-y", yd - 1, lambda x, y, s: ((x, (y + 1) % yd), [((x + 1) % xd) * yd + (y + 1 - s) % yd]))
    # 4. all-gather along x: pass the finished groups round the x-ring
    run("ag-x", xd - 1, lambda x, y, s: (((x + 1) % xd, y), group((x + 1 - s) % xd)))

    total = [sum(data[x][y][c] for x in range(xd) for y in range(yd)) for c in range(d)]
    return {"X": xd, "Y": yd, "steps": len(frames) - 1, "sum": total, "frames": frames}


def steps_torus(x_dim: int, y_dim: int) -> int:
    return 2 * (x_dim - 1) + 2 * (y_dim - 1)


def steps_ring(chips: int) -> int:
    return 2 * (chips - 1)


DEMO_TORUS: dict[str, Any] = {"X": 4, "Y": 4, "seed": 7}


def demo_run(x_dim: int | None = None, y_dim: int | None = None) -> dict[str, Any]:
    xd = x_dim or DEMO_TORUS["X"]
    yd = y_dim or DEMO_TORUS["Y"]
    return allreduce(demo_vectors(xd, yd, DEMO_TORUS["seed"]))
