// Write a crawl's OpenCall[] to its COMMITTED snapshot at data/opencalls/<source>.json.
//
// WHY COMMITTED, when funds/ and procurement/ are deliberately PG-only. Three reasons that
// are specific to this dataset and do not generalise:
//   * size — ~66 rows of kilobytes, so the objection that drives PG-only for the 82k-row
//     contracts corpus (a 3GB tree nobody wants in git) simply does not apply;
//   * ARCHIVE — git history then records what was open when, which nobody in Bulgaria
//     publishes, and which makes the corpus reproducible after a source rotates a GUID;
//   * review — the parse stays diffable, which matters most in the first months.
// It does not violate feedback_no_json_from_pg: that rule forbids generating JSON *from*
// Postgres. Here JSON is the ingest artifact and Postgres is the serving layer — the same
// direction as every other loader.
//
// data/opencalls/ must be EXCLUDED from bucket:sync (scripts/bucket_sync_paths.ts). It is
// Cloud-SQL-served like funds/ and procurement/; without the exclusion every sync publishes a
// second copy to a GCS path nothing reads, which is a spare serving surface that can go stale.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateCall, type OpenCall, type OpenCallsSnapshot } from "./types";

const OUT_DIR = "data/opencalls";
/** A register can genuinely contract, but not by a quarter overnight without something
 *  breaking upstream. Same posture as load_kzk_decisions_pg.ts's shrink guard. */
const MAX_SHRINK = 0.25;

/** Sort key: source_key is the stable natural id within a source, so ordering by it keeps the
 *  file's line order fixed across runs. Without this, a source that returns rows in a
 *  different order each crawl produces a whole-file diff and destroys the archive's
 *  readability — the one property the committed snapshot exists for. */
const byKey = (a: OpenCall, b: OpenCall): number =>
  a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0;

/** Throws on a structurally invalid row rather than writing it.
 *
 *  The database would reject it anyway (migration 142's CHECKs), but failing HERE names the
 *  offending call and its problem, whereas the loader would surface a CHECK violation with no
 *  indication of which of 66 rows caused it. */
export const writeSnapshot = (
  source: OpenCall["source"],
  calls: OpenCall[],
  crawledAt = new Date().toISOString(),
  /** Override the destination. Exists so tests write to a temp dir: every value of `source`
   *  is a REAL source with a REAL committed snapshot, so there is no "throwaway" name a test
   *  could pass safely — an earlier version of the test used "az" and deleted
   *  data/opencalls/az.json on every run. */
  outDir: string = OUT_DIR,
  /** Escape hatch for a register that really did contract, and for the guard's own tests. */
  allowShrink = false,
): string => {
  // ── THE TWO GUARDS LIVE HERE, not in a caller ────────────────────────────────────────
  // An earlier version put them in isun_fetch's main(), which meant the NEXT source to call
  // this (sp2023, ahu, az) silently inherited none of them. The snapshot is a committed
  // archive: a bad vintage overwrites a good one at exit 0, and nothing downstream can tell.
  //
  // Zero calls is always a failure, never a state. A tier can legitimately be empty —
  // /PublicDiscussion returned 0 rows on 2026-08-08 — but a SOURCE resolving to nothing means
  // the crawl broke, and publishing that empties the register.
  if (calls.length === 0)
    throw new Error(
      `${source}: refusing to write an empty snapshot — zero calls means the crawl failed, not that the register is empty`,
    );

  const prevPath = path.join(outDir, `${source}.json`);
  if (!allowShrink && existsSync(prevPath)) {
    try {
      const prev = JSON.parse(
        readFileSync(prevPath, "utf-8"),
      ) as OpenCallsSnapshot;
      const shrink = 1 - calls.length / Math.max(1, prev.calls.length);
      if (shrink > MAX_SHRINK)
        throw new Error(
          `${source}: snapshot would shrink ${prev.calls.length} → ${calls.length} ` +
            `(${Math.round(shrink * 100)}% > ${Math.round(MAX_SHRINK * 100)}%). ` +
            `Re-run, or pass allowShrink if the register really did contract.`,
        );
    } catch (e) {
      // A shrink refusal must propagate; an unreadable previous file must not block a write.
      if (e instanceof Error && e.message.includes("would shrink")) throw e;
    }
  }

  const problems = calls.flatMap((c) => {
    const bad = validateCall(c);
    return bad.length ? [`${c.sourceKey}: ${bad.join("; ")}`] : [];
  });
  if (problems.length)
    throw new Error(
      `refusing to write ${problems.length} invalid call(s):\n  ${problems.join("\n  ")}`,
    );

  const dupes = calls
    .map((c) => c.sourceKey)
    .filter((k, i, a) => a.indexOf(k) !== i);
  if (dupes.length)
    throw new Error(
      `duplicate sourceKey(s) — the loader's UNIQUE(source, source_key) would reject the merge: ${[
        ...new Set(dupes),
      ].join(", ")}`,
    );

  const snapshot: OpenCallsSnapshot = {
    source,
    crawledAt,
    calls: [...calls].sort(byKey),
  };
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${source}.json`);
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  return out;
};
