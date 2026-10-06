/**
 * The family's visual language (explained_sites_visual_standard.md §3):
 * Okabe and Ito's colour-blind-safe palette, the same in light and dark
 * mode. The memory-level colours are the family's (GPU Kernels Explained);
 * this site adds one colour per kind of data moving through the array,
 * used in every picture and in the equations (globals.css, `.hl-*`):
 * A (activations) blue, B (weights) vermillion, partial sums sky, results
 * purple. Colours are fills and strokes, never text on white (sky and
 * purple text fail contrast). "Active" is a highlight, "done" is muted,
 * and an idle PE is grey plus a hatch pattern, never colour alone.
 *
 * Okabe, M. and Ito, K. (2008), "Color Universal Design (CUD): how to make
 * figures and presentations that are friendly to colorblind people",
 * https://jfly.uni-koeln.de/color/
 */

export const OKABE_ITO = {
  black: "#000000",
  orange: "#E69F00",
  sky: "#56B4E9",
  green: "#009E73",
  yellow: "#F0E442",
  blue: "#0072B2",
  vermillion: "#D55E00",
  purple: "#CC79A7",
} as const;

/** One colour per memory level, the same on every site in the family. */
export const LEVEL_COLOUR = {
  reg: OKABE_ITO.orange,
  smem: OKABE_ITO.green,
  l2: OKABE_ITO.sky,
  hbm: OKABE_ITO.purple,
} as const;

/** What moves through the array. */
export const DATA_COLOUR = {
  a: OKABE_ITO.blue,
  b: OKABE_ITO.vermillion,
  psum: OKABE_ITO.sky,
  c: OKABE_ITO.purple,
} as const;

/** The three dataflows, wherever they are compared. */
export const DATAFLOW_COLOUR = {
  ws: OKABE_ITO.vermillion,
  os: OKABE_ITO.purple,
  is: OKABE_ITO.blue,
} as const;

/** States of an element in an animation. */
export const STATE_COLOUR = {
  active: OKABE_ITO.blue,
  error: OKABE_ITO.vermillion,
} as const;

/** Muted ("done", "idle") greys: Tailwind neutral-400 and neutral-600. */
export const MUTED = { light: "#a3a3a3", dark: "#525252" } as const;
