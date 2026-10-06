"use client";

/**
 * Chapter 5: the buffer bandwidth each dataflow needs. A 1024-wide layer
 * (K = N = 1024, M rows of activations) tiled onto arrays from 8 × 8 to
 * 256 × 256, one array size per step. Top: words moved between the on-chip
 * buffer and the array per MAC, by operand, for each dataflow. Bottom: the
 * total against array size for all three (log scales), the current size
 * marked. From `tiledWords` (checked against the cycle-accurate tiled
 * simulation in tests/python) and `tiledCycles`.
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { trim } from "@/lib/format";
import { DATAFLOW_SHORT } from "@/lib/sa/captions";
import { bandwidthCaption } from "@/lib/sa/captionsB";
import { DATAFLOWS, DEMO } from "@/lib/sa/model";
import { type Words } from "@/lib/sa/stream";
import { bandwidthRows } from "@/lib/sa/views";
import { DATA_COLOUR, DATAFLOW_COLOUR, STATE_COLOUR } from "@/lib/viz/palette";

const VW = 640;
const PARTS: [keyof Words, string, string][] = [
  ["a", "A read", DATA_COLOUR.a],
  ["b", "B read", DATA_COLOUR.b],
  ["c", "C written", DATA_COLOUR.c],
  ["acc", "partial sums read", DATA_COLOUR.psum],
];

export default function BandwidthWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [m, setM] = useState<number>(DEMO.bw.Ms[1]);
  const [hover, setHover] = useState<string | null>(null);
  const rows = useMemo(() => bandwidthRows(m), [m]);
  const st = useStepper(rows.length, { stepMs: 1200, resetKey: String(m) });
  const row = rows[st.step]!;
  const macs = m * DEMO.bw.K * DEMO.bw.N;
  const font = useSvgFont(VW);
  const fs = font.fs(12);

  // stacked bars
  const bx = 120;
  const bw = VW - bx - 20;
  const bh = Math.max(30, fs * 1.8);
  const by = 10 + fs * 1.5;
  const legY = by + 3 * (bh + 12) + fs;
  const maxPer = Math.max(
    ...rows.flatMap((r) => DATAFLOWS.map((d) => r.perMac[d])),
  );
  const W = (v: number) => (v / maxPer) * bw;
  // line chart (log-log)
  const ly = legY + fs * 1.5 + fs * 3.5;
  const lh = 170;
  const lx = 70;
  const lw = VW - lx - 20;
  const all = rows.flatMap((r) => DATAFLOWS.map((d) => r.perMac[d]));
  const lo = Math.log10(Math.min(...all)) - 0.1;
  const hi = Math.log10(Math.max(...all)) + 0.1;
  const LX = (i: number) => lx + (i / (rows.length - 1)) * lw;
  const LY = (v: number) => ly + lh - ((Math.log10(v) - lo) / (hi - lo)) * lh;
  const decades: number[] = [];
  for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) decades.push(10 ** e);

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${ly + lh + 30 + fs * 1.5}`}
      className="w-full"
      role="img"
      aria-label={`Buffer words per MAC of each dataflow on a ${row.array} by ${row.array} array`}
    >
      <text x={bx} y={by - 10} fontSize={fs} fill="currentColor">
        {`words per MAC, ${row.array} × ${row.array} array`}
      </text>
      {DATAFLOWS.map((df, i) => {
        let x = bx;
        const y = by + i * (bh + 12);
        return (
          <g key={df} data-df={df}>
            <text
              x={bx - 8}
              y={y + bh / 2 + fs * 0.35}
              textAnchor="end"
              fontSize={fs}
              fill="currentColor"
            >
              {DATAFLOW_SHORT[df]}
            </text>
            {PARTS.map(([key, label, colour]) => {
              const w = W(row.words[df][key] / macs);
              const r = (
                <rect
                  key={key}
                  x={x}
                  y={y}
                  width={w}
                  height={bh}
                  fill={colour}
                  fillOpacity={
                    hover && hover !== (key === "acc" ? "p" : key) ? 0.25 : 0.8
                  }
                >
                  <title>{`${label}: ${trim(row.words[df][key] / macs, 3)} per MAC`}</title>
                </rect>
              );
              x += w;
              return r;
            })}
            <text
              x={Math.min(x + 6, VW - 60)}
              y={y + bh / 2 + fs * 0.35}
              fontSize={fs}
              fill="currentColor"
            >
              {trim(row.perMac[df], 3)}
            </text>
          </g>
        );
      })}
      {PARTS.map(([key, label, colour], i) => (
        <g
          key={key}
          transform={`translate(${bx + (i % 2) * (bw / 2)}, ${legY + (i < 2 ? 0 : fs * 1.5)})`}
        >
          <rect width={12} height={12} y={-10} fill={colour} rx={2} />
          <text x={18} y={0} fontSize={fs} fill="currentColor">
            {label}
          </text>
        </g>
      ))}

      {/* all array sizes */}
      {decades.map((d) => (
        <g key={d}>
          <line
            x1={lx}
            x2={lx + lw}
            y1={LY(d)}
            y2={LY(d)}
            stroke="currentColor"
            strokeOpacity={0.12}
          />
          <text
            x={lx - 6}
            y={LY(d) + 4}
            textAnchor="end"
            fontSize={fs}
            fill="currentColor"
          >
            {trim(d, 3)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => (
        <text
          key={r.array}
          x={LX(i)}
          y={ly + lh + 18}
          textAnchor="middle"
          fontSize={fs}
          fill="currentColor"
        >
          {r.array}
        </text>
      ))}
      <text
        x={lx + lw}
        y={ly + lh + 22 + fs * 1.3}
        textAnchor="end"
        fontSize={fs}
        fill="currentColor"
      >
        array size R = C (log)
      </text>
      {DATAFLOWS.map((df) => (
        <g key={df}>
          <path
            d={rows
              .map(
                (r, i) =>
                  `${i ? "L" : "M"}${LX(i).toFixed(1)} ${LY(r.perMac[df]).toFixed(1)}`,
              )
              .join("")}
            fill="none"
            stroke={DATAFLOW_COLOUR[df]}
            strokeWidth={2.5}
            strokeDasharray={
              df === "is" ? "6 4" : df === "os" ? "2 3" : undefined
            }
          />
        </g>
      ))}
      <text x={lx} y={ly - 14 - fs * 1.4} fontSize={fs} fill="currentColor">
        words per MAC, every array size (log)
      </text>
      {DATAFLOWS.map((df, i) => (
        <g
          key={`k${df}`}
          transform={`translate(${lx + i * fs * 5}, ${ly - 10})`}
        >
          <line
            x1={0}
            x2={22}
            y1={-4}
            y2={-4}
            stroke={DATAFLOW_COLOUR[df]}
            strokeWidth={2.5}
            strokeDasharray={
              df === "is" ? "6 4" : df === "os" ? "2 3" : undefined
            }
          />
          <text x={28} y={0} fontSize={fs} fill="currentColor">
            {DATAFLOW_SHORT[df]}
          </text>
        </g>
      ))}
      <line
        x1={LX(st.step)}
        x2={LX(st.step)}
        y1={ly}
        y2={ly + lh}
        stroke={STATE_COLOUR.active}
        strokeWidth={2}
      />
    </svg>
  );

  return (
    <AnimationPanel
      testId="bandwidth-widget"
      title="Buffer bandwidth against array size"
      summary={`A layer with K = N = ${DEMO.bw.K} and M = ${m} rows, tiled onto bigger and bigger arrays (tiles in sequence). Each step doubles the array's side.`}
      stepper={st}
      stepLabel="size"
      countFrom={1}
      caption={bandwidthCaption(row.array, m, row.perMac)}
      visual={visual}
      equation={children}
      hl={hover ?? "a"}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-3 gap-2">
          {DATAFLOWS.map((df) => {
            const w = row.words[df];
            const per = (w.a + w.b + w.c + w.acc) / row.cycles[df];
            return (
              <Stat
                key={df}
                label={`${DATAFLOW_SHORT[df]} words/cycle`}
                value={trim(per, 3)}
                hint={`${trim(row.perMac[df], 3)} per MAC`}
              />
            );
          })}
        </div>
      }
      params={
        <Segmented
          label="M (rows of activations)"
          value={String(m)}
          options={DEMO.bw.Ms.map((v) => ({
            value: String(v),
            label:
              v === DEMO.bw.Ms[0]
                ? `${v} (decode-like)`
                : `${v} (prefill-like)`,
          }))}
          onChange={(v) => setM(Number(v))}
        />
      }
    />
  );
}
