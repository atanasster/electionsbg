/**
 * One-off: stamp `valueBasis` onto every asset row of every committed declaration shard, and
 * fill `valueEur` on the foreign-currency rows that never had one.
 *
 * WHAT WAS BROKEN. Each money table of the cacbg form carries a „Равностойност в лв./в евро."
 * cell that the DECLARANT fills in, and `pickEurValue` prefers it. Where it was left blank, a
 * USD/GBP/CHF row was stored with `amount` + `currency` and a NULL `valueEur` — and dropped out
 * of every wealth aggregate with nothing flagging it. Measured: 462 rows over 163 people, 356
 * of them on filings `person_wealth_year` actually publishes, including a 4,481,442 USD bank
 * balance and one person published at −€121,331 net whose true position is positive.
 * `excluded_asset_rows` reported 0 for all 280 affected published person-years.
 * See docs/plans/declaration-fx-conversion-v1.md.
 *
 * WHY A BACKFILL AND NOT JUST A PARSER FIX. The provenance is only recoverable from the source
 * XML: whether a figure came from the declarant's cell or from the peg cannot be inferred from
 * the shard, because for BGN/EUR both paths give the same number. So the rule lives in the
 * parser and this replays it over the committed corpus from the raw cache — no network.
 *
 * SAME SHAPE AS backfill_asset_table_num.ts, and deliberately so: it walks the same three
 * committed shard trees the PG loader reads, re-parses each filing out of the raw cache, and
 * writes back exactly the two fields. `rebuild_all_from_cache.ts` is still the wrong tool — it
 * re-parses the MP tree only (1,061 shards) and rewrites each declaration wholesale, while most
 * of the damage here is in the exec and muni tiers it never touches.
 *
 * POSITIONAL, BUT VERIFIED — with a DIFFERENT key from its sibling. That script matches rows on
 * (category, description, valueEur); `valueEur` is the very thing this one changes, so using it
 * would reject every row worth fixing. The key here is (category, description, currency,
 * amount): all four are untouched by this change, and `amount` is the strong discriminator.
 * A shard whose row set has genuinely moved under an older parser is REPORTED and left alone
 * rather than half-stamped.
 *
 * Manual by design, per the repo's convention for one-off backfills.
 *
 *   npx tsx scripts/declarations/backfill_asset_fx.ts           # dry run
 *   npx tsx scripts/declarations/backfill_asset_fx.ts --apply
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDeclarationXml } from "./parse_declaration";
import type { MpAsset } from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), "../..");

const TREES = [
  "data/parliament/declarations",
  "data/officials/declarations",
  "data/officials/municipal/declarations",
];

const RAW_ROOTS = ["raw_data/declarations", "raw_data/officials"];

type ShardDecl = { sourceUrl?: string; assets?: MpAsset[] };

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

/** Do these two rows describe the same declared item? Deliberately NOT on `valueEur` — see
 *  the header. `amount` and `currency` are the fields this change leaves alone, and they are
 *  what make a positional match verifiable here. */
const sameRow = (a: MpAsset, b: MpAsset): boolean =>
  a.category === b.category &&
  (a.description ?? null) === (b.description ?? null) &&
  (a.currency ?? null) === (b.currency ?? null) &&
  (a.amount ?? null) === (b.amount ?? null);

/** Re-serialise a shard in the EXACT format it was already stored in — see
 *  scripts/declarations/formats.ts, whose header ends „Do NOT mass-reformat either family to
 *  unify them". Detected from the file's own bytes so a family that changes format later
 *  cannot start silently churning. */
const reserialize = (raw: string, obj: unknown): string => {
  const pretty = /^\s*\[\s*\n/.test(raw);
  const body = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  return raw.endsWith("\n") ? body + "\n" : body;
};

const main = (): void => {
  const apply = process.argv.includes("--apply");
  const cache = buildCacheIndex();
  console.log(`[fx] ${cache.size} cached XMLs indexed`);

  let shards = 0;
  let shardsChanged = 0;
  let decls = 0;
  let stampedBasis = 0;
  let filledValue = 0;
  let filledEurTotal = 0;
  let stillUnvalued = 0;
  let noCache = 0;
  let mismatched = 0;
  // How much this leaves UNCORRECTED — a skipped filing keeps its NULL valueEur and stays
  // out of every total. Reported as a number rather than left to be inferred from a warning:
  // "no silent caps".
  let mismatchUnvalued = 0;
  let legacyStamped = 0;
  const byBasis = new Map<string, number>();
  const byCcy = new Map<string, number>();
  const mismatchSamples: string[] = [];

  for (const tree of TREES) {
    const dir = path.join(REPO, tree);
    if (!fs.existsSync(dir)) {
      console.warn(`[fx] missing ${tree} — skipping`);
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
        console.warn(`[fx] unreadable ${tree}/${file} — skipping`);
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
          continue;
        }
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
          mismatchUnvalued += d.assets.filter(
            (a) => a.valueEur == null && a.amount != null && a.currency != null,
          ).length;
          // A skipped filing keeps its valueEur untouched — but a row that HAS a value and
          // no basis would leave „value_eur IS NOT NULL implies value_basis IS NOT NULL"
          // permanently unassertable, and an invariant with a fuzzy exception is one nobody
          // can rely on. 'legacy' says exactly what is true here: the figure is the
          // declarant's, and which of the three paths produced it is no longer recoverable.
          // It is never 'fx_ecb', so it cannot leak into imputed_eur.
          for (const a of d.assets) {
            if (a.valueEur != null && a.valueBasis == null) {
              a.valueBasis = "legacy";
              dirty = true;
              legacyStamped++;
            }
          }
          if (mismatchSamples.length < 10)
            mismatchSamples.push(
              `${d.sourceUrl} (shard ${d.assets.length} rows, re-parse ${freshAssets.length})`,
            );
          continue;
        }
        d.assets.forEach((a, i) => {
          const f = freshAssets[i];
          if (a.valueBasis !== (f.valueBasis ?? null)) {
            a.valueBasis = f.valueBasis ?? null;
            dirty = true;
            stampedBasis++;
          }
          if (a.valueEur == null && f.valueEur != null) {
            a.valueEur = f.valueEur;
            dirty = true;
            filledValue++;
            filledEurTotal += f.valueEur;
            const c = (a.currency ?? "?").toUpperCase();
            byCcy.set(c, (byCcy.get(c) ?? 0) + 1);
          }
          if (f.valueEur == null && f.amount != null && f.currency != null)
            stillUnvalued++;
          const b = f.valueBasis ?? "(none)";
          byBasis.set(b, (byBasis.get(b) ?? 0) + 1);
        });
      }

      if (dirty) {
        shardsChanged++;
        if (apply) fs.writeFileSync(fp, reserialize(raw, parsed));
      }
    }
  }

  console.log(
    `[fx] ${shards} shards, ${decls} declarations, ${shardsChanged} shard(s) ${apply ? "written" : "would change"}`,
  );
  console.log(
    `[fx] valueBasis stamped on ${stampedBasis} row(s), plus ${legacyStamped} 'legacy' on skipped filings`,
  );
  console.log(
    `[fx] valueEur filled on ${filledValue} row(s), €${Math.round(filledEurTotal).toLocaleString("en-US")} total` +
      (byCcy.size
        ? ` — ${[...byCcy].map(([c, n]) => `${c}:${n}`).join(" ")}`
        : ""),
  );
  console.log(
    `[fx] basis mix: ${[...byBasis]
      .sort((a, b) => b[1] - a[1])
      .map(([b, n]) => `${b}=${n}`)
      .join(" ")}`,
  );
  // Not a failure — a currency we hold no dated rate for MUST stay unvalued rather than
  // guessed. 090 counts these in excluded_asset_rows so every surface can say the total is
  // partial. Printed so the residue is a number somebody has seen, not an assumption.
  console.log(
    `[fx] still unvalued (no rate — counted in excluded_asset_rows): ${stillUnvalued} row(s)`,
  );
  if (noCache) console.log(`[fx] ${noCache} declaration(s) with no cached XML`);
  if (mismatched) {
    console.warn(
      `[fx] ${mismatched} declaration(s) SKIPPED — the shard's row set disagrees with a fresh parse; ${mismatchUnvalued} unvalued row(s) stay uncorrected there`,
    );
    for (const s of mismatchSamples) console.warn(`       ${s}`);
  }
  if (!apply) console.log("[fx] dry run — pass --apply to write");
};

main();
