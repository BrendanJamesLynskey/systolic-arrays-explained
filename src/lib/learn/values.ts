/**
 * The learning layer's numbers (brief 44) that are not already a path in
 * the chapters' value tree (`src/lib/sa/values.ts`): each is computed here
 * from the tested model's values, at build time. A self-check cites one as
 * `<Check v="…">`, prose as `<V v="…" />`; tests/unit/learn.test.ts checks
 * every one.
 */
import { lookup } from "@/lib/sa/values";

const num = (path: string): number => {
  const v = lookup(path);
  if (typeof v !== "number") throw new Error(`${path} is not a number`);
  return v;
};

const VALUES: Record<string, () => number> = {
  // chapter 5: buffer words per MAC, decode-like (M = 8) over M = 512, 256 x 256
  "ch05.decodeTraffic": () => num("bw.m8.r256.ws") / num("bw.m512.r256.ws"),
  // chapter 7: one ring's steps over the torus's, 16 x 16 pod
  "ch07.ringOverTorus": () => num("torus.bigRing") / num("torus.big"),
};

export const LEARN_VALUE_NAMES = Object.keys(VALUES);

const CACHE = new Map<string, number>();

export function learnValue(name: string): number {
  const cached = CACHE.get(name);
  if (cached !== undefined) return cached;
  const f = VALUES[name];
  if (!f) throw new Error(`no learn value ${name}`);
  const v = f();
  if (!Number.isFinite(v)) throw new Error(`learn value ${name} is ${v}`);
  CACHE.set(name, v);
  return v;
}
