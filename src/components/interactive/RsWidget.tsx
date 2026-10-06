"use client";

/**
 * Chapter 8: Eyeriss's row-stationary dataflow on a 2-D convolution. PE(i, j)
 * keeps filter row i and slides it along input row i + j, one multiply per
 * cycle; when it finishes an output column it adds the partial sum from the
 * PE above and passes the total down, so each column of PEs builds one row
 * of the output. Top: the PEs this cycle (the product each makes, its
 * running row sum, and the partial sum it passes down). Bottom: the input,
 * the filter and the output, with the numbers read and written this cycle
 * outlined. Every frame is a cycle of `simulateRs` (the TS port of
 * reference/systolic.py's `simulate_rs`).
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { int, minus, signed } from "@/lib/format";
import { rsCaption } from "@/lib/sa/captionsB";
import { simulateRs, type Matrix } from "@/lib/sa/model";
import { rsDemo } from "@/lib/sa/views";
import { DATA_COLOUR, STATE_COLOUR } from "@/lib/viz/palette";

const VW = 640;
const n = (v: number) => minus(String(v));

export default function RsWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [hover, setHover] = useState<string | null>(null);
  const { x, f } = useMemo(rsDemo, []);
  const tr = useMemo(() => simulateRs(x, f), [x, f]);
  const st = useStepper(tr.cycles, { stepMs: 1000 });
  const t = st.step;
  const fr = tr.frames[t]!;
  const font = useSvgFont(VW);
  const fs = font.fs(12);

  // PEs
  const pw = 128;
  const ph = 64;
  const gx = (VW - tr.E * pw) / 2;
  const gy = 30;
  // matrices
  // phones: bigger cells, and the output on a second row
  const cs = font.narrow ? Math.max(26, fs * 2) : 26;
  const my = gy + tr.R * ph + 46;
  const reads = new Set<string>();
  const taps = new Set<string>();
  fr.pe.forEach((row, i) =>
    row.forEach(([col, tap, mac], j) => {
      if (mac !== null) {
        reads.add(`${i + j},${col! + tap!}`);
        taps.add(`${i},${tap}`);
      }
    }),
  );
  const written = new Set<string>();
  const done = new Set<string>();
  tr.frames.slice(0, t + 1).forEach((g, s) =>
    g.out.forEach(([j, c]) => {
      done.add(`${j},${c}`);
      if (s === t) written.add(`${j},${c}`);
    }),
  );
  const hl = hover ?? (fr.out.length ? "c" : "p");

  const matrix = (
    label: string,
    m: Matrix,
    ox: number,
    oy: number,
    colour: string,
    lit: Set<string>,
    shown?: Set<string>,
  ) => (
    <g>
      <text x={ox} y={oy - 8} fontSize={fs} fill="currentColor">
        {label}
      </text>
      {m.map((row, r) =>
        row.map((v, c) => {
          const on = lit.has(`${r},${c}`);
          const vis = !shown || shown.has(`${r},${c}`);
          return (
            <g key={`${r}-${c}`}>
              <rect
                x={ox + c * cs}
                y={oy + r * cs}
                width={cs - 2}
                height={cs - 2}
                rx={2}
                fill={colour}
                fillOpacity={vis ? (on ? 0.45 : 0.12) : 0.03}
                stroke={on ? STATE_COLOUR.active : "none"}
                strokeWidth={on ? 2 : 0}
              />
              {vis && (
                <text
                  x={ox + c * cs + cs / 2 - 1}
                  y={oy + r * cs + cs / 2 + fs * 0.33}
                  fontSize={font.fs(11)}
                  textAnchor="middle"
                  fill="currentColor"
                >
                  {n(v)}
                </text>
              )}
            </g>
          );
        }),
      )}
    </g>
  );
  const xw = x[0]!.length * cs;
  const fw = f[0]!.length * cs;
  const ow = tr.F * cs;
  const twoRows = font.narrow;
  const gapM = twoRows ? (VW - xw - fw) / 3 : (VW - xw - fw - ow) / 4;
  const oRowY = twoRows ? my + x.length * cs + fs * 2.5 : my;
  const oX = twoRows ? gapM : 3 * gapM + xw + fw;
  const vhRs = twoRows ? oRowY + tr.E * cs + 10 : my + x.length * cs + 10;

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${vhRs}`}
      className="w-full"
      role="img"
      aria-label={`Row-stationary convolution at cycle ${t + 1}`}
    >
      <text x={gx} y={gy - 10} fontSize={fs} fill="currentColor">
        PE(i, j): filter row i, input row i + j → output row j
      </text>
      {fr.pe.map((row, i) =>
        row.map(([col, tap, mac, acc, v], j) => {
          const px = gx + j * pw;
          const py = gy + i * ph;
          return (
            <g
              key={`${i}-${j}`}
              data-pe={`${i},${j}`}
              data-mac={mac ? "1" : undefined}
            >
              <rect
                x={px + 4}
                y={py + 4}
                width={pw - 8}
                height={ph - 14}
                rx={5}
                fill="currentColor"
                fillOpacity={0.04}
                stroke={mac ? STATE_COLOUR.active : "currentColor"}
                strokeOpacity={mac ? 1 : 0.3}
                strokeWidth={mac ? 2.5 : 1}
              />
              {mac && (
                <text
                  x={px + pw / 2}
                  y={py + 24}
                  fontSize={fs}
                  textAnchor="middle"
                  fill="currentColor"
                  fontFamily="ui-monospace, monospace"
                >
                  {font.narrow
                    ? `Σ ${n(acc!)}`
                    : `${n(mac[0])} × ${signed(mac[1])}, Σ ${n(acc!)}`}
                </text>
              )}
              {!mac && (
                <text
                  x={px + pw / 2}
                  y={py + 24}
                  fontSize={fs}
                  textAnchor="middle"
                  fill="currentColor"
                  opacity={0.5}
                >
                  {col === null ? "idle" : ""}
                </text>
              )}
              {!font.narrow && mac && (
                <text
                  x={px + pw / 2}
                  y={py + 42}
                  fontSize={font.fs(11)}
                  textAnchor="middle"
                  fill="currentColor"
                  opacity={0.75}
                >
                  {`col ${col}, tap ${tap! + 1}`}
                </text>
              )}
              {v !== null && (
                <g>
                  <line
                    x1={px + pw / 2}
                    x2={px + pw / 2}
                    y1={py + ph - 10}
                    y2={py + ph + 2}
                    stroke={i === tr.R - 1 ? DATA_COLOUR.c : DATA_COLOUR.psum}
                    strokeWidth={3}
                  />
                  <text
                    x={px + pw / 2 + 6}
                    y={py + ph}
                    fontSize={font.fs(11)}
                    fill="currentColor"
                  >
                    {n(v[0])}
                  </text>
                </g>
              )}
            </g>
          );
        }),
      )}
      {matrix("input x", x, gapM, my, DATA_COLOUR.a, reads)}
      {matrix("filter f", f, 2 * gapM + xw, my, DATA_COLOUR.b, taps)}
      {matrix("output o", tr.O, oX, oRowY, DATA_COLOUR.c, written, done)}
    </svg>
  );

  let busy = 0;
  for (const row of fr.pe) for (const c of row) if (c[2] !== null) busy++;
  return (
    <AnimationPanel
      testId="rs-widget"
      title="Row-stationary: a 2-D convolution, row by row"
      summary={`A ${tr.R} × ${tr.S} filter over a ${x.length} × ${x[0]!.length} input on ${tr.R} × ${tr.E} PEs: each keeps one filter row and one input row, and the columns sum the rows.`}
      stepper={st}
      stepLabel="cycle"
      caption={rsCaption(tr, t)}
      visual={visual}
      equation={children}
      hl={hl}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Busy PEs" value={`${busy} of ${tr.R * tr.E}`} />
          <Stat label="MACs so far" value={int(fr.cnt.macs)} />
          <Stat label="Partial sums passed" value={int(fr.cnt.psumHops)} />
          <Stat label="Outputs" value={`${fr.cnt.writes} of ${tr.E * tr.F}`} />
        </div>
      }
    />
  );
}
