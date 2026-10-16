"use client";

/**
 * Verified against RTL: the weight-stationary array's registers from a
 * Verilator VCD (rtl/ws_wave.json, written by rtl/check_rtl.py) drawn as a
 * waveform, next to the cycle-accurate model's frame for the same clock
 * edge (`simulateWsStream`). Both step together; every register that differs
 * is marked. The toggle shifts the model one cycle, the check's negative
 * control, and the mismatches light up: the comparison can fail.
 */
import { useMemo, useState } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { int } from "@/lib/format";
import {
  REGS,
  WAVE,
  compareWave,
  frameFor,
  laneMismatch,
  lanes,
  modelReg,
  show,
  waveCaption,
  waveModel,
  type Lane,
  type View,
} from "@/lib/sa/rtlwave";
import { DATA_COLOUR, MUTED, OKABE_ITO, STATE_COLOUR } from "@/lib/viz/palette";

import rtl from "../../../rtl/rtl_check.json";

const VW = 640;
const KIND_COLOUR: Record<Lane["kind"], string> = {
  weight: DATA_COLOUR.b,
  act: DATA_COLOUR.a,
  psum: DATA_COLOUR.psum,
};

export default function RtlWaveWidget({
  testId = "rtl-wave-widget",
}: {
  testId?: string;
}): JSX.Element {
  const [view, setView] = useState<View>("weights");
  const [col, setCol] = useState<"0" | "1" | "2">("0");
  const [shifted, setShifted] = useState<"off" | "on">("off");
  const shift: 0 | 1 = shifted === "on" ? 1 : 0;
  const tr = useMemo(() => waveModel(), []);
  const cmp = useMemo(() => compareWave(WAVE, tr, shift), [tr, shift]);
  const ls = useMemo(
    () => lanes(WAVE, tr, view, Number(col), shift),
    [tr, view, col, shift],
  );
  const E = WAVE.edges.length;
  const st = useStepper(E, {
    stepMs: 700,
    resetKey: `${view}-${col}-${shifted}`,
  });
  const i = st.step;
  const font = useSvgFont(VW);
  const fs = font.fs(12);
  const small = font.fs(11);

  // the waveform shows a window of edges around the cursor
  const win = font.narrow ? 6 : 12;
  const first = Math.max(0, Math.min(E - win, i - Math.floor(win / 2)));
  const labelW = font.narrow ? 230 : 120;
  const cw = (VW - labelW - 8) / win;
  const laneH = font.narrow ? 46 : 30;
  const top = 40;
  const X = (k: number) => labelW + (k - first) * cw;
  const Y = (j: number) => top + 26 + j * laneH;
  const wh = Y(ls.length) + 10;

  // the overview strip: every edge, red where any register differs
  const oy = 8;
  const ow = (VW - labelW - 8) / E;

  // the model's frame for this edge, as a small grid
  const f = frameFor(tr, WAVE.edges[i]!.edge, shift);
  const R = WAVE.case.rows;
  const C = WAVE.case.cols;
  const gy = wh + 30;
  const pw = font.narrow ? 196 : 190;
  const ph = font.narrow ? 132 : 84;
  const gx = (VW - (C * pw + (C - 1) * 10)) / 2;
  const vh = gy + 20 + R * (ph + 10);
  const bad = cmp.bad[i]!;

  const segs = (l: Lane) => {
    const out: JSX.Element[] = [];
    const y = (j: number) => Y(j);
    let k = first;
    const j = ls.indexOf(l);
    while (k < first + win) {
      const x0 = l.rtl[k]!;
      let k1 = k + 1;
      while (
        k1 < first + win &&
        (x0 === null
          ? l.rtl[k1] === null
          : l.rtl[k1] !== null &&
            l.rtl[k1]!.v === x0.v &&
            l.rtl[k1]!.tile === x0.tile)
      )
        k1++;
      const xa = X(k) + 1;
      const xb = X(k1) - 1;
      const yt = y(j) + 4;
      const yb = y(j) + laneH - 8;
      const ym = (yt + yb) / 2;
      if (x0 === null) {
        out.push(
          <line
            key={`n${k}`}
            x1={xa}
            x2={xb}
            y1={ym}
            y2={ym}
            stroke={MUTED.light}
            strokeWidth={1.5}
          />,
        );
      } else {
        const d = 4;
        out.push(
          <g key={`s${k}`}>
            <polygon
              points={`${xa},${ym} ${xa + d},${yt} ${xb - d},${yt} ${xb},${ym} ${xb - d},${yb} ${xa + d},${yb}`}
              fill={KIND_COLOUR[l.kind]}
              fillOpacity={0.18}
              stroke={KIND_COLOUR[l.kind]}
              strokeWidth={1.5}
            >
              <title>{`${l.label}, edges ${k + 1}-${k1}: ${show(x0)} (tile tag ${x0.tile})`}</title>
            </polygon>
            {xb - xa > fs * 1.9 && (
              <text
                x={(xa + xb) / 2}
                y={ym + fs * 0.35}
                textAnchor="middle"
                fontSize={fs}
                fill="currentColor"
                fontFamily="ui-monospace, monospace"
              >
                {show(x0)}
              </text>
            )}
          </g>,
        );
      }
      k = k1;
    }
    // the model agreement strip under each edge
    for (let e = first; e < first + win; e++) {
      const miss = laneMismatch(l, e);
      out.push(
        <rect
          key={`m${e}`}
          data-lane-miss={miss ? "1" : undefined}
          x={X(e) + 2}
          y={y(j) + laneH - 6}
          width={cw - 4}
          height={4}
          fill={miss ? STATE_COLOUR.error : OKABE_ITO.green}
          fillOpacity={miss ? 1 : 0.55}
        >
          <title>
            {miss
              ? `edge ${e + 1}: the model has ${l.model[e] ? show(l.model[e]!) : "nothing"}`
              : `edge ${e + 1}: model agrees`}
          </title>
        </rect>,
      );
    }
    return out;
  };

  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${vh}`}
      className="mx-auto w-full max-w-2xl"
      role="img"
      aria-label={`Waveform of column ${col} of the weight-stationary array from the Verilator VCD, edges ${first + 1} to ${first + win}, beside the model's frame for edge ${i + 1}`}
      data-wave-edge={i + 1}
      data-wave-mismatches={cmp.mismatches}
    >
      {/* overview: every edge */}
      <text x={4} y={oy + 9} fontSize={small} fill="currentColor">
        {font.narrow ? "edges" : "all edges"}
      </text>
      {WAVE.edges.map((_, e) => (
        <rect
          key={`o${e}`}
          x={labelW + e * ow}
          y={oy}
          width={Math.max(1, ow - 1)}
          height={10}
          fill={cmp.bad[e]!.size ? STATE_COLOUR.error : OKABE_ITO.green}
          fillOpacity={cmp.bad[e]!.size ? 0.9 : 0.45}
        />
      ))}
      <rect
        x={labelW + first * ow}
        y={oy - 3}
        width={win * ow}
        height={16}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.6}
      />
      {/* the clock */}
      <text x={4} y={top + 14} fontSize={small} fill="currentColor">
        clk
      </text>
      {Array.from({ length: win }, (_, w) => first + w).map((e) => (
        <g key={`c${e}`}>
          <polyline
            points={`${X(e)},${top + 18} ${X(e)},${top + 4} ${X(e) + cw / 2},${top + 4} ${X(e) + cw / 2},${top + 18} ${X(e) + cw},${top + 18}`}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.55}
          />
          {(!font.narrow || e % 2 === 0) && (
            <text
              x={X(e) + 3}
              y={top - 2}
              fontSize={small}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {e + 1}
            </text>
          )}
        </g>
      ))}
      {/* the cursor */}
      <rect
        x={X(i)}
        y={top}
        width={cw}
        height={wh - top}
        fill={STATE_COLOUR.active}
        fillOpacity={0.12}
        stroke={STATE_COLOUR.active}
      />
      {ls.map((l, j) => (
        <g key={l.key} data-lane={l.key}>
          <text
            x={4}
            y={Y(j) + laneH / 2 + small * 0.2}
            fontSize={small}
            fill="currentColor"
            fontFamily="ui-monospace, monospace"
          >
            {l.label}
          </text>
          {segs(l)}
        </g>
      ))}

      {/* the model's frame for this edge */}
      <text
        x={VW / 2}
        y={gy}
        textAnchor="middle"
        fontSize={fs}
        fill="currentColor"
      >
        {`Model, cycle ${Math.min(i + shift, tr.frames.length - 1)}${shift ? " (one cycle late: the negative control)" : ""}`}
      </text>
      {f.pe.map((row, r) =>
        row.map((cell, c) => {
          const x = gx + c * (pw + 10);
          const y = gy + 14 + r * (ph + 10);
          return (
            <g key={`p${r}${c}`} data-model-pe={`${r},${c}`}>
              <rect
                x={x}
                y={y}
                width={pw}
                height={ph}
                rx={5}
                fill="currentColor"
                fillOpacity={0.04}
                stroke={
                  String(c) === col ? STATE_COLOUR.active : "currentColor"
                }
                strokeOpacity={String(c) === col ? 0.9 : 0.3}
              />
              {REGS.map((reg, q) => {
                const m = modelReg(cell, reg, WAVE.tagBits);
                const wrong = bad.has(`${r},${c},${reg}`);
                const cols2 = font.narrow ? 1 : 2;
                const xx = x + 8 + (q % cols2) * (pw / 2);
                const yy =
                  y + 8 + Math.floor(q / cols2) * (font.narrow ? 30 : 36) + fs;
                return (
                  <text
                    key={reg}
                    x={xx}
                    y={yy}
                    fontSize={small}
                    fill={wrong ? STATE_COLOUR.error : "currentColor"}
                    fontWeight={wrong ? 700 : 400}
                    fontFamily="ui-monospace, monospace"
                    data-wrong={wrong ? "1" : undefined}
                  >
                    {`${reg} ${m[0] ? show({ v: m[2] }) : "–"}${wrong ? " ✗" : ""}`}
                  </text>
                );
              })}
            </g>
          );
        }),
      )}
    </svg>
  );

  const ws = rtl.wsTotals;
  return (
    <AnimationPanel
      testId={testId}
      title="Verified against RTL: the weight-stationary array"
      summary={`Top: column ${col} of the SystemVerilog array (rtl/systolic_array_ws.sv) as ${rtl.simulator} wrote it to a VCD, edge by edge; a band means the register holds a valid value, a flat line that it is empty. Bottom: the cycle-accurate model's frame for the same edge. The thin strip under each lane is green where the model agrees.`}
      stepper={st}
      stepLabel="edge"
      caption={waveCaption(WAVE, cmp, i, shift)}
      visual={visual}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Registers compared"
            value={int(cmp.values)}
            hint="this run, 36 per edge"
          />
          <Stat
            label="Mismatches"
            value={int(cmp.mismatches)}
            hint={shift ? "model shifted one cycle" : "model aligned"}
          />
          <Stat
            label="All WS runs"
            value={`${int(ws.values)} registers`}
            hint={`${ws.cases} problems`}
          />
          <Stat
            label="Their mismatches"
            value={int(ws.mismatches)}
            hint={`${int(ws.mismatchesShifted)} when shifted`}
          />
        </div>
      }
      params={
        <>
          <Segmented
            label="Signals"
            value={view}
            options={[
              { value: "weights", label: "weights (shadow chain)" },
              { value: "data", label: "activations, sums" },
            ]}
            onChange={setView}
          />
          <Segmented
            label="Column"
            value={col}
            options={[
              { value: "0", label: "0" },
              { value: "1", label: "1" },
              { value: "2", label: "2" },
            ]}
            onChange={setCol}
          />
          <Segmented
            label="Shift the model one cycle"
            value={shifted}
            options={[
              { value: "off", label: "off" },
              { value: "on", label: "on (negative control)" },
            ]}
            onChange={setShifted}
          />
        </>
      }
    />
  );
}
