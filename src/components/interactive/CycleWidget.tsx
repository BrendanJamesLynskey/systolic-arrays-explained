"use client";

/**
 * Chapters 2 and 3: one matrix multiply on a systolic array, cycle by
 * cycle, with the value in every register. Driven by `simulate` (the TS
 * port of reference/systolic.py); each step is one frame of the trace.
 * The sliders choose the problem size: the model re-runs and the
 * animation restarts.
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Slider, Stat } from "@/components/ui/Controls";
import { ArrayView } from "@/components/viz/ArrayView";
import { Matrices } from "@/components/viz/Matrices";
import { int, pct } from "@/lib/format";
import { DATAFLOW_NAME, cycleCaption } from "@/lib/sa/captions";
import {
  DEMO,
  demoPair,
  simulate,
  utilisation,
  type Dataflow,
} from "@/lib/sa/model";

/** The array the problem needs: exactly the block it uses. */
export function blockFor(
  df: Dataflow,
  m: number,
  k: number,
  n: number,
): [number, number] {
  return df === "ws" ? [k, n] : df === "os" ? [m, n] : [k, m];
}

export default function CycleWidget({
  dataflow = "ws",
  choose = false,
  testId = "cycle-widget",
  children,
}: {
  dataflow?: Dataflow;
  /** Offer output- and input-stationary as well (chapter 3). */
  choose?: boolean;
  testId?: string;
  children?: ReactNode;
}): JSX.Element {
  const [df, setDf] = useState<Dataflow>(dataflow);
  const init = df === "ws" ? DEMO.ws : DEMO.cmp;
  const [mRaw, setM] = useState<number>(init.M);
  const [k, setK] = useState<number>(init.K);
  const [n, setN] = useState<number>(init.N);
  const [hover, setHover] = useState<string | null>(null);
  // the block of an output- or input-stationary array grows with M: keep
  // it at most 4 wide so the numbers stay legible on a phone
  const mMax = df === "ws" ? DEMO.range.M[1] : 4;
  const m = Math.min(mRaw, mMax);
  const [a, b] = useMemo(() => demoPair(m, k, n), [m, k, n]);
  const [rows, cols] = blockFor(df, m, k, n);
  const trace = useMemo(
    () => simulate(df, a, b, rows, cols),
    [df, a, b, rows, cols],
  );
  const st = useStepper(trace.cycles, {
    stepMs: 1100,
    resetKey: `${df}-${m}-${k}-${n}`,
  });
  const f = trace.frames[st.step]!;
  const dims = { M: m, K: k, N: n, rows, cols };
  const hl =
    hover ??
    (f.phase === "load"
      ? df === "ws"
        ? "w"
        : "a"
      : f.out.length
        ? "c"
        : df === "os"
          ? "acc"
          : "p");

  const title =
    df === "ws"
      ? "Weight-stationary: C = A·B, cycle by cycle"
      : df === "os"
        ? "Output-stationary: every PE keeps one cᵢⱼ"
        : "Input-stationary: A stays, B streams";

  return (
    <AnimationPanel
      testId={testId}
      title={title}
      summary={`A ${m} × ${k} times B ${k} × ${n} on a ${rows} × ${cols} array, ${DATAFLOW_NAME[df]}: every number is a register in the cycle-accurate model.`}
      stepper={st}
      stepLabel="cycle"
      caption={cycleCaption(df, dims, f)}
      visual={
        <div className="grid min-w-0 gap-4">
          <ArrayView
            trace={trace}
            step={st.step}
            hl={hover}
            ariaLabel={`A ${rows} by ${cols} systolic array at cycle ${st.step + 1}, ${DATAFLOW_NAME[df]}`}
          />
          <Matrices trace={trace} step={st.step} a={a} b={b} />
        </div>
      }
      equation={children}
      hl={hl}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Phase" value={f.phase} />
          <Stat
            label="MACs so far"
            value={`${int(f.cnt.macs)} of ${int(m * k * n)}`}
          />
          <Stat label="Cycles" value={int(trace.cycles)} />
          <Stat
            label="Utilisation"
            value={pct(utilisation(m * k * n, rows, cols, trace.cycles), 0)}
            hint="over the whole run"
          />
        </div>
      }
      params={
        <>
          {choose && (
            <Segmented
              label="Dataflow"
              value={df}
              options={(["os", "is", "ws"] as const).map((v) => ({
                value: v,
                label: DATAFLOW_NAME[v],
              }))}
              onChange={setDf}
            />
          )}
          <Slider
            label="M (rows of A)"
            value={m}
            min={DEMO.range.M[0]}
            max={mMax}
            onChange={setM}
          />
          <Slider
            label="K (inner dimension)"
            value={k}
            min={DEMO.range.K[0]}
            max={DEMO.range.K[1]}
            onChange={setK}
          />
          <Slider
            label="N (columns of B)"
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
