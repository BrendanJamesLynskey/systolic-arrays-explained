/**
 * <V of="…" fmt="…" />: a number from the tested model,
 * formatted, in running prose. <V v="…" />: one of the
 * learning layer's model values (src/lib/learn/values.ts), the same way.
 * Server Component.
 */
import { formatValue, lookup, type Fmt } from "@/lib/sa/values";
import { learnValue } from "@/lib/learn/values";

export function V({
  of,
  v,
  fmt = "num",
}: {
  of?: string;
  v?: string;
  fmt?: Fmt;
}): JSX.Element {
  if (of !== undefined)
    return <span data-v={of}>{formatValue(lookup(of), fmt)}</span>;
  if (v === undefined) throw new Error("<V> needs `of` or `v`");
  return <span data-learn-value={v}>{formatValue(learnValue(v), fmt)}</span>;
}
