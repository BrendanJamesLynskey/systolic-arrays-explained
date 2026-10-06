"use client";

/**
 * One frame of the cycle-accurate model, drawn: the grid of PEs with every
 * register's value, the links that carried data in this cycle, the
 * staircase of inputs waiting at the edges (the skew), and the results
 * leaving the array. A pure function of (trace, step): nothing here is
 * keyframed by hand.
 *
 * Colours (src/lib/viz/palette.ts): A blue, B (weights) vermillion,
 * partial sums sky, results purple. A PE that multiplied in this cycle has
 * a thick outline; a PE outside the block the problem uses is idle, grey
 * and hatched.
 */
import { useEffect, useId, useState } from "react";

import { minus } from "@/lib/format";
import type { Frame, OpTag, SumTag, Trace } from "@/lib/sa/model";
import { DATA_COLOUR, MUTED, STATE_COLOUR } from "@/lib/viz/palette";

import { useSvgFont } from "./useSvgFont";

const n = (v: number) => minus(String(v));

export type ArrayGeom = {
  cs: number;
  gap: number;
  qw: number;
  qh: number;
  slot: number;
  tslot: number;
  ob: number;
  vw: number;
  vh: number;
  x: (c: number) => number;
  y: (r: number) => number;
};

export function geometry(
  rows: number,
  cols: number,
  numbers: boolean,
  queue = 3,
  /** Inputs queued above the array (output-stationary streams B there). */
  topQueue = queue,
): ArrayGeom {
  const cs = numbers ? 76 : 40;
  const gap = numbers ? 22 : 14;
  const slot = numbers ? 34 : 16;
  const tslot = numbers ? 26 : 14;
  const qw = 16 + (numbers ? 40 : 12) + queue * slot;
  const qh = 16 + (numbers ? 22 : 12) + topQueue * tslot;
  const ob = numbers ? 40 : 22;
  const vw = qw + cols * cs + (cols - 1) * gap + 10;
  const vh = qh + rows * cs + (rows - 1) * gap + ob;
  return {
    cs,
    gap,
    qw,
    qh,
    slot,
    tslot,
    ob,
    vw,
    vh,
    x: (c) => qw + c * (cs + gap),
    y: (r) => qh + r * (cs + gap),
  };
}

function Pill({
  x,
  y,
  w,
  h,
  colour,
  text,
  fs,
  opacity = 1,
  label,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  text: string;
  fs: number;
  opacity?: number;
  label?: string;
}): JSX.Element {
  return (
    <g opacity={opacity}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        fill={colour}
        fillOpacity={0.22}
        stroke={colour}
        strokeWidth={1.5}
      />
      <text
        x={x + w / 2}
        y={y + h / 2 + fs * 0.35}
        textAnchor="middle"
        fontSize={fs}
        fill="currentColor"
        fontFamily="ui-monospace, monospace"
      >
        {label ? (
          <tspan fontSize={fs * 0.75} opacity={0.75}>
            {label}
          </tspan>
        ) : null}
        {text}
      </text>
    </g>
  );
}

export function ArrayView({
  trace,
  step,
  numbers = true,
  queue = 3,
  hl,
  ariaLabel,
}: {
  trace: Trace;
  step: number;
  numbers?: boolean;
  queue?: number;
  /** The equation term being hovered: a, w, b, p, acc or c. */
  hl?: string | null;
  ariaLabel: string;
}): JSX.Element {
  const hatchId = useId().replace(/:/g, "");
  const f: Frame = trace.frames[step]!;
  const { rows, cols, dataflow: df } = trace;
  // phones: one queued input per edge, so the PEs (and their numbers) get
  // the width; the font hook keeps every label at least 11 px
  const [narrow, setNarrow] = useState(false);
  const q = narrow ? Math.min(queue, 1) : queue;
  const topQueue = df === "os" ? q : 0;
  const g = geometry(rows, cols, numbers, q, topQueue);
  const font = useSvgFont(g.vw);
  useEffect(() => {
    // decide once from the full-width layout's scale (no oscillation)
    if (!narrow && font.scale < 0.8) setNarrow(true);
  }, [font.scale, narrow]);
  const fs = font.fs(numbers ? 13 : 10);
  // register pills grow with the font (phones)
  const ph = Math.max(20, fs + 5);
  const cs = g.cs;
  const vColour = df === "os" ? DATA_COLOUR.b : DATA_COLOUR.psum;
  const hColour = df === "is" ? DATA_COLOUR.b : DATA_COLOUR.a;
  const sColour = df === "is" ? DATA_COLOUR.a : DATA_COLOUR.b;
  const used = (r: number, c: number) => {
    const blk =
      df === "ws"
        ? [trace.K, trace.N]
        : df === "os"
          ? [trace.M, trace.N]
          : [trace.K, trace.M];
    return r < blk[0]! && c < blk[1]!;
  };
  const dim = (key: string) => (hl && hl !== key ? 0.35 : 1);
  const hKey = df === "is" ? "b" : "a";
  const sKey = df === "is" ? "a" : "w";
  const vKey = df === "os" ? "b" : "p";

  // the inputs still to come at each edge: the skew staircase
  const upcomingL: (OpTag | null)[][] = [];
  const upcomingT: (OpTag | null)[][] = [];
  for (let d = 1; d <= q; d++) {
    const ff = trace.frames[step + d];
    upcomingL.push(ff ? ff.inL : new Array(rows).fill(null));
    if (d <= topQueue) upcomingT.push(ff ? ff.inT : new Array(cols).fill(null));
  }
  const slot = g.slot;
  const pill = numbers ? { w: 40, h: Math.max(22, fs + 6) } : { w: 12, h: 12 };

  return (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${g.vw} ${g.vh}`}
      className="mx-auto w-full"
      style={{ maxWidth: `${Math.round(g.vw * 1.25)}px` }}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <pattern
          id={hatchId}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={6}
            stroke={MUTED.light}
            strokeWidth={1.5}
          />
        </pattern>
      </defs>

      {/* links: right and down; bright when they carried data this cycle */}
      {f.pe.map((row, r) =>
        row.map((cell, c) => {
          const out: JSX.Element[] = [];
          const x = g.x(c);
          const y = g.y(r);
          const hOn = cell[1] !== null;
          const vOn = cell[2] !== null && (df === "os" || r > 0);
          // arrow into this PE from the left (or from the edge)
          out.push(
            <line
              key={`h${r}-${c}`}
              x1={x - (c === 0 ? 10 : g.gap)}
              x2={x}
              y1={y + cs / 2}
              y2={y + cs / 2}
              stroke={hOn ? hColour : "currentColor"}
              strokeOpacity={hOn ? dim(hKey) : 0.2}
              strokeWidth={hOn ? 3 : 1}
            />,
          );
          if (df === "os" || r > 0 || f.phase === "load")
            out.push(
              <line
                key={`v${r}-${c}`}
                x1={x + cs / 2}
                x2={x + cs / 2}
                y1={y - (r === 0 ? 10 : g.gap)}
                y2={y}
                stroke={
                  f.phase === "load"
                    ? cell[0] !== null
                      ? sColour
                      : "currentColor"
                    : vOn
                      ? vColour
                      : "currentColor"
                }
                strokeOpacity={
                  (f.phase === "load" ? cell[0] !== null : vOn) ? 1 : 0.2
                }
                strokeWidth={
                  (f.phase === "load" ? cell[0] !== null : vOn) ? 3 : 1
                }
              />,
            );
          return out;
        }),
      )}

      {/* PEs */}
      {f.pe.map((row, r) =>
        row.map((cell, c) => {
          const x = g.x(c);
          const y = g.y(r);
          const idle = !used(r, c);
          const mac = cell[4] !== null;
          return (
            <g key={`pe${r}-${c}`} data-pe={`${r},${c}`} data-mac={mac ? 1 : 0}>
              <rect
                x={x}
                y={y}
                width={cs}
                height={cs}
                rx={6}
                fill={idle ? `url(#${hatchId})` : "currentColor"}
                fillOpacity={idle ? 1 : mac ? 0.1 : 0.04}
                stroke={mac ? STATE_COLOUR.active : "currentColor"}
                strokeOpacity={mac ? 1 : 0.35}
                strokeWidth={mac ? 3 : 1}
              />
              {numbers && !idle && (
                <>
                  {cell[0] !== null && (
                    <g opacity={dim(sKey)}>
                      <Pill
                        x={x + 4}
                        y={y + 4}
                        w={cs - 8}
                        h={ph}
                        colour={sColour}
                        text={n(cell[0][0])}
                        label={narrow ? undefined : df === "ws" ? "w " : "a "}
                        fs={fs}
                      />
                    </g>
                  )}
                  {cell[1] !== null && (
                    <g opacity={dim(hKey)}>
                      <Pill
                        x={x + 4}
                        y={y + cs / 2 - ph / 2}
                        w={cs / 2 - 6}
                        h={ph}
                        colour={hColour}
                        text={n(cell[1][0])}
                        fs={fs}
                      />
                    </g>
                  )}
                  {df === "os" && cell[2] !== null && (
                    <g opacity={dim(vKey)}>
                      <Pill
                        x={x + cs / 2 + 2}
                        y={y + 4}
                        w={cs / 2 - 6}
                        h={ph}
                        colour={DATA_COLOUR.b}
                        text={n(cell[2][0])}
                        fs={fs}
                      />
                    </g>
                  )}
                  {df !== "os" && cell[2] !== null && (
                    <g opacity={dim("p")}>
                      <Pill
                        x={x + 4}
                        y={y + cs - ph - 4}
                        w={cs - 8}
                        h={ph}
                        colour={DATA_COLOUR.psum}
                        text={n((cell[2] as SumTag)[0])}
                        label={narrow ? undefined : "p "}
                        fs={fs}
                      />
                    </g>
                  )}
                  {cell[3] !== null && (
                    <g opacity={dim("acc")}>
                      <Pill
                        x={x + 4}
                        y={y + cs - ph - 4}
                        w={cs - 8}
                        h={ph}
                        colour={DATA_COLOUR.psum}
                        text={n(cell[3][0])}
                        label={narrow ? undefined : "c "}
                        fs={fs}
                      />
                    </g>
                  )}
                  {mac && (
                    <text
                      x={x + cs - 6}
                      y={y + cs / 2 + fs * 0.35}
                      textAnchor="end"
                      fontSize={fs}
                      fill="currentColor"
                      fontWeight={700}
                    >
                      ×
                    </text>
                  )}
                </>
              )}
              {!numbers && !idle && (
                <>
                  {cell[0] !== null && (
                    <rect
                      x={x + 3}
                      y={y + 3}
                      width={cs - 6}
                      height={6}
                      rx={2}
                      fill={sColour}
                    />
                  )}
                  {cell[1] !== null && (
                    <circle
                      cx={x + cs * 0.3}
                      cy={y + cs / 2}
                      r={5}
                      fill={hColour}
                    />
                  )}
                  {cell[2] !== null && (
                    <circle
                      cx={x + cs * 0.7}
                      cy={y + cs / 2 + (df === "os" ? -6 : 8)}
                      r={5}
                      fill={vColour}
                    />
                  )}
                  {cell[3] !== null && (
                    <rect
                      x={x + 3}
                      y={y + cs - 9}
                      width={
                        ((cs - 6) * Math.min(cell[3][3], trace.K)) / trace.K
                      }
                      height={6}
                      rx={2}
                      fill={DATA_COLOUR.psum}
                    />
                  )}
                </>
              )}
            </g>
          );
        }),
      )}

      {/* edge inputs this cycle, and the staircase of those to come */}
      {f.inL.map((tag, r) =>
        tag === null ? null : (
          <g key={`inL${r}`} opacity={dim(hKey)}>
            <Pill
              x={g.qw - pill.w - 12}
              y={g.y(r) + cs / 2 - pill.h / 2}
              w={pill.w}
              h={pill.h}
              colour={hColour}
              text={numbers ? n(tag[0]) : ""}
              fs={fs}
            />
          </g>
        ),
      )}
      {upcomingL.map((col, d) =>
        col.map((tag, r) =>
          tag === null ? null : (
            <g key={`qL${d}-${r}`} opacity={0.45 * dim(hKey)}>
              <Pill
                x={g.qw - pill.w - 12 - (d + 1) * slot + 2}
                y={g.y(r) + cs / 2 - pill.h / 2}
                w={slot - 4}
                h={pill.h}
                colour={hColour}
                text={numbers ? n(tag[0]) : ""}
                fs={fs}
              />
            </g>
          ),
        ),
      )}
      {f.inT.map((tag, c) =>
        tag === null ? null : (
          <g key={`inT${c}`} opacity={dim(f.phase === "load" ? sKey : vKey)}>
            <Pill
              x={g.x(c) + cs / 2 - pill.w / 2}
              y={g.qh - pill.h - 12}
              w={pill.w}
              h={pill.h}
              colour={f.phase === "load" ? sColour : DATA_COLOUR.b}
              text={numbers ? n(tag[0]) : ""}
              fs={fs}
            />
          </g>
        ),
      )}
      {upcomingT.map((row, d) =>
        row.map((tag, c) =>
          tag === null ? null : (
            <g key={`qT${d}-${c}`} opacity={0.45}>
              <rect
                x={g.x(c) + cs / 2 - 6}
                y={g.qh - pill.h - 12 - (d + 1) * g.tslot}
                width={12}
                height={g.tslot - 6}
                rx={3}
                fill={
                  trace.frames[step + d + 1]?.phase === "load"
                    ? sColour
                    : DATA_COLOUR.b
                }
                fillOpacity={0.5}
              />
            </g>
          ),
        ),
      )}

      {/* results leaving the array in this cycle */}
      {f.out.map(([m, nn, v]) => {
        const c = df === "is" ? m : nn;
        return (
          <g key={`out${m}-${nn}`} opacity={dim("c")}>
            <Pill
              x={g.x(c) + cs / 2 - pill.w / 2}
              y={g.y(rows - 1) + cs + (numbers ? 10 : 5)}
              w={pill.w}
              h={pill.h}
              colour={DATA_COLOUR.c}
              text={numbers ? n(v) : ""}
              fs={fs}
            />
          </g>
        );
      })}
    </svg>
  );
}
