// The coalition an MP was ELECTED with, cleaned off their parliament.bg profile record.
//
// Lives in its own module so it can be tested without importing scrape_mps.ts, whose
// top-level `run(cli, …)` would execute the CLI as an import side effect — the same reason
// region.ts exists.

/** Every quote glyph parliament.bg has been seen to wrap a party name in.
 *
 *  Shared with the browser-side fold (`stripGroupPrefix` in
 *  src/data/parties/parliamentGroupAliases.ts) in intent but not in code: that one strips at
 *  the EDGES of an already-prefixed group label, this one replaces throughout. Keeping the
 *  glyph class identical is what stops the two disagreeing about what a quote is. */
export const PARTY_QUOTE_CHARS = /[„“”"«»'‘’]/g;

/**
 * Strip the quoting and collapse whitespace. Does NOT normalise the name itself — the
 * canonical mapping lives in data/canonical_parties.json and is the consumer's job.
 *
 * REPLACE WITH A SPACE, do not strip the edges. parliament.bg's quoting is genuinely
 * unbalanced: the raw corpus holds `"Коалиция за България"`, `Партия "Атака"` and
 * `ПП "ГЕРБ` — measured over all 4,284 cached profiles, 3,715 carry a value in 49 distinct
 * raw forms, 16 of them quoted. An edge-strip leaves `Партия "Атака` on ~400 of them; a
 * delete-throughout would join words on any name with an internal quote. Replace + collapse
 * is the only one of the three that is right for all of them.
 */
export const electedWithOf = (raw: {
  A_ns_CoalL_value?: string;
}): string | null => {
  const v = (raw.A_ns_CoalL_value ?? "")
    .replace(PARTY_QUOTE_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return v || null;
};
