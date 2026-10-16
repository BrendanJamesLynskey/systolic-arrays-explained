/**
 * How this site presents itself when a link to it is shared (brief 39): its name, track, one-line
 * claim and how it is checked, as drawn on the link-preview card (src/app/_og/card.tsx), and the
 * Open Graph and Twitter tags for each page. Every page passes its own path to `withShare`, so
 * a shared chapter link names that chapter, not the home page.
 */
import type { Metadata } from "next";

import { SITE_URL } from "@/lib/site";

export type Share = {
  name: string;
  /** The track in the site menu (null: the site sits outside the four tracks). */
  track: string | null;
  /** The card's top line, when it is not "<TRACK> TRACK". */
  kicker?: string;
  /** The one-line claim under the name on the card. */
  claim: string;
  /** How the site is checked, in one line (from the About page). */
  checkedShort: string;
  /** The site's colour on its card and favicon. */
  color: string;
  url: string;
  description: string;
};

export const SHARE: Share = {
  name: "Systolic Arrays Explained",
  track: "Hardware",
  claim: "How the hardware multiplies matrices",
  checkedShort:
    "Output-stationary frames match a SystemVerilog array in Verilator: 613 values, 0 mismatches",
  color: "#0284c7",
  url: SITE_URL,
  description:
    "How matrix-multiply hardware works: systolic arrays cycle by cycle in weight-, output- and input-stationary dataflows, skew, tiling, inside a processing element, the TPU, other matrix engines and lowering a graph to the array, each animated by a cycle-accurate model, parts of it checked against RTL.",
};

/** `m` plus Open Graph and Twitter tags for the page at `path` (titled as `m` titles it). */
export function withShare<M extends Metadata>(
  path: string,
  m: M,
  share: Share = SHARE,
): M & Pick<Metadata, "openGraph" | "twitter"> {
  const t = m.title;
  const own =
    typeof t === "string"
      ? t
      : t && typeof t === "object" && "absolute" in t
        ? t.absolute
        : null;
  const title =
    own && !own.endsWith(share.name)
      ? `${own} · ${share.name}`
      : (own ?? share.name);
  const description =
    typeof m.description === "string" ? m.description : share.description;
  return {
    ...m,
    openGraph: {
      title,
      description,
      url: path,
      siteName: share.name,
      type: path === "/" ? "website" : "article",
      locale: "en_GB",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
