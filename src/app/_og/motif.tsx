/**
 * This site's favicon glyph (src/app/icon.svg) and its card's graphic.
 * Glyph: the chip of the Hardware track, the letter S, #0284c7.
 */
import { DATA_COLOUR } from "@/lib/viz/palette";

export function Glyph({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect x="3.5" y="3.5" width="25" height="25" rx="2.5" fill="#0284c7" />
      <path
        d="M9 0h3v4h-3zM20 0h3v4h-3zM9 28h3v4h-3zM20 28h3v4h-3zM0 9h4v3h-4zM0 20h4v3h-4zM28 9h4v3h-4zM28 20h4v3h-4z"
        fill="#0284c7"
      />
      <path
        d="M20.56 19.12Q20.56 20.98 19.22 22.09Q17.87 23.2 15.4 23.2Q13.19 23.2 11.44 22.35V19.59Q12.44 20.02 13.51 20.38Q14.58 20.75 15.64 20.75Q16.74 20.75 17.2 20.32Q17.66 19.9 17.66 19.25Q17.66 18.73 17.29 18.35Q16.93 17.98 16.32 17.66Q15.72 17.33 14.93 16.96Q14.44 16.73 13.87 16.4Q13.3 16.08 12.78 15.6Q12.26 15.12 11.93 14.43Q11.6 13.75 11.6 12.78Q11.6 10.9 12.87 9.85Q14.15 8.8 16.34 8.8Q17.44 8.8 18.43 9.06Q19.42 9.31 20.5 9.78L19.54 12.1Q18.58 11.71 17.81 11.49Q17.05 11.27 16.25 11.27Q15.4 11.27 14.95 11.67Q14.5 12.06 14.5 12.69Q14.5 13.43 15.17 13.86Q15.83 14.29 17.15 14.92Q18.23 15.43 18.98 15.98Q19.74 16.53 20.15 17.27Q20.56 18.02 20.56 19.12Z"
        fill="#fff"
      />
    </svg>
  );
}

/**
 * A 6 × 6 systolic array mid-run: operands enter skewed from the left and the top, and the
 * diagonal wavefront of cells doing a multiply-accumulate this cycle is lit; cells behind it hold
 * partial sums. Schematic, in the site's data colours.
 */
export function Motif(): JSX.Element {
  const n = 6;
  const s = 58;
  const x0 = 70;
  const y0 = 60;
  const wave = 5;
  return (
    <svg width="440" height="420" viewBox="0 0 440 420">
      {Array.from({ length: n }, (_, r) =>
        Array.from({ length: n }, (_, c) => {
          const k = r + c;
          const fill =
            k === wave ? DATA_COLOUR.psum : k < wave ? "#1e3a5f" : "#111827";
          return (
            <rect
              key={`${r}-${c}`}
              x={x0 + c * s}
              y={y0 + r * s}
              width={s - 10}
              height={s - 10}
              rx={7}
              fill={fill}
              stroke={k === wave ? DATA_COLOUR.psum : "#475569"}
              strokeWidth={3}
            />
          );
        }),
      )}
      {Array.from({ length: n }, (_, r) => (
        <rect
          key={`a${r}`}
          x={x0 - 52}
          y={y0 + r * s + 14}
          width={34}
          height={20}
          rx={4}
          fill={DATA_COLOUR.a}
          opacity={r <= wave ? 1 : 0.35}
        />
      ))}
      {Array.from({ length: n }, (_, c) => (
        <rect
          key={`b${c}`}
          x={x0 + c * s + 14}
          y={y0 - 52}
          width={20}
          height={34}
          rx={4}
          fill={DATA_COLOUR.b}
          opacity={c <= wave ? 1 : 0.35}
        />
      ))}
    </svg>
  );
}
