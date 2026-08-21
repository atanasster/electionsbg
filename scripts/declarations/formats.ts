/**
 * On-disk JSON formats for the declarations pipeline's committed artifacts.
 *
 * These are FIXED per artifact family and deliberately NOT a function of
 * `--prod`. Every other builder in scripts/ takes its formatter from
 * `main.ts`'s single `stringify`, which pretty-prints unless `--prod` is
 * passed — a dev convenience that is correct for the per-election data
 * folders, because those are regenerated wholesale and their diff is never
 * read. It is wrong here: these artifacts are COMMITTED, so the format is
 * part of the file's identity in git.
 *
 * Threading the global one through cost us a refresh with no clean
 * invocation at all. `npm run data -- --declarations` pretty-printed the
 * parliament family (1,438 files, ~892k insertions of pure whitespace);
 * `--prod` wrote them correctly but flipped company_links.json to compact
 * (~928k deletions, also pure whitespace). Both diffs bury the handful of
 * real value changes a reviewer needs to see, and both churn the bucket.
 *
 * So each builder owns its format and no caller passes one in. Two families,
 * confirmed against the committed history rather than assumed:
 *
 *   compact — data/parliament/declarations/*.json, mp-assets/*.json,
 *             assets-rankings.json,
 *             assets-rankings-top.json, car-makes.json, mp-cars.json,
 *             data-provenance.json
 *   pretty  — data/officials/derived/company_links.json
 *
 * Do NOT mass-reformat either family to unify them: each would be a
 * ~million-line no-op diff and a full re-upload of the trees that ship.
 */

/** Single-line. `JSON.stringify(o, null, 0)` is byte-identical to this. */
export const compactJson = (o: object): string => JSON.stringify(o);

/** 2-space indent. */
export const prettyJson = (o: object): string => JSON.stringify(o, null, 2);

/** The three committed per-person declaration shard trees, in loader order. The magistrate
 *  tier is deliberately absent: it is derived from ВСС PDFs, has no cacbg XML behind it and
 *  `data/judiciary/declarations` is empty. Mirrors the specs in
 *  `scripts/db/load_declarations_pg.ts`, which is the authority — this is the copy a
 *  one-off backfill walks, so that „someone missed one" cannot start with a fourth hand-typed
 *  list. */
export const DECLARATION_SHARD_TREES = [
  "data/parliament/declarations",
  "data/officials/declarations",
  "data/officials/municipal/declarations",
] as const;

/** Re-serialise a shard in the EXACT format it was already stored in, detected from the
 *  file's OWN bytes rather than from its tree — so a family that changes format later cannot
 *  start silently churning. Per this file's header: parliament is compact, the officials
 *  trees are 2-space indented, and writing one format for both buries the real change in a
 *  ~1.4M-line whitespace diff that the next ingest immediately writes back. */
export const reserializeShard = (raw: string, obj: unknown): string => {
  const body = /^\s*\[\s*\n/.test(raw)
    ? prettyJson(obj as object)
    : compactJson(obj as object);
  return raw.endsWith("\n") ? body + "\n" : body;
};
