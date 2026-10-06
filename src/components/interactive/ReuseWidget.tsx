"use client";

/**
 * Chapter 1's memory wall, one step per array size n (`reuseSteps`). Left:
 * the n × n grid of multipliers with the 2n words a systolic array takes in
 * each cycle. Right: MACs per cycle at peak, with reuse (systolic) and
 * without (every MAC fetching its own two operands) from a memory that
 * delivers β words a cycle.
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { int } from "@/lib/format";
import { reuseCaption } from "@/lib/sa/captions";
import { DEMO, reuseSteps } from "@/lib/sa/model";
import {
  DATA_COLOUR,
  LEVEL_COLOUR,
  MUTED,
  OKABE_ITO,
  STATE_COLOUR,
} from "@/lib/viz/palette";

const VW = 640;
const GRID = 190;

export default function ReuseWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [beta, setBeta] = useState<number>(DEMO.beta);
  const [hover, setHover] = useState<string | null>(null);
  const steps = useMemo(() => reuseSteps(beta, DEMO.reuseMax), [beta]);
  const st = useStepper(steps.length, { stepMs: 900, resetKey: String(beta) });
  const s = steps[st.step]!;
  const font = useSvgFont(VW);
  const fs = font.fs(13);
  const n = s.n;
  // phones: the grid above the bars, so both stay legible
  const narrow = font.narrow;
  const grid = narrow ? 260 : GRID;
  const cell = grid / n;
  const VH = narrow ? 580 : 270;
  const gx = narrow ? (VW - grid) / 2 : 40;
  const gy = 40;
  const bx = narrow ? 30 : 300;
  const bw = VW - bx - 20;
  const maxV = DEMO.reuseMax * DEMO.reuseMax;
  const bar = (v: number) => (v / maxV) * bw;
  const rowsY = narrow ? [400, 470, 540] : [70, 130, 190];
  const bars = [
    { key: "peak", label: "peak (n²)", v: s.peak, colour: MUTED.light },
    {
      key: "u",
      label: "systolic",
      v: s.systolic2 / 2,
      colour: STATE_COLOUR.active,
    },
    { key: "bw", label: "no reuse", v: s.naive2 / 2, colour: OKABE_ITO.orange },
  ];

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${VH}`}
      className="w-full"
      role="img"
      aria-label={`An ${n} by ${n} grid of multipliers and bars of multiply-accumulates per cycle with and without data reuse`}
    >
      <text x={gx - 30} y={22} fontSize={fs} fill="currentColor">
        memory: {beta} words / cycle
      </text>
      <rect
        x={gx - 30}
        y={gy}
        width={14}
        height={grid}
        rx={3}
        fill={LEVEL_COLOUR.smem}
        fillOpacity={0.6}
      />
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <line
            x1={gx - 14}
            x2={gx}
            y1={gy + (i + 0.5) * cell}
            y2={gy + (i + 0.5) * cell}
            stroke={DATA_COLOUR.a}
            strokeWidth={n > 10 ? 1.5 : 2.5}
          />
          <line
            x1={gx + (i + 0.5) * cell}
            x2={gx + (i + 0.5) * cell}
            y1={gy - 12}
            y2={gy}
            stroke={DATA_COLOUR.b}
            strokeWidth={n > 10 ? 1.5 : 2.5}
          />
        </g>
      ))}
      {Array.from({ length: n * n }, (_, i) => {
        const r = Math.floor(i / n);
        const c = i % n;
        const busy = i < s.systolic2 / 2;
        return (
          <rect
            key={i}
            x={gx + c * cell + 1}
            y={gy + r * cell + 1}
            width={cell - 2}
            height={cell - 2}
            rx={Math.min(4, cell / 5)}
            fill={busy ? STATE_COLOUR.active : "currentColor"}
            fillOpacity={busy ? 0.55 : 0.08}
          />
        );
      })}
      <text x={gx - 30} y={gy + grid + 30} fontSize={fs} fill="currentColor">
        {n} × {n}: {s.wordsPerCycle} words in per cycle
      </text>
      {bars.map((b, i) => (
        <g key={b.key} opacity={hover && hover !== b.key ? 0.4 : 1}>
          <text x={bx} y={rowsY[i]! - 8} fontSize={fs} fill="currentColor">
            {b.label}: {int(b.v)} MACs / cycle
          </text>
          <rect
            x={bx}
            y={rowsY[i]!}
            width={bw}
            height={narrow ? 26 : 18}
            rx={3}
            fill="currentColor"
            fillOpacity={0.06}
          />
          <rect
            x={bx}
            y={rowsY[i]!}
            width={Math.max(2, bar(b.v))}
            height={narrow ? 26 : 18}
            rx={3}
            fill={b.colour}
          />
        </g>
      ))}
    </svg>
  );

  return (
    <AnimationPanel
      testId="reuse-widget"
      title="The memory wall, and reuse"
      summary="Grow the array one size at a time. Without reuse the memory caps the multipliers that can run; a systolic array's need grows only with the edge, 2n."
      stepper={st}
      stepLabel="n ="
      countFrom={1}
      caption={reuseCaption(s, beta)}
      visual={visual}
      equation={children}
      hl={hover ?? "n"}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Peak" value={int(s.peak)} />
          <Stat label="Systolic" value={int(s.systolic2 / 2)} />
          <Stat label="No reuse" value={int(s.naive2 / 2)} />
        </div>
      }
      params={
        <Segmented
          label="Memory bandwidth (words per cycle)"
          value={String(beta)}
          options={["8", "32", "128"].map((v) => ({ value: v, label: v }))}
          onChange={(v) => setBeta(Number(v))}
        />
      }
    />
  );
}
