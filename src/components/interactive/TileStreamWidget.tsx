"use client";

/**
 * Chapter 5: a GEMM too big for the array, run as weight-stationary tiles
 * back to back. Top: the array in this cycle, every PE with its stationary
 * weight (filled), its shadow weight (dashed: the next tile, shifting in
 * while this one computes) and the activation passing through. Bottom: the
 * tiles' timeline (fetch from HBM, load into the shadow registers, stream,
 * drain) with the current cycle marked. Every frame is a cycle of
 * `simulateWsStream` (the TS port of reference/systolic.py), which checks
 * as it runs that every PE swaps in the right weight in time.
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Slider, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { int, minus, pct } from "@/lib/format";
import { streamCaption, tileActivity } from "@/lib/sa/captionsB";
import { DEMO, demoPair, utilisation } from "@/lib/sa/model";
import { simulateWsStream, streamSchedule } from "@/lib/sa/stream";
import {
  DATA_COLOUR,
  LEVEL_COLOUR,
  MUTED,
  STATE_COLOUR,
} from "@/lib/viz/palette";

const VW = 640;
const n = (v: number) => minus(String(v));

export default function TileStreamWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const S = DEMO.stream;
  const [m, setM] = useState<number>(S.M);
  const [shadow, setShadow] = useState<"on" | "off">("on");
  const [bw, setBw] = useState<number>(0);
  const [buffers, setBuffers] = useState<number>(2);
  const [hover, setHover] = useState<string | null>(null);
  const R = S.array;
  const trace = useMemo(() => {
    const [a, b] = demoPair(m, S.K, S.N);
    return simulateWsStream(a, b, R, R, bw || null, buffers, shadow === "on");
  }, [m, shadow, bw, buffers, R, S.K, S.N]);
  const seq = useMemo(
    () => streamSchedule(m, S.K, S.N, R, R, bw || null, buffers, false).cycles,
    [m, bw, buffers, R, S.K, S.N],
  );
  const st = useStepper(trace.cycles, {
    stepMs: 650,
    resetKey: `${m}-${shadow}-${bw}-${buffers}`,
  });
  const t = st.step;
  const f = trace.frames[t]!;
  const font = useSvgFont(VW);
  const fs = font.fs(13);
  const small = font.fs(11);
  const act = tileActivity(trace, t);
  const hl =
    hover ??
    (act.some((x) => x.what === "stream")
      ? "a"
      : act.some((x) => x.what === "load")
        ? "w"
        : act.some((x) => x.what === "fetch")
          ? "bw"
          : "c");

  // the array
  // phones: bigger PEs and timeline rows, so labels stay >= 11 px
  const cs = font.narrow ? 150 : 86;
  const gap = font.narrow ? 24 : 18;
  const ax = (VW - (R * cs + (R - 1) * gap)) / 2;
  const ay = 22;
  const X = (q: number) => ax + q * (cs + gap);
  const Y = (r: number) => ay + r * (cs + gap);
  // the timeline
  const g0 = ay + R * cs + (R - 1) * gap + 46;
  const rowH = font.narrow ? 44 : 26;
  const gl = font.narrow ? 100 : 70;
  const gw = VW - gl - 12;
  const T = trace.cycles;
  const cx = (c: number) => gl + (c / T) * gw;
  const ts = trace.schedule.tiles;
  const vh = g0 + ts.length * rowH + 56;

  const bar = (
    key: string,
    from: number,
    to: number,
    row: number,
    colour: string,
    label: string,
    dashed = false,
    lower = false,
  ) =>
    to > from && (
      <rect
        key={key}
        x={cx(from)}
        y={g0 + row * rowH + 3 + (lower ? (rowH - 6) / 2 : 0)}
        width={Math.max(1, cx(to) - cx(from))}
        height={(rowH - 6) / 2 - 1}
        rx={2}
        fill={colour}
        fillOpacity={dashed ? 0.25 : 0.85}
        stroke={colour}
        strokeDasharray={dashed ? "3 2" : undefined}
      >
        <title>{label}</title>
      </rect>
    );

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${vh}`}
      className="mx-auto w-full max-w-2xl"
      role="img"
      aria-label={`A ${R} by ${R} weight-stationary array at cycle ${t + 1}, and the timeline of its ${ts.length} weight tiles`}
    >
      <defs>
        <pattern
          id="ts-idle"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke={MUTED.light}
            strokeWidth="1.5"
          />
        </pattern>
      </defs>
      {/* activations waiting at the left edge */}
      {f.inL.map(
        (h, r) =>
          h !== null && (
            <g key={`l${r}`}>
              <line
                x1={ax - 26}
                x2={ax - 4}
                y1={Y(r) + cs / 2}
                y2={Y(r) + cs / 2}
                stroke={DATA_COLOUR.a}
                strokeWidth={2}
              />
              <circle
                cx={ax - 30}
                cy={Y(r) + cs / 2}
                r={6}
                fill={DATA_COLOUR.a}
              />
            </g>
          ),
      )}
      {f.inT.map(
        (w, q) =>
          w !== null && (
            <line
              key={`t${q}`}
              x1={X(q) + cs / 2}
              x2={X(q) + cs / 2}
              y1={ay - 18}
              y2={ay - 2}
              stroke={DATA_COLOUR.b}
              strokeWidth={3}
            />
          ),
      )}
      {f.pe.map((row, r) =>
        row.map((cell, q) => {
          const [s, h, , sh, mac] = cell;
          const x = X(q);
          const y = Y(r);
          const idle = s === null && sh === null;
          return (
            <g
              key={`${r}-${q}`}
              data-pe={`${r},${q}`}
              data-mac={mac !== null ? "1" : undefined}
            >
              <rect
                x={x}
                y={y}
                width={cs}
                height={cs}
                rx={6}
                fill={idle ? "url(#ts-idle)" : "currentColor"}
                fillOpacity={idle ? 1 : 0.04}
                stroke={mac !== null ? STATE_COLOUR.active : "currentColor"}
                strokeOpacity={mac !== null ? 1 : 0.3}
                strokeWidth={mac !== null ? 3 : 1}
              />
              {s !== null && (
                <g>
                  <rect
                    x={x + 6}
                    y={y + 6}
                    width={cs - 12}
                    height={cs / 2 - 9}
                    rx={4}
                    fill={DATA_COLOUR.b}
                    fillOpacity={0.22}
                    stroke={DATA_COLOUR.b}
                    strokeWidth={1.5}
                  />
                  <text
                    x={x + cs / 2}
                    y={y + 6 + (cs / 2 - 9) / 2 + fs * 0.35}
                    textAnchor="middle"
                    fontSize={fs}
                    fill="currentColor"
                    fontFamily="ui-monospace, monospace"
                  >
                    {font.narrow ? `T${s[3] + 1}` : `T${s[3] + 1}: ${n(s[0])}`}
                  </text>
                </g>
              )}
              {sh !== null && (
                <g>
                  <rect
                    x={x + 6}
                    y={y + cs / 2 + 3}
                    width={cs - 12}
                    height={cs / 2 - 9}
                    rx={4}
                    fill="none"
                    stroke={DATA_COLOUR.b}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={x + cs / 2}
                    y={y + cs / 2 + 3 + (cs / 2 - 9) / 2 + small * 0.35}
                    textAnchor="middle"
                    fontSize={small}
                    fill="currentColor"
                  >
                    {`T${sh[3] + 1}`}
                  </text>
                </g>
              )}
              {h !== null && (
                <circle
                  cx={x + 2}
                  cy={y + cs / 2}
                  r={7}
                  fill={DATA_COLOUR.a}
                  stroke="#fff"
                  strokeWidth={1.5}
                >
                  <title>{`a${h[1]},${h[2]} = ${h[0]}`}</title>
                </circle>
              )}
            </g>
          );
        }),
      )}
      {f.out.length > 0 && (
        <text
          x={VW / 2}
          y={g0 - 14}
          textAnchor="middle"
          fontSize={small}
          fill="currentColor"
        >
          {`${f.out.length} result${f.out.length === 1 ? "" : "s"} out ↓`}
        </text>
      )}

      {/* the timeline */}
      {ts.map((tl, j) => (
        <g key={`row${j}`}>
          <text
            x={gl - 8}
            y={g0 + j * rowH + rowH / 2 + small * 0.35}
            textAnchor="end"
            fontSize={small}
            fill="currentColor"
          >
            {`tile ${j + 1}`}
          </text>
          {tl.fetch &&
            bar(
              `f${j}`,
              tl.fetch[0],
              tl.fetch[1],
              j,
              LEVEL_COLOUR.hbm,
              "fetch from HBM",
              true,
            )}
          {bar(
            `l${j}`,
            tl.load,
            tl.loadEnd + 1,
            j,
            DATA_COLOUR.b,
            "load into the shadow registers",
          )}
          {bar(
            `s${j}`,
            tl.stream,
            tl.stream + m,
            j,
            DATA_COLOUR.a,
            "stream the rows of A",
            false,
            true,
          )}
          {bar(
            `d${j}`,
            tl.stream + m,
            tl.end,
            j,
            DATA_COLOUR.psum,
            "drain",
            false,
            true,
          )}
        </g>
      ))}
      <rect
        x={cx(t)}
        y={g0 - 4}
        width={Math.max(2, cx(t + 1) - cx(t))}
        height={ts.length * rowH + 8}
        fill={STATE_COLOUR.active}
        fillOpacity={0.18}
        stroke={STATE_COLOUR.active}
      />
      <text
        x={VW - 12}
        y={g0 + ts.length * rowH + 22}
        textAnchor="end"
        fontSize={small}
        fill="currentColor"
      >
        {`cycle → (${T})`}
      </text>
      {[
        ["fetch", LEVEL_COLOUR.hbm],
        ["load", DATA_COLOUR.b],
        ["stream", DATA_COLOUR.a],
        ["drain", DATA_COLOUR.psum],
      ].map(([label, colour], i) => (
        <g
          key={label}
          transform={`translate(${gl + i * (gw / 4)}, ${g0 + ts.length * rowH + 34})`}
        >
          <rect width={14} height={12} y={-1} fill={colour} rx={2} />
          <text x={20} y={10} fontSize={small} fill="currentColor">
            {label}
          </text>
        </g>
      ))}
    </svg>
  );

  const macs = m * S.K * S.N;
  return (
    <AnimationPanel
      testId="tile-stream-widget"
      title="Tiles back to back, double-buffered"
      summary={`A ${m} × ${S.K} times B ${S.K} × ${S.N} on a ${R} × ${R} weight-stationary array: ${ts.length} weight tiles. Filled: the weight a PE uses; dashed: the next tile's weight shifting in behind it.`}
      stepper={st}
      stepLabel="cycle"
      caption={streamCaption(trace, t)}
      visual={visual}
      equation={children}
      hl={hl}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Cycles" value={int(trace.cycles)} />
          <Stat label="Tiles in sequence" value={int(seq)} hint="no overlap" />
          <Stat
            label="Utilisation"
            value={pct(utilisation(macs, R, R, trace.cycles), 0)}
          />
          <Stat
            label="MACs so far"
            value={`${int(f.cnt.macs)} of ${int(macs)}`}
          />
        </div>
      }
      params={
        <>
          <Slider
            label="M (rows of A per tile)"
            value={m}
            min={S.mRange[0]}
            max={S.mRange[1]}
            onChange={setM}
          />
          <Segmented
            label="Weight registers"
            value={shadow}
            options={[
              { value: "on", label: "double (shadow)" },
              { value: "off", label: "single" },
            ]}
            onChange={setShadow}
          />
          <Segmented
            label="HBM words per cycle"
            value={String(bw)}
            options={S.bws.map((v) => ({
              value: String(v),
              label: v === 0 ? "on chip" : String(v),
            }))}
            onChange={(v) => setBw(Number(v))}
          />
          {bw > 0 && (
            <Segmented
              label="Weight buffers"
              value={String(buffers)}
              options={[
                { value: "1", label: "one" },
                { value: "2", label: "two (ping-pong)" },
              ]}
              onChange={(v) => setBuffers(Number(v))}
            />
          )}
        </>
      }
    />
  );
}
