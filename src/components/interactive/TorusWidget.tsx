"use client";

/**
 * Chapter 7: all-reduce on a 2-D torus. X × Y chips, each holding X·Y
 * numbers; every chip must end with the element-wise sum of all of them.
 * Each chip is drawn as its vector (a small grid of cells, one per number,
 * shaded by how many chips' numbers it already sums); the links that carry
 * data in this step are lit, wrap-around links included, and the cells
 * that just arrived are outlined. Every step is a frame of `allreduce`
 * (the TS port of reference/torus.py).
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Slider, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { PHASE_NAME, torusCaption } from "@/lib/sa/captionsB";
import { DEMO_TORUS, demoRun, stepsRing, stepsTorus } from "@/lib/sa/torus";
import { DATA_COLOUR, STATE_COLOUR } from "@/lib/viz/palette";

const VW = 640;

export default function TorusWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [xd, setX] = useState<number>(DEMO_TORUS.X);
  const [yd, setY] = useState<number>(DEMO_TORUS.Y);
  const [hover, setHover] = useState<string | null>(null);
  const run = useMemo(() => demoRun(xd, yd), [xd, yd]);
  const st = useStepper(run.frames.length, {
    stepMs: 1400,
    resetKey: `${xd}-${yd}`,
  });
  const f = run.frames[st.step]!;
  const font = useSvgFont(VW);
  const fs = font.fs(12);
  const chips = xd * yd;

  // x runs across, y down; the chip is a box with its vector inside
  const margin = 46;
  const pitch = Math.min(150, (VW - 2 * margin) / xd);
  const box = pitch * 0.7;
  const ox = (VW - pitch * xd) / 2 + (pitch - box) / 2;
  const oy = 50;
  const CX = (x: number) => ox + x * pitch;
  const CY = (y: number) => oy + y * pitch;
  const vecH = font.narrow ? 60 + fs * 3.6 : 70;
  const vh = oy + yd * pitch + vecH;
  // chip (0,0)'s vector, under the grid
  const vy = vh - vecH + (font.narrow ? fs * 1.6 : 8);
  const vx0 = font.narrow ? 8 : 100;
  const cell = (box - 8) / Math.max(xd, yd);
  const received = new Set<string>();
  for (const [, , dx, dy, chunks] of f.msgs)
    for (const c of chunks) received.add(`${dx},${dy},${c}`);
  const xPhase = f.phase.endsWith("x");
  const hl = hover ?? (f.phase === "start" ? "x" : xPhase ? "x" : "y");

  const links: JSX.Element[] = [];
  for (let x = 0; x < xd; x++)
    for (let y = 0; y < yd; y++) {
      for (const dir of ["x", "y"] as const) {
        const active = f.phase !== "start" && (dir === "x") === xPhase;
        const nx = dir === "x" ? (x + 1) % xd : x;
        const ny = dir === "y" ? (y + 1) % yd : y;
        const wrap = dir === "x" ? nx === 0 : ny === 0;
        // vertical links run at 80% across, clear of the chip labels
        const vx = box * 0.82;
        const sx = CX(x) + (dir === "x" ? box : vx);
        const sy = CY(y) + (dir === "y" ? box : box / 2);
        const ex = CX(nx) + (dir === "x" ? 0 : vx);
        const ey = CY(ny) + (dir === "y" ? 0 : box / 2);
        const colour = active ? STATE_COLOUR.active : "currentColor";
        const common = {
          fill: "none",
          stroke: colour,
          strokeOpacity: active ? 1 : 0.25,
          strokeWidth: active ? 2.5 : 1.2,
          strokeDasharray: wrap ? "5 3" : undefined,
          markerEnd: active ? "url(#torus-arrow)" : undefined,
        };
        // a wrap-around link is drawn as a stub leaving one edge of the
        // grid and a stub entering the opposite edge
        const st = (pitch - box) / 2 + 6;
        const d = wrap
          ? dir === "x"
            ? `M${sx} ${sy} L ${sx + st} ${sy} M ${ex - st} ${ey} L ${ex} ${ey}`
            : `M${sx} ${sy} L ${sx} ${sy + st} M ${ex} ${ey - st} L ${ex} ${ey}`
          : `M${sx} ${sy} L ${ex} ${ey}`;
        if (xd < 2 && dir === "x") continue;
        links.push(
          <path
            key={`${x}-${y}-${dir}`}
            d={d}
            {...common}
            data-active={active ? "1" : undefined}
          />,
        );
      }
    }

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${vh}`}
      className="mx-auto w-full max-w-2xl"
      role="img"
      aria-label={`${chips} chips on a ${xd} by ${yd} torus at step ${f.t}: ${PHASE_NAME[f.phase]}`}
    >
      <defs>
        <marker
          id="torus-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill={STATE_COLOUR.active} />
        </marker>
      </defs>
      {links}
      {f.state.map((col, x) =>
        col.map((chip, y) => (
          <g key={`${x}-${y}`} data-chip={`${x},${y}`}>
            <rect
              x={CX(x)}
              y={CY(y)}
              width={box}
              height={box}
              rx={6}
              fill="currentColor"
              fillOpacity={0.05}
              stroke="currentColor"
              strokeOpacity={0.4}
            />
            {chip.map(([, c], k) => {
              const g = Math.floor(k / yd);
              const j = k % yd;
              const got = received.has(`${x},${y},${k}`);
              return (
                <rect
                  key={k}
                  x={CX(x) + 4 + j * cell}
                  y={CY(y) + 4 + g * cell}
                  width={cell - 2}
                  height={cell - 2}
                  rx={1.5}
                  fill={DATA_COLOUR.c}
                  fillOpacity={0.12 + (0.88 * (c - 1)) / Math.max(1, chips - 1)}
                  stroke={got ? STATE_COLOUR.active : "none"}
                  strokeWidth={got ? 2 : 0}
                />
              );
            })}
            {!font.narrow && (
              <text
                x={CX(x) + box / 2}
                y={CY(y) + box + fs + 2}
                fontSize={fs}
                textAnchor="middle"
                fill="currentColor"
              >
                {`(${x},${y})`}
              </text>
            )}
          </g>
        )),
      )}
      <text x={8} y={18} fontSize={fs} fill="currentColor">
        {`x →  (${xd} chips)`}
      </text>
      {/* chip (0,0)'s vector: label above the strip on phones */}
      <text
        x={8}
        y={font.narrow ? vy - 8 : vy + 18}
        fontSize={fs}
        fill="currentColor"
      >
        chip (0,0):
      </text>
      {f.state[0]![0]!.map(([v, c], k) => {
        const w = (VW - vx0 - 10) / chips;
        return (
          <g key={k}>
            <rect
              x={vx0 + k * w}
              y={vy}
              width={w - 2}
              height={26}
              rx={2}
              fill={DATA_COLOUR.c}
              fillOpacity={0.12 + (0.88 * (c - 1)) / Math.max(1, chips - 1)}
              stroke={c === chips ? STATE_COLOUR.active : "none"}
            />
            {w >= 2.2 * fs && (
              <text
                x={vx0 + k * w + w / 2 - 1}
                y={vy + 18}
                fontSize={fs}
                textAnchor="middle"
                fill="currentColor"
              >
                {v}
              </text>
            )}
          </g>
        );
      })}
      {(font.narrow
        ? ["shade: how many chips' numbers a cell sums", "outlined: finished"]
        : ["shade = how many chips' numbers a cell sums; outlined = finished"]
      ).map((line, k, all) => (
        <text
          key={k}
          x={vx0}
          y={vh - 10 - (all.length - 1 - k) * fs * 1.2}
          fontSize={fs}
          fill="currentColor"
          opacity={0.8}
        >
          {line}
        </text>
      ))}
    </svg>
  );

  return (
    <AnimationPanel
      testId="torus-widget"
      title="All-reduce on a 2-D torus"
      summary={`${chips} chips on a ${xd} × ${yd} torus: dashed stubs are the wrap-around links, leaving one edge of the grid and entering the opposite one. Each holds ${chips} numbers; afterwards every chip holds the sum of all ${chips} vectors.`}
      stepper={st}
      stepLabel="step"
      countFrom={0}
      caption={torusCaption(f, xd, yd)}
      visual={visual}
      equation={children}
      hl={hl}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Phase" value={PHASE_NAME[f.phase]} />
          <Stat label="Numbers sent per chip" value={String(f.sent / chips)} />
          <Stat label="Steps, torus" value={String(stepsTorus(xd, yd))} />
          <Stat
            label="Steps, one ring"
            value={String(stepsRing(chips))}
            hint={`through all ${chips} chips`}
          />
        </div>
      }
      params={
        <>
          <Slider
            label="X (chips across)"
            value={xd}
            min={2}
            max={4}
            onChange={setX}
          />
          <Slider
            label="Y (chips down)"
            value={yd}
            min={2}
            max={4}
            onChange={setY}
          />
        </>
      }
    />
  );
}
