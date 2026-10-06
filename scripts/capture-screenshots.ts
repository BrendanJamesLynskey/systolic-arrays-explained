/**
 * Captures the README screenshots. Manual run, output committed.
 *
 *   pnpm build && pnpm start   # in another shell
 *   pnpm screenshots           # headless Chromium writes docs/screenshots/*.png
 *
 * Light theme, fixed viewport, reduced motion (nothing plays by itself), and
 * each animation set to a chosen mid-animation frame by its scrub bar, so
 * the pictures are reproducible.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const OUT = path.join(process.cwd(), "docs", "screenshots");
const BASE = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";

type Shot = { name: string; path: string; widget?: string; step?: number };

const SHOTS: Shot[] = [
  { name: "01-landing", path: "/" },
  {
    name: "02-hero",
    path: "/learn/01-why-systolic",
    widget: "hero-ch1",
    step: 9,
  },
  {
    name: "03-memory-wall",
    path: "/learn/01-why-systolic",
    widget: "reuse-widget",
    step: 7,
  },
  {
    name: "04-weight-stationary",
    path: "/learn/02-weight-stationary",
    widget: "cycle-widget",
    step: 9,
  },
  {
    name: "05-dataflows",
    path: "/learn/03-output-and-input-stationary",
    widget: "compare-widget",
    step: 5,
  },
  {
    name: "06-output-stationary",
    path: "/learn/03-output-and-input-stationary",
    widget: "os-widget",
    step: 4,
  },
  {
    name: "07-wavefront",
    path: "/learn/04-skew-fill-drain",
    widget: "wavefront-widget",
    step: 10,
  },
  {
    name: "08-utilisation",
    path: "/learn/04-skew-fill-drain",
    widget: "util-widget",
    step: 40,
  },
  { name: "09-model", path: "/model" },
  {
    name: "10-tiles-back-to-back",
    path: "/learn/05-tiling",
    widget: "tile-stream-widget",
    step: 9,
  },
  {
    name: "11-bandwidth",
    path: "/learn/05-tiling",
    widget: "bandwidth-widget",
    step: 2,
  },
  {
    name: "12-inside-a-pe",
    path: "/learn/06-inside-a-pe",
    widget: "pe-widget",
    step: 5,
  },
  {
    name: "13-torus-all-reduce",
    path: "/learn/07-the-tpu",
    widget: "torus-widget",
    step: 5,
  },
  {
    name: "14-row-stationary",
    path: "/learn/08-other-ways",
    widget: "rs-widget",
    step: 7,
  },
  {
    name: "15-graph-to-silicon",
    path: "/learn/09-graph-to-silicon",
    widget: "lower-widget",
    step: 39,
  },
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  for (const s of SHOTS) {
    await page.goto(BASE + s.path, { waitUntil: "networkidle" });
    const file = path.join(OUT, `${s.name}.png`);
    if (s.widget) {
      const fig = page.getByTestId(s.widget);
      await fig.waitFor();
      if (s.step !== undefined)
        await fig.getByTestId("scrub").fill(String(s.step));
      await fig.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file });
    }
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
  await browser.close();
}

void main();
