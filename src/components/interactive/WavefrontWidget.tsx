"use client";

/**
 * Chapter 4: the wavefront. Top: which PEs multiply in this cycle of a
 * weight-stationary run, each labelled with the row m of A it is working
 * on (PE(k, n) works on m = t − k − n, so the busy PEs form a diagonal
 * band). Bottom: busy PEs per cycle for the whole run, with the load, fill
 * and drain marked. Both come from `simulate`'s frames (`activePerCycle`).
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Slider, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { int, pct } from "@/lib/format";
import { waveCaption } from "@/lib/sa/captions";
import {
  DEMO,
  activePerCycle,
  demoPair,
  simulate,
  utilisation,
} from "@/lib/sa/model";
import { DATA_COLOUR, MUTED, STATE_COLOUR } from "@/lib/viz/palette";

const VW = 640;

export default function WavefrontWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [m, setM] = useState<number>(DEMO.wave.M);
  const [size, setSize] = useState<number>(DEMO.wave.K);
  const [hover, setHover] = useState<string | null>(null);
  const k = size;
  const n = size;
  const trace = useMemo(() => {
    const [a, b] = demoPair(m, k, n);
    return simulate("ws", a, b, k, n);
  }, [m, k, n]);
  const active = useMemo(() => activePerCycle(trace), [trace]);
  const st = useStepper(trace.cycles, {
    stepMs: 450,
    resetKey: `${m}-${size}`,
  });
  const f = trace.frames[st.step]!;
  const font = useSvgFont(VW);
  const fs = font.fs(12);

  // the grid
  const gs = 230;
  const cell = gs / size;
  const gx = (VW - gs) / 2;
  const gy = 10;
  // the chart
  const cy0 = gy + gs + 34;
  const ch = 120;
  const cx0 = 46;
  const cw = VW - cx0 - 12;
  const bw = cw / trace.cycles;
  const pes = k * n;
  const fillEnd = k + (k + n - 2);
  const drainStart = k + m - 1;
  const hlKey =
    hover ??
    (st.step < k
      ? "w"
      : st.step < fillEnd && active[st.step]! < pes
        ? "fill"
        : "t");

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${cy0 + ch + 30}`}
      className="w-full"
      role="img"
      aria-label={`Busy processing elements at cycle ${st.step + 1}, and busy count per cycle`}
    >
      {f.pe.map((row, r) =>
        row.map((pe, c) => {
          const mac = pe[4] !== null;
          const mm = mac ? pe[1]![1] : null;
          return (
            <g key={`${r}-${c}`}>
              <rect
                x={gx + c * cell + 1}
                y={gy + r * cell + 1}
                width={cell - 2}
                height={cell - 2}
                rx={3}
                fill={mac ? DATA_COLOUR.a : "currentColor"}
                fillOpacity={mac ? (mm! % 2 === 0 ? 0.5 : 0.25) : 0.06}
                stroke={mac ? STATE_COLOUR.active : "currentColor"}
                strokeOpacity={mac ? 1 : 0.2}
              />
              {mac && cell >= 24 && (
                <text
                  x={gx + c * cell + cell / 2}
                  y={gy + r * cell + cell / 2 + fs * 0.35}
                  textAnchor="middle"
                  fontSize={fs}
                  fill="currentColor"
                >
                  {mm}
                </text>
              )}
            </g>
          );
        }),
      )}
      <text
        x={gx - 10}
        y={gy + 14}
        fontSize={fs}
        textAnchor="end"
        fill="currentColor"
      >
        row m of A →
      </text>

      {/* busy PEs per cycle */}
      <rect
        x={cx0}
        y={cy0}
        width={bw * k}
        height={ch}
        fill={DATA_COLOUR.b}
        fillOpacity={0.12}
      />
      <text x={cx0 + 2} y={cy0 - 6} fontSize={fs} fill="currentColor">
        load
      </text>
      {active.map((v, t) => (
        <rect
          key={t}
          x={cx0 + t * bw + 0.5}
          y={cy0 + ch - (v / pes) * ch}
          width={Math.max(1, bw - 1)}
          height={(v / pes) * ch}
          fill={t === st.step ? STATE_COLOUR.active : MUTED.light}
          fillOpacity={t <= st.step ? 1 : 0.45}
        />
      ))}
      <line
        x1={cx0}
        x2={cx0 + cw}
        y1={cy0}
        y2={cy0}
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeDasharray="4 3"
      />
      <text
        x={cx0 - 6}
        y={cy0 + 4}
        fontSize={fs}
        textAnchor="end"
        fill="currentColor"
      >
        {pes}
      </text>
      <text
        x={cx0 - 6}
        y={cy0 + ch}
        fontSize={fs}
        textAnchor="end"
        fill="currentColor"
      >
        0
      </text>
      {drainStart < trace.cycles && (
        <line
          x1={cx0 + drainStart * bw}
          x2={cx0 + drainStart * bw}
          y1={cy0}
          y2={cy0 + ch}
          stroke="currentColor"
          strokeOpacity={0.35}
        />
      )}
      <text
        x={cx0 + cw}
        y={cy0 + ch + 20}
        fontSize={fs}
        textAnchor="end"
        fill="currentColor"
      >
        cycle →
      </text>
    </svg>
  );

  const util = utilisation(m * k * n, k, n, trace.cycles);
  return (
    <AnimationPanel
      testId="wavefront-widget"
      title="The wavefront: fill, full, drain"
      summary={`${m} rows of A through a ${size} × ${size} weight-stationary array. The busy PEs are a diagonal band that sweeps across the array.`}
      stepper={st}
      stepLabel="cycle"
      caption={waveCaption(st.step, k, active[st.step]!, pes, {
        M: m,
        K: k,
        N: n,
      })}
      visual={visual}
      equation={children}
      hl={hlKey}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Busy now" value={`${active[st.step]} of ${pes}`} />
          <Stat label="Cycles" value={int(trace.cycles)} />
          <Stat label="Utilisation" value={pct(util, 1)} />
        </div>
      }
      params={
        <>
          <Slider
            label="M (rows of A streamed)"
            value={m}
            min={1}
            max={24}
            onChange={setM}
          />
          <Segmented
            label="Array"
            value={String(size)}
            options={["4", "8"].map((v) => ({
              value: v,
              label: `${v} × ${v}`,
            }))}
            onChange={(v) => setSize(Number(v))}
          />
        </>
      }
    />
  );
}
