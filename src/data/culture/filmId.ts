// A stable, URL-safe id for a single НФЦ film award. The register's own „рег.№"
// is neither unique (28 collisions across the 949-row corpus) nor URL-friendly
// (Cyrillic + „№"), so the browser row-link and the /culture/film/:id record page
// both derive the SAME deterministic id from a film's identifying fields. Computed
// client-side (not stored) so it needs no ingest change; identical inputs on both
// sides guarantee the link resolves.

import type { FilmAward } from "./types";

/** djb2 hash → base36 over the fields that identify a single award. Distinct
 *  films get distinct ids (verified collision-free across the corpus); any
 *  fully-identical duplicate rows would harmlessly collapse to one record. */
export const filmId = (f: FilmAward): string => {
  const s = `${f.year}|${f.regNo}|${f.producer}|${f.subsidyBgn}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** Build an id→film lookup over the whole corpus (first write wins on the
 *  vanishingly rare collision). Used by the record page to resolve :id. */
export const indexFilms = (films: FilmAward[]): Map<string, FilmAward> => {
  const m = new Map<string, FilmAward>();
  for (const f of films) {
    const id = filmId(f);
    if (!m.has(id)) m.set(id, f);
  }
  return m;
};
