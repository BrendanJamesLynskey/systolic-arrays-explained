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
] as const;

/** The chapters part B of the brief adds (listed on /learn, not linked yet). */
export const COMING = [
  "Tiling big GEMMs",
  "Inside a PE",
  "The TPU",
  "Other ways to build it",
  "From graph to silicon",
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
