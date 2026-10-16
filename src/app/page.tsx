import type { Route } from "next";
import Link from "next/link";

import { CheckedStrip, StartButton } from "@/components/ui/Landing";
import { HeroWidget, RtlWaveWidget } from "@/components/interactive/lazy";
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
      <div className="mt-6 grid items-start gap-8 md:grid-cols-[1fr_minmax(0,24rem)]">
        <div>
          <p className="max-w-2xl text-lg text-neutral-600 dark:text-neutral-300">
            An interactive guide to the systolic arrays inside matrix engines,
            one clock cycle at a time, drawn from a cycle-accurate model.
          </p>
          <div className="mt-6">
            <StartButton href={`/learn/${SECTIONS[0]!.slug}` as Route} />
          </div>
        </div>
        <div data-hero-figure className="min-w-0">
          <HeroWidget testId="hero-home" />
        </div>
      </div>
      <CheckedStrip href="/about#checked">
        Checked against RTL: the weight-stationary array with shadow weights,
        written in SystemVerilog and simulated in{" "}
        <V of="rtl.simulator" fmt="raw" />, matches the cycle-accurate model on
        every register after every clock edge: <V of="wsrtl.values" fmt="int" />{" "}
        values, <V of="wsrtl.mismatches" fmt="int" /> mismatches (
        <V of="wsrtl.allValues" fmt="int" /> across three designs). Synthesised
        with Yosys: a 16 × 16 array is <V of="synth.ws16.gates" fmt="int" />{" "}
        gates and <V of="synth.ws16.ffs" fmt="int" /> flip-flops.
      </CheckedStrip>
      <section aria-labelledby="rtl-heading" className="mt-12" data-rtl-home>
        <h2 id="rtl-heading" className="text-xl font-semibold tracking-tight">
          The RTL beside the model
        </h2>
        <p className="mt-4 max-w-2xl text-neutral-600 dark:text-neutral-300">
          The waveform is the weight-stationary array in Verilator, read from
          its VCD; below it is the model&apos;s frame for the same clock edge.
          Step through: the shadow weights shift down each column while the
          previous tile computes, and each PE swaps them in as the next
          tile&apos;s first activation arrives. Shift the model by one cycle and
          the mismatches light up (
          <V of="wsrtl.demoShifted" fmt="int" /> of{" "}
          <V of="wsrtl.demoValues" fmt="int" /> registers), the check&apos;s
          negative control.{" "}
          <Link href="/model#synthesis" className={A}>
            Synthesis numbers
          </Link>{" "}
          for every PE and array size are on the model page.
        </p>
        <div className="mt-6">
          <RtlWaveWidget testId="rtl-wave-home" />
        </div>
      </section>
      <section aria-labelledby="learn-heading" className="mt-12">
        <h2 id="learn-heading" className="text-xl font-semibold tracking-tight">
          What you&apos;ll learn
        </h2>
        <p className="mt-4 max-w-2xl text-neutral-600 dark:text-neutral-300">
          A matrix unit is a grid of multiply-accumulate cells that pass numbers
          to their neighbours every clock cycle: each operand is fetched from
          memory once and used by a whole row or column of cells. This site
          takes that machine apart one cycle at a time: which operand stays put,
          how the inputs are skewed so everything meets at the right moment, and
          where the cycles go.
        </p>
        <p className="mt-4 max-w-2xl text-neutral-600 dark:text-neutral-300">
          Every animation is drawn from a cycle-accurate model of the array
          (Python reference, exact TypeScript port). Its weight-stationary and
          output-stationary frames, and the processing element&apos;s pipeline,
          match SystemVerilog designs simulated in Verilator on every register
          after every clock edge: <V of="wsrtl.allValues" fmt="int" /> values,{" "}
          <V of="wsrtl.allMismatches" fmt="int" /> mismatches.
        </p>
      </section>
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
