/**
 * Frame tests on the page (visual standard §4): set key frames of every
 * animation and require the caption on screen to be the caption built from
 * the Python reference's state for that frame (tests/fixtures), and the
 * registers drawn to be the reference's.
 */
import { expect, test, type Locator } from "@playwright/test";

import fx from "../fixtures/sa_fixtures.json";
import fb from "../fixtures/sa_fixtures_b.json";

import { minus } from "@/lib/format";
import {
  compareCaption,
  cycleCaption,
  heroCaption,
  reuseCaption,
  utilCaption,
  waveCaption,
} from "@/lib/sa/captions";
import {
  bandwidthCaption,
  lowerCaption,
  peCaption,
  rsCaption,
  streamCaption,
  torusCaption,
  wordsPerMac,
} from "@/lib/sa/captionsB";
import type { Layer, LowerStep } from "@/lib/sa/lower";
import type { PeTrace } from "@/lib/sa/pe";
import type { StreamTrace } from "@/lib/sa/stream";
import type { TorusFrame } from "@/lib/sa/torus";
import type {
  Counts,
  Dataflow,
  Frame,
  ReuseStep,
  RsTrace,
  ShapeStep,
  Trace,
  UtilStep,
} from "@/lib/sa/model";

// No autoplay (reduced motion): the test sets each frame itself.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function change(fig: Locator, act: () => Promise<void>): Promise<void> {
  const before = (await fig.getAttribute("data-key")) ?? "";
  await act();
  await expect(fig).not.toHaveAttribute("data-key", before);
}

async function show(fig: Locator, s: number): Promise<void> {
  if ((await fig.getAttribute("data-playing")) === "true")
    await fig.getByTestId("play").click();
  await fig.getByTestId("scrub").fill(String(s));
  await expect(fig).toHaveAttribute("data-step", String(s));
  await expect(fig).toHaveAttribute("data-playing", "false");
}

const caption = (fig: Locator) => fig.getByTestId("caption");
const tr = (k: keyof typeof fx.traces) => fx.traces[k] as unknown as Trace;
const dims = (t: Trace) => ({
  M: t.M,
  K: t.K,
  N: t.N,
  rows: t.rows,
  cols: t.cols,
});

/** The PEs that multiply in a frame, as "r,c" (what the page marks). */
function macs(f: Frame): string[] {
  const out: string[] = [];
  f.pe.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell[4] !== null) out.push(`${r},${c}`);
    }),
  );
  return out;
}

async function pageMacs(fig: Locator): Promise<string[]> {
  return fig
    .locator('[data-mac="1"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-pe") ?? ""));
}

test("chapter 2: weight-stationary frames", async ({ page }) => {
  await page.goto("/learn/02-weight-stationary");
  const fig = page.getByTestId("cycle-widget");
  const t = tr("ws");
  for (const s of [0, t.K + 3, 11, t.cycles - 1]) {
    await show(fig, s);
    await expect(caption(fig)).toHaveText(
      cycleCaption("ws", dims(t), t.frames[s]!),
    );
    expect(await pageMacs(fig)).toEqual(macs(t.frames[s]!));
  }
  // the results so far are C's first entries
  await expect(fig.getByTestId("c-so-far")).toContainText(
    minus(String(t.C[4]![3])),
  );
});

test("chapter 3: output- and input-stationary frames", async ({ page }) => {
  await page.goto("/learn/03-output-and-input-stationary");
  const fig = page.getByTestId("os-widget");
  for (const [df, key] of [
    ["os", "cmp_os"],
    ["is", "cmp_is"],
  ] as const) {
    if (df === "is")
      await change(fig, () =>
        fig.getByRole("radio", { name: "input-stationary" }).click(),
      );
    const t = tr(key);
    for (const s of [1, 5, t.cycles - 1]) {
      await show(fig, s);
      await expect(caption(fig)).toHaveText(
        cycleCaption(df as Dataflow, dims(t), t.frames[s]!),
      );
      expect(await pageMacs(fig)).toEqual(macs(t.frames[s]!));
    }
  }
});

test("chapter 3: the three dataflows side by side", async ({ page }) => {
  await page.goto("/learn/03-output-and-input-stationary");
  const fig = page.getByTestId("compare-widget");
  const ts = { ws: tr("cmp_ws"), os: tr("cmp_os"), is: tr("cmp_is") };
  const total = Math.max(ts.ws.cycles, ts.os.cycles, ts.is.cycles);
  for (const s of [2, 6, total - 1]) {
    await show(fig, s);
    const counts = {} as Record<Dataflow, Counts>;
    const done = {} as Record<Dataflow, boolean>;
    for (const df of ["ws", "os", "is"] as const) {
      counts[df] = ts[df].frames[Math.min(s, ts[df].cycles - 1)]!.cnt;
      done[df] = s >= ts[df].cycles - 1;
    }
    await expect(caption(fig)).toHaveText(compareCaption(s, counts, done));
  }
});

test("chapter 1: the hero and the memory wall", async ({ page }) => {
  await page.goto("/learn/01-why-systolic");
  const hero = page.getByTestId("hero-ch1");
  const t = tr("hero");
  for (const s of [0, 6, t.cycles - 1]) {
    await show(hero, s);
    await expect(caption(hero)).toHaveText(heroCaption(t.frames[s]!, 16));
  }
  const fig = page.getByTestId("reuse-widget");
  const r = fx.reuse as ReuseStep[];
  for (const s of [0, 7, r.length - 1]) {
    await show(fig, s);
    await expect(caption(fig)).toHaveText(reuseCaption(r[s]!, fx.demo.beta));
  }
});

test("chapter 4: the wavefront and utilisation", async ({ page }) => {
  await page.goto("/learn/04-skew-fill-drain");
  const fig = page.getByTestId("wavefront-widget");
  const w = fx.demo.wave;
  for (const s of [2, 9, 14]) {
    await show(fig, s);
    await expect(caption(fig)).toHaveText(
      waveCaption(s, w.K, fx.active[s]!, w.K * w.N, w),
    );
  }
  const u = page.getByTestId("util-widget");
  const us = fx.util.ws as UtilStep[];
  for (const s of [0, 7, us.length - 1]) {
    await show(u, s);
    await expect(caption(u)).toHaveText(
      utilCaption("ws", "stream", us[s]!, fx.demo.array, fx.demo.array),
    );
  }
  await change(u, () => u.getByRole("radio", { name: /matrix width/ }).click());
  const sh = fx.shape.ws as ShapeStep[];
  for (const s of [7, 8, sh.length - 1]) {
    await show(u, s);
    await expect(caption(u)).toHaveText(
      utilCaption("ws", "shape", sh[s]!, fx.demo.array, fx.demo.array),
    );
  }
});

/** The PEs that multiply in a stream frame, as "r,c". */
function streamMacs(f: StreamTrace["frames"][number]): string[] {
  const out: string[] = [];
  f.pe.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell[4] !== null) out.push(`${r},${c}`);
    }),
  );
  return out;
}

test("chapter 5: tiles back to back, and buffer bandwidth", async ({
  page,
}) => {
  await page.goto("/learn/05-tiling");
  const fig = page.getByTestId("tile-stream-widget");
  for (const [key, act] of [
    ["default", null],
    ["noShadow", "single"],
  ] as const) {
    if (act)
      await change(fig, () => fig.getByRole("radio", { name: act }).click());
    const t = fb.stream[key] as unknown as StreamTrace;
    for (const s of [0, 4, 12, t.cycles - 1]) {
      await show(fig, s);
      await expect(caption(fig)).toHaveText(streamCaption(t, s));
      expect(await pageMacs(fig)).toEqual(streamMacs(t.frames[s]!));
    }
  }
  const bw = page.getByTestId("bandwidth-widget");
  const rows = fb.bandwidth["512"];
  for (const s of [0, 3, rows.length - 1]) {
    await show(bw, s);
    const per = {} as Record<Dataflow, number>;
    for (const df of ["ws", "os", "is"] as const)
      per[df] = wordsPerMac(rows[s]![df].words, 512 * 1024 * 1024);
    await expect(caption(bw)).toHaveText(
      bandwidthCaption(rows[s]!.array, 512, per),
    );
  }
});

test("chapter 6: the PE pipeline", async ({ page }) => {
  await page.goto("/learn/06-inside-a-pe");
  const fig = page.getByTestId("pe-widget");
  for (const mode of ["bf16", "fp16", "int8"] as const) {
    if (mode !== "bf16")
      await change(fig, () =>
        fig
          .getByRole("radio", {
            name: new RegExp(`^${mode === "fp16" ? "FP16" : "INT8"}`),
          })
          .click(),
      );
    const t = fb.pe[mode] as unknown as PeTrace;
    for (const s of [0, 3, 6, t.cycles - 1]) {
      await show(fig, s);
      await expect(caption(fig)).toHaveText(
        peCaption(mode, t, fb.peDemo.count, s),
      );
    }
  }
});

test("chapter 7: all-reduce on the torus", async ({ page }) => {
  await page.goto("/learn/07-the-tpu");
  const fig = page.getByTestId("torus-widget");
  const frames = fb.torus.frames as unknown as TorusFrame[];
  for (const s of [0, 2, 5, frames.length - 1]) {
    await show(fig, s);
    await expect(caption(fig)).toHaveText(torusCaption(frames[s]!, 4, 4));
    // the links lit are those that carry data in this step
    const lit = await fig.locator('path[data-active="1"]').count();
    expect(lit).toBe(s === 0 ? 0 : 16);
  }
});

test("chapter 8: row-stationary", async ({ page }) => {
  await page.goto("/learn/08-other-ways");
  const fig = page.getByTestId("rs-widget");
  const t = fx.rs.trace as unknown as RsTrace;
  for (const s of [0, 4, 9, t.cycles - 1]) {
    await show(fig, s);
    await expect(caption(fig)).toHaveText(rsCaption(t, s));
    const want: string[] = [];
    t.frames[s]!.pe.forEach((row, i) =>
      row.forEach((cell, j) => {
        if (cell[2] !== null) want.push(`${i},${j}`);
      }),
    );
    expect(await pageMacs(fig)).toEqual(want);
  }
});

test("chapter 9: lowering the ONNX graph", async ({ page }) => {
  await page.goto("/learn/09-graph-to-silicon");
  const fig = page.getByTestId("lower-widget");
  const layers = fb.lower.layers["8"] as unknown as Layer[];
  const steps = fb.lower.steps["8"] as unknown as LowerStep[];
  for (const s of [0, 9, 38, steps.length - 2, steps.length - 1]) {
    await show(fig, s);
    await expect(caption(fig)).toHaveText(
      lowerCaption(steps[s]!, layers, 8, 6, 3),
    );
  }
});
