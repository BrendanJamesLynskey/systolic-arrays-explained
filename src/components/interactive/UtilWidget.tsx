"use client";

/**
 * Chapter 4: utilisation, plotted point by point. "Stream length": an 8 × 8
 * array with its block full, against the length of the stream (rows of A
 * for weight-stationary, K for output-stationary, columns of B for
 * input-stationary): the fill and drain are paid once, so utilisation
 * climbs towards 1. "Matrix width": N swept past the array's 8 columns,
 * tile by tile: each new tile starts nearly empty, so utilisation saws.
 * From `utilSteps` and `shapeSteps` (closed forms checked against the
 * cycle-accurate model).
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { int, pct } from "@/lib/format";
import { DATAFLOW_NAME, utilCaption } from "@/lib/sa/captions";
import {
  DEMO,
  shapeSteps,
  utilSteps,
  type Dataflow,
  type ShapeStep,
  type UtilStep,
} from "@/lib/sa/model";
import { DATAFLOW_COLOUR, STATE_COLOUR } from "@/lib/viz/palette";

const VW = 640;
const VH = 260;
const PAD = { l: 48, r: 14, t: 14, b: 36 };

type Mode = "stream" | "shape";

export default function UtilWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [mode, setMode] = useState<Mode>("stream");
  const [df, setDf] = useState<Dataflow>("ws");
  const [hover, setHover] = useState<string | null>(null);
  const R = DEMO.array;
  const steps: (UtilStep | ShapeStep)[] = useMemo(
    () =>
      mode === "stream"
        ? utilSteps(df, R, R, R, R, DEMO.utilMax)
        : shapeSteps(df, R, R, DEMO.shape.M, DEMO.shape.K, DEMO.shape.nMax),
    [mode, df, R],
  );
  const st = useStepper(steps.length, {
    stepMs: 220,
    resetKey: `${mode}-${df}`,
  });
  const s = steps[st.step]!;
  const font = useSvgFont(VW);
  const fs = font.fs(12);
  const xs = steps.map((p) => ("x" in p ? p.x : p.n));
  const xMax = xs[xs.length - 1]!;
  const X = (x: number) =>
    PAD.l + ((x - 1) / (xMax - 1)) * (VW - PAD.l - PAD.r);
  const Y = (u: number) => VH - PAD.b - u * (VH - PAD.t - PAD.b);
  const path = steps
    .slice(0, st.step + 1)
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${X(xs[i]!).toFixed(1)} ${Y(p.util).toFixed(1)}`,
    )
    .join("");
  const xLabel =
    mode === "shape"
      ? `N (columns of B), M = ${DEMO.shape.M}, K = ${DEMO.shape.K}`
      : df === "ws"
        ? "M (rows of A streamed)"
        : df === "os"
          ? "K (inner dimension streamed)"
          : "N (columns of B streamed)";
  const ticks =
    mode === "shape" ? [1, 8, 16, 24, 32, 40] : [1, 8, 16, 32, 48, 64];

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${VH}`}
      className="w-full"
      role="img"
      aria-label={`Utilisation against ${xLabel}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((u) => (
        <g key={u}>
          <line
            x1={PAD.l}
            x2={VW - PAD.r}
            y1={Y(u)}
            y2={Y(u)}
            stroke="currentColor"
            strokeOpacity={u === 1 ? 0.35 : 0.12}
            strokeDasharray={u === 1 ? "4 3" : undefined}
          />
          <text
            x={PAD.l - 6}
            y={Y(u) + 4}
            fontSize={fs}
            textAnchor="end"
            fill="currentColor"
          >
            {pct(u)}
          </text>
        </g>
      ))}
      {ticks.map((x) => (
        <text
          key={x}
          x={X(x)}
          y={VH - PAD.b + 16}
          fontSize={fs}
          textAnchor="middle"
          fill="currentColor"
        >
          {x}
        </text>
      ))}
      <text
        x={VW - PAD.r}
        y={VH - 4}
        fontSize={fs}
        textAnchor="end"
        fill="currentColor"
      >
        {xLabel}
      </text>
      {mode === "shape" &&
        df !== "is" &&
        [8, 16, 24, 32].map((x) => (
          <line
            key={x}
            x1={X(x + 0.5)}
            x2={X(x + 0.5)}
            y1={PAD.t}
            y2={VH - PAD.b}
            stroke="currentColor"
            strokeOpacity={0.15}
          />
        ))}
      <path
        d={path}
        fill="none"
        stroke={DATAFLOW_COLOUR[df]}
        strokeWidth={2.5}
        opacity={hover && hover !== "u" ? 0.5 : 1}
      />
      <circle
        cx={X(xs[st.step]!)}
        cy={Y(s.util)}
        r={5}
        fill={STATE_COLOUR.active}
      />
    </svg>
  );

  return (
    <AnimationPanel
      testId="util-widget"
      title="Utilisation against size"
      summary={`An ${R} × ${R} array, ${DATAFLOW_NAME[df]}. Each step adds one problem size; the fraction of the array's MACs that did useful work.`}
      stepper={st}
      stepLabel={mode === "shape" ? "N =" : "size"}
      countFrom={1}
      caption={utilCaption(df, mode, s, R, R)}
      visual={visual}
      equation={children}
      hl={hover ?? (mode === "shape" ? "n" : "u")}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Cycles" value={int(s.cycles)} />
          <Stat label="Utilisation" value={pct(s.util, 1)} />
          <Stat
            label={mode === "shape" ? "Tiles" : "MACs"}
            value={int("tiles" in s ? s.tiles : s.macs)}
          />
        </div>
      }
      params={
        <>
          <Segmented
            label="Sweep"
            value={mode}
            options={[
              { value: "stream", label: "stream length" },
              { value: "shape", label: "matrix width (tiles)" },
            ]}
            onChange={setMode}
          />
          <Segmented
            label="Dataflow"
            value={df}
            options={(["ws", "os", "is"] as const).map((v) => ({
              value: v,
              label: v.toUpperCase(),
            }))}
            onChange={setDf}
          />
        </>
      }
    />
  );
}
