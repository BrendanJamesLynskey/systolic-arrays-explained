/**
 * /learn — index of chapters.
 *
 * Server Component, statically rendered. Same layout as the companion
 * sites' /learn (transformer-explainer's, minus the per-user progress
 * badges: this site has no accounts).
 */
import Link from "next/link";

import { COMING, SECTIONS } from "@/lib/mdx/sections";
import { KERNELS_URL, TPU_HUB } from "@/lib/site";

export const metadata = {
  title: "Learn",
  description:
    "Chapters on systolic arrays, each built around an animation driven by the cycle-accurate model.",
};

export default function LearnIndex(): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-accent dark:text-indigo-300">
        /learn
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Systolic arrays, cycle by cycle
      </h1>
      <p className="mt-4 text-neutral-600 dark:text-neutral-300">
        One chapter per idea, each opening with an animation. Every frame is a
        cycle of this site&apos;s model of the array (checked exactly against
        its Python reference, and against a SystemVerilog array in Verilator).
        Toggle layers (Concept / Maths / Code) inside any chapter to choose how
        deep to go. How a GPU does the same job is on{" "}
        <a
          href={KERNELS_URL}
          className="focus-ring rounded text-accent underline underline-offset-2 dark:text-indigo-300"
        >
          GPU Kernels Explained
        </a>
        ; for slides, see the{" "}
        <a
          href={TPU_HUB}
          className="focus-ring rounded text-accent underline underline-offset-2 dark:text-indigo-300"
        >
          Google TPU
        </a>{" "}
        series.
      </p>

      <ol className="mt-10 divide-y divide-neutral-200 dark:divide-neutral-800">
        {SECTIONS.map((s, i) => (
          <li key={s.slug} className="py-5">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Link
                href={`/learn/${s.slug}`}
                className="focus-ring rounded text-lg font-medium text-neutral-900 hover:text-accent dark:text-neutral-100"
              >
                {s.title}
              </Link>
            </div>
            <p className="mt-1 pl-9 text-sm text-neutral-600 dark:text-neutral-400">
              {s.summary}
            </p>
          </li>
        ))}
      </ol>
      <h2 className="mt-10 text-sm font-medium uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
        Coming next
      </h2>
      <ol
        start={SECTIONS.length + 1}
        className="mt-3 list-decimal space-y-1 pl-9 text-sm text-neutral-600 dark:text-neutral-400"
      >
        {COMING.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
    </main>
  );
}
