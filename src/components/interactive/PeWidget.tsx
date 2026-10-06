"use client";

/**
 * Chapter 6: inside one processing element. The author's three-stage MAC
 * unit (rtl/mac_unit.sv), register by register and bit by bit: stage 1
 * latches the two operands, stage 2 multiplies them (exactly, into FP32 or
 * INT16), stage 3 adds the product to the accumulator (FP32, rounded to
 * nearest even, or INT32). Two dot products of four terms run back to
 * back; `clear` starts the second. Every frame is a cycle of `macPipeline`
 * (the TS port of reference/pe.py), whose INT8 and FP16 frames match the
 * RTL in Verilator register for register.
 */
import { useMemo, useState, type ReactNode } from "react";

import { AnimationPanel } from "@/components/anim/AnimationPanel";
import { useStepper } from "@/components/anim/useStepper";
import { Segmented, Stat } from "@/components/ui/Controls";
import { useSvgFont } from "@/components/viz/useSvgFont";
import { minus, trim } from "@/lib/format";
import { operand, peCaption, peValue } from "@/lib/sa/captionsB";
import { DEMO_PE, FORMATS, demoTrace, fields, type Mode } from "@/lib/sa/pe";
import { FIELD_COLOUR, MUTED, STATE_COLOUR } from "@/lib/viz/palette";

const VW = 640;

const MODE_LABEL: Record<Mode, string> = {
  int8: "INT8 → INT32",
  fp16: "FP16 → FP32",
  bf16: "bfloat16 → FP32",
};

/** Bit colours: sign, exponent, mantissa (integers: sign, then magnitude). */
function bitColours(
  kind: "fp16" | "bf16" | "fp32" | "int",
  width: number,
): string[] {
  const out: string[] = [];
  const [e] = kind === "int" ? [0] : kind === "fp32" ? [8] : FORMATS[kind];
  for (let i = 0; i < width; i++)
    out.push(
      i === 0
        ? FIELD_COLOUR.sign
        : kind === "int"
          ? MUTED.light
          : i <= e!
            ? FIELD_COLOUR.exp
            : FIELD_COLOUR.mant,
    );
  return out;
}

function bitsOf(v: number, width: number): number[] {
  const out: number[] = [];
  const u = width === 32 ? v >>> 0 : v & ((1 << width) - 1);
  for (let i = width - 1; i >= 0; i--) out.push(Math.floor(u / 2 ** i) % 2);
  return out;
}

const fmt = (v: number) =>
  Number.isInteger(v) ? minus(String(v)) : trim(v, 6);

export default function PeWidget({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [mode, setMode] = useState<Mode>("bf16");
  const [hover, setHover] = useState<string | null>(null);
  const trace = useMemo(() => demoTrace(mode), [mode]);
  const st = useStepper(trace.cycles, { stepMs: 1300, resetKey: mode });
  const t = st.step;
  const f = trace.frames[t]!;
  const font = useSvgFont(VW);
  const fs = font.fs(13);
  const small = font.fs(11);
  const fp = mode !== "int8";
  const inW = fp ? 16 : 8;
  const prodW = fp ? 32 : 16;
  const inKind = fp ? (mode as "fp16" | "bf16") : "int";
  const prodKind = fp ? "fp32" : "int";

  const lx = 116;
  const bit = 12;
  const rowH = 58;
  const rows: {
    key: string;
    stage: string;
    label: string;
    bits: number;
    width: number;
    kind: "fp16" | "bf16" | "fp32" | "int";
    value: number;
    active: boolean;
    hl: string;
  }[] = [
    {
      key: "a",
      stage: "stage 1",
      label: "a",
      bits: fp ? f.s1[0] : f.s1[0] & 0xff,
      width: inW,
      kind: inKind,
      value: operand(mode, f.s1[0]),
      active: f.s1[2] === 1,
      hl: "a",
    },
    {
      key: "b",
      stage: "",
      label: "b",
      bits: fp ? f.s1[1] : f.s1[1] & 0xff,
      width: inW,
      kind: inKind,
      value: operand(mode, f.s1[1]),
      active: f.s1[2] === 1,
      hl: "b",
    },
    {
      key: "p",
      stage: "stage 2",
      label: "a·b",
      bits: f.s2[0],
      width: prodW,
      kind: prodKind,
      value: peValue(mode, f.s2[0]),
      active: f.s2[1] === 1,
      hl: "p",
    },
    {
      key: "acc",
      stage: "stage 3",
      label: "acc",
      bits: f.acc,
      width: 32,
      kind: fp ? "fp32" : "int",
      value: peValue(mode, f.acc),
      active: f.event[0] !== "hold",
      hl: "acc",
    },
  ];
  const hl =
    hover ??
    (f.event[0] !== "hold" ? "acc" : f.s2[1] ? "p" : f.s1[2] ? "a" : "acc");

  // the alignment the FP32 adder did in this cycle
  let align = "";
  if (fp && f.event[0] === "add") {
    const p = trace.frames[t - 1]!.s2[0];
    const [, ea] = fields("fp32", f.event[1]);
    const [, ep] = fields("fp32", p);
    const d = Math.abs(ea - ep);
    align = `+ aligned the smaller operand by ${d} bit${d === 1 ? "" : "s"}, then rounded to 24 significant bits`;
  } else if (f.event[0] === "clear")
    align = "clear: acc takes the product (a new dot product)";

  // phones: the label and value go on a line above each register, and the
  // bits use the full width, so nothing is drawn below 11 px
  const narrow = font.narrow;
  const head = narrow ? fs * 1.3 : 0;
  const rowStep = narrow ? head + 34 + fs * 0.6 : rowH;
  const x0 = narrow ? 8 : lx;
  const bitW = narrow ? (VW - 24) / 32 : bit;
  const alignLines = narrow && align ? align.split(", then ") : [align];
  const vhh = 22 + rows.length * rowStep + 18 + alignLines.length * small * 1.3;
  const visual = (
    <svg
      ref={font.ref}
      viewBox={`0 0 ${VW} ${vhh}`}
      className="w-full"
      role="img"
      aria-label={`The MAC unit's pipeline registers at cycle ${t + 1}`}
    >
      {rows.map((r, i) => {
        const y = 22 + i * rowStep + head;
        const bits = bitsOf(r.bits, r.width);
        const cols = bitColours(r.kind, r.width);
        const strip = r.width * bitW;
        const op = i === 2 ? " (× exact)" : i === 3 ? " (+, rounded)" : "";
        return (
          <g
            key={r.key}
            data-reg={r.key}
            data-active={r.active ? "1" : undefined}
          >
            {narrow ? (
              <text
                x={x0}
                y={y - 6}
                fontSize={fs}
                fill="currentColor"
                fontFamily="ui-monospace, monospace"
              >
                {`${r.stage ? `${r.stage} · ` : ""}${r.label} = ${fmt(r.value)}`}
                {op && (
                  <tspan fontSize={small} opacity={0.75}>
                    {op}
                  </tspan>
                )}
              </text>
            ) : (
              <>
                {r.stage && (
                  <text
                    x={8}
                    y={y + 4}
                    fontSize={small}
                    fill="currentColor"
                    opacity={0.75}
                  >
                    {r.stage}
                  </text>
                )}
                <text
                  x={lx - 10}
                  y={y + 22}
                  fontSize={fs}
                  textAnchor="end"
                  fill="currentColor"
                  fontFamily="ui-monospace, monospace"
                >
                  {r.label}
                </text>
                <text
                  x={lx + strip + 12}
                  y={y + 24}
                  fontSize={fs}
                  fill="currentColor"
                  fontFamily="ui-monospace, monospace"
                >
                  {fmt(r.value)}
                </text>
                {(i === 1 || i === 2) && (
                  <text
                    x={lx + strip / 2}
                    y={y + rowH - 6}
                    fontSize={fs}
                    textAnchor="middle"
                    fill="currentColor"
                  >
                    {i === 1 ? "× (exact)" : "+ (round to nearest even)"}
                  </text>
                )}
              </>
            )}
            <rect
              x={x0 - 4}
              y={y + 6}
              width={strip + 8}
              height={26}
              rx={4}
              fill="none"
              stroke={r.active ? STATE_COLOUR.active : "currentColor"}
              strokeOpacity={r.active ? 1 : 0.2}
              strokeWidth={r.active ? 2.5 : 1}
            />
            {bits.map((b, k) => (
              <rect
                key={k}
                x={x0 + k * bitW}
                y={y + 10}
                width={bitW - 2}
                height={18}
                rx={1.5}
                fill={cols[k]}
                fillOpacity={b ? 0.9 : 0.15}
              />
            ))}
          </g>
        );
      })}
      {alignLines.map((line, k) => (
        <text
          key={k}
          x={x0 - 4}
          y={vhh - 8 - (alignLines.length - 1 - k) * small * 1.3}
          fontSize={small}
          fill="currentColor"
        >
          {k > 0 ? `then ${line}` : line}
        </text>
      ))}
    </svg>
  );

  return (
    <AnimationPanel
      testId="pe-widget"
      title="One PE, three pipeline stages"
      summary={`${MODE_LABEL[mode]}: two dot products of ${DEMO_PE.every} terms through the author's MAC unit. Bits: sign (purple), exponent (sky), mantissa (green); a lit bit is a 1.`}
      stepper={st}
      stepLabel="cycle"
      caption={peCaption(mode, trace, DEMO_PE.count, t)}
      visual={visual}
      equation={children}
      hl={hl}
      onEquationHover={setHover}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Products added"
            value={`${f.macs} of ${DEMO_PE.count}`}
          />
          <Stat label="Latency" value="3 cycles" hint="input to accumulator" />
          <Stat label="Accumulator" value={fmt(peValue(mode, f.acc))} />
          <Stat label="valid_out" value={String(f.vout)} />
        </div>
      }
      params={
        <Segmented
          label="Number format"
          value={mode}
          options={(["bf16", "fp16", "int8"] as const).map((v) => ({
            value: v,
            label: MODE_LABEL[v],
          }))}
          onChange={setMode}
        />
      }
    />
  );
}
