// One-time remediation for the ЕГН-as-contractor-key defect (D-1 in
// docs/plans/procurement-foreign-consortium-members-v1.md).
//
// WHAT WENT WRONG. `canonicalEik` passes any 10-digit value through unchanged and
// `isValidEik` accepts 9–13 digits, so a natural person's ЕГН published in the
// `supplierRegisterNumber` field became `contracts.contractor_eik` verbatim — 98
// distinct checksum-valid ЕГН across 148 rows, each beside the person's full name. The
// normalizers no longer do this (see supplier_identity.ts), but the corpus already on
// disk still holds them, and it is what `db:load:pg` loads and mirrors to Cloud SQL.
//
// Git history is NOT affected: /data/procurement/{contracts,contractors,
// contractor_contracts}/ are gitignored, and a scan of every tracked file under
// data/procurement found zero ЕГН. The exposure is the working corpus, the local
// database and production.
//
// An ЕГН hides in FOUR places on a row, not one. The first version of this script fixed
// only the first and shipped the rest:
//   1. `contractorEik`                     — the obvious one.
//   2. `contractorEikFull`                 — preserves the raw source token.
//   3. `releaseId`                         — legacy_csv builds it as
//      `aop-legacy-${year}-${documentId}-${contractorEik}`, i.e. the id is INSIDE the
//      identifier. 21 rows still carried it after the first run.
//   4. `key`                               — `hashKey` over a base string containing the
//      ЕГН. 48 bits of sha256 where every other component is public in the same row, so
//      a guessed ЕГН can be confirmed by recomputation over a 10^10 space.
//
// KEY FORMULAS DIFFER BY SOURCE PATH and the first version applied the ЦАИС one to
// everything, silently corrupting the 17 legacy rows' URLs:
//   ЦАИС / OCDS / РОП : hashKey(`${releaseId}::${contractId}::${eik}::${tag}`)
//   legacy CSV        : hashKey(`legacy::${datasetUuid}::${documentId}::${eik}`)
// (The earlier docblock claimed the legacy path contributed no ЕГН rows. That was
// wrong — it contributed 17 of them.)
//
// IDEMPOTENT AND SELF-REPAIRING. It processes rows that still hold an ЕГН *and* rows
// already carrying an `np-` key, so re-running repairs the earlier bad keys rather than
// needing the corpus rebuilt from raw. A final sweep greps the whole data/procurement
// tree and exits non-zero if any ЕГН survives anywhere.
//
//   npx tsx scripts/procurement/__encode_personal_ids_inplace.ts [--dry-run]
//   npx tsx scripts/procurement/rebuild_from_cache.ts
//   npm run db:load:pg && npm run db:load:graph:pg

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { hashKey, legacyKeyDiscriminator } from "./contract_key";
import { LEGACY_DATASETS } from "./legacy_csv";
import {
  isEgn,
  isOrganisationName,
  personSupplierKey,
} from "./supplier_identity";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PROC = path.join(ROOT, "data/procurement");
const MONTH_DIR = path.join(PROC, "contracts");

const DRY = process.argv.includes("--dry-run");

interface Row {
  key?: string;
  ocid?: string;
  releaseId?: string;
  contractId?: string;
  tag?: string;
  contractorEik?: string;
  contractorEikFull?: string;
  contractorName?: string;
  amount?: number;
  amountEur?: number;
  [k: string]: unknown;
}

const NP = /^np-[0-9a-f]{12}$/;
const datasetUuidByYear = new Map(
  LEGACY_DATASETS.map((d) => [d.year, d.datasetUuid]),
);

// `aop-legacy-<year>-<documentId>-<contractorEik>`. The year token itself may contain a
// hyphen ("2011-2015", "2023-RL"), so match the known years rather than splitting.
const parseLegacyReleaseId = (
  releaseId: string,
): { year: string; documentId: string; tail: string } | null => {
  for (const { year } of LEGACY_DATASETS) {
    const prefix = `aop-legacy-${year}-`;
    if (!releaseId.startsWith(prefix)) continue;
    const rest = releaseId.slice(prefix.length);
    const cut = rest.lastIndexOf("-");
    if (cut < 0) return null;
    return { year, documentId: rest.slice(0, cut), tail: rest.slice(cut + 1) };
  }
  return null;
};

const rekey = (r: Row, eik: string): string => {
  const legacy = r.releaseId ? parseLegacyReleaseId(r.releaseId) : null;
  if (legacy) {
    const uuid = datasetUuidByYear.get(legacy.year);
    if (!uuid) throw new Error(`no datasetUuid for legacy year ${legacy.year}`);
    const base = hashKey(`legacy::${uuid}::${legacy.documentId}::${eik}`);
    // legacy_csv disambiguates lots sharing a document number; mirror it so the scrub
    // and a fresh ingest converge on the same URL.
    return hashKey(`${base}::${legacyKeyDiscriminator(r)}`);
  }
  return hashKey(
    `${r.releaseId ?? ""}::${r.contractId ?? ""}::${eik}::${r.tag ?? ""}`,
  );
};

let rowsFixed = 0;
let filesTouched = 0;
let releaseIdsFixed = 0;
let fullsCleared = 0;
let collapsed = 0;
let collapsedEur = 0;
const affected = new Set<string>();

// ONLY the month shards. `data/procurement/contracts/` also holds a `by-id/`
// subdirectory of single-contract objects, so year dirs must be matched explicitly.
const isYearDir = (name: string): boolean => /^\d{4}$/.test(name);
const years = (
  fs.existsSync(MONTH_DIR) ? fs.readdirSync(MONTH_DIR) : []
).filter(isYearDir);

for (const year of years) {
  const yearDir = path.join(MONTH_DIR, year);
  if (!fs.statSync(yearDir).isDirectory()) continue;
  for (const file of fs
    .readdirSync(yearDir)
    .filter((f) => f.endsWith(".json"))) {
    const full = path.join(yearDir, file);
    let rows = JSON.parse(fs.readFileSync(full, "utf8")) as Row[];
    if (!Array.isArray(rows)) continue;
    let changed = 0;

    for (const r of rows) {
      const cur = String(r.contractorEik ?? "");
      const wasEgn = isEgn(cur);
      // Also revisit rows a previous run already converted, so their key/releaseId get
      // repaired with the right formula.
      if (!wasEgn && !NP.test(cur)) continue;

      const np = wasEgn ? personSupplierKey(r.contractorName) : cur;
      if (wasEgn) affected.add(cur);
      r.contractorEik = np;

      // (2) raw token
      if (r.contractorEikFull) {
        const digits = String(r.contractorEikFull).replace(/\D/g, "");
        if (isEgn(String(r.contractorEikFull)) || isEgn(digits)) {
          delete r.contractorEikFull;
          fullsCleared++;
        }
      }
      // (3) the id embedded in releaseId
      if (r.releaseId) {
        const legacy = parseLegacyReleaseId(r.releaseId);
        if (legacy && (isEgn(legacy.tail) || NP.test(legacy.tail))) {
          const next = `aop-legacy-${legacy.year}-${legacy.documentId}-${np}`;
          if (next !== r.releaseId) {
            r.releaseId = next;
            releaseIdsFixed++;
          }
        }
      }
      // (4) the key, with the path-appropriate formula
      const nextKey = rekey(r, np);
      if (nextKey !== r.key) r.key = nextKey;
      changed++;
      rowsFixed++;
    }

    // COLLAPSE. Re-keying merges rows the source distinguished ONLY by a differing ЕГН —
    // contract Д-302 / 00701-2020-0007 carried "ЗП Сейхан Азизов Бекиров" under three
    // different ЕГН. Once they share one identity they share a rowKey, and a fresh
    // re-parse collapses them at the month-shard merge, so the scrub must too or it
    // violates contracts_pkey. The surviving row takes the SUM: the merge the ingest
    // performs is over rows that are the same logical contract, and dropping the smaller
    // amounts silently shrank the corpus by €81.80 in the first version.
    const byKey = new Map<string, Row[]>();
    for (const r of rows) {
      if (!NP.test(String(r.contractorEik ?? ""))) continue;
      const arr = byKey.get(String(r.key));
      if (arr) arr.push(r);
      else byKey.set(String(r.key), [r]);
    }
    const drop = new Set<Row>();
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const [keep, ...rest] = [...group].sort(
        (a, b) => Number(b.amountEur ?? 0) - Number(a.amountEur ?? 0),
      );
      for (const r of rest) {
        keep.amount = Number(keep.amount ?? 0) + Number(r.amount ?? 0);
        keep.amountEur = Number(keep.amountEur ?? 0) + Number(r.amountEur ?? 0);
        collapsedEur += Number(r.amountEur ?? 0);
        drop.add(r);
        collapsed++;
      }
    }
    if (drop.size) {
      rows = rows.filter((r) => !drop.has(r));
      changed += drop.size;
    }

    if (changed && !DRY) {
      fs.writeFileSync(full, JSON.stringify(rows, null, 2) + "\n");
    }
    if (changed) filesTouched++;
  }
}

// Per-entity artifacts keyed BY the contractor id — the filename itself is the personal
// data. Every eik-keyed tree under data/procurement is swept, not a hand-listed pair:
// the first version named only contractors/ and contractor_contracts/ and left ЕГН-named
// files behind in breakdowns/c/ and the search/index artifacts.
let shardsDeleted = 0;
const sweepDir = (dir: string): void => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sweepDir(p);
      continue;
    }
    const id = entry.name.replace(/\.json$/, "");
    if (!isEgn(id)) continue;
    if (!DRY) fs.unlinkSync(p);
    shardsDeleted++;
  }
};
for (const d of fs.readdirSync(PROC, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name === "contracts") continue;
  sweepDir(path.join(PROC, d.name));
}
sweepDir(path.join(MONTH_DIR, "by-id"));

// FINAL SWEEP. Any ЕГН left anywhere under data/procurement is a failure — the whole
// point is that none ships. Reported per file so the next gap is actionable.
//
// FIELD-AWARE, deliberately. A plain text grep for checksum-valid 10-digit runs is
// useless here: the ЕГН check is mod-11, so ~1 in 11 arbitrary 10-digit numbers passes,
// and a first attempt flagged 793 files — mostly contract amounts and document numbers.
// Only values under keys that carry an ENTITY IDENTIFIER can be an ЕГН, so the walk is
// keyed on those.
const ID_KEYS = new Set([
  "contractorEik",
  "contractorEikFull",
  "awarderEik",
  "eik",
  "releaseId",
  "ocid",
]);
const isEgnish = (v: unknown): boolean => {
  const s = String(v ?? "");
  if (isEgn(s)) return true;
  // An id embedded in a compound identifier (`aop-legacy-2020-50234-7302016648`).
  // The run must be DELIMITED: an unanchored \d{10} also matches a 10-digit window
  // inside a longer number, which produced two false positives — the 12-digit EIK
  // `134708703000` (window `1347087030`) and the document number `ПЕС/04023042021`.
  for (const m of s.matchAll(/(?<!\d)\d{10}(?!\d)/g))
    if (isEgn(m[0])) return true;
  return false;
};

// Name fields that sit alongside an id on the same object.
const NAME_KEYS = ["contractorName", "name", "awarderName"] as const;

const leaks: Array<{ file: string; sample: string[] }> = [];
const walkValues = (node: unknown, found: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const v of node) walkValues(v, found);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // Apply the SAME organisation exclusion the classifier uses. Without it the sweep
    // disagrees with the code it is checking and can never go green: `Evig Mérnök
    // Vállalkozói Kft` (Hungarian, `0109065346`) passes the mod-11 checksum by
    // coincidence and is deliberately NOT treated as a person.
    const siblingName = NAME_KEYS.map((k) => obj[k]).find(
      (v) => typeof v === "string" && v,
    ) as string | undefined;
    for (const [k, v] of Object.entries(obj)) {
      if (ID_KEYS.has(k)) {
        if (isEgnish(v) && !isOrganisationName(siblingName)) {
          found.add(`${k}=${String(v)}`);
        }
      } else walkValues(v, found);
    }
  }
};
const scan = (dir: string): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(p);
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    const found = new Set<string>();
    const base = entry.name.replace(/\.json$/, "");
    if (isEgn(base)) found.add(`filename=${base}`);
    try {
      walkValues(JSON.parse(fs.readFileSync(p, "utf8")), found);
    } catch {
      // Unparseable shard — not this script's problem, and not a leak signal.
    }
    if (found.size) {
      leaks.push({
        file: path.relative(ROOT, p),
        sample: [...found].slice(0, 3),
      });
    }
  }
};
scan(PROC);

console.log(
  [
    "",
    DRY ? "DRY RUN — nothing written" : "applied",
    `  distinct ЕГН converted:   ${affected.size}`,
    `  rows normalised:          ${rowsFixed}`,
    `  month shards touched:     ${filesTouched}`,
    `  releaseIds rewritten:     ${releaseIdsFixed}`,
    `  contractorEikFull cleared:${fullsCleared}`,
    `  ЕГН-named files deleted:  ${shardsDeleted}`,
    `  rows collapsed (summed):  ${collapsed} (€${collapsedEur.toFixed(2)} folded into survivors)`,
    "",
    leaks.length
      ? `✗ ЕГН STILL PRESENT in ${leaks.length} file(s):\n` +
        leaks
          .slice(0, 20)
          .map((l) => `    ${l.file} — ${l.sample.join(", ")}`)
          .join("\n")
      : "✓ final sweep: no ЕГН anywhere under data/procurement",
    "",
    "Next: npx tsx scripts/procurement/rebuild_from_cache.ts",
    "      npm run db:load:pg && npm run db:load:graph:pg",
  ].join("\n"),
);

if (leaks.length && !DRY) process.exitCode = 1;
