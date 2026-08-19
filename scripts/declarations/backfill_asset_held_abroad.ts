/**
 * One-off: stamp the held-place fields onto every asset row of every committed declaration
 * shard — `heldScope`, `heldCountry` and the two raw „В страната" / „В чужбина" cells.
 *
 * The provenance exists ONLY in the source XML — no SQL and no shard rewrite can derive it —
 * so the corpus cannot answer "how much of the money declared by officials is held abroad,
 * and where" until this has run. Until then `held_scope` is NULL everywhere, which 089's
 * column comment defines as "this row's table has no such question" rather than as domestic,
 * so the whole change is INERT and nothing published moves.
 * See docs/plans/declaration-held-abroad-v1.md.
 *
 * WHY NOT `rebuild_all_from_cache.ts` — the same reason backfill_asset_table_num.ts gives:
 * that script re-parses the MP tree only (1,061 shards) and rewrites each declaration
 * wholesale, re-running every downstream builder, while the tiers holding most of this
 * corpus are exec and muni, which it never touches. This walks the three committed shard
 * trees the PG loader itself reads, reads each filing's XML back out of the raw cache, and
 * writes back exactly four new fields per money row. No network, idempotent, reviewable diff.
 *
 * POSITIONAL, BUT VERIFIED — again as in backfill_asset_table_num.ts. Rows are matched to the
 * re-parse by index, then checked on (category, description, valueEur); a shard whose row set
 * a parser change has since moved is REPORTED and left alone rather than half-stamped.
 *
 * Manual by design, per the repo's convention for one-off backfills.
 *
 *   npx tsx scripts/declarations/backfill_asset_held_abroad.ts           # dry run
 *   npx tsx scripts/declarations/backfill_asset_held_abroad.ts --apply
 *
 * Then, in this order — `--resolve` alone does NOT rewrite asset rows:
 *   npm run db:load:declarations:pg
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDeclarationXml } from "./parse_declaration";
import type { MpAsset } from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), "../..");

// The three shard trees load_declarations_pg.ts reads. `data/judiciary/declarations` is the
// fourth spec there and is deliberately absent: the magistrate tier is derived from ВСС PDFs,
// has no cacbg XML behind it, and the directory is empty.
const TREES = [
  "data/parliament/declarations",
  "data/officials/declarations",
  "data/officials/municipal/declarations",
];

const RAW_ROOTS = ["raw_data/declarations", "raw_data/officials"];

type ShardDecl = { sourceUrl?: string; assets?: MpAsset[] };

/** Every cached XML by "<folder>/<file>". A basename alone is NOT a key: the two roots
 *  overlap (the same filing is cached under both for people in both rosters), and the
 *  register folder is part of the identity. */
const buildCacheIndex = (): Map<string, string> => {
  const idx = new Map<string, string>();
  for (const root of RAW_ROOTS) {
    const abs = path.join(REPO, root);
    if (!fs.existsSync(abs)) continue;
    for (const folder of fs.readdirSync(abs)) {
      const dir = path.join(abs, folder);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".xml")) continue;
        const key = `${folder}/${file}`;
        if (!idx.has(key)) idx.set(key, path.join(dir, file));
      }
    }
  }
  return idx;
};

const cacheKey = (sourceUrl: string): string | null => {
  const m = sourceUrl.match(/cacbg\.bg\/([^/]+)\/([^/]+\.xml)$/);
  return m ? `${m[1]}/${m[2]}` : null;
};

/** Do these two rows describe the same declared item? Compared on the three fields a parser
 *  change is least likely to move together — `share`, `legalBasis` and the money columns have
 *  all been re-read at some point. */
const sameRow = (a: MpAsset, b: MpAsset): boolean =>
  a.category === b.category &&
  (a.description ?? null) === (b.description ?? null) &&
  (a.valueEur ?? null) === (b.valueEur ?? null);

/** Re-serialise a shard in the EXACT format it was already stored in — see
 *  scripts/declarations/formats.ts, whose header ends „Do NOT mass-reformat either family to
 *  unify them". The parliament tree is compact, the officials trees are 2-space indented;
 *  writing one format for both buries the real change in a ~1.4M-line whitespace diff that
 *  the next ingest immediately writes back. Detected from the file's OWN bytes so a family
 *  that changes format later cannot start silently churning. */
const reserialize = (raw: string, obj: unknown): string => {
  const pretty = /^\s*\[\s*\n/.test(raw);
  const body = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  return raw.endsWith("\n") ? body + "\n" : body;
};

/** The four fields this script owns, read off a freshly parsed row. */
const heldOf = (a: MpAsset) => ({
  heldScope: a.heldScope ?? null,
  heldCountry: a.heldCountry ?? null,
  heldRawInCountry: a.heldRawInCountry ?? null,
  heldRawAbroad: a.heldRawAbroad ?? null,
});

const main = (): void => {
  const apply = process.argv.includes("--apply");
  const cache = buildCacheIndex();
  console.log(`[held] ${cache.size} cached XMLs indexed`);

  let shards = 0;
  let shardsChanged = 0;
  let decls = 0;
  let stamped = 0;
  let noCache = 0;
  let mismatched = 0;
  let mismatchAbroad = 0;
  const byScope = new Map<string, number>();
  const byCountry = new Map<string, number>();
  let abroadEur = 0;
  let unknownEur = 0;
  const mismatchSamples: string[] = [];
  const missingSamples: string[] = [];

  for (const tree of TREES) {
    const dir = path.join(REPO, tree);
    if (!fs.existsSync(dir)) {
      console.warn(`[held] missing ${tree} — skipping`);
      continue;
    }
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const fp = path.join(dir, file);
      let raw: string;
      let parsed: ShardDecl[];
      try {
        raw = fs.readFileSync(fp, "utf-8");
        parsed = JSON.parse(raw) as ShardDecl[];
      } catch {
        console.warn(`[held] unreadable ${tree}/${file} — skipping`);
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      shards++;
      let dirty = false;

      for (const d of parsed) {
        if (!d.sourceUrl || !d.assets?.length) continue;
        decls++;
        const key = cacheKey(d.sourceUrl);
        const xmlPath = key ? cache.get(key) : undefined;
        if (!xmlPath) {
          noCache++;
          if (missingSamples.length < 5) missingSamples.push(d.sourceUrl);
          continue;
        }
        // mpId / institution are required by ParseInput and touch no asset field. The
        // declarant NAME is read from the XML itself, so the re-parse cannot disagree with
        // the shard about whose row it is.
        const fresh = parseDeclarationXml({
          xml: fs.readFileSync(xmlPath, "utf-8"),
          sourceUrl: d.sourceUrl,
          mpId: 0,
          institution: "",
        });
        const freshAssets = fresh?.assets ?? [];
        if (
          freshAssets.length !== d.assets.length ||
          !d.assets.every((a, i) => sameRow(a, freshAssets[i]))
        ) {
          mismatched++;
          // How much this leaves UNSTAMPED. A skipped filing keeps held_scope NULL, so its
          // money drops out of every "held abroad" figure — the safe direction (nothing is
          // asserted) but not a free one. Say so with a number rather than leaving the gap
          // to be inferred from a warning.
          mismatchAbroad += freshAssets.filter(
            (a) => a.heldScope === "abroad",
          ).length;
          if (mismatchSamples.length < 10)
            mismatchSamples.push(
              `${d.sourceUrl} (shard ${d.assets.length} rows, re-parse ${freshAssets.length})`,
            );
          continue;
        }
        d.assets.forEach((a, i) => {
          const next = heldOf(freshAssets[i]);
          const cur = heldOf(a);
          if (
            cur.heldScope !== next.heldScope ||
            cur.heldCountry !== next.heldCountry ||
            cur.heldRawInCountry !== next.heldRawInCountry ||
            cur.heldRawAbroad !== next.heldRawAbroad
          ) {
            // Assign only the fields that apply. A row from a table with no such question
            // (real estate, a car, cash) must keep them ABSENT rather than gain four nulls —
            // that is what keeps the shard diff to the money rows and lets 089's NULL keep
            // meaning "no such question".
            if (next.heldScope == null) {
              delete a.heldScope;
              delete a.heldCountry;
              delete a.heldRawInCountry;
              delete a.heldRawAbroad;
            } else {
              a.heldScope = next.heldScope;
              a.heldCountry = next.heldCountry;
              a.heldRawInCountry = next.heldRawInCountry;
              a.heldRawAbroad = next.heldRawAbroad;
            }
            dirty = true;
            stamped++;
          }
          if (next.heldScope) {
            byScope.set(next.heldScope, (byScope.get(next.heldScope) ?? 0) + 1);
            if (next.heldCountry)
              byCountry.set(
                next.heldCountry,
                (byCountry.get(next.heldCountry) ?? 0) + 1,
              );
            if (next.heldScope === "abroad") abroadEur += a.valueEur ?? 0;
            if (next.heldScope === "unknown") unknownEur += a.valueEur ?? 0;
          }
        });
      }

      if (dirty) {
        shardsChanged++;
        if (apply) fs.writeFileSync(fp, reserialize(raw, parsed), "utf-8");
      }
    }
  }

  const eur = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;
  console.log(
    `[held] ${shards} shards · ${decls} filings with assets · ` +
      `${stamped} rows stamped · ${shardsChanged} shards ${apply ? "written" : "would change"}`,
  );
  const total = [...byScope.values()].reduce((a, b) => a + b, 0);
  console.log(
    `[held] by scope (of ${total} money rows on tables 5 + 8): ` +
      ["domestic", "abroad", "unknown"]
        .map(
          (k) =>
            `${k}=${byScope.get(k) ?? 0} (${(((byScope.get(k) ?? 0) / total) * 100).toFixed(2)}%)`,
        )
        .join(" · "),
  );
  console.log(
    `[held] declared abroad: ${eur(abroadEur)} · unresolved: ${eur(unknownEur)}`,
  );
  // The named-country subset is much smaller than the abroad set — „да" in the „В чужбина"
  // column says abroad and names nowhere — so print BOTH numbers together. A surface that
  // reports "where" is reporting on this subset and has to say so.
  const named = [...byCountry.values()].reduce((a, b) => a + b, 0);
  console.log(
    `[held] a country is named on ${named} of ${byScope.get("abroad") ?? 0} abroad rows ` +
      `(${byCountry.size} distinct): ` +
      [...byCountry.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([k, v]) => `${k}=${v}`)
        .join(" · "),
  );
  if (noCache) {
    console.warn(
      `[held] ⚠ ${noCache} filings have no cached XML — their rows keep held_scope = null ` +
        `and stay out of every abroad figure. Sample:\n  ${missingSamples.join("\n  ")}`,
    );
  }
  if (mismatched) {
    console.warn(
      `[held] ⚠ ${mismatched} filings re-parse to a different row set and were LEFT ALONE ` +
        `(shard predates a parser change) — ${mismatchAbroad} abroad rows in them stay ` +
        `unstamped. Sample:\n  ${mismatchSamples.join("\n  ")}`,
    );
  }
  if (!apply) console.log("[held] dry run — pass --apply to write");
};

main();
