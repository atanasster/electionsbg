// Backfill `unp` (УНП — the АОП unique procurement number) onto the existing
// contract shards, so the corpus gains tender lineage without a full re-ingest.
//
// Why a backfill at all. The parsers now emit `unp` (legacy_csv.ts reads the
// "УНП" column; normalize_eop.ts emits the one it already computes), but
// data/procurement/contracts/ holds ~300k rows built before that change. This
// script fills them in place, the way eop_field_map.ts enriches CPV/procedure.
//
// Three routes, one per feed — see 049_contracts_unp.sql for the full rationale:
//
//   eop-<УНП>          the ocid IS the УНП        → substring, free
//   aop-legacy-<ds>-<documentId>                  → look up (ds, documentId) in
//                                                   the raw legacy CSVs
//   ocds-e82gsb-<id>   release carries no УНП      → look up the ocid in the
//                                                   tender shards, which carry
//                                                   both ocid and unp
//
// The OCDS rows are resolved HERE, into the shards, rather than left to
// resolve_contract_unp() at load time. Otherwise Postgres would hold a УНП the
// shard corpus doesn't, and pg_roundtrip.data.test.ts (rightly) fails: PG is
// asserted to be a lossless capture of the shards, not a superset of them. The
// SQL resolver stays as the safety net for OCDS rows ingested after this ran.
//
// `eop-T<contractNumber>` rows are ЕОП records the source published with no
// УНП. They stay null: neither tenders.tender_id (0 of 7,403) nor notice_id
// (13.6%) identifies them, and a wrong lineage is worse than none.
//
//   npx tsx scripts/procurement/backfill_unp.ts             # dry run (coverage)
//   npx tsx scripts/procurement/backfill_unp.ts --apply     # structural routes
//   npx tsx scripts/procurement/backfill_unp.ts --content --apply  # + content-join
//
// `--content` adds a fuzzy (buyer, value≈, year) tender content-join for the
// eop-`T…` rows that no structural route can resolve (their `T…` id maps to no
// proper УНП — 0/13,500 join tenders.tenderId). It is OPT-IN and MARGINAL: the
// raw join is only ~16% correct, so a CPV-division concordance gate is applied,
// which cuts it to ~319 high-confidence recoveries (100% CPV-concordant) out of
// ~8k eop-T rows. Kept off the default pipeline — most eop-T rows genuinely have
// no recoverable УНП, and a wrong lineage is worse than none.
//
// Re-runnable: idempotent. Only sets `unp` where it is currently absent, and
// only to a well-formed УНП. No network — reads raw_data/procurement/legacy/.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "url";
import { command, run, flag } from "cmd-ts";
import { canonicalJson } from "./validate";
import { UNP_RE, UNP_HEADER_PATTERNS } from "./unp";
import type { Contract } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const TENDERS_DIR = path.join(PROCUREMENT_DIR, "tenders");
const LEGACY_DIR = path.resolve(__dirname, "../../raw_data/procurement/legacy");

// УНП column header patterns — shared with the ingest parser via unp.ts so a
// header rename can never make the backfill and the parser disagree.
const UNP_HEADERS = UNP_HEADER_PATTERNS;
const DOC_HEADERS = [/номер.*на.*документ/i, /id.*на.*документ/i];

/**
 * Map `aop-legacy-<ds>-<documentId>` → УНП, read straight from the raw CSVs.
 *
 * The dataset label `<ds>` is the file's basename (`2022-RL`, `2019`, …), which
 * is exactly what legacy_csv.ts interpolates into the ocid, so the reconstructed
 * key matches without needing the dataset uuid.
 *
 * Two files are silently skipped, both harmlessly (they predate the tenders
 * corpus, which starts at procedure-year 2020): `2011-2015.csv.gz` is actually
 * JSON despite the extension, and `2018.csv.gz` publishes no УНП column at all.
 */
const buildLegacyMap = (): Map<string, string> => {
  const map = new Map<string, string>();
  if (!fs.existsSync(LEGACY_DIR)) return map;

  for (const file of fs.readdirSync(LEGACY_DIR).sort()) {
    if (!file.endsWith(".csv.gz")) continue;
    const ds = file.replace(/\.csv\.gz$/, "");
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(LEGACY_DIR, file)));
    const text = raw.toString("utf8").replace(/^\uFEFF/, "");
    if (text.trimStart().startsWith("[")) continue; // 2011-2015: JSON, not CSV

    let records: string[][];
    try {
      records = parse(text, { relaxColumnCount: true, skipEmptyLines: true });
    } catch {
      console.warn(`  ${ds}: unparseable CSV, skipped`);
      continue;
    }
    if (records.length < 2) continue;

    const header = records[0].map((h) => h.trim().replace(/^"+|"+$/g, ""));
    const unpIdx = header.findIndex((h) => UNP_HEADERS.some((p) => p.test(h)));
    const docIdx = header.findIndex((h) => DOC_HEADERS.some((p) => p.test(h)));
    if (unpIdx < 0 || docIdx < 0) {
      console.warn(`  ${ds}: no УНП column, skipped`);
      continue;
    }

    let kept = 0;
    for (let i = 1; i < records.length; i++) {
      const r = records[i];
      if (!r || r.length <= Math.max(unpIdx, docIdx)) continue;
      const unp = (r[unpIdx] ?? "").trim().replace(/^"+|"+$/g, "");
      const doc = (r[docIdx] ?? "").trim().replace(/^"+|"+$/g, "");
      if (!doc || !UNP_RE.test(unp)) continue;
      // (ds, documentId) → УНП is 1:1 across the corpus (87,272 pairs, zero
      // conflicts). A collision would mean the raw feed disagrees with itself.
      const key = `aop-legacy-${ds}-${doc}`;
      const prev = map.get(key);
      if (prev && prev !== unp) {
        console.warn(`  ${ds}: conflicting УНП for ${doc}: ${prev} vs ${unp}`);
        continue;
      }
      map.set(key, unp);
      kept++;
    }
    console.log(`  ${ds}: ${kept} rows → ${map.size} cumulative keys`);
  }
  return map;
};

// ---- content-join route (--content) ------------------------------------------
//
// eop-`T…` rows carry only ЦАИС's internal `T…` id, which maps to no proper УНП
// (verified: 0 of 13,500 join tenders.tenderId; the договори `tenderId` is a
// different id space). The remaining recovery is a CONTENT join: a null-УНП
// contract inherits a tender's УНП when that buyer has EXACTLY ONE tender whose
// estimated value ≈ the contract's SIGNING value and whose procedure year lines
// up. Uniqueness is the precision guard — a non-unique buyer/value/year bucket is
// left null (a wrong УНП lineage is worse than none). Opt-in only.

interface TenderLite {
  unp: string;
  eur: number;
  year: string; // procedure year from the УНП
  cpv: string;
}

// buyerEik → tenders (with a proper УНП + a euro estimate) for the content join.
const buildTenderValueIndex = (): Map<string, TenderLite[]> => {
  const idx = new Map<string, TenderLite[]>();
  if (!fs.existsSync(TENDERS_DIR)) return idx;
  for (const year of fs.readdirSync(TENDERS_DIR).sort()) {
    const dir = path.join(TENDERS_DIR, year);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      let rows: Array<{
        unp?: string;
        buyerEik?: string;
        estimatedValueEur?: number;
        cpv?: string;
      }>;
      try {
        rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        continue;
      }
      for (const t of rows) {
        if (
          !t.unp ||
          !UNP_RE.test(t.unp) ||
          !t.buyerEik ||
          typeof t.estimatedValueEur !== "number" ||
          t.estimatedValueEur <= 0
        )
          continue;
        const list = idx.get(t.buyerEik) ?? [];
        list.push({
          unp: t.unp,
          eur: t.estimatedValueEur,
          year: t.unp.slice(6, 10),
          cpv: (t.cpv ?? "").slice(0, 8),
        });
        idx.set(t.buyerEik, list);
      }
    }
  }
  return idx;
};

// Tight value tolerance for the content join — the estimate and the signed value
// are close but not identical, so a small band; uniqueness does the heavy lifting.
const CONTENT_VALUE_TOL = 0.02;

// Resolve a null-УНП contract's УНП via a UNIQUE (buyer, value≈, year) tender.
// `signed` is the at-signing euro value (signingAmountEur ?? amountEur). Returns
// {unp, cpvMatch} where cpvMatch reports whether the tender's CPV division agrees
// with the contract's — a precision proxy, not a gate. Undefined when not unique.
const contentResolve = (
  idx: Map<string, TenderLite[]>,
  c: Contract,
  signed: number | undefined,
): { unp: string; cpvMatch: boolean } | undefined => {
  if (signed == null || signed <= 0) return undefined;
  const list = idx.get(c.awarderEik);
  if (!list) return undefined;
  const yr = c.date.slice(0, 4);
  const hits = list.filter(
    (t) =>
      Math.abs(t.eur - signed) / signed <= CONTENT_VALUE_TOL &&
      Math.abs(Number(t.year) - Number(yr)) <= 1,
  );
  // Collapse hits that all point at the SAME УНП (a tender split into lots) — that
  // is still a unique procedure, not an ambiguous match.
  const unps = new Set(hits.map((h) => h.unp));
  if (unps.size !== 1) return undefined;
  const hit = hits[0];
  const bothCpvKnown = !!c.cpv && !!hit.cpv;
  const cpvMatch = bothCpvKnown && c.cpv!.slice(0, 2) === hit.cpv.slice(0, 2);
  // Precision gate: when both CPVs are known they MUST agree at the division
  // level. Without this the join is ~16% correct (a coincidental value collision
  // with an unrelated procedure of the same buyer); with it the surviving matches
  // are buyer + value + year + CPV-division concordant. Rows where either side
  // lacks a CPV can't be gated this way, so they fall through on uniqueness alone.
  if (bothCpvKnown && !cpvMatch) return undefined;
  return { unp: hit.unp, cpvMatch };
};

/**
 * Map `ocds-e82gsb-<tenderId>` → УНП from the tender shards, which carry both.
 * This is the only route for OCDS contracts: their releases publish no УНП.
 */
const buildOcdsMap = (): Map<string, string> => {
  const map = new Map<string, string>();
  if (!fs.existsSync(TENDERS_DIR)) return map;
  for (const year of fs.readdirSync(TENDERS_DIR).sort()) {
    const dir = path.join(TENDERS_DIR, year);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      let rows: Array<{ ocid?: string; unp?: string }>;
      try {
        rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        // One truncated/corrupt shard must not abort the whole backfill — skip
        // it and continue, matching the legacy CSV path's guard.
        console.warn(`  ${year}/${f}: unparseable tender shard, skipped`);
        continue;
      }
      for (const t of rows)
        if (t.ocid && t.unp && UNP_RE.test(t.unp)) map.set(t.ocid, t.unp);
    }
  }
  return map;
};

/** Resolve one contract's УНП, or undefined when no feed can supply it. */
const resolveUnp = (
  c: Contract,
  legacy: Map<string, string>,
  ocds: Map<string, string>,
): string | undefined => {
  if (c.unp) return c.unp;
  if (c.ocid.startsWith("eop-")) {
    const tail = c.ocid.slice(4);
    return UNP_RE.test(tail) ? tail : undefined; // `eop-T…` → no УНП
  }
  if (c.ocid.startsWith("aop-legacy-")) return legacy.get(c.ocid);
  return ocds.get(c.ocid);
};

const main = command({
  name: "backfill_unp",
  args: {
    apply: flag({ long: "apply", description: "write onto shards" }),
    content: flag({
      long: "content",
      description:
        "also recover УНП via a unique (buyer, value≈, year) tender content-join (eop-T rows)",
    }),
  },
  handler: ({ apply, content }) => {
    console.log("Building legacy (dataset, documentId) → УНП map…");
    const legacy = buildLegacyMap();
    console.log(`Legacy map: ${legacy.size} keys`);
    const ocds = buildOcdsMap();
    console.log(`OCDS ocid → УНП map: ${ocds.size} keys`);
    const tenders = content ? buildTenderValueIndex() : new Map();
    if (content) console.log(`Tender value index: ${tenders.size} buyers\n`);
    else console.log("");

    const stats = { total: 0, already: 0, eop: 0, legacy: 0, ocds: 0, none: 0 };
    // Content-join precision proxy: of the УНП recovered by content-join, how many
    // have a CPV division agreeing with the matched tender.
    const contentStats = { recovered: 0, cpvAgree: 0, cpvKnown: 0 };

    for (const year of fs.readdirSync(CONTRACTS_DIR).sort()) {
      const dir = path.join(CONTRACTS_DIR, year);
      if (year === "by-id" || !fs.statSync(dir).isDirectory()) continue;

      for (const f of fs.readdirSync(dir).sort()) {
        if (!f.endsWith(".json")) continue;
        const p = path.join(dir, f);
        let rows: Contract[];
        try {
          rows = JSON.parse(fs.readFileSync(p, "utf8")) as Contract[];
        } catch {
          console.warn(`  ${year}/${f}: unparseable contract shard, skipped`);
          continue;
        }
        let touched = false;

        for (const c of rows) {
          stats.total++;
          if (c.unp) {
            stats.already++;
            continue;
          }
          const unp = resolveUnp(c, legacy, ocds);
          if (unp) {
            c.unp = unp;
            touched = true;
            if (c.ocid.startsWith("eop-")) stats.eop++;
            else if (c.ocid.startsWith("aop-legacy-")) stats.legacy++;
            else stats.ocds++;
            continue;
          }
          // Content-join fallback for rows no structural route resolved.
          if (content) {
            const signed = c.signingAmountEur ?? c.amountEur;
            const cj = contentResolve(tenders, c, signed);
            if (cj) {
              c.unp = cj.unp;
              touched = true;
              contentStats.recovered++;
              if (c.cpv) {
                contentStats.cpvKnown++;
                if (cj.cpvMatch) contentStats.cpvAgree++;
              }
              continue;
            }
          }
          stats.none++;
        }
        if (touched && apply) fs.writeFileSync(p, canonicalJson(rows));
      }
    }

    const filled =
      stats.already +
      stats.eop +
      stats.legacy +
      stats.ocds +
      contentStats.recovered;
    const pct = (n: number) => ((100 * n) / stats.total).toFixed(1);
    console.log(`\nrows                      ${stats.total}`);
    console.log(`already had unp           ${stats.already}`);
    console.log(`filled from eop ocid      ${stats.eop}`);
    console.log(`filled from legacy CSV    ${stats.legacy}`);
    console.log(`filled from tender shards ${stats.ocds}`);
    if (content) {
      const prec =
        contentStats.cpvKnown > 0
          ? ((100 * contentStats.cpvAgree) / contentStats.cpvKnown).toFixed(1)
          : "n/a";
      console.log(
        `filled from content-join  ${contentStats.recovered} ` +
          `(CPV-division agreement ${prec}% of ${contentStats.cpvKnown} with a known CPV — precision proxy)`,
      );
    }
    console.log(`no УНП in any source      ${stats.none}`);
    console.log(`\nunp present after backfill: ${filled} (${pct(filled)}%)`);
    if (!apply) console.log("\nDry run — pass --apply to write.");
  },
});

run(main, process.argv.slice(2));
