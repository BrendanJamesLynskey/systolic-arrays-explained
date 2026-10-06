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
  tiles,
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
  it("chapter 5", () => {
    // "a 1024 x 1024 weight matrix on a 128 x 128 array is 64 tiles"
    expect(tiles("ws", 1, 1024, 1024, 128, 128).length).toBe(64);
    // "two of K by two of N"
    expect(lookup("stream.tiles")).toBe(4);
    expect(tiles("ws", 6, 6, 6, 3, 3).map((t) => [t[2], t[4]])).toEqual([
      [0, 0],
      [3, 0],
      [0, 3],
      [3, 3],
    ]);
    // the swap test: back to back is faster, and the bandwidth story
    expect(lookup("stream.cycles")).toBeLessThan(
      lookup("stream.seq") as number,
    );
    expect(lookup("stream.bw1double")).toBeLessThan(
      lookup("stream.bw1single") as number,
    );
    // "every doubling of the array roughly halves the traffic per MAC"
    const big = lookup("bw.m512.r256.ws") as number;
    const small = lookup("bw.m512.r8.ws") as number;
    expect(small / big).toBeGreaterThan(16);
    expect(lookup("bw.m512.r8.os")).toBeLessThan(
      lookup("bw.m512.r8.ws") as number,
    );
  });
  it("chapter 6", () => {
    // significand products: bfloat16 8 x 8 -> 16 bits, FP16 11 x 11 -> 22 bits
    expect(Math.log2((2 ** 8 - 1) ** 2)).toBeLessThan(16);
    expect(Math.log2((2 ** 11 - 1) ** 2)).toBeLessThan(22);
    // "three cycles" of latency: a product reaches acc two edges after stage 1
    expect(lookup("pe.fp16.rounded")).toBeGreaterThan(0);
    expect(lookup("pe.bf16.rounded")).toBeGreaterThan(0);
    expect(lookup("mac.mismatches")).toBe(0);
    // 53 >= 2 x 24 + 2 (Figueroa)
    expect(53).toBeGreaterThanOrEqual(2 * 24 + 2);
  });
  it("chapter 7", () => {
    expect(lookup("torus.steps")).toBe(12);
    expect(lookup("torus.big")).toBe(60);
    expect(lookup("torus.bigRing")).toBe(510);
    expect(lookup("torus.perChip")).toBe(2 * (16 - 1));
  });
  it("chapter 9", () => {
    // "36 x 27 x 8", "3 input channels and 3 x 3 filters", "up to 9 rows"
    expect([
      lookup("lower.conv.M"),
      lookup("lower.conv.K"),
      lookup("lower.conv.N"),
    ]).toEqual([36, 27, 8]);
    expect(lookup("lower.conv.K")).toBe(3 * 3 * 3);
    // "within a few per cent" on the Gemm; "differ by more" on the conv
    const fa = lookup("lower.fc.approx") as number;
    const fo = lookup("lower.fc.seqOs") as number;
    expect(Math.abs(fa - fo) / fo).toBeLessThan(0.03);
    const ca = lookup("lower.conv.approx") as number;
    const co = lookup("lower.conv.seqOs") as number;
    expect(Math.abs(ca - co) / co).toBeGreaterThan(0.2);
    expect(lookup("lower.simfrontOk")).toBe("agree");
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
