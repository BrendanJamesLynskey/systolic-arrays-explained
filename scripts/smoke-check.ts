/**
 * scripts/smoke-check.ts
 *
 * Post-deploy smoke check, adapted from the companion sites'. Fetches every
 * page and exits non-zero if any fails:
 *
 *     pnpm smoke https://systolic-arrays-explained.vercel.app
 *
 * With no argument it checks http://localhost:3000. For a protected
 * preview deployment, pass the bypass token as VERCEL_BYPASS (sent as the
 * `x-vercel-protection-bypass` header; never printed).
 *
 * Fails when a page is not a 200 (redirects count as failures) or lacks
 * the content that proves it rendered from the model: the landing page and
 * the model page must print the model's own numbers (computed here with
 * the same code), every chapter must render its MDX (a layer, server-
 * rendered KaTeX and the animation's placeholder), and the header must
 * carry the two-group site switch with Silicon current.
 */
import { int } from "@/lib/format";
import { SECTIONS } from "@/lib/mdx/sections";
import { cycles } from "@/lib/sa/model";
import { lookup } from "@/lib/sa/values";

type Result = { path: string; ok: boolean; detail: string };

const headers: Record<string, string> = process.env.VERCEL_BYPASS
  ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS }
  : {};

const SWITCH = [
  'data-site-switch="full"',
  'href="https://agent-harnesses-explained.vercel.app"',
  'href="https://agent-protocols-explained.vercel.app"',
  'href="https://agent-context-explained.vercel.app"',
  'href="https://systolic-arrays-explained.vercel.app"',
  'href="https://numerics-explained.vercel.app"',
  'data-site-switch="compact"',
];

async function checkPage(
  base: string,
  path: string,
  mustContain: string[],
): Promise<Result> {
  try {
    const res = await fetch(base + path, { redirect: "manual", headers });
    if (res.status !== 200)
      return { path, ok: false, detail: String(res.status) };
    const html = await res.text();
    const missing = mustContain.filter((s) => !html.includes(s));
    if (missing.length)
      return {
        path,
        ok: false,
        detail: `200 but missing ${missing.join(", ")}`,
      };
    return { path, ok: true, detail: "200" };
  } catch (err) {
    return { path, ok: false, detail: (err as Error).message };
  }
}

async function main(): Promise<void> {
  const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
  const checks: Promise<Result>[] = [
    checkPage(base, "/", [
      "Systolic Arrays Explained",
      `data-v="rtl.values">${int(lookup("rtl.values") as number)}<`,
      `data-v="rtl.mismatches">0<`,
      ...SWITCH,
    ]),
    checkPage(base, "/model", [
      'data-testid="rtl-table"',
      int(cycles("ws", 128, 128, 128)),
      "n4_k7_int8",
    ]),
    checkPage(base, "/about", ["How it is checked", "Against RTL"]),
    checkPage(
      base,
      "/learn",
      SECTIONS.map((x) => x.slug),
    ),
    ...SECTIONS.map((x) =>
      checkPage(base, `/learn/${x.slug}`, [
        'data-layer="concept"',
        "data-pending-widget",
        'class="katex"',
        ...SWITCH,
      ]),
    ),
  ];
  const results = await Promise.all(checks);
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.path} ${r.detail}`);
  }
  console.log(
    `${results.length - failed}/${results.length} checks passed against ${base}`,
  );
  if (failed) process.exit(1);
}

void main();
