// One-off: re-key the contract rows whose supplier id is FILLER.
//
//   npx tsx scripts/procurement/rekey_placeholder_suppliers.ts            # dry run
//   npx tsx scripts/procurement/rekey_placeholder_suppliers.ts --apply    # write
//
// WHY A ONE-OFF AND NOT A RE-INGEST. The parser fix (eik.ts `isPlaceholderId` +
// supplier_identity.ts's `placeholder` branch) only affects rows as they are
// parsed. Applying it to the corpus that is already on disk cannot be done by
// re-running the ingest, and both modes fail in a different way — measured
// 2026-08-18 over the full 2020→2026 ЦАИС history:
//
//   · `--backfill` (gap-fill) keeps only buyers ENTIRELY ABSENT from the corpus.
//     All 4,416 are present, so it kept 0 rows and dropped 207,029.
//   · `--backfill --self-heal` dedups on `contentKeys()`, and ALL FOUR of its nets
//     embed `contractorEik`. A re-parsed filler row therefore shares NO key with
//     its own on-disk twin, so it is kept as NEW while the old row stays —
//     double-counting the rows instead of correcting them. Verified on the live
//     Кларивейт row: 4 keys before, 4 after, 0 in common.
//
// So the corpus has to be edited in place, and this script does exactly that and
// nothing else.
//
// ⚠ IT MOVES /contract/:key URLs, and that is unavoidable rather than a design
// choice: the key is hash(releaseId::contractId::contractorEik::tag) for the two
// release-shaped feeds and hash(legacy::datasetUuid::documentId::contractorEik)
// for the annual CSV, so the supplier id IS part of contract identity. A fresh
// parse would move them identically. On the legacy feed `releaseId` embeds the
// supplier id too, so that moves as well — otherwise the row would stop matching
// what the parser emits and the next real ingest would mint a duplicate.
//
// NOTHING HERE RE-IMPLEMENTS A FORMULA. The keys come from `releaseContractKey`,
// `legacyContractKey` and `legacyReleaseId` in contract_key.ts — the same
// functions normalize.ts, normalize_eop.ts and legacy_csv.ts call — so this
// script and the ingest cannot drift. That mattered enough to refactor the three
// private copies into one shared home first.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, boolean } from "cmd-ts";
import { isPlaceholderId } from "./eik";
import { classifySupplierId } from "./supplier_identity";
import {
  releaseContractKey,
  legacyContractKey,
  legacyReleaseId,
} from "./contract_key";
import { LEGACY_DATASETS } from "./legacy_csv";
import { canonicalJson } from "./validate";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(HERE, "../../data/procurement/contracts");

type Row = {
  key: string;
  releaseId?: string;
  contractId?: string;
  tag: string;
  contractorEik?: string;
  contractorName?: string;
  [k: string]: unknown;
};

/** Recompute a row's identity for a new supplier key, using the SAME builder its
 *  own feed uses. Returns null when the feed is unrecognised — better to report a
 *  row than to guess a key shape and mint one the parser would never produce. */
const reidentify = (
  r: Row,
  eik: string,
): { key: string; releaseId?: string } | null => {
  const rel = r.releaseId ?? "";
  if (rel.startsWith("aop-legacy-")) {
    // `aop-legacy-<year>-<documentId>-<contractorEik>`. The year token is the
    // dataset's own `year` (which can carry a suffix, e.g. "2023-RL"), so resolve
    // the dataset by longest matching prefix rather than by splitting on "-".
    const ds = [...LEGACY_DATASETS]
      .sort((a, b) => b.year.length - a.year.length)
      .find((d) => rel.startsWith(`aop-legacy-${d.year}-`));
    if (!ds) return null;
    const rest = rel.slice(`aop-legacy-${ds.year}-`.length);
    // Trim the trailing `-<contractorEik>` to recover the document id.
    const documentId = rest.slice(0, rest.lastIndexOf("-"));
    if (!documentId) return null;
    return {
      key: legacyContractKey(ds.datasetUuid, documentId, eik),
      releaseId: legacyReleaseId(ds.year, documentId, eik),
    };
  }
  if (!rel) return null;
  // OCDS (`ocds-…`) and ЦАИС ЕОП (`eop-…`) share one builder.
  return { key: releaseContractKey(rel, r.contractId, eik, r.tag) };
};

const main = command({
  name: "rekey-placeholder-suppliers",
  args: {
    apply: flag({ type: boolean, long: "apply", defaultValue: () => false }),
  },
  handler: ({ apply }) => {
    const years = fs
      .readdirSync(CONTRACTS_DIR)
      .filter((d) => /^\d{4}$/.test(d))
      .sort();

    let scanned = 0;
    let hit = 0;
    let anonymised = 0;
    const refused: string[] = [];
    const byOldEik = new Map<string, { rows: number; eur: number }>();
    const newKeys = new Map<string, string>(); // newKey -> oldKey, collision check
    const samples: string[] = [];
    let filesChanged = 0;

    for (const y of years) {
      const dir = path.join(CONTRACTS_DIR, y);
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const file = path.join(dir, f);
        const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Row[];
        let touched = false;

        for (const r of rows) {
          scanned++;
          const old = r.contractorEik ?? "";
          if (!old || !isPlaceholderId(old)) continue;

          const resolved = classifySupplierId(old, r.contractorName);
          const next = resolved.eik;
          const ident = reidentify(r, next);
          if (!ident) {
            refused.push(`${r.key} (${r.releaseId ?? "no releaseId"})`);
            continue;
          }

          hit++;
          if (!next) anonymised++;
          const amt = Number(r.amountEur ?? 0);
          const agg = byOldEik.get(old) ?? { rows: 0, eur: 0 };
          byOldEik.set(old, { rows: agg.rows + 1, eur: agg.eur + amt });
          if (newKeys.has(ident.key))
            refused.push(
              `KEY COLLISION ${ident.key}: ${newKeys.get(ident.key)} vs ${r.key}`,
            );
          newKeys.set(ident.key, r.key);
          if (samples.length < 12)
            samples.push(
              `  ${old} → ${next || "(no identity)"}  ${r.key}→${ident.key}  ${r.contractorName ?? ""}`,
            );

          r.contractorEik = next;
          if (ident.releaseId) r.releaseId = ident.releaseId;
          r.key = ident.key;
          touched = true;
        }

        if (touched) {
          filesChanged++;
          if (apply) fs.writeFileSync(file, canonicalJson(rows));
        }
      }
    }

    console.log(`→ scanned ${scanned.toLocaleString()} row(s) in ${years.length} year(s)`); // prettier-ignore
    console.log(`→ ${hit} filler row(s) across ${byOldEik.size} filler id(s) in ${filesChanged} shard file(s)`); // prettier-ignore
    const eur = [...byOldEik.values()].reduce((a, b) => a + b.eur, 0);
    console.log(`→ €${Math.round(eur).toLocaleString()} re-attributed; ${newKeys.size} distinct new contract key(s)`); // prettier-ignore
    if (anonymised)
      console.log(`→ ${anonymised} row(s) had no usable name → no contractor identity`); // prettier-ignore
    console.log("\n  old id → new key   (sample)");
    samples.forEach((s) => console.log(s));
    console.log("\n  per filler id:");
    [...byOldEik.entries()]
      .sort((a, b) => b[1].eur - a[1].eur)
      .forEach(
        ([k, v]) =>
        console.log(`  ${k.padEnd(26)} ${String(v.rows).padStart(4)} row(s)  €${Math.round(v.eur).toLocaleString()}`), // prettier-ignore
      );

    if (refused.length) {
      console.log(`\n⚠ ${refused.length} row(s) REFUSED (not rewritten):`);
      refused.forEach((r) => console.log(`  ${r}`));
    }
    console.log(
      apply
        ? `\n✓ wrote ${filesChanged} shard file(s)`
        : "\n✓ dry run — pass --apply to write",
    );
  },
});

run(main, process.argv.slice(2));
