/**
 * The fixtures' digest (scripts/make_fixtures.py `digest`): SHA-256 over a
 * canonical serialisation in which every number is its IEEE double bit
 * pattern, so two results agree only if they are bit-identical.
 */
import { createHash } from "node:crypto";

const DV = new DataView(new ArrayBuffer(8));

export function hexf(x: number): string {
  if (Number.isNaN(x)) return "nan";
  DV.setFloat64(0, x);
  return (
    DV.getUint32(0).toString(16).padStart(8, "0") +
    DV.getUint32(4).toString(16).padStart(8, "0")
  );
}

function flat(obj: unknown, out: string[]): void {
  if (typeof obj === "boolean") out.push(obj ? "t" : "f");
  else if (typeof obj === "number") out.push(hexf(obj));
  else if (Array.isArray(obj)) {
    out.push("[");
    for (const o of obj) flat(o, out);
    out.push("]");
  } else if (obj === null || obj === undefined) out.push("null");
  else if (typeof obj === "object") {
    out.push("{");
    const rec = obj as Record<string, unknown>;
    for (const k of Object.keys(rec).sort()) {
      out.push(k);
      flat(rec[k], out);
    }
    out.push("}");
  } else out.push(String(obj));
}

export function digest(obj: unknown): string {
  const parts: string[] = [];
  flat(obj, parts);
  return createHash("sha256").update(parts.join(",")).digest("hex");
}
