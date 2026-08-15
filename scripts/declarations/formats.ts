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
 *             companies-index.json, assets-rankings.json,
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
