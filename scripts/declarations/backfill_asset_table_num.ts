/**
 * One-off: stamp `tableNum` onto every asset row of every committed declaration shard.
 *
 * The provenance exists ONLY in the source XML — no SQL and no shard rewrite can derive
 * it — so the corpus cannot answer "is this row a holding or something the declarant
 * merely uses" until this has run. Until then `is_declared_holding()` (089) reads the
 * NULL as a holding, i.e. the pre-existing behaviour, and the whole change is inert.
 * See docs/plans/declaration-foreign-assets-v1.md.
 *
 * WHY NOT `rebuild_all_from_cache.ts`. That script re-parses the MP tree only (1,061
 * shards) and rewrites each declaration wholesale, re-running every downstream builder.
 * The tiers that carry most of the damage are exec (€47.1m) and muni (€6.0m), which it
 * never touches, and re-running their ingests would need the register's listing pages —
 * a network pass with its own `--max-missing` refusals. This walks the three committed
 * shard trees the PG loader itself reads, reads each filing's XML back out of the raw
 * cache, and writes back exactly ONE new field per asset row. No network, idempotent,
 * and the diff is reviewable.
 *
 * POSITIONAL, BUT VERIFIED. Rows are matched to the re-parse by index, then checked on
 * (category, description, valueEur). A shard written by an older parser can legitimately
 * disagree — the credit_limit split and the real-estate dedupe both changed row sets — and
 * such a shard is REPORTED and left alone rather than half-stamped. Re-parsing it whole
 * would silently move values this change has no business touching.
 *
 * Manual by design, per the repo's convention for one-off backfills.
 *
 *   npx tsx scripts/declarations/backfill_asset_table_num.ts           # dry run
 *   npx tsx scripts/declarations/backfill_asset_table_num.ts --apply
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDeclarationXml } from "./parse_declaration";
import type { MpAsset } from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), "../..");

// The three shard trees load_declarations_pg.ts reads. `data/judiciary/declarations` is
// the fourth spec there and is deliberately absent: the magistrate tier is derived from
// ВСС PDFs, has no cacbg XML behind it, and the directory is empty.
const TREES = [
  "data/parliament/declarations",
  "data/officials/declarations",
  "data/officials/municipal/declarations",
];

// Both raw caches, keyed the way each ingest writes them: <root>/<registerFolder>/<file>.
const RAW_ROOTS = ["raw_data/declarations", "raw_data/officials"];

type ShardDecl = {
  sourceUrl?: string;
  assets?: MpAsset[];
};

/** Every cached XML by "<folder>/<file>", built once. A basename alone is NOT a key: the
 *  two roots overlap (the same filing is cached under both for people who are in both
 *  rosters), and the register folder is part of the identity. */
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
        // First root wins; the two copies are the same bytes from the same register.
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

/** Do these two rows describe the same declared item? Compared on the three fields a
 *  parser change is least likely to move together, and NOT on the whole object: `share`,
 *  `legalBasis` and the money columns have all been re-read at some point. */
const sameRow = (a: MpAsset, b: MpAsset): boolean =>
  a.category === b.category &&
  (a.description ?? null) === (b.description ?? null) &&
  (a.valueEur ?? null) === (b.valueEur ?? null);

/** Re-serialise a shard in the EXACT format it was already stored in.
 *
 *  The two families disagree and both are deliberate — see scripts/declarations/formats.ts,
 *  whose header ends „Do NOT mass-reformat either family to unify them". The parliament tree
 *  is `compactJson` (one line, no trailing newline); the officials trees are `writeJson`
 *  (2-space indent, trailing newline). Writing one format for both reformats 1,061 MP shards
 *  into a ~1.4M-line whitespace diff that buries the real change — and the next MP ingest
 *  writes them straight back, so it churns the bucket on every run thereafter. Measured: the
 *  first cut of this script did exactly that before it was killed.
 *
 *  Detected from the file's OWN bytes rather than from a hard-coded tree list, so a family
 *  that changes format later cannot start silently churning. */
const reserialize = (raw: string, obj: unknown): string => {
  // A pretty file breaks the line immediately after the opening bracket; a compact one
  // has `[{` (or `[]`). Checking the head is enough and cannot be fooled by a newline
  // inside a string value.
  const pretty = /^\s*\[\s*\n/.test(raw);
  const body = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  return raw.endsWith("\n") ? body + "\n" : body;
};

const main = (): void => {
  const apply = process.argv.includes("--apply");
  const cache = buildCacheIndex();
  console.log(`[table-num] ${cache.size} cached XMLs indexed`);

  let shards = 0;
  let shardsChanged = 0;
  let decls = 0;
  let stamped = 0;
  let noCache = 0;
  let mismatched = 0;
  let mismatchForeign = 0;
  const byTable = new Map<string, number>();
  const mismatchSamples: string[] = [];
  const missingSamples: string[] = [];

  for (const tree of TREES) {
    const dir = path.join(REPO, tree);
    if (!fs.existsSync(dir)) {
      console.warn(`[table-num] missing ${tree} — skipping`);
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
        console.warn(`[table-num] unreadable ${tree}/${file} — skipping`);
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
        // mpId / institution are required by ParseInput and are irrelevant here: they
        // touch no asset field. The declarant NAME — which `isSpouse` is derived from —
        // is read from the XML itself, so the re-parse cannot disagree with the shard
        // about whose row it is.
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
          // How much this leaves UNCORRECTED. A skipped filing keeps tableNum = null, so
          // is_declared_holding reads its rows as holdings — including any чуждо ones. Say
          // so with a number rather than leaving the gap to be inferred from a warning
          // ("no silent caps"): a skip that hides a чуждо row is the one case where this
          // script's conservatism costs something.
          mismatchForeign += freshAssets.filter(
            (a) => a.tableNum === "1.2" || a.tableNum === "3.4",
          ).length;
          if (mismatchSamples.length < 10)
            mismatchSamples.push(
              `${d.sourceUrl} (shard ${d.assets.length} rows, re-parse ${freshAssets.length})`,
            );
          continue;
        }
        d.assets.forEach((a, i) => {
          const tn = freshAssets[i].tableNum ?? null;
          if (a.tableNum !== tn) {
            a.tableNum = tn;
            dirty = true;
            stamped++;
          }
          if (tn) byTable.set(tn, (byTable.get(tn) ?? 0) + 1);
        });
      }

      if (dirty) {
        shardsChanged++;
        if (apply) fs.writeFileSync(fp, reserialize(raw, parsed), "utf-8");
      }
    }
  }

  console.log(
    `[table-num] ${shards} shards · ${decls} filings with assets · ` +
      `${stamped} rows stamped · ${shardsChanged} shards ${apply ? "written" : "would change"}`,
  );
  const foreign = (byTable.get("1.2") ?? 0) + (byTable.get("3.4") ?? 0);
  console.log(
    `[table-num] by table: ` +
      [...byTable.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );
  console.log(
    `[table-num] чуждо (1.2 + 3.4) = ${foreign} rows — these leave every wealth figure`,
  );
  if (noCache) {
    console.warn(
      `[table-num] ⚠ ${noCache} filings have no cached XML — their rows keep tableNum = null ` +
        `and are therefore still counted as holdings. Sample:\n  ${missingSamples.join("\n  ")}`,
    );
  }
  if (mismatched) {
    console.warn(
      `[table-num] ⚠ ${mismatched} filings re-parse to a different row set and were LEFT ALONE ` +
        `(shard predates a parser change) — ${mismatchForeign} чуждо rows in them stay counted ` +
        `as holdings. Sample:\n  ${mismatchSamples.join("\n  ")}`,
    );
  }
  if (!apply) console.log("[table-num] dry run — pass --apply to write");
};

main();
