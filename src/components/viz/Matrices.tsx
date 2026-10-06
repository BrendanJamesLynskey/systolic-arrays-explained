"use client";

/**
 * A, B and the result C so far, as small grids beside the array: the
 * elements entering the array in this cycle are outlined, C fills in as
 * results leave. HTML (not SVG), so it reflows on a phone.
 */
import { minus, sub } from "@/lib/format";
import type { Frame, Matrix, OpTag, Trace } from "@/lib/sa/model";
import { DATA_COLOUR } from "@/lib/viz/palette";

const n = (v: number) => minus(String(v));

function Grid({
  name,
  m,
  colour,
  on,
  filled,
  testId,
}: {
  name: string;
  m: Matrix;
  colour: string;
  on: (i: number, j: number) => boolean;
  filled?: (i: number, j: number) => boolean;
  testId?: string;
}): JSX.Element {
  const cols = m[0]!.length;
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="mb-1 font-mono text-xs text-neutral-600 dark:text-neutral-400">
        <span
          aria-hidden
          className="mr-1 inline-block size-2.5 rounded-sm"
          style={{ background: colour }}
        />
        {name} ({m.length} × {cols})
      </p>
      <div
        className="inline-grid gap-0.5 font-mono text-xs"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(1.9rem, auto))` }}
      >
        {m.map((row, i) =>
          row.map((v, j) => {
            const show = filled ? filled(i, j) : true;
            const hot = on(i, j);
            return (
              <span
                key={`${i}-${j}`}
                title={`${name.toLowerCase()}${sub(i, j)}`}
                className="rounded px-1 py-0.5 text-center text-neutral-800 dark:text-neutral-200"
                style={{
                  background: show
                    ? `${colour}${hot ? "55" : "1f"}`
                    : "transparent",
                  outline: hot
                    ? `2px solid ${colour}`
                    : "1px solid rgb(163 163 163 / 0.4)",
                }}
              >
                {show ? n(v) : "·"}
              </span>
            );
          }),
        )}
      </div>
    </div>
  );
}

export function Matrices({
  trace,
  step,
  a,
  b,
}: {
  trace: Trace;
  step: number;
  a: Matrix;
  b: Matrix;
}): JSX.Element {
  const f: Frame = trace.frames[step]!;
  const df = trace.dataflow;
  const entering = new Set<string>();
  const add = (mat: "A" | "B", t: OpTag | null) => {
    if (t) entering.add(`${mat}${t[1]},${t[2]}`);
  };
  for (const t of f.inL) add(df === "is" ? "B" : "A", t);
  for (const t of f.inT)
    add(f.phase === "load" ? (df === "ws" ? "B" : "A") : "B", t);
  const done = new Set<string>();
  for (let s = 0; s <= step; s++)
    for (const [m, nn] of trace.frames[s]!.out) done.add(`${m},${nn}`);
  const fresh = new Set(f.out.map(([m, nn]) => `${m},${nn}`));
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Grid
        name="A"
        m={a}
        colour={DATA_COLOUR.a}
        on={(i, j) => entering.has(`A${i},${j}`)}
      />
      <Grid
        name="B"
        m={b}
        colour={DATA_COLOUR.b}
        on={(i, j) => entering.has(`B${i},${j}`)}
      />
      <Grid
        name="C"
        m={trace.C}
        colour={DATA_COLOUR.c}
        on={(i, j) => fresh.has(`${i},${j}`)}
        filled={(i, j) => done.has(`${i},${j}`)}
        testId="c-so-far"
      />
    </div>
  );
}
