/**
 * /model: the cycle-accurate model's conventions, the closed forms the
 * tests check it against, and the RTL cross-check, with its numbers read
 * from rtl/rtl_check.json (written by rtl/check_rtl.py). Server Component,
 * static: every number is computed by the model at build time.
 */
import rtl from "../../../rtl/rtl_check.json";

import { int } from "@/lib/format";
import { DATAFLOW_NAME } from "@/lib/sa/captions";
import {
  DATAFLOWS,
  DEMO,
  cycles,
  demoMatrix,
  simulateRs,
  traffic,
} from "@/lib/sa/model";
import { RTL_FILE, repoFile } from "@/lib/site";

export const metadata = {
  title: "The model",
  description:
    "The cycle-accurate systolic-array model: registers, timing and closed forms for weight-, output- and input-stationary dataflows, and its cycle-by-cycle cross-check against a SystemVerilog array in Verilator.",
};

const A =
  "focus-ring rounded text-accent underline underline-offset-2 dark:text-indigo-300";
const TH = "py-1 pr-3 text-left font-medium";
const TD = "py-1 pr-3 font-mono";

const ROWS: Record<string, [string, string, string, string, string]> = {
  ws: [
    "K × N",
    "B (weights)",
    "aₘₖ in PE(k, n) at m + k + n",
    "K + (M + K + N − 2)",
    "M N (K − 1)",
  ],
  os: [
    "M × N",
    "C (outputs)",
    "aₘₖ, bₖₙ in PE(m, n) at k + m + n",
    "(K + M + N − 2) + M",
    "N M (M − 1) / 2",
  ],
  is: [
    "K × M",
    "A (inputs)",
    "bₖₙ in PE(k, m) at n + k + m",
    "K + (N + K + M − 2)",
    "M N (K − 1)",
  ],
};

export default function ModelPage(): JSX.Element {
  const S = 128;
  const rs = DEMO.rs;
  const rsTrace = simulateRs(
    demoMatrix(rs.H, rs.W, rs.seedX),
    demoMatrix(rs.R, rs.S, rs.seedF),
  );
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-accent dark:text-indigo-300">
        /model
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        The cycle-accurate model
      </h1>
      <div className="mdx-content mt-6">
        <p>
          The model computes <em>C = AB</em> (A is M × K, B is K × N) on an R ×
          C array. A frame is the state of every register after the clock edge
          that ends a cycle, computed only from the previous frame and the
          values entering at the edges, so data moves exactly one PE per cycle.
          A PE holds up to four registers: <strong>s</strong>, the stationary
          operand; <strong>h</strong>, the operand moving right;{" "}
          <strong>v</strong>, what moves down (a partial sum, or in
          output-stationary an operand); and <strong>acc</strong>,
          output-stationary&apos;s accumulator. Each register holds a tag naming
          the element of A, B or C it carries, so the captions can say which
          value is where. Source:{" "}
          <a href={repoFile("reference/systolic.py")} className={A}>
            reference/systolic.py
          </a>{" "}
          and its exact TypeScript port{" "}
          <a href={repoFile("src/lib/sa/model.ts")} className={A}>
            src/lib/sa/model.ts
          </a>
          .
        </p>

        <h2>Dataflows and closed forms</h2>
        <p>
          The array block each dataflow needs, what stays in it, where and when
          each product happens, the cycles of one pass (load, compute and drain)
          and the partial sums moved between PEs. The tests count all of these
          from the frames.
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Dataflows and their closed forms (scrolls sideways)"
        >
          <table className="w-full text-sm" data-testid="dataflow-table">
            <thead>
              <tr>
                <th className={TH}>Dataflow</th>
                <th className={TH}>Block</th>
                <th className={TH}>Stationary</th>
                <th className={TH}>Product</th>
                <th className={TH}>Cycles</th>
                <th className={TH}>Partial-sum hops</th>
              </tr>
            </thead>
            <tbody>
              {DATAFLOWS.map((df) => (
                <tr
                  key={df}
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className="py-1 pr-3">{DATAFLOW_NAME[df]}</td>
                  {ROWS[df]!.map((c, i) => (
                    <td key={i} className={i >= 2 ? TD : "py-1 pr-3"}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          For a {S} × {S} × {S} problem on a {S} × {S} array:
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Traffic for a 128 cube (scrolls sideways)"
        >
          <table className="w-full text-sm" data-testid="traffic-table">
            <thead>
              <tr>
                <th className={TH}>Dataflow</th>
                <th className={TH}>Cycles</th>
                <th className={TH}>Buffer reads</th>
                <th className={TH}>Buffer writes</th>
                <th className={TH}>PE-to-PE hops</th>
                <th className={TH}>Partial-sum hops</th>
                <th className={TH}>Register writes</th>
              </tr>
            </thead>
            <tbody>
              {DATAFLOWS.map((df) => {
                const t = traffic(df, S, S, S);
                return (
                  <tr
                    key={df}
                    className="border-t border-neutral-200 dark:border-neutral-800"
                  >
                    <td className="py-1 pr-3">{DATAFLOW_NAME[df]}</td>
                    <td className={TD}>{int(cycles(df, S, S, S))}</td>
                    <td className={TD}>{int(t.reads)}</td>
                    <td className={TD}>{int(t.writes)}</td>
                    <td className={TD}>{int(t.hops)}</td>
                    <td className={TD}>{int(t.psumHops)}</td>
                    <td className={TD}>{int(t.regWrites)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2>The RTL cross-check</h2>
        <p>
          The design is a parameterised N × N output-stationary array with
          internal skew registers, from the author&apos;s{" "}
          <a href={RTL_FILE} className={A}>
            Interview RTL challenge
          </a>{" "}
          (modules <code>pe</code> and <code>systolic_array</code>, vendored
          unchanged at commit {rtl.source.commit.slice(0, 7)}).{" "}
          <a href={repoFile("rtl/tb_trace.sv")} className={A}>
            rtl/tb_trace.sv
          </a>{" "}
          drives one matrix multiply as the challenge&apos;s own testbench does
          and prints every accumulator after every rising edge;{" "}
          <a href={repoFile("rtl/check_rtl.py")} className={A}>
            rtl/check_rtl.py
          </a>{" "}
          builds it in {rtl.simulator}, runs it and compares. Edge <em>p</em> is
          the model&apos;s compute cycle <em>p</em> − 1; after the last product
          (edge K + 2(N − 1)) the RTL holds its results and pulses{" "}
          <code>valid_out</code>, so there the check requires <em>C = AB</em>.
          Run with <code>--shift 1</code>, comparing each edge with the next
          cycle, it reports mismatches in every case: the comparison can fail.
          The same testbench in Vivado xsim 2025.2 gives byte-identical traces
          (run locally; CI has no Vivado).
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="The RTL cross-check, case by case (scrolls sideways)"
        >
          <table className="w-full text-sm" data-testid="rtl-table">
            <thead>
              <tr>
                <th className={TH}>Case</th>
                <th className={TH}>N</th>
                <th className={TH}>K</th>
                <th className={TH}>Values in</th>
                <th className={TH}>Edges</th>
                <th className={TH}>Accumulators compared</th>
                <th className={TH}>Mismatches</th>
                <th className={TH}>valid_out at edge</th>
              </tr>
            </thead>
            <tbody>
              {rtl.cases.map((c) => (
                <tr
                  key={c.name}
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className={TD}>{c.name}</td>
                  <td className={TD}>{c.N}</td>
                  <td className={TD}>{c.K}</td>
                  <td className={TD}>
                    {c.range[0]} … {c.range[1]}
                  </td>
                  <td className={TD}>{c.edges}</td>
                  <td className={TD}>{int(c.values)}</td>
                  <td className={TD}>{c.mismatches}</td>
                  <td className={TD}>{c.validOutEdges.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The weight- and input-stationary dataflows are not checked against RTL
          here; they are checked against a direct matrix multiply, their
          textbook timing and their closed forms.
        </p>

        <h2>Row-stationary, as a reference</h2>
        <p>
          For a convolution, Eyeriss&apos;s row-stationary dataflow gives PE(i,
          j) filter row i and input row i + j; each PE slides its filter row
          along its input row, one MAC per cycle, and each column of PEs adds
          its rows into one output row. The model runs it too (
          <code>simulateRs</code>): a {rs.H} × {rs.W} input and a {rs.R} ×{" "}
          {rs.S} filter take {rsTrace.cycles} cycles on {rsTrace.R} ×{" "}
          {rsTrace.E} PEs, and the output equals a direct convolution. A later
          chapter uses it.
        </p>
      </div>
    </main>
  );
}
