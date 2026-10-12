// Tour narration that quotes MEASURED figures without hard-coding them.
//
// The lateral-link tour used to write its overlaps as literals („18 757 изпълнителя …") beside a
// test pinning the same literals — so every watcher reload that moved a join by a handful of rows
// turned the build red until somebody re-typed three numbers in two languages (eleven re-pins
// between 2026-08-15 and 2026-10-12). The figure the prose wants is the overlap the builder has
// ALREADY measured for that link, so the prose names the link instead and the builder writes the
// number in:
//
//   „… — {{overlap:connections|procurement|eik}} изпълнителя се намират там …"
//
// The token is the link's manifest id. An unknown id, or a link the build could not measure, is a
// build FAILURE (`unresolvedTourTokens`), never a blank or a zero in published prose.

import type { Lang } from "./model";

const TOKEN = /\{\{overlap:([^}]+)\}\}/g;

/** The link ids a piece of prose quotes. */
export const tourTokens = (text: string): string[] =>
  [...text.matchAll(TOKEN)].map((m) => m[1]);

/** An integer as each language writes a count: „18,794" / „18 794". */
export const formatCount = (n: number, lang: keyof Lang): string => {
  const en = Math.round(n).toLocaleString("en-US");
  return lang === "bg" ? en.replace(/,/g, " ") : en;
};

/** Writes each `{{overlap:<link id>}}` as that link's measured overlap, per language. A token
 *  with no measurement is left in place — `unresolvedTourTokens` is what refuses to ship it. */
export const renderTourText = (
  text: Lang,
  overlapOf: (linkId: string) => number | undefined,
): Lang => {
  const render = (s: string, lang: keyof Lang) =>
    s.replace(TOKEN, (whole, id: string) => {
      const n = overlapOf(id);
      return n === undefined ? whole : formatCount(n, lang);
    });
  return { bg: render(text.bg, "bg"), en: render(text.en, "en") };
};

/** Tokens in the prose that `overlapOf` cannot answer — each one would publish a raw `{{…}}`. */
export const unresolvedTourTokens = (
  texts: Lang[],
  overlapOf: (linkId: string) => number | undefined,
): string[] => [
  ...new Set(
    texts
      .flatMap((t) => [...tourTokens(t.bg), ...tourTokens(t.en)])
      .filter((id) => overlapOf(id) === undefined),
  ),
];
