/**
 * Number formatting for the captions, readouts and prose (from Numerics
 * Explained): integers with thousands separators and typographic minus
 * signs, significant figures switching to scientific notation outside
 * 1e-4 .. 1e7, percentages and subscript indices.
 */

const SUP: Record<string, string> = {
  "-": "⁻",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

/** An integer as superscript digits (with a typographic minus). */
export function sup(k: number): string {
  return String(k)
    .split("")
    .map((c) => SUP[c] ?? c)
    .join("");
}

/** A typographic minus for negative numbers. */
export function minus(s: string): string {
  return s.replace(/^-/, "−");
}

/** Up to `digits` significant figures, without trailing zeros. */
export function trim(v: number, digits = 4): string {
  if (v === 0) return "0";
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "NaN" : v > 0 ? "∞" : "−∞";
  const a = Math.abs(v);
  if (a < 1e-4 || a >= 1e7) return sci(v, digits);
  const s = Number(v.toPrecision(digits));
  return minus(s.toLocaleString("en-GB", { maximumFractionDigits: 10 }));
}

/** Scientific notation: 6.104 × 10⁻⁵. */
export function sci(v: number, digits = 4): string {
  if (v === 0) return "0";
  const [m, e] = v.toExponential(digits - 1).split("e");
  const mant = String(Number(m));
  return `${minus(mant)} × 10${sup(Number(e))}`;
}

/** A fraction as a percentage. */
export function pct(f: number, digits = 0): string {
  return `${(f * 100).toFixed(digits)}%`;
}

/** A whole number with thousands separators. */
export function int(v: number): string {
  return Math.round(v).toLocaleString("en-GB");
}

const SUB: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

/** Subscript indices: sub(2, 1) is "₂₁"; indices above 9 get a comma. */
export function sub(...idx: number[]): string {
  const s = idx.map((i) =>
    String(i)
      .split("")
      .map((c) => SUB[c] ?? c)
      .join(""),
  );
  return idx.some((i) => i > 9) ? s.join(",") : s.join("");
}

/** An integer with a typographic minus, in brackets when negative (for products). */
export function signed(v: number): string {
  return v < 0 ? `(${minus(String(v))})` : String(v);
}
