// The tool layer's two standard envelope shapes.
//
// ⚠ ONE DECLARATION, BECAUSE THEY ARE THE LAYER'S VOCABULARY. `noData` was module-private in
// `areaResults.ts` and hand-rolled again in `presidential.ts`; a third copy is where the
// „I could not answer, and here is why" shape starts to differ between tools, and a reader
// cannot tell a deliberate difference from a drifted one.

import type { Column, Envelope, Lang, Row } from "./types";

/**
 * „No answer, and here is why."
 *
 * ⚠ `facts` MUST NAME THE REASON. An empty scalar envelope is indistinguishable from a place
 * that genuinely cast no votes, and the LLM narrates `facts` — so a reason that is not in there
 * is a reason the reader never gets.
 */
export const noData = (
  tool: string,
  title: string,
  provenance: string[],
  facts: Record<string, string | number> = {},
): Envelope => ({
  tool,
  kind: "scalar",
  title,
  viz: "none",
  facts,
  provenance,
});

/**
 * A ranked table that also carries the same rows as a bar series.
 *
 * ⚠ BOTH, NOT EITHER — the renderer picks. `national.ts` established the idiom and every
 * ranked tool repeats it; the repetition is what this collapses.
 */
export const barTable = (
  columns: Column[],
  rows: Row[],
  labelKey: string,
  valueKey: string,
  lang: Lang,
): Pick<Envelope, "columns" | "rows" | "viz" | "categories" | "series"> => ({
  columns,
  rows,
  viz: "bar",
  categories: rows.map((r) => String(r[labelKey])),
  series: [
    {
      key: valueKey,
      label: lang === "bg" ? "Гласове" : "Votes",
      points: rows.map((r) => ({
        x: String(r[labelKey]),
        y: Number(r[valueKey]),
      })),
    },
  ],
});

/**
 * The first usable string of a tool argument.
 *
 * ⚠ `ToolArgs` VALUES MAY BE `string[]`. `String(args.place)` renders `["Пловдив","Варна"]` as
 * „Пловдив,Варна", which `resolveMunicipality` then fuzzy-matches to *something* — a confident
 * answer about a place nobody named.
 */
export const firstString = (
  v: string | number | string[] | undefined,
): string =>
  Array.isArray(v) ? String(v[0] ?? "").trim() : String(v ?? "").trim();
