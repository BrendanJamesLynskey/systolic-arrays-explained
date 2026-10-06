"use client";

/**
 * The hero: data pulsing through a 4 × 4 weight-stationary array. Each
 * frame is the model's (`simulate`); between two frames every value glides
 * from the register it was in to the one it is latched into, and a PE that
 * multiplies glows. No numbers: chapter 2 has them.
 */
import { useMemo } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { geometry } from "@/components/viz/ArrayView";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { heroCaption } from "@/lib/sa/captions";
import { DEMO, demoPair, simulate, type Frame } from "@/lib/sa/model";
import { DATA_COLOUR, STATE_COLOUR } from "@/lib/viz/palette";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export default function HeroWidget({
  testId = "hero-widget",
}: {
  testId?: string;
}): JSX.Element {
  const { M, K, N } = DEMO.hero;
  const trace = useMemo(() => {
    const [a, b] = demoPair(M, K, N);
    return simulate("ws", a, b, K, N);
  }, [M, K, N]);
  const st = useStepper(trace.cycles, { stepMs: 650, smooth: true });
  const g = geometry(K, N, false, 0);
  const font = useSvgFont(g.vw);
  const cs = g.cs;
  const cur: Frame = trace.frames[st.step]!;
  const next: Frame | undefined = trace.frames[st.step + 1];
  const t = next ? st.frac : 0;
  const shown = next && t > 0 ? next : cur;
  const cx = (c: number) => g.x(c) + cs / 2;
  const cy = (r: number) => g.y(r) + cs / 2;

  const tokens: JSX.Element[] = [];
  shown.pe.forEach((row, r) =>
    row.forEach((cell, c) => {
      const moving = shown === next;
      if (cell[0] !== null && shown.phase === "load") {
        const y0 = r === 0 ? g.qh - 14 : cy(r - 1) - 12;
        tokens.push(
          <rect
            key={`s${r}-${c}`}
            x={cx(c) - 12}
            y={(moving ? lerp(y0, cy(r) - 12, t) : cy(r) - 12) - 3}
            width={24}
            height={6}
            rx={2}
            fill={DATA_COLOUR.b}
          />,
        );
      } else if (cell[0] !== null) {
        tokens.push(
          <rect
            key={`s${r}-${c}`}
            x={cx(c) - 12}
            y={cy(r) - 15}
            width={24}
            height={6}
            rx={2}
            fill={DATA_COLOUR.b}
          />,
        );
      }
      if (cell[1] !== null) {
        const x0 = c === 0 ? g.x(0) - 14 : cx(c - 1);
        tokens.push(
          <circle
            key={`h${r}-${c}`}
            cx={moving ? lerp(x0, cx(c), t) : cx(c)}
            cy={cy(r) + 2}
            r={6}
            fill={DATA_COLOUR.a}
          />,
        );
      }
      if (cell[2] !== null) {
        const y0 = r === 0 ? cy(0) : cy(r - 1) + 10;
        tokens.push(
          <circle
            key={`v${r}-${c}`}
            cx={cx(c) + 8}
            cy={moving ? lerp(y0, cy(r) + 10, t) : cy(r) + 10}
            r={5}
            fill={DATA_COLOUR.psum}
            opacity={r === 0 && moving ? t : 1}
          />,
        );
      }
    }),
  );
  const outs = shown.out.map(([m, n]) => (
    <circle
      key={`o${m}-${n}`}
      cx={cx(n) + 8}
      cy={g.y(K - 1) + cs + 8 * (shown === next ? t : 1)}
      r={6}
      fill={DATA_COLOUR.c}
    />
  ));

  return (
    <AnimationPanel
      testId={testId}
      title="Data pulsing through a 4 × 4 systolic array"
      summary={`Weight-stationary: ${M} rows of A stream through ${K} × ${N} stationary weights. Each glide is one clock cycle of the model.`}
      stepper={st}
      stepLabel="cycle"
      caption={heroCaption(cur, K * N)}
      visual={
        <svg
          ref={font.ref}
          viewBox={`0 0 ${g.vw} ${g.vh}`}
          className="mx-auto w-full max-w-md"
          role="img"
          aria-label="A 4 by 4 grid of processing elements; blue activations move right, sky-blue partial sums move down, purple results leave the bottom"
        >
          {Array.from({ length: K }, (_, r) =>
            Array.from({ length: N }, (_, c) => {
              const mac =
                (shown.pe[r]![c]![4] !== null ? (shown === next ? t : 1) : 0) *
                0.9;
              return (
                <g key={`pe${r}-${c}`}>
                  {c < N - 1 && (
                    <line
                      x1={g.x(c) + cs}
                      x2={g.x(c + 1)}
                      y1={cy(r)}
                      y2={cy(r)}
                      stroke="currentColor"
                      strokeOpacity={0.25}
                    />
                  )}
                  {r < K - 1 && (
                    <line
                      x1={cx(c)}
                      x2={cx(c)}
                      y1={g.y(r) + cs}
                      y2={g.y(r + 1)}
                      stroke="currentColor"
                      strokeOpacity={0.25}
                    />
                  )}
                  <rect
                    x={g.x(c)}
                    y={g.y(r)}
                    width={cs}
                    height={cs}
                    rx={6}
                    fill={STATE_COLOUR.active}
                    fillOpacity={0.04 + 0.2 * mac}
                    stroke={mac > 0.45 ? STATE_COLOUR.active : "currentColor"}
                    strokeOpacity={mac > 0.45 ? 1 : 0.35}
                    strokeWidth={mac > 0.45 ? 2.5 : 1}
                  />
                </g>
              );
            }),
          )}
          {tokens}
          {outs}
        </svg>
      }
    />
  );
}
