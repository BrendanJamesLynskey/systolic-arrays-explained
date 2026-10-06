"use client";

/**
 * Chapter 9: an ONNX graph lowered onto the array. Top: the graph (Conv →
 * Relu → Flatten → Gemm), the node being lowered lit, and the unit each
 * runs on. Middle: the Conv's im2col, one output pixel per step (the 3 × 3
 * patch of every input channel it sees becomes one row of A), then its
 * GEMM cut into weight tiles, one per step. Bottom: each array layer's
 * cycles, from the cycle-accurate model (tiles back to back, and in
 * sequence) and from Torch_Sim_Frontend's cycle-approximate formula. Every
 * step is one of `lowerSteps` (the TS port of reference/lower.py); the
 * convolution's numbers are `runConv`'s, which equal a direct convolution.
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { int, pct } from "@/lib/format";
import { lowerCaption } from "@/lib/sa/captionsB";
import { TINY_CNN, lower, lowerSteps, runConv } from "@/lib/sa/lower";
import { DATA_COLOUR, MUTED, STATE_COLOUR } from "@/lib/viz/palette";

const VW = 640;
const ARRAYS = [4, 8, 16] as const;

export default function LowerWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [rows, setRows] = useState<number>(8);
  const [hover, setHover] = useState<string | null>(null);
  const layers = useMemo(() => lower(TINY_CNN, rows, rows), [rows]);
  const steps = useMemo(() => lowerSteps(TINY_CNN, rows, rows), [rows]);
  const conv = useMemo(() => runConv(TINY_CNN, 8, 8), []);
  const st = useStepper(steps.length, { stepMs: 450, resetKey: String(rows) });
  const s = steps[st.step]!;
  const font = useSvgFont(VW);
  const fs = font.fs(12);
  const L0 = layers[0]!;
  const [, M, K, N] = L0.gemm!;
  const kernel = TINY_CNN.convWeight[0]![0]!.length;
  const outW = TINY_CNN.shapes.conv_out![3]!;
  const ch = conv.x.length;
  const H = conv.x[0]!.length;

  // the graph strip
  const nodes = layers.map((l) => l);
  const nw = (VW - 20) / nodes.length;
  // im2col / GEMM panel. Desktop: the input channels stacked on the left,
  // A, then B. Phones: the channels in a row on top, A and B below, with
  // bigger cells, so the picture keeps its detail at 390 px.
  const narrow = font.narrow;
  const lab = font.fs(11);
  const py = 56 + lab * 2.6;
  const ic = narrow ? 18 : 9; // input cell
  const aw = narrow ? 15 : 11; // A, B cell width
  const ah = narrow ? 9 : 6; // A row height
  const bx0 = 14;
  const chX = (c: number) => (narrow ? bx0 + c * (ic * H + 16) : bx0);
  const chY = (c: number) => (narrow ? py : py + c * (ic * H + 8));
  const inH = narrow ? ic * H : ch * (ic * H + 8);
  const ay = narrow ? py + inH + lab * 2.2 : py;
  const ax0 = narrow ? bx0 : bx0 + ic * H + 30;
  const bx = ax0 + K * aw + 24;
  const panelBottom = Math.max(narrow ? ay + M * ah : py + inH, ay + M * ah);
  const cy0 = panelBottom + 30;
  const arr = layers.filter((l) => l.unit === "array");
  const cmax = Math.max(
    ...arr.flatMap((l) => [l.stream!, l.seqWs!, l.approx!]),
  );
  const barH = Math.max(11, lab * 0.9);
  const barGap = barH + 4;
  const blockH = lab * 1.6 + 3 * barGap + 12;
  // bars start at the left; each is followed by its value and label
  const barX = 10;
  const barW = (v: number) => (v / cmax) * (VW - barX - (narrow ? 330 : 220));
  const vh = cy0 + arr.length * blockH + 10;

  const row = s.kind === "im2col" ? s.row : -1;
  const pi = row >= 0 ? Math.floor(row / outW) : -1;
  const pj = row >= 0 ? row % outW : -1;
  const filled =
    s.kind === "im2col" ? row + 1 : s.kind === "node" && s.layer === 0 ? 0 : M;
  const tile = s.kind === "tile" ? s : null;
  const hl =
    hover ??
    (s.kind === "im2col"
      ? "a"
      : s.kind === "tile"
        ? "w"
        : s.kind === "summary"
          ? "c"
          : "a");

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${vh}`}
      className="w-full"
      role="img"
      aria-label="An ONNX graph lowered onto a systolic array"
    >
      {nodes.map((l, i) => {
        const on = s.layer === i && s.kind !== "summary";
        return (
          <g key={l.name} data-node={l.name} data-active={on ? "1" : undefined}>
            <rect
              x={10 + i * nw + 4}
              y={8}
              width={nw - 8}
              height={36}
              rx={6}
              fill={
                l.unit === "array"
                  ? DATA_COLOUR.b
                  : l.unit === "vector"
                    ? DATA_COLOUR.psum
                    : MUTED.light
              }
              fillOpacity={on ? 0.35 : 0.12}
              stroke={on ? STATE_COLOUR.active : "currentColor"}
              strokeOpacity={on ? 1 : 0.3}
              strokeWidth={on ? 2.5 : 1}
            />
            <text
              x={10 + i * nw + nw / 2}
              y={31}
              fontSize={fs}
              textAnchor="middle"
              fill="currentColor"
            >
              {l.op}
            </text>
            <text
              x={10 + i * nw + nw / 2}
              y={44 + lab * 1.2}
              fontSize={font.fs(11)}
              textAnchor="middle"
              fill="currentColor"
              opacity={0.75}
            >
              {l.unit === "array"
                ? "array"
                : l.unit === "vector"
                  ? "vector unit"
                  : "view"}
            </text>
          </g>
        );
      })}

      {/* the input channels, with the patch the current pixel sees */}
      {conv.x.map((plane, c) => (
        <g key={c}>
          {plane.map((r, i) =>
            r.map((v, j) => {
              const inPatch =
                pi >= 0 &&
                i >= pi &&
                i < pi + kernel &&
                j >= pj &&
                j < pj + kernel;
              return (
                <rect
                  key={`${i}-${j}`}
                  x={chX(c) + j * ic}
                  y={chY(c) + i * ic}
                  width={ic - 1}
                  height={ic - 1}
                  fill={DATA_COLOUR.a}
                  fillOpacity={0.08 + 0.12 * Math.abs(v)}
                  stroke={inPatch ? STATE_COLOUR.active : "none"}
                  strokeWidth={inPatch ? 1.5 : 0}
                />
              );
            }),
          )}
        </g>
      ))}
      <text x={bx0} y={py - 6} fontSize={font.fs(11)} fill="currentColor">
        {`x: ${ch} × ${H} × ${H}`}
      </text>
      {/* A = im2col(x), M x K */}
      <text x={ax0} y={ay - 6} fontSize={font.fs(11)} fill="currentColor">
        {`A: ${M} × ${K}`}
      </text>
      {conv.A.map((r, p) => (
        <g key={p}>
          {r.map((v, k) => {
            const inTile =
              tile !== null && k >= tile.k0 && k < tile.k0 + tile.k;
            return (
              <rect
                key={k}
                x={ax0 + k * aw}
                y={ay + p * ah}
                width={aw - 1}
                height={ah - 1}
                fill={DATA_COLOUR.a}
                fillOpacity={
                  p < filled
                    ? inTile
                      ? 0.3 + 0.12 * Math.abs(v)
                      : 0.06 + 0.1 * Math.abs(v)
                    : 0.02
                }
              />
            );
          })}
        </g>
      ))}
      {row >= 0 && (
        <rect
          x={ax0 - 2}
          y={ay + row * ah - 1}
          width={K * aw + 2}
          height={ah + 1}
          fill="none"
          stroke={STATE_COLOUR.active}
          strokeWidth={2}
        />
      )}
      {/* B, K x N, with the current weight tile */}
      <text x={bx} y={ay - 6} fontSize={font.fs(11)} fill="currentColor">
        {`B: ${K} × ${N}`}
      </text>
      {conv.B.map((r, k) =>
        r.map((v, nn) => {
          const inTile =
            tile !== null &&
            k >= tile.k0 &&
            k < tile.k0 + tile.k &&
            nn >= tile.n0 &&
            nn < tile.n0 + tile.n;
          return (
            <rect
              key={`${k}-${nn}`}
              x={bx + nn * aw}
              y={ay + k * ah * (M / K) * 0.5}
              width={aw - 1}
              height={ah * (M / K) * 0.5 - 1}
              fill={DATA_COLOUR.b}
              fillOpacity={
                inTile ? 0.45 + 0.1 * Math.abs(v) : 0.06 + 0.06 * Math.abs(v)
              }
              stroke={inTile ? STATE_COLOUR.active : "none"}
              strokeWidth={inTile ? 1 : 0}
            />
          );
        }),
      )}

      {/* cycles per array layer */}
      {arr.map((l, i) => {
        const y = cy0 + i * blockH;
        const on = s.kind === "summary" || layers[s.layer] === l;
        const bars: [string, number, string, boolean][] = [
          ["back to back", l.stream!, DATA_COLOUR.b, false],
          ["in sequence", l.seqWs!, MUTED.light, false],
          ["approximate", l.approx!, DATA_COLOUR.c, true],
        ];
        return (
          <g key={l.name} opacity={on ? 1 : 0.45}>
            <text x={barX} y={y + lab} fontSize={fs} fill="currentColor">
              {`${l.name}: ${l.gemm![1]} × ${l.gemm![2]} × ${l.gemm![3]}, cycles`}
            </text>
            {bars.map(([label, v, colour, dashed], b) => (
              <g key={label}>
                <rect
                  x={barX}
                  y={y + lab * 1.6 + b * barGap}
                  width={barW(v)}
                  height={barH}
                  fill={colour}
                  fillOpacity={dashed ? 0.25 : 0.7}
                  stroke={colour}
                  strokeDasharray={dashed ? "3 2" : undefined}
                />
                <text
                  x={barX + barW(v) + 6}
                  y={y + lab * 1.6 + b * barGap + barH * 0.85}
                  fontSize={lab}
                  fill="currentColor"
                >
                  {`${int(v)} ${label}`}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );

  const cur = layers[s.layer]!;
  return (
    <AnimationPanel
      testId="lower-widget"
      title="From an ONNX graph to the array"
      summary={`A small CNN (${TINY_CNN.nodes.length} ONNX nodes) on a ${rows} × ${rows} weight-stationary array: im2col turns the convolution into a GEMM, and the GEMMs are cut into weight tiles.`}
      stepper={st}
      stepLabel="step"
      caption={lowerCaption(s, layers, rows, outW, kernel)}
      visual={visual}
      equation={children}
      hl={hl}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Node" value={`${cur.name} (${cur.op})`} />
          <Stat
            label="Runs on"
            value={cur.unit === "vector" ? "vector unit" : cur.unit}
          />
          <Stat
            label="Conv cycles"
            value={int(L0.stream!)}
            hint={`${pct(L0.util!, 0)} busy`}
          />
          <Stat
            label="Gemm cycles"
            value={int(layers[layers.length - 1]!.stream!)}
            hint={`${pct(layers[layers.length - 1]!.util!, 0)} busy`}
          />
        </div>
      }
      params={
        <Segmented
          label="Array"
          value={String(rows)}
          options={ARRAYS.map((r) => ({
            value: String(r),
            label: `${r} × ${r}`,
          }))}
          onChange={(v) => setRows(Number(v))}
        />
      }
    />
  );
}
