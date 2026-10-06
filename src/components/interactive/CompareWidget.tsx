"use client";

/**
 * Chapter 3: the same C = A·B in the three dataflows at once, on one clock.
 * Each panel is the model's frame for that dataflow at the current cycle
 * (a dataflow that has finished stays on its last frame); the table under
 * them counts, cycle by cycle, what each one has moved: words read from
 * and written to the buffers, values passed between neighbouring PEs, the
 * share of those that were partial sums, and register writes.
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Slider } from "@/components/ui/Controls";
import { ArrayView } from "@/components/viz/ArrayView";
import { int } from "@/lib/format";
import {
  DATAFLOW_NAME,
  DATAFLOW_SHORT,
  compareCaption,
} from "@/lib/sa/captions";
import {
  DATAFLOWS,
  DEMO,
  demoPair,
  simulate,
  type Counter,
  type Counts,
  type Dataflow,
  type Trace,
} from "@/lib/sa/model";
import { DATAFLOW_COLOUR } from "@/lib/viz/palette";

import { blockFor } from "./CycleWidget";

const ROWS: { key: Counter; label: string; hl: string }[] = [
  { key: "reads", label: "Buffer reads", hl: "bw" },
  { key: "writes", label: "Buffer writes", hl: "c" },
  { key: "hops", label: "PE-to-PE hops", hl: "a" },
  { key: "psumHops", label: "… of partial sums", hl: "p" },
  { key: "regWrites", label: "Register writes", hl: "t" },
];

export default function CompareWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [m, setM] = useState<number>(DEMO.cmp.M);
  const [k, setK] = useState<number>(DEMO.cmp.K);
  const [n, setN] = useState<number>(DEMO.cmp.N);
  const [hover, setHover] = useState<string | null>(null);
  const traces = useMemo(() => {
    const [a, b] = demoPair(m, k, n);
    const out = {} as Record<Dataflow, Trace>;
    for (const df of DATAFLOWS) {
      const [r, c] = blockFor(df, m, k, n);
      out[df] = simulate(df, a, b, r, c);
    }
    return out;
  }, [m, k, n]);
  const total = Math.max(...DATAFLOWS.map((df) => traces[df].cycles));
  const st = useStepper(total, {
    stepMs: 800,
    resetKey: `${m}-${k}-${n}`,
  });
  const at = (df: Dataflow) => Math.min(st.step, traces[df].cycles - 1);
  const counts = {} as Record<Dataflow, Counts>;
  const done = {} as Record<Dataflow, boolean>;
  for (const df of DATAFLOWS) {
    counts[df] = traces[df].frames[at(df)]!.cnt;
    done[df] = st.step >= traces[df].cycles - 1;
  }
  const finals = DATAFLOWS.map((df) => traces[df].totals);
  const maxOf = (key: Counter) => Math.max(1, ...finals.map((t) => t[key]));

  return (
    <AnimationPanel
      testId="compare-widget"
      title="One matmul, three dataflows"
      summary={`A ${m} × ${k} times B ${k} × ${n}. Weight-stationary holds B, output-stationary holds C, input-stationary holds A; the counts are the model's, cycle by cycle.`}
      stepper={st}
      stepLabel="cycle"
      caption={compareCaption(st.step, counts, done)}
      visual={
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            {(["ws", "os", "is"] as const).map((df) => (
              <figure key={df} className="min-w-0" data-df={df}>
                <figcaption className="mb-1 flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-sm"
                    style={{ background: DATAFLOW_COLOUR[df] }}
                  />
                  <span className="font-medium">{DATAFLOW_NAME[df]}</span>
                  <span className="font-mono text-neutral-500 dark:text-neutral-400">
                    {traces[df].rows}×{traces[df].cols}, {traces[df].cycles}{" "}
                    cycles
                  </span>
                </figcaption>
                <ArrayView
                  trace={traces[df]}
                  step={at(df)}
                  numbers={false}
                  queue={2}
                  ariaLabel={`${DATAFLOW_NAME[df]} array at cycle ${at(df) + 1}`}
                />
              </figure>
            ))}
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-0 text-xs" data-testid="traffic">
              <thead>
                <tr className="text-left text-neutral-600 dark:text-neutral-400">
                  <th className="py-1 pr-2 font-medium">so far</th>
                  {DATAFLOWS.map((df) => (
                    <th key={df} className="py-1 pr-2 font-mono font-medium">
                      {DATAFLOW_SHORT[df]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr
                    key={row.key}
                    className="border-t border-neutral-200 dark:border-neutral-800"
                    style={{ opacity: hover && hover !== row.hl ? 0.45 : 1 }}
                  >
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {row.label}
                    </th>
                    {DATAFLOWS.map((df) => (
                      <td key={df} className="py-1 pr-2">
                        <div className="flex items-center gap-1">
                          <span className="w-9 shrink-0 text-right font-mono">
                            {int(counts[df][row.key])}
                          </span>
                          <span
                            aria-hidden
                            className="hidden h-2 rounded-sm sm:block"
                            style={{
                              width: `${(counts[df][row.key] / maxOf(row.key)) * 4.5}rem`,
                              background: DATAFLOW_COLOUR[df],
                            }}
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      }
      equation={children}
      hl={hover ?? "p"}
      onEquationHover={setHover}
      params={
        <>
          <Slider label="M" value={m} min={1} max={4} onChange={setM} />
          <Slider
            label="K"
            value={k}
            min={DEMO.range.K[0]}
            max={DEMO.range.K[1]}
            onChange={setK}
          />
          <Slider
            label="N"
            value={n}
            min={DEMO.range.N[0]}
            max={DEMO.range.N[1]}
            onChange={setN}
          />
        </>
      }
    />
  );
}
