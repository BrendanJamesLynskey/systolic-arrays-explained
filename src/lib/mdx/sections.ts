/**
 * Chapter catalogue + filesystem loader for /learn content.
 *
 * MDX sources live under `/content/chapters/`, one per mechanism, each built
 * around an animation. Their slugs and order are defined here (single source
 * of truth); the `[slug]` route validates incoming params against this list
 * before reading from disk. Same shape as the companion sites'
 * `src/lib/mdx/sections.ts`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SECTIONS = [
  {
    slug: "01-why-systolic",
    title: "Why systolic?",
    summary:
      "The memory wall, and Kung's answer: fetch each number once and pass it from processor to processor, so a grid of n × n multipliers needs only 2n words a cycle.",
  },
  {
    slug: "02-weight-stationary",
    title: "Weight-stationary, cycle by cycle",
    summary:
      "The TPU's dataflow: weights sit still, skewed activations march right, partial sums flow down and drain out of the bottom. Every register, every cycle.",
  },
  {
    slug: "03-output-and-input-stationary",
    title: "Output- and input-stationary",
    summary:
      "The same matrix multiply in three dataflows side by side: what stays put, what moves, and what that costs in memory reads, link hops and register writes.",
  },
  {
    slug: "04-skew-fill-drain",
    title: "Skew, fill and drain",
    summary:
      "Why the inputs arrive as a staircase, how long the array takes to fill and empty, and what that does to utilisation as the matrices grow or stop fitting.",
  },
  {
    slug: "05-tiling",
    title: "Tiling big GEMMs",
    summary:
      "A matrix bigger than the array, cut into weight tiles and run back to back: double-buffered weights hide each tile's load, and the dataflow decides how many words the buffer must deliver.",
  },
  {
    slug: "06-inside-a-pe",
    title: "Inside a PE",
    summary:
      "One processing element, bit by bit: a three-stage MAC that multiplies bfloat16 or FP16 exactly and accumulates in FP32, checked register for register against the author's RTL.",
  },
  {
    slug: "07-the-tpu",
    title: "The TPU",
    summary:
      "The matrix units in a chip (MXU, vector and scalar units, on-chip memory, HBM) and the chips in a pod: an all-reduce on a 2-D torus, step by step.",
  },
  {
    slug: "08-other-ways",
    title: "Other ways to build it",
    summary:
      "GPU tensor cores against systolic arrays, Eyeriss's dataflow taxonomy with row-stationary animated, and computing in or near memory.",
  },
  {
    slug: "09-graph-to-silicon",
    title: "From graph to silicon",
    summary:
      "An ONNX model lowered onto the array: im2col turns a convolution into a GEMM, the GEMMs become weight tiles, and the cycle-accurate count meets a simulator's estimate.",
  },
] as const;

export type SectionSlug = (typeof SECTIONS)[number]["slug"];

const SLUG_SET = new Set<string>(SECTIONS.map((s) => s.slug));

export function isValidSlug(slug: string): slug is SectionSlug {
  return SLUG_SET.has(slug);
}

export function getSectionMeta(slug: SectionSlug): (typeof SECTIONS)[number] {
  return SECTIONS.find((s) => s.slug === slug) ?? SECTIONS[0];
}

/** Read the raw MDX source for a chapter, or `null` if it doesn't exist. */
export async function readSectionMdx(
  slug: SectionSlug,
): Promise<string | null> {
  const path = join(process.cwd(), "content", "chapters", `${slug}.mdx`);
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}
