/**
 * /model: the cycle-accurate model's conventions, the closed forms the
 * tests check it against, and the RTL cross-check, with its numbers read
 * from rtl/rtl_check.json (written by rtl/check_rtl.py). Server Component,
 * static: every number is computed by the model at build time.
 */
import simfront from "../../../reference/simfront_check.json";
import rtl from "../../../rtl/rtl_check.json";
import synth from "../../../rtl/synth.json";

import { RtlWaveWidget } from "@/components/interactive/lazy";
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
import { MAC_FILE, RTL_FILE, SIMFRONT_URL, repoFile } from "@/lib/site";
import { withShare } from "@/lib/share";

export const metadata = withShare("/model", {
  title: "The model",
  description:
    "The cycle-accurate systolic-array model: registers, timing and closed forms for weight-, output- and input-stationary dataflows, its cycle-by-cycle cross-checks against SystemVerilog arrays in Verilator, and Yosys synthesis numbers for the PEs and arrays.",
});

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
          The weight-stationary array has its own RTL (below). The
          input-stationary dataflow is not checked against RTL; it is checked
          against a direct matrix multiply, its textbook timing and its closed
          forms.
        </p>

        <h2>The processing element against its RTL</h2>
        <p>
          Chapter 6&apos;s PE is the author&apos;s three-stage mixed-precision
          MAC unit (modules <code>fp16_mul_to_fp32</code>, <code>fp32_add</code>{" "}
          and <code>mac_unit_mixed_precision</code> of the{" "}
          <a href={MAC_FILE} className={A}>
            MAC unit challenge
          </a>
          , vendored unchanged at commit {rtl.macSource.commit.slice(0, 7)} as{" "}
          <a href={repoFile("rtl/mac_unit.sv")} className={A}>
            rtl/mac_unit.sv
          </a>
          ).{" "}
          <a href={repoFile("rtl/tb_mac_trace.sv")} className={A}>
            rtl/tb_mac_trace.sv
          </a>{" "}
          drives one operation per cycle and prints every pipeline register
          after every rising edge; the same script compares them with{" "}
          <code>reference/pe.py</code>, which models the unit register for
          register (FP16 mode: the stage-1 operands, the exact FP32 product, the
          FP32 accumulator, valid and clear; INT8 mode: the operand bytes, the
          INT16 product and the INT32 accumulator). With <code>--shift 1</code>{" "}
          every case reports mismatches. The same five runs in Vivado xsim
          2025.2 give byte-identical traces (run locally). The site&apos;s
          bfloat16 mode has no RTL counterpart and is checked against NumPy.
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="The MAC unit cross-check, case by case (scrolls sideways)"
        >
          <table className="w-full text-sm" data-testid="mac-table">
            <thead>
              <tr>
                <th className={TH}>Case</th>
                <th className={TH}>Mode</th>
                <th className={TH}>Operations</th>
                <th className={TH}>Valid</th>
                <th className={TH}>Dot products</th>
                <th className={TH}>Edges</th>
                <th className={TH}>Registers compared</th>
                <th className={TH}>Mismatches</th>
              </tr>
            </thead>
            <tbody>
              {rtl.mac.map((c) => (
                <tr
                  key={c.name}
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className={TD}>{c.name}</td>
                  <td className={TD}>{c.mode.toUpperCase()}</td>
                  <td className={TD}>{c.ops}</td>
                  <td className={TD}>{c.valid}</td>
                  <td className={TD}>{c.dots}</td>
                  <td className={TD}>{c.edges}</td>
                  <td className={TD}>{int(c.values)}</td>
                  <td className={TD}>{c.mismatches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 id="ws-rtl">The weight-stationary array against its RTL</h2>
        <p>
          <a href={repoFile("rtl/systolic_array_ws.sv")} className={A}>
            rtl/systolic_array_ws.sv
          </a>{" "}
          is chapter 5&apos;s machine in SystemVerilog, written for this site:
          an R × C grid of PEs, each with a stationary weight, a shadow weight,
          an activation and a partial-sum register (valid bit,{" "}
          {rtl.wsTotals.tagBits}
          -bit tile tag, value). Weights shift down each column&apos;s shadow
          chain; in load step <em>l</em> rows 0 … <em>l</em> shift and the rows
          below hold (a per-column step counter restarted by{" "}
          <code>w_first</code>). A PE latches an arriving activation only if its
          stationary or shadow weight carries the same tile tag, and swaps the
          shadow weight in on that edge. Row 0 starts each partial sum at zero;
          a tile of <em>k</em> rows completes its sums in row <em>k</em> − 1.{" "}
          <a href={repoFile("rtl/tb_ws_trace.sv")} className={A}>
            rtl/tb_ws_trace.sv
          </a>{" "}
          replays the model&apos;s edge inputs (the weights entering each column
          and the skewed activations entering each row, from{" "}
          <code>simulate_ws_stream</code>) and prints every register after every
          rising edge; edge <em>t</em> + 1 is the model&apos;s cycle <em>t</em>.
          The check compares all four registers of every PE (an empty
          register&apos;s stale bits are not compared), reads the results back
          from each tile&apos;s last row and requires them to equal <em>AB</em>,
          and records the negative control: every case mismatches against the
          model one cycle late. The testbench drives the schedule, so this
          checks the array, not a controller. Two mutations (shifting every
          shadow row on every load step; latching activations whatever their
          tile) were each caught by the check when it was written.
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="The weight-stationary RTL check, case by case (scrolls sideways)"
        >
          <table className="w-full text-sm" data-testid="ws-rtl-table">
            <thead>
              <tr>
                <th className={TH}>Case</th>
                <th className={TH}>M × K × N</th>
                <th className={TH}>Array</th>
                <th className={TH}>Weights</th>
                <th className={TH}>Tiles</th>
                <th className={TH}>Edges</th>
                <th className={TH}>Registers compared</th>
                <th className={TH}>Mismatches</th>
                <th className={TH}>Shifted one cycle</th>
                <th className={TH}>C = AB</th>
              </tr>
            </thead>
            <tbody>
              {rtl.ws.map((c) => (
                <tr
                  key={c.name}
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className={TD}>{c.name}</td>
                  <td className={TD}>
                    {c.M} × {c.K} × {c.N}
                  </td>
                  <td className={TD}>
                    {c.rows} × {c.cols}
                  </td>
                  <td className={TD}>
                    {c.shadow ? "shadow" : "single"}
                    {c.bw ? `, HBM ${c.bw} w/cycle, ${c.buffers} buffer` : ""}
                  </td>
                  <td className={TD}>{c.tiles}</td>
                  <td className={TD}>{c.edges}</td>
                  <td className={TD}>{int(c.values)}</td>
                  <td className={TD}>{c.mismatches}</td>
                  <td className={TD}>{int(c.mismatchesShifted)}</td>
                  <td className={TD}>{c.cResultsMatch ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The panel draws the first case from the simulator&apos;s VCD (
          <a href={repoFile("rtl/ws_wave.json")} className={A}>
            rtl/ws_wave.json
          </a>
          , written by the same script; it checks that the VCD and the printed
          trace agree) beside the TypeScript model.
        </p>
        <RtlWaveWidget testId="rtl-wave-model" />

        <h2 id="synthesis">Synthesis</h2>
        <p>
          <a href={repoFile("rtl/synth_yosys.py")} className={A}>
            rtl/synth_yosys.py
          </a>{" "}
          synthesises the RTL with{" "}
          {synth.tools.yosys.replace(/ \(git .*\)/, "")} (the YoWASP WebAssembly
          build, pinned in <code>rtl/requirements-synth.txt</code>, so it gives
          the same netlist on any machine; CI repeats it and fails if{" "}
          <code>rtl/synth.json</code> changes). The MAC unit goes through sv2v{" "}
          {synth.tools.sv2v} first, because Yosys&apos;s front end does not
          accept its <code>break</code>. Two flows:
        </p>
        <ul>
          <li>
            <strong>Generic gates:</strong>{" "}
            <code>{synth.tools.flows.generic}</code>. Gates are Yosys&apos;s
            internal two-input cells and MUX; depth is the number of gates on
            the longest path between flip-flops or ports (<code>ltp</code>);
            transistors is Yosys&apos;s estimate for static CMOS after every
            flip-flop becomes a plain D flip-flop (its enable and reset become
            gates). It is an area proxy with no standard-cell library, no wires,
            no process node and no timing.
          </li>
          <li>
            <strong>AMD 7-series:</strong> <code>{synth.tools.flows.xc7}</code>.
            Yosys&apos;s own FPGA mapping, not Vivado&apos;s, with no placement
            or routing, so no Fmax. Multiplies map to DSP48E1 slices; the
            output-stationary PE&apos;s multiply-accumulate folds into one DSP48
            with its accumulator, which is why that array needs almost no LUTs.
          </li>
        </ul>
        {(["pe", "array", "mul"] as const).map((grp) => (
          <div
            key={grp}
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={`Synthesis results: ${grp === "pe" ? "processing elements" : grp === "array" ? "arrays" : "multipliers"} (scrolls sideways)`}
          >
            <table className="w-full text-sm" data-testid={`synth-${grp}`}>
              <thead>
                <tr>
                  <th className={TH}>Design</th>
                  <th className={TH}>Gates</th>
                  <th className={TH}>Flip-flops</th>
                  <th className={TH}>Depth</th>
                  <th className={TH}>Transistors (est.)</th>
                  <th className={TH}>7-series LUTs</th>
                  <th className={TH}>FFs</th>
                  <th className={TH}>DSP48</th>
                  <th className={TH}>CARRY4</th>
                </tr>
              </thead>
              <tbody>
                {synth.designs
                  .filter((d) => d.group === grp)
                  .map((d) => (
                    <tr
                      key={d.key}
                      className="border-t border-neutral-200 dark:border-neutral-800"
                    >
                      <td className="py-1 pr-3">
                        {d.label.replace(/ x /g, " × ")}
                      </td>
                      <td className={TD}>{int(d.generic.gates)}</td>
                      <td className={TD}>{int(d.generic.flipFlops)}</td>
                      <td className={TD}>{d.generic.depth}</td>
                      <td className={TD}>{int(d.generic.transistors)}</td>
                      <td className={TD}>{int(d.xc7.luts)}</td>
                      <td className={TD}>{int(d.xc7.flipFlops)}</td>
                      <td className={TD}>{d.xc7.dsp48}</td>
                      <td className={TD}>{d.xc7.carry4}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
        <p>
          The arrays scale with their PE count while the logic depth hardly
          moves: a systolic array&apos;s wires are all neighbour to neighbour.
          The 16 × 16 output-stationary array has 16 times the 4 × 4&apos;s PEs
          and{" "}
          {(
            synth.designs.find((d) => d.key === "os-16")!.generic.transistors /
            synth.designs.find((d) => d.key === "os-4")!.generic.transistors
          ).toFixed(1)}{" "}
          times its transistors. The weight-stationary array grows faster (
          {(
            synth.designs.find((d) => d.key === "ws-16")!.generic.transistors /
            synth.designs.find((d) => d.key === "ws-4")!.generic.transistors
          ).toFixed(1)}{" "}
          times), because its top row&apos;s PEs need no adder (their partial
          sums start at zero): a quarter of a 4 × 4, a sixteenth of a 16 × 16.
          Both arrays expose every PE&apos;s registers as ports, as the trace
          check needs, so no register is optimised away.
        </p>

        <h2>Tiles back to back</h2>
        <p>
          Chapter 5 adds a shadow weight register to every PE and runs a
          GEMM&apos;s weight-stationary tiles back to back (
          <code>simulateWsStream</code>). The model checks, every cycle, that a
          PE swaps in the weight of the tile whose activation has just arrived
          and that every partial sum meets its next product in step; moving one
          tile&apos;s load or stream a cycle earlier makes it stop with an
          error. Its cycle counts equal the closed form{" "}
          <em>
            S<sub>j+1</sub> = max(S<sub>j</sub> + M, L<sub>j+1</sub> + k
            <sub>j+1</sub>)
          </em>
          , and with the shadow registers off they equal chapter 4&apos;s tiles
          in sequence.
        </p>

        <h2>The lowering against Torch_Sim_Frontend</h2>
        <p>
          Chapter 9 lowers{" "}
          <a href={repoFile("reference/data/tiny_cnn.onnx")} className={A}>
            a small ONNX model
          </a>{" "}
          onto the array.{" "}
          <a href={repoFile("scripts/check_simfront.py")} className={A}>
            scripts/check_simfront.py
          </a>{" "}
          runs the author&apos;s{" "}
          <a href={SIMFRONT_URL} className={A}>
            Torch_Sim_Frontend
          </a>{" "}
          (commit {simfront.simfront.commit.slice(0, 7)}) on the same file: its
          ONNX front end and GEMM rule give the same shapes, and its
          cycle-approximate array formula the same numbers, on a{" "}
          {simfront.array} × {simfront.array} array.
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="The lowering cross-check, node by node (scrolls sideways)"
        >
          <table className="w-full text-sm" data-testid="simfront-table">
            <thead>
              <tr>
                <th className={TH}>Node</th>
                <th className={TH}>simfront category</th>
                <th className={TH}>GEMM (batch, M, K, N)</th>
                <th className={TH}>simfront cycles</th>
                <th className={TH}>Agree</th>
              </tr>
            </thead>
            <tbody>
              {simfront.nodes.map((n) => (
                <tr
                  key={n.name}
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className={TD}>{n.op.replace("onnx.", "")}</td>
                  <td className={TD}>{n.category}</td>
                  <td className={TD}>
                    {n.simfront.length ? n.simfront[0]!.join(" × ") : "none"}
                  </td>
                  <td className={TD}>
                    {"simfrontCycles" in n ? n.simfrontCycles : "–"}
                  </td>
                  <td className={TD}>{n.agree ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Row-stationary, as a reference</h2>
        <p>
          For a convolution, Eyeriss&apos;s row-stationary dataflow gives PE(i,
          j) filter row i and input row i + j; each PE slides its filter row
          along its input row, one MAC per cycle, and each column of PEs adds
          its rows into one output row. The model runs it too (
          <code>simulateRs</code>): a {rs.H} × {rs.W} input and a {rs.R} ×{" "}
          {rs.S} filter take {rsTrace.cycles} cycles on {rsTrace.R} ×{" "}
          {rsTrace.E} PEs, and the output equals a direct convolution. Chapter 8
          animates it.
        </p>
      </div>
    </main>
  );
}
