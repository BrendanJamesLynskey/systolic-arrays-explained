/**
 * The numbers the chapters print: every <V of="…" /> path in the MDX and
 * the pages resolves in the model, and every number the prose spells out
 * in words (or in a chapter summary) is recomputed here from the model.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { int, minus, pct, sci, signed, sub, sup, trim } from "@/lib/format";
import { SECTIONS } from "@/lib/mdx/sections";
import {
  cycles,
  reuseSteps,
  shapeSteps,
  traffic,
  utilSteps,
} from "@/lib/sa/model";
import { formatValue, lookup, streamFor, type Fmt } from "@/lib/sa/values";

const ROOT = path.join(__dirname, "../..");
const DIR = path.join(ROOT, "content/chapters");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".mdx"));
const PAGES = ["src/app/page.tsx", "src/app/about/page.tsx"];

describe("model values quoted in the chapters", () => {
  const uses: { file: string; of: string; fmt: string }[] = [];
  const sources = [
    ...FILES.map((f) => [f, readFileSync(path.join(DIR, f), "utf8")]),
    ...PAGES.map((p) => [p, readFileSync(path.join(ROOT, p), "utf8")]),
  ];
  for (const [file, src] of sources)
    for (const m of src!.matchAll(/<V of="([^"]+)"(?: fmt="([^"]+)")? \/>/g))
      uses.push({ file: file!, of: m[1]!, fmt: m[2] ?? "num" });

  it("are used", () => expect(uses.length).toBeGreaterThan(50));
  it("all resolve", () => {
    for (const u of uses) {
      const v = lookup(u.of);
      expect(["number", "string"], `${u.file}: ${u.of}`).toContain(typeof v);
      expect(formatValue(v, u.fmt as Fmt).length).toBeGreaterThan(0);
    }
  });
  it("unknown paths fail loudly", () => {
    expect(() => lookup("ws.nothing")).toThrow(/no value/);
    expect(() => lookup("ws")).toThrow(/not a number/);
  });
});

describe("numbers written in words", () => {
  it("chapter 1", () => {
    // "65,536 8-bit MACs" is the TPU paper's figure: a 256 x 256 grid
    expect(256 * 256).toBe(65536);
    const r = reuseSteps(32, 16);
    expect(r[15]!.wordsPerCycle).toBe(32);
    expect(lookup("reuse.naive")).toBe(16);
    expect(lookup("reuse.sys")).toBe(256);
    expect(lookup("reuse.perWord")).toBe(8);
  });
  it("chapter 3", () => {
    // WS and OS make the same number of hops when M = K = N: 5/2 N^2 (N - 1)
    for (const n of [2, 3, 7, 128]) {
      expect(traffic("ws", n, n, n).hops).toBe((5 * n * n * (n - 1)) / 2);
      expect(traffic("os", n, n, n).hops).toBe((5 * n * n * (n - 1)) / 2);
    }
    expect(lookup("big.ws.bits")).toBeGreaterThan(
      lookup("big.os.bits") as number,
    );
  });
  it("chapter 4", () => {
    // the 8 x 8 overhead is 2R + C - 2 = 22, so 90% takes 0.9 * 22 / 0.1 = 198
    expect(lookup("util.overhead")).toBe(22);
    expect(lookup("util.m90")).toBe(198);
    expect(lookup("util.overheadBig")).toBe(766);
    expect(streamFor(8, 8, 0.9)).toBe(198);
    // "64 rows" is the last step of the sweep
    expect(utilSteps("ws", 8, 8, 8, 8, 64)[63]!.x).toBe(64);
    // the drops at N = 9 and 17
    const sh = shapeSteps("ws", 8, 8, 32, 8, 40);
    expect(sh[8]!.util).toBeLessThan(sh[7]!.util);
    expect(sh[16]!.util).toBeLessThan(sh[15]!.util);
    expect(cycles("ws", 0, 8, 8)).toBe(22);
  });
  it("chapter summaries", () => {
    // chapter 1's summary: an n x n grid needs 2n words a cycle
    expect(SECTIONS[0]!.summary).toContain("2n words a cycle");
    expect(reuseSteps(32, 5)[4]!.wordsPerCycle).toBe(10);
  });
});

describe("formatting", () => {
  it("formats every kind", () => {
    expect(formatValue(0.744, "pct")).toBe("74.4%");
    expect(formatValue(0.744, "pct0")).toBe("74%");
    expect(formatValue(12345, "int")).toBe("12,345");
    expect(formatValue(12345, "raw")).toBe("12345");
    expect(formatValue(0.1234567, "num")).toBe("0.1235");
    expect(formatValue("Verilator", "int")).toBe("Verilator");
  });
  it("helpers", () => {
    expect(sub(2, 1)).toBe("₂₁");
    expect(sub(12, 3)).toBe("₁₂,₃");
    expect(signed(-3)).toBe("(−3)");
    expect(signed(3)).toBe("3");
    expect(minus("-4")).toBe("−4");
    expect(sup(-5)).toBe("⁻⁵");
    expect(trim(0)).toBe("0");
    expect(trim(Infinity)).toBe("∞");
    expect(trim(-Infinity)).toBe("−∞");
    expect(trim(NaN)).toBe("NaN");
    expect(trim(1e-6)).toBe(sci(1e-6));
    expect(sci(0)).toBe("0");
    expect(sci(6.104e-5)).toBe("6.104 × 10⁻⁵");
    expect(pct(0.5)).toBe("50%");
    expect(int(1234.4)).toBe("1,234");
  });
});
