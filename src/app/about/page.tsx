/**
 * /about: what the site is, how the cycle-accurate model is checked, what
 * is illustrative, how the animations are driven, and where the design came
 * from. Server Component, static.
 */
import Link from "next/link";

import { V } from "@/components/mdx/V";
import {
  ARCHITECTURES_URL,
  DECODER_URL,
  GITHUB_URL,
  INFERENCE_URL,
  KERNELS_URL,
  NUMERICS_URL,
  TPU_HUB,
  repoFile,
} from "@/lib/site";

export const metadata = {
  title: "About",
  description:
    "How Systolic Arrays Explained's cycle-accurate model is checked against a direct matrix multiply, its own closed forms and a SystemVerilog array in Verilator, and what is illustrative.",
};

const A =
  "focus-ring rounded text-accent underline underline-offset-2 dark:text-indigo-300";

export default function AboutPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-accent dark:text-indigo-300">
        /about
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        About this site
      </h1>
      <div className="mdx-content mt-6">
        <p>
          Systolic Arrays Explained is about the hardware that does a
          model&apos;s matrix multiplies: systolic arrays, their dataflows, and
          the matrix units of TPUs. Each chapter is built around an animation.
          It is the sixth of a family of companion sites, with the{" "}
          <a href={DECODER_URL} className={A}>
            Transformer Decoder Explainer
          </a>
          ,{" "}
          <a href={INFERENCE_URL} className={A}>
            LLM Inference Explained
          </a>
          ,{" "}
          <a href={ARCHITECTURES_URL} className={A}>
            LLM Architectures Explained
          </a>
          ,{" "}
          <a href={KERNELS_URL} className={A}>
            GPU Kernels Explained
          </a>{" "}
          and{" "}
          <a href={NUMERICS_URL} className={A}>
            Numerics Explained
          </a>
          . The chapters link the matching slides of the{" "}
          <a href={TPU_HUB} className={A}>
            Google TPU
          </a>{" "}
          series.
        </p>

        <h2>The model</h2>
        <p>
          <a href={repoFile("reference/systolic.py")} className={A}>
            reference/systolic.py
          </a>{" "}
          is a cycle-accurate model of a parameterised array in plain Python,
          and{" "}
          <a href={repoFile("src/lib/sa/model.ts")} className={A}>
            src/lib/sa/model.ts
          </a>{" "}
          repeats it line for line. Every PE&apos;s registers are recomputed
          each cycle from the previous cycle&apos;s, exactly as flip-flops
          behave, in weight-, output- and input-stationary dataflows, with
          row-stationary for a convolution as a reference; it also tiles
          problems that do not fit. The arithmetic is all integer, so the two
          agree exactly. The{" "}
          <Link href="/model" className={A}>
            model page
          </Link>{" "}
          lists its conventions and closed forms.
        </p>

        <h2>How it is checked</h2>
        <ul>
          <li>
            <strong>Against a direct matrix multiply.</strong>{" "}
            <a href={repoFile("tests/python/test_systolic.py")} className={A}>
              tests/python/test_systolic.py
            </a>{" "}
            compares every result with numpy, for every dataflow, many shapes,
            arrays larger than the problem, and full-range signed INT8; and the
            row-stationary convolution with a direct convolution.
          </li>
          <li>
            <strong>Against the textbook timing.</strong> The tests read every
            product back from the frames and check it happened in the PE and the
            cycle the derivation in the chapters says, and that operands and
            partial sums move exactly one PE per cycle.
          </li>
          <li>
            <strong>Against its closed forms.</strong> Cycle counts, buffer
            reads and writes, PE-to-PE hops, partial-sum hops and register
            writes, counted from the frames, equal the formulas on the model
            page; tiled runs equal the sum of their tiles.
          </li>
          <li>
            <strong>Against RTL.</strong>{" "}
            <a href={repoFile("rtl/check_rtl.py")} className={A}>
              rtl/check_rtl.py
            </a>{" "}
            runs the author&apos;s SystemVerilog output-stationary array in{" "}
            <V of="rtl.simulator" fmt="raw" /> and compares every accumulator
            after every clock edge with the model:{" "}
            <V of="rtl.values" fmt="int" /> values,{" "}
            <V of="rtl.mismatches" fmt="int" /> mismatches. CI repeats it.
          </li>
          <li>
            <strong>Exact parity.</strong>{" "}
            <a href={repoFile("scripts/make_fixtures.py")} className={A}>
              scripts/make_fixtures.py
            </a>{" "}
            writes the reference&apos;s traces, and the unit tests require the
            TypeScript port to reproduce every register of every PE in every
            cycle: in full for the chapters&apos; demonstrations, and through
            SHA-256 digests for every size the sliders allow. CI fails if the
            fixtures are out of date.
          </li>
          <li>
            <strong>Animations from the model.</strong> Every animation draws
            the model&apos;s frames; a picture is a pure function of one frame.
            The tests set chosen frames of every animation and require the
            caption to match the caption built from the Python reference&apos;s
            frame.
          </li>
          <li>
            <strong>Numbers in the prose</strong> are printed from the model
            when the page is built, not typed.
          </li>
        </ul>

        <h2>What is illustrative</h2>
        <ul>
          <li>
            The matrices are small seeded integers (−4 to 5) so their values fit
            in the drawings; the RTL check also runs full-range INT8.
          </li>
          <li>
            Each pass is counted on its own: the weights load before the stream
            and passes do not overlap. Real arrays double-buffer the weights and
            run tiles back to back.
          </li>
          <li>
            Output-stationary results drain down the columns one row per cycle;
            other designs read them out in parallel.
          </li>
          <li>
            The memory-bandwidth figures of chapter 1 are round numbers, not a
            particular chip&apos;s.
          </li>
        </ul>

        <h2>The animations</h2>
        <p>
          Every animation has play and pause, step back and forward, a scrub
          bar, speeds from 0.25× to 4× and reset; with the animation focused,
          Space plays or pauses and the arrow keys step. Each step has a
          one-line caption, also announced to screen readers. With{" "}
          <em>reduce motion</em> set in your system, nothing plays by itself.
          Animations pause when scrolled out of view. Colours come from Okabe
          and Ito&apos;s colour-blind-safe palette, the same in light and dark
          mode: activations (A) blue, weights (B) vermillion, partial sums sky
          blue, results purple. A PE that multiplies in a cycle gets a thick
          outline; an idle PE is grey and hatched.
        </p>

        <h2>Source</h2>
        <p>
          The code, the model and the tests are on{" "}
          <a href={GITHUB_URL} className={A}>
            GitHub
          </a>{" "}
          (MIT licence). The design system is copied from the companion sites;
          the README records where each piece came from.
        </p>
      </div>
    </main>
  );
}
