/**
 * Chapter 7: a TPU chip's structure (a static diagram: the structure is the
 * point, so nothing moves). One TensorCore with four MXUs (systolic
 * arrays), a vector unit and a scalar unit, its on-chip vector memory, the
 * HBM beside the die, and four inter-chip links to its neighbours on a 2-D
 * torus. Generic, after Google's public TPU documentation (v4 and v5e have
 * four MXUs per TensorCore; v4 has two TensorCores per chip and six links;
 * v5e one TensorCore and a 2-D torus). Colours: the family's memory levels
 * (HBM purple, on-chip SRAM green, registers orange) and this site's
 * weights vermillion for the MXUs. Server Component: plain SVG, sized so
 * its labels stay at least 11 px on a phone.
 */
import { DATA_COLOUR, LEVEL_COLOUR, STATE_COLOUR } from "@/lib/viz/palette";

const VW = 420;
const FS = 16;

function Box({
  x,
  y,
  w,
  h,
  colour,
  label,
  sub,
  opacity = 0.18,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  label: string;
  sub?: string;
  opacity?: number;
}): JSX.Element {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill={colour}
        fillOpacity={opacity}
        stroke={colour}
        strokeWidth={1.5}
      />
      <text
        x={x + w / 2}
        y={y + h / 2 + (sub ? -2 : FS * 0.35)}
        textAnchor="middle"
        fontSize={FS}
        fill="currentColor"
      >
        {label}
      </text>
      {sub && (
        <text
          x={x + w / 2}
          y={y + h / 2 + FS}
          textAnchor="middle"
          fontSize={FS - 1}
          fill="currentColor"
          opacity={0.8}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

export function TpuDiagram(): JSX.Element {
  const cx = 70;
  const cy = 60;
  const cw = 280;
  const mx = 10;
  const mxu = (cw - 3 * mx) / 2;
  return (
    <figure className="my-8 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <figcaption>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
          Structure · static
        </p>
        <p className="mt-1 font-semibold text-neutral-900 dark:text-neutral-100">
          One TPU chip, one TensorCore
        </p>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Generic, after Google&apos;s public TPU documentation: four MXUs (128
          × 128 systolic arrays before v6e), a vector unit and a scalar unit
          share on-chip memory; HBM sits beside the die; links to the
          neighbouring chips form the torus.
        </p>
      </figcaption>
      <svg
        viewBox={`0 0 ${VW} 520`}
        className="mx-auto mt-4 w-full max-w-md"
        role="img"
        aria-label="A TPU chip: one TensorCore with four matrix units, a vector unit and a scalar unit, on-chip vector memory, high-bandwidth memory beside it, and four inter-chip links"
      >
        {/* ICI links */}
        {[
          [cx + cw / 2, cy - 4, cx + cw / 2, 8, "ICI −y"],
          [cx + cw / 2, cy + 380, cx + cw / 2, 512, "ICI +y"],
          [cx - 4, cy + 190, 8, cy + 190, "−x"],
          [cx + cw + 4, cy + 190, VW - 8, cy + 190, "+x"],
        ].map(([x1, y1, x2, y2, l]) => (
          <g key={l as string}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={STATE_COLOUR.active}
              strokeWidth={4}
              strokeLinecap="round"
            />
            <text
              x={(x1 as number) + ((x2 as number) - (x1 as number)) / 2 + 8}
              y={(y1 as number) + ((y2 as number) - (y1 as number)) / 2 - 6}
              fontSize={FS - 1}
              fill="currentColor"
            >
              {l}
            </text>
          </g>
        ))}
        <rect
          x={cx}
          y={cy}
          width={cw}
          height={320}
          rx={10}
          fill="currentColor"
          fillOpacity={0.04}
          stroke="currentColor"
          strokeOpacity={0.5}
        />
        <text x={cx + 10} y={cy + 20} fontSize={FS} fill="currentColor">
          TensorCore
        </text>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <Box
              x={cx + mx + (i % 2) * (mxu + mx)}
              y={cy + 32 + Math.floor(i / 2) * 82}
              w={mxu}
              h={72}
              colour={DATA_COLOUR.b}
              label={`MXU ${i + 1}`}
              sub="systolic array"
            />
          </g>
        ))}
        <Box
          x={cx + mx}
          y={cy + 202}
          w={cw - 2 * mx}
          h={52}
          colour={LEVEL_COLOUR.reg}
          label="Vector unit"
          sub="elementwise: activations, softmax"
        />
        <Box
          x={cx + mx}
          y={cy + 262}
          w={(cw - 3 * mx) * 0.35}
          h={52}
          colour={LEVEL_COLOUR.reg}
          label="Scalar"
          sub="control"
        />
        <Box
          x={cx + 2 * mx + (cw - 3 * mx) * 0.35}
          y={cy + 262}
          w={(cw - 3 * mx) * 0.65}
          h={52}
          colour={LEVEL_COLOUR.smem}
          label="On-chip memory"
          sub="(VMEM)"
        />
        <Box
          x={cx}
          y={cy + 330}
          w={cw}
          h={48}
          colour={LEVEL_COLOUR.hbm}
          label="HBM"
          sub="beside the die, in the package"
          opacity={0.25}
        />
      </svg>
    </figure>
  );
}
