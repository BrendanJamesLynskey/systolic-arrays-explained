# Systolic Arrays Explained

An animated explainer of the hardware that does a model's matrix
multiplies: why a systolic array beats the memory wall, the
weight-stationary array of the first TPU cycle by cycle, output- and
input-stationary side by side, and where the cycles go (skew, fill, drain
and tiling). Every chapter is built around an animation, and every frame of
every animation is a cycle of a **cycle-accurate model** of the array whose
TypeScript port matches its Python reference exactly, and whose
output-stationary frames match a **SystemVerilog array simulated in
Verilator** on every accumulator after every clock edge.

It is the sixth of a family of companion sites: the
[Transformer Decoder Explainer](https://transformer-decoder-explained.vercel.app/)
shows one forward pass, [LLM Inference Explained](https://llm-inference-explained.vercel.app/)
shows how a model is served, [LLM Architectures Explained](https://llm-architectures-explained.vercel.app/)
shows how the models differ, [GPU Kernels Explained](https://gpu-kernels-explained.vercel.app/)
shows how a GPU runs the maths, [Numerics Explained](https://numerics-explained.vercel.app/)
is about the number formats, and this site is the silicon underneath. They
share one design system and link to each other from the header ("Decoder ·
Inference · Architectures · Kernels · Numerics · Silicon").

**Live:** [systolic-arrays-explained.vercel.app](https://systolic-arrays-explained.vercel.app/)

![A weight-stationary array cycle by cycle: weights held, activations moving right, partial sums moving down](docs/screenshots/04-weight-stationary.png)

## Part of

This project sits in the [LLMs](https://github.com/BrendanJamesLynskey/LLMs)
hub, next to the other companion sites. The chapters link the matching
slides of the [Google TPU](https://brendanjameslynskey.github.io/LLM_Hub_Google_TPUs/)
series and the [AI matrix-multiply unit](https://brendanjameslynskey.github.io/AI_MMUL_Unit/)
deck, and the RTL cross-check runs a design from
[Interview_RTL_LLM_Accelerators](https://github.com/BrendanJamesLynskey/Interview_RTL_LLM_Accelerators).

## Chapters

| #   | Chapter                                                                                                           | The animation                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | [Why systolic?](https://systolic-arrays-explained.vercel.app/learn/01-why-systolic)                               | Data pulsing through a 4 × 4 array; the memory wall, with an n × n grid fed with and without reuse as n grows.                                          |
| 02  | [Weight-stationary, cycle by cycle](https://systolic-arrays-explained.vercel.app/learn/02-weight-stationary)      | Weights load, skewed activations march right, partial sums flow down and results drain out: every register's value, every cycle, for any M, K, N.       |
| 03  | [Output- and input-stationary](https://systolic-arrays-explained.vercel.app/learn/03-output-and-input-stationary) | The same matmul in all three dataflows on one clock, with reads, writes, hops, partial-sum hops and register writes counted; output-stationary in full. |
| 04  | [Skew, fill and drain](https://systolic-arrays-explained.vercel.app/learn/04-skew-fill-drain)                     | The diagonal wavefront and the busy-PE count per cycle; utilisation against stream length and against matrix width, tile by tile.                       |

Chapters 5–9 (tiling and double-buffered SRAM, inside a PE, the TPU, other
ways to build it, from graph to silicon) follow in the next part.

## Screenshots

|                                                                     |                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| ![Landing](docs/screenshots/01-landing.png)                         | ![Data pulsing through the array](docs/screenshots/02-hero.png) |
| ![The memory wall](docs/screenshots/03-memory-wall.png)             | ![Weight-stationary](docs/screenshots/04-weight-stationary.png) |
| ![Three dataflows](docs/screenshots/05-dataflows.png)               | ![Output-stationary](docs/screenshots/06-output-stationary.png) |
| ![The wavefront](docs/screenshots/07-wavefront.png)                 | ![Utilisation](docs/screenshots/08-utilisation.png)             |
| ![The model and the RTL cross-check](docs/screenshots/09-model.png) |                                                                 |

Regenerate them with `pnpm build && pnpm start` in one shell and
`pnpm screenshots` in another.

## The model

[`reference/systolic.py`](reference/systolic.py) is a cycle-accurate model in
plain Python; [`src/lib/sa/model.ts`](src/lib/sa/model.ts) repeats it line
for line. A frame is the state of every register after the clock edge that
ends a cycle, computed only from the previous frame and the values entering
at the edges, so data moves exactly one PE per cycle. Each PE has a
stationary register, a register moving right, a register moving down and
(output-stationary) an accumulator, each holding a tag that names the
element of A, B or C it carries. It implements:

- **Weight-stationary** (B held in a K × N block, loaded by shifting down
  the columns; A streamed with the skew; partial sums moving down),
  **output-stationary** (C held in an M × N block; A and B streamed; results
  drained down the columns) and **input-stationary** (A held; B streamed),
  on any array at least as big as the block (the rest idle);
- **tiling** of problems that do not fit, tile by tile, with the partial
  sums of a split K added in the output buffer;
- **row-stationary** (Eyeriss) for a 2-D convolution, as a reference;
- **counters** per cycle: MACs, buffer reads and writes, PE-to-PE hops,
  partial-sum hops and register writes; and the closed forms for all of
  them;
- the higher-level views the chapters draw: the memory-wall argument,
  utilisation against stream length and against matrix width.

Integers only, so there is nothing to round: the port matches the
reference exactly.

### Checked

- [`tests/python/test_systolic.py`](tests/python/test_systolic.py): every
  result against **numpy's matmul** (every dataflow, many shapes, arrays
  bigger than the problem, full-range signed INT8) and a direct convolution;
  every product read back from the frames happens in the PE and at the cycle
  the **textbook timing** gives (m + k + n); operands and partial sums move
  one PE per cycle; the **closed forms** for cycles and every counter equal
  the counts from the frames; tiled runs equal the sum of their tiles.
- **RTL**: [`rtl/check_rtl.py`](rtl/check_rtl.py) runs the output-stationary
  array of [challenge 01](https://github.com/BrendanJamesLynskey/Interview_RTL_LLM_Accelerators/blob/b37984fc89019d999f6866492433b6cad0977ae8/02_datapath_design/coding_challenges/challenge_01_systolic_array.sv)
  (vendored unchanged in [`rtl/systolic_array_os.sv`](rtl/systolic_array_os.sv);
  [`rtl/VENDORED.json`](rtl/VENDORED.json) records the commit) in Verilator
  5.020 with a trace testbench, [`rtl/tb_trace.sv`](rtl/tb_trace.sv), and
  compares every accumulator after every rising edge with the model, on
  three problems including full-range signed INT8: 613 values, 0
  mismatches ([`rtl/rtl_check.json`](rtl/rtl_check.json), raw traces in
  [`rtl/traces/`](rtl/traces/)). `--shift 1` compares each edge with the
  next cycle instead and reports mismatches in every case, so the comparison
  can fail. CI repeats the run. The same testbench in Vivado xsim 2025.2
  gives byte-identical traces (run locally; CI has no Vivado). Weight- and input-stationary are checked
  against the matmul, the timing and the closed forms, not RTL.
- [`scripts/make_fixtures.py`](scripts/make_fixtures.py) writes the
  reference's traces; [`tests/unit/model.test.ts`](tests/unit/model.test.ts)
  requires the port to reproduce **every register of every PE in every
  cycle**: in full for the chapters' demonstrations and through SHA-256
  digests for all 216 problem sizes the sliders allow. CI fails if the
  fixtures are out of date.
- **Frame tests**: [`tests/unit/frames.test.ts`](tests/unit/frames.test.ts)
  and [`tests/e2e/frames.spec.ts`](tests/e2e/frames.spec.ts) set key frames
  of every animation and require the state, the PEs marked as multiplying
  and the caption on the page to match the Python reference's.
- Numbers in the chapters are printed from the model at build time
  (`<V of="ws.cycles" />`), every code block shown is cut from the model's
  source ([`content.test.ts`](tests/unit/content.test.ts)), and numbers the
  prose states in words are recomputed in
  [`values.test.ts`](tests/unit/values.test.ts).

**Illustrative, and labelled so on the site:** the matrices (small seeded
integers, −4 to 5, so the values fit in the drawings); each pass counted on
its own (weights loaded before every tile, no overlap between tiles; real
arrays double-buffer and overlap, so utilisation figures are lower bounds);
output-stationary results draining down the columns (the RTL reads them in
parallel); the memory bandwidths of chapter 1 (round numbers); and the
8-bit operand / 32-bit partial-sum widths used to weigh traffic in bits.

## The animations

Every animation follows the family's visual standard: play and pause, step
back and forward, a scrub bar, speed from 0.25× to 4× and reset; Space and
the arrow keys when it has focus; a live caption per step, also in an
`aria-live` region; no auto-play with `prefers-reduced-motion`; paused when
scrolled out of view; the equation beside the picture, with the term the
animation is on highlighted. Colours are Okabe and Ito's colour-blind-safe
palette, the same in light and dark mode: activations (A) blue, weights (B)
vermillion, partial sums sky blue, results purple; a PE that multiplies gets
a thick outline and an idle PE is grey and hatched. The pictures are plain
SVG drawn by React from the model's frames (no animation library), and every
SVG label renders at 11 px or more on a 390 px phone.

## Stack

- **Framework**: Next.js 14 (App Router) + TypeScript (strict)
- **Styling**: Tailwind CSS, Tailwind plugin for ESLint + Prettier
- **Content**: MDX via `next-mdx-remote`, KaTeX rendered on the server
- **Model**: Python reference, TypeScript port, JSON fixtures; RTL in
  Verilator
- **Testing**: pytest (numpy), Vitest (exact parity, frames, content; 100%
  line coverage on `src/lib/sa/`), Playwright (every page at 1280 and
  390 px, light and dark; every animation's controls; frame tests; reduced
  motion; axe-core scans)
- **CI / deploy**: GitHub Actions (model, fixtures and RTL; lint, typecheck,
  unit, e2e, Lighthouse), Vercel

No database and no sign-in: every page is statically rendered, and each
animation is a code-split client component.

### Design system: where each piece came from

Copied from [numerics-explained](https://github.com/BrendanJamesLynskey/numerics-explained)
at commit `e4b7ae7`, which copied it from the other companion sites:

| Here                                                                                                                                               | From                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `tailwind.config.ts`, `src/app/globals.css`, `src/app/layout.tsx`                                                                                  | identical apart from titles; `globals.css` has this site's equation-highlight keys     |
| `src/components/ui/SiteHeader.tsx`, `SiteSwitch.tsx`                                                                                               | the same header and six-way switch, with Silicon now live                              |
| `src/components/anim/`, `src/lib/anim/clock.ts`, `src/components/viz/useSvgFont.ts`, `src/components/mdx/Eq.tsx`, `V.tsx`                          | unchanged (`V` reads this site's values)                                               |
| `src/lib/viz/palette.ts`                                                                                                                           | the family palette, plus this site's data and dataflow colours                         |
| `src/app/learn/`, `src/lib/mdx/`, `Layer.tsx`, `LayerToggle.tsx`, `MdxTable.tsx`, `Controls.tsx`, `Callout.tsx`, `lazy.tsx`                        | copied                                                                                 |
| `.eslintrc.json`, `.prettierrc.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `lighthouserc.json`, `.github/workflows/ci.yml` | adapted (model, fixtures and RTL job; new pages)                                       |
| `scripts/smoke-check.ts`, `scripts/capture-screenshots.ts`, `scripts/capture-animations.ts`, `scripts/check_links.py`, `RUNBOOK.md`                | adapted                                                                                |
| `rtl/systolic_array_os.sv`                                                                                                                         | Interview_RTL_LLM_Accelerators challenge 01 at `b37984f`, the design modules unchanged |

A shared npm package for the design system would be cleaner in principle;
for a handful of small sites, copying and recording the origin stays
simpler.

## Local development

- Node ≥ 20.11 and pnpm ≥ 9 (pinned via `packageManager`); Python ≥ 3.10;
  Verilator 5 for the RTL check.
- No environment variables, no database.

```bash
git clone https://github.com/BrendanJamesLynskey/systolic-arrays-explained
cd systolic-arrays-explained
pnpm install
python3 -m venv .venv && .venv/bin/pip install -r reference/requirements.txt
pnpm dev                              # http://localhost:3000
```

## Changing the model

```bash
# edit reference/systolic.py, then the same change in src/lib/sa/model.ts
.venv/bin/python -m pytest tests/python      # against numpy, the timing, the closed forms
.venv/bin/python scripts/make_fixtures.py    # regenerate the fixtures
.venv/bin/python rtl/check_rtl.py            # the RTL cross-check (needs verilator)
pnpm test                                    # the port must match exactly
```

## Testing

```bash
.venv/bin/python -m pytest tests/python   # reference model
.venv/bin/python rtl/check_rtl.py --check # RTL = model, every edge
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test:coverage                        # Vitest with thresholds (exact parity included)
pnpm test:e2e                             # Playwright on a production build (builds first)
pnpm lighthouse                           # Lighthouse CI on a `pnpm build`
pnpm smoke <url>                          # post-deploy check of every page
python3 scripts/check_links.py            # every external link, deck anchor and arXiv id
```

## Deploying

See [`RUNBOOK.md`](RUNBOOK.md): a CLI deploy from a clean `git archive`
export, then `pnpm smoke`.

## Project layout

```
content/chapters/     The MDX chapters, each opening with its animation
reference/            The Python model
rtl/                  The vendored SystemVerilog array, its trace testbench and the cross-check
scripts/              make_fixtures, smoke-check, capture-screenshots, check_links
src/app/              Routes: /, /learn, /learn/[slug], /model, /about
src/lib/sa/           The TypeScript model, the captions, the values the prose quotes
src/lib/anim/         The animation clock
src/components/anim/  The animation hook and panel (controls, caption, equation)
src/components/viz/   The array drawing (every register of every PE) and the matrices
src/components/interactive/  The chapters' widgets
tests/python/         pytest
tests/unit/           Vitest (fixtures in tests/fixtures/)
tests/e2e/            Playwright + axe-core
```

## References

- H. T. Kung, 1982 — _[Why systolic architectures?](https://doi.org/10.1109/MC.1982.1653825)_, IEEE Computer 15(1); H. T. Kung and C. E. Leiserson — _Systolic arrays (for VLSI)_, Sparse Matrix Proceedings 1978 (SIAM, 1979), also CMU technical report CMU-CS-79-103.
- Jouppi et al., 2017 — _[In-Datacenter Performance Analysis of a Tensor Processing Unit](https://arxiv.org/abs/1704.04760)_, ISCA 2017.
- Chen, Emer and Sze, 2016 — _[Eyeriss: A Spatial Architecture for Energy-Efficient Dataflow for Convolutional Neural Networks](https://doi.org/10.1109/ISCA.2016.40)_, ISCA 2016; Sze, Chen, Yang and Emer, 2017 — _[Efficient Processing of Deep Neural Networks: A Tutorial and Survey](https://arxiv.org/abs/1703.09039)_.
- Samajdar et al., 2018 — _[SCALE-Sim: Systolic CNN Accelerator Simulator](https://arxiv.org/abs/1811.02883)_; Genc et al., 2019 — _[Gemmini: Enabling Systematic Deep-Learning Architecture Evaluation via Full-Stack Integration](https://arxiv.org/abs/1911.09925)_.
- Okabe and Ito, 2008 — _[Color Universal Design](https://jfly.uni-koeln.de/color/)_ (the palette).

## Contributing

PRs welcome. CI runs the model job (pytest, fixtures up to date, the RTL
cross-check in Verilator), `format:check`, `lint`, `typecheck`, unit tests
with coverage thresholds, e2e on a production build, and Lighthouse CI
(performance, accessibility and best practices must each score at least 90
on `/`, `/model` and every chapter).

## Licence

MIT — see [`LICENSE`](LICENSE).
