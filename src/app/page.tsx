import Link from "next/link";

import { HeroWidget } from "@/components/interactive/lazy";
import { V } from "@/components/mdx/V";
import { SECTIONS } from "@/lib/mdx/sections";

const A =
  "focus-ring rounded underline decoration-accent/40 underline-offset-4 hover:decoration-accent";

/**
 * Landing page: what the site is, the hero animation (data pulsing through
 * a 4 × 4 array), and the chapters. Server Component; the hero is a
 * code-split client widget.
 */
export default function HomePage(): JSX.Element {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-accent dark:text-indigo-300">
        Systolic Arrays Explained
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        How the hardware multiplies matrices
      </h1>
      <div className="mt-8 grid items-start gap-8 md:grid-cols-[1fr_minmax(0,24rem)]">
        <div>
          <p className="max-w-2xl text-lg text-neutral-600 dark:text-neutral-300">
            A matrix unit is a grid of multiply-accumulate cells that pass
            numbers to their neighbours every clock cycle: each operand is
            fetched from memory once and used by a whole row or column of cells.
            This site takes that machine apart one cycle at a time: which
            operand stays put, how the inputs are skewed so everything meets at
            the right moment, and where the cycles go.
          </p>
          <p className="mt-4 max-w-2xl text-neutral-600 dark:text-neutral-300">
            Every animation is drawn from a cycle-accurate model of the array
            (Python reference, exact TypeScript port). Its output-stationary
            frames match a SystemVerilog array simulated in Verilator on every
            accumulator after every clock edge: <V of="rtl.values" fmt="int" />{" "}
            values, <V of="rtl.mismatches" fmt="int" /> mismatches.
          </p>
        </div>
        <div className="min-w-0">
          <HeroWidget testId="hero-home" />
        </div>
      </div>
      <nav aria-label="Chapters" className="mt-12 grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s, i) => (
          <Link
            key={s.slug}
            href={`/learn/${s.slug}`}
            className="focus-ring group rounded-lg border border-neutral-200 p-5 hover:border-accent dark:border-neutral-800 dark:hover:border-indigo-400"
          >
            <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
              {String(i + 1).padStart(2, "0")}
            </p>
            <h2 className="mt-1 font-semibold">{s.title}</h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              {s.summary}
            </p>
          </Link>
        ))}
      </nav>
      <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
        The model, its conventions and the RTL cross-check:{" "}
        <Link href="/model" className={A}>
          the model
        </Link>
        .
      </p>
      <p className="mt-12 text-sm text-neutral-600 dark:text-neutral-400">
        Part of a family of sixteen companion sites in four tracks, all in the
        site menu above: Foundations (
        <a
          href="https://transformer-decoder-explained.vercel.app"
          className={A}
        >
          Decoder
        </a>
        ,{" "}
        <a
          href="https://transformer-training-explained.vercel.app"
          className={A}
        >
          Training
        </a>
        ), Hardware (
        <a href="https://gpu-kernels-explained.vercel.app" className={A}>
          Kernels
        </a>
        , <strong className="font-medium">Systolic</strong>,{" "}
        <a href="https://ai-accelerators-explained.vercel.app" className={A}>
          Accelerators
        </a>
        ,{" "}
        <a href="https://ai-racks-explained.vercel.app" className={A}>
          Racks
        </a>
        ), Inference (
        <a href="https://llm-inference-explained.vercel.app" className={A}>
          Serving
        </a>
        ,{" "}
        <a href="https://llm-architectures-explained.vercel.app" className={A}>
          Architectures
        </a>
        ,{" "}
        <a href="https://numerics-explained.vercel.app" className={A}>
          Numerics
        </a>
        ,{" "}
        <a
          href="https://inference-tradeoffs-explained.vercel.app"
          className={A}
        >
          Trade-offs
        </a>
        ) and Agents (
        <a href="https://agent-harnesses-explained.vercel.app" className={A}>
          Harnesses
        </a>
        ,{" "}
        <a href="https://agent-protocols-explained.vercel.app" className={A}>
          Protocols
        </a>
        ,{" "}
        <a href="https://agent-context-explained.vercel.app" className={A}>
          Context
        </a>
        ,{" "}
        <a
          href="https://agent-orchestration-explained.vercel.app"
          className={A}
        >
          Orchestration
        </a>
        ,{" "}
        <a href="https://agent-evals-explained.vercel.app" className={A}>
          Evals
        </a>
        ,{" "}
        <a href="https://agent-security-explained.vercel.app" className={A}>
          Security
        </a>
        ). This site is the silicon inside a matrix engine. How it was built,
        and how to check it:{" "}
        <Link href="/about" className={A}>
          about
        </Link>
        .
      </p>
    </main>
  );
}
