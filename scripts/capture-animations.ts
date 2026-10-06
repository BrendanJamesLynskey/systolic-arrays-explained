/**
 * Records the README's animated GIFs (and WebM videos) of the hero
 * animations. Manual run, output committed; a heavy job, so run it alone:
 *
 *   pnpm build && pnpm start   # in another shell
 *   pnpm animations            # writes docs/media/*.gif and *.webm
 *
 * Every frame is a model state set by the animation's scrub bar (reduced
 * motion, so nothing plays by itself), screenshotted, then joined by
 * ffmpeg: the recordings are reproducible frame for frame. Needs ffmpeg on
 * the PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";

const OUT = path.join(process.cwd(), "docs", "media");
const BASE = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";

type Clip = {
  name: string;
  path: string;
  widget: string;
  /** frames per second of the output */
  fps: number;
  /** a radio to press first (a parameter), if any */
  radio?: string;
};

const CLIPS: Clip[] = [
  { name: "hero", path: "/learn/01-why-systolic", widget: "hero-ch1", fps: 3 },
  {
    name: "weight-stationary",
    path: "/learn/02-weight-stationary",
    widget: "cycle-widget",
    fps: 2,
  },
  {
    name: "dataflows",
    path: "/learn/03-output-and-input-stationary",
    widget: "compare-widget",
    fps: 2,
  },
  {
    name: "wavefront",
    path: "/learn/04-skew-fill-drain",
    widget: "wavefront-widget",
    fps: 3,
  },
  {
    name: "tiles-back-to-back",
    path: "/learn/05-tiling",
    widget: "tile-stream-widget",
    fps: 3,
  },
  {
    name: "inside-a-pe",
    path: "/learn/06-inside-a-pe",
    widget: "pe-widget",
    fps: 1,
  },
  {
    name: "torus-all-reduce",
    path: "/learn/07-the-tpu",
    widget: "torus-widget",
    fps: 1,
  },
  {
    name: "row-stationary",
    path: "/learn/08-other-ways",
    widget: "rs-widget",
    fps: 2,
  },
  {
    name: "graph-to-silicon",
    path: "/learn/09-graph-to-silicon",
    widget: "lower-widget",
    fps: 4,
  },
];

// `pnpm animations outliers gptq` records only the named clips
const ONLY = process.argv.slice(2);

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  for (const c of CLIPS) {
    if (ONLY.length > 0 && !ONLY.includes(c.name)) continue;
    const dir = mkdtempSync(path.join(tmpdir(), `num-${c.name}-`));
    await page.goto(BASE + c.path, { waitUntil: "networkidle" });
    const fig = page.getByTestId(c.widget);
    await fig.waitFor();
    if (c.radio) await fig.getByRole("radio", { name: c.radio }).click();
    const scrub = fig.getByTestId("scrub");
    const max = Number(await scrub.getAttribute("max"));
    const visual = fig.getByTestId("visual");
    for (let s = 0; s <= max; s++) {
      await scrub.fill(String(s));
      await visual.screenshot({
        path: path.join(dir, `f${String(s).padStart(4, "0")}.png`),
      });
    }
    const input = path.join(dir, "f%04d.png");
    const gif = path.join(OUT, `${c.name}.gif`);
    const webm = path.join(OUT, `${c.name}.webm`);
    // even dimensions for the video encoder; a shared palette for the GIF
    const scale = "scale=560:-2:flags=lanczos";
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(c.fps),
      "-i",
      input,
      "-vf",
      `${scale},split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none`,
      "-loop",
      "0",
      gif,
    ]);
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(c.fps),
      "-i",
      input,
      "-vf",
      scale,
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      "40",
      "-pix_fmt",
      "yuv420p",
      webm,
    ]);
    rmSync(dir, { recursive: true, force: true });
    console.log(
      `wrote ${path.relative(process.cwd(), gif)} and .webm (${max + 1} frames)`,
    );
  }
  await browser.close();
}

void main();
