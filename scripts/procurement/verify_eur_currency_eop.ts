// Read-only check of the АОП portal CSV's EUR-tagged contracts against the ЦАИС ЕОП daily feed.
//
//   npx tsx scripts/procurement/verify_eur_currency_eop.ts            # summary + list file
//   npx tsx scripts/procurement/verify_eur_currency_eop.ts --from 2020 --to 2025
//
// WHY: the deferred-followups entry „ЦАИС ЕОП pre-2026 EUR guard" records that most of the
// 2020–2025 legacy-CSV contracts labelled `EUR` were entered in BGN, so dividing them by 1.95583
// would be right and trusting the label wrong — or the reverse — contract by contract. The ЕОП
// daily JSON (raw_data/procurement/eop/*.json.gz, one file per day) is the independent witness,
// and it carries TWO currency fields, `currency` and `contractCurrency`, that can disagree. This
// script measures, it does not decide: it joins each EUR-labelled legacy row to its ЕОП record
// and reports how the two fields agree with each other and with the legacy amount.
//
// READ-ONLY. It writes one report, raw_data/procurement/eur_currency_check.json (gitignored),
// and touches no shard, table or committed file. A correction goes through the normal re-key
// chain in CLAUDE.md, never through this script.
//
// ⚠️ THE LEGACY CSV IS NOT WHERE THE „365" LIVES. Measured 2026-10-21 its currency column tags
// 90 rows EUR for 2020–2023 (none in the 2024/2025 RL dumps), of which `parseLegacyCsv` keeps 57
// — the rest it drops, mostly for having no valid contractor, before currency is looked at. The ЕОП daily feed is where
// the corpus's EUR contracts come from, so the script ALSO measures the feed on its own (part 2):
// which of its two currency fields describes `contractValue`.
//
// THE JOIN: УНП + contract number first, then УНП + supplier ЕИК. A legacy row with no УНП
// cannot be joined and is counted as such — the feed's `T`-ids („T" + tenderId, used when a
// procedure has no УНП) are not in the legacy CSV's УНП column.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LEGACY_DATASETS,
  parseLegacyCsv,
  type LegacyDataset,
} from "./legacy_csv";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const LEGACY_DIR = path.join(ROOT, "raw_data/procurement/legacy");
const EOP_DIR = path.join(ROOT, "raw_data/procurement/eop");
const OUT = path.join(ROOT, "raw_data/procurement/eur_currency_check.json");

/** One ЕОП daily row, reduced to what the check needs. */
export interface EopCurrencyRow {
  unp: string;
  contractNumber: string;
  supplierEik: string;
  contractValue: number | null;
  currency: string;
  contractCurrency: string;
  day: string;
}

/** „751832,33" → 751832.33; empty or unparsable → null. Comma decimal, optional spaces. */
export const parseEopAmount = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const norm = (s: unknown): string =>
  String(s ?? "")
    .trim()
    .toUpperCase();

/**
 * Which unit a contract value is really in, judged against the SAME row's estimate. Used only
 * where the two fields disagree AND `currency` is BGN — that `currency` labels the estimate is
 * INFERRED from the field order (it sits beside `estimatedValue`), not shown by the feed, and
 * the bands mean nothing for an EUR or USD estimate. An award rarely lands above its estimate or
 * far below it, so against a BGN estimate:
 *   ratio 0.3–0.6 (an EUR amount, i.e. ÷1.95583 × a discount) → the EUR contract label holds;
 *   ratio 0.6–1.2 (same units as the estimate)               → the amount is BGN under an EUR
 *                                                                label.
 * Everything else is reported as `ambiguous` — a halved estimate, a lot split, a typo — never
 * decided. The bands are disjoint; a measurement near an edge still needs a human.
 */
export const ratioBand = (
  contractValue: number | null,
  estimatedValue: number | null,
): "eur-scale" | "same-scale" | "ambiguous" | "no-ratio" => {
  if (!contractValue || !estimatedValue) return "no-ratio";
  const r = contractValue / estimatedValue;
  if (r >= 0.3 && r < 0.6) return "eur-scale";
  if (r >= 0.6 && r <= 1.2) return "same-scale";
  return "ambiguous";
};

export const toEopRow = (
  r: Record<string, unknown>,
  day: string,
): EopCurrencyRow => ({
  unp: String(r.uniqueProcurementNumber ?? "").trim(),
  contractNumber: String(r.contractNumber ?? "").trim(),
  supplierEik: String(r.supplierRegisterNumber ?? "").trim(),
  contractValue: parseEopAmount(r.contractValue),
  currency: norm(r.currency),
  contractCurrency: norm(r.contractCurrency),
  day,
});

/** The two lookup keys a row is indexed under. */
export const joinKeys = (
  unp: string,
  contractNumber: string | undefined,
  eik: string | undefined,
): { byNumber: string | null; byEik: string | null } => ({
  byNumber: unp && contractNumber ? `${unp}|n|${contractNumber.trim()}` : null,
  byEik: unp && eik ? `${unp}|e|${eik.trim()}` : null,
});

/**
 * What a matched pair says about the EUR label. `legacyAmount` is the legacy CSV's number
 * under its EUR label; `eop` is the ЕОП record.
 *
 * - `fields`: whether ЕОП's `currency` and `contractCurrency` agree, and on what.
 * - `amountCheck`: whether ЕОП's `contractValue` equals the legacy amount (to the cent) — if it
 *   does and ЕОП says BGN, the legacy EUR label is wrong; if ЕОП says EUR, the label holds.
 */
export const classify = (
  legacyAmount: number,
  eop: EopCurrencyRow,
): {
  fields: "agree" | "disagree" | "one-empty" | "both-empty";
  eopSays: string;
  amountCheck: "equal" | "differs" | "no-value";
} => {
  const a = eop.currency;
  const b = eop.contractCurrency;
  const fields =
    !a && !b
      ? "both-empty"
      : !a || !b
        ? "one-empty"
        : a === b
          ? "agree"
          : "disagree";
  const eopSays =
    fields === "agree" ? a : fields === "disagree" ? `${a}/${b}` : a || b || "";
  const amountCheck =
    eop.contractValue === null || eop.contractValue === 0
      ? "no-value"
      : Math.abs(eop.contractValue - legacyAmount) < 0.01
        ? "equal"
        : "differs";
  return { fields, eopSays, amountCheck };
};

const legacyDatasetFor = (year: string): LegacyDataset =>
  LEGACY_DATASETS.find((d) => d.year === year) ?? {
    // A year discovered after LEGACY_DATASETS was pinned (2024-RL, 2025-RL). The UUID only
    // feeds the contract KEY, which this read-only check never uses.
    year,
    datasetUuid: `local-${year}`,
    system: year.endsWith("-RL") ? "RL" : "CE",
  };

const main = (): void => {
  const arg = (f: string) => {
    const i = process.argv.indexOf(f);
    return i >= 0 ? Number(process.argv[i + 1]) : undefined;
  };
  const from = arg("--from") ?? 2020;
  const to = arg("--to") ?? 2025;

  // ── the EUR-labelled legacy rows ──────────────────────────────────────────
  const legacy: {
    year: string;
    unp?: string;
    contractId?: string;
    contractorEik: string;
    amount: number;
    awarderName: string;
    contractorName: string;
  }[] = [];
  for (const f of fs.readdirSync(LEGACY_DIR).sort()) {
    const m = /^(\d{4})(-RL)?\.csv\.gz$/.exec(f);
    if (!m || Number(m[1]) < from || Number(m[1]) > to) continue;
    const year = m[1] + (m[2] ?? "");
    const text = zlib
      .gunzipSync(fs.readFileSync(path.join(LEGACY_DIR, f)))
      .toString("utf8");
    const { rows } = parseLegacyCsv(text, legacyDatasetFor(year));
    for (const r of rows)
      if ((r.currency ?? "").toUpperCase() === "EUR")
        legacy.push({
          year,
          unp: r.unp,
          contractId: r.contractId,
          contractorEik: r.contractorEik,
          amount: r.amount,
          awarderName: r.awarderName,
          contractorName: r.contractorName,
        });
  }

  // ── the ЕОП witness ───────────────────────────────────────────────────────
  const unpsWanted = new Set(
    legacy.map((r) => r.unp).filter(Boolean) as string[],
  );
  const index = new Map<string, EopCurrencyRow[]>();
  // Part 2 — the feed on its own: every row with a contract value, by currency pair, and the
  // estimate-ratio band of every row whose two fields disagree.
  const pairs: Record<string, number> = {};
  const disagreeBands: Record<string, number> = {};
  const disagreeSample: (EopCurrencyRow & { estimatedValue: number | null })[] =
    [];
  let unreadable = 0;
  let rowsWithValue = 0;
  const distinctWithValue = new Set<string>();
  for (const f of fs.readdirSync(EOP_DIR).sort()) {
    if (!f.endsWith(".json.gz")) continue;
    const day = f.slice(0, 10);
    if (Number(day.slice(0, 4)) < from || Number(day.slice(0, 4)) > to)
      continue;
    let data: unknown;
    try {
      data = JSON.parse(
        zlib
          .gunzipSync(fs.readFileSync(path.join(EOP_DIR, f)))
          .toString("utf8"),
      );
    } catch {
      unreadable++;
      continue;
    }
    if (!Array.isArray(data)) {
      unreadable++;
      continue;
    }
    for (const raw of data as Record<string, unknown>[]) {
      const r = toEopRow(raw, day);
      if (r.contractValue) {
        rowsWithValue++;
        distinctWithValue.add(`${r.unp}|${r.contractNumber}|${r.supplierEik}`);
        const pair = `${r.currency || "∅"}/${r.contractCurrency || "∅"}`;
        pairs[pair] = (pairs[pair] ?? 0) + 1;
        if (
          r.currency &&
          r.contractCurrency &&
          r.currency !== r.contractCurrency
        ) {
          const est = parseEopAmount(raw.estimatedValue);
          const band = `${pair} ${
            r.currency === "BGN"
              ? ratioBand(r.contractValue, est)
              : "not-applicable"
          }`;
          disagreeBands[band] = (disagreeBands[band] ?? 0) + 1;
          if (disagreeSample.length < 40)
            disagreeSample.push({ ...r, estimatedValue: est });
        }
      }
      if (!unpsWanted.has(r.unp)) continue;
      // A consortium lists several ЕИК joined by „;" — index each, or the by-ЕИК fallback can
      // never match one of its members.
      const keys = new Set<string>();
      const kn = joinKeys(r.unp, r.contractNumber, undefined).byNumber;
      if (kn) keys.add(kn);
      for (const eik of r.supplierEik.split(";")) {
        const ke = joinKeys(r.unp, undefined, eik).byEik;
        if (ke) keys.add(ke);
      }
      for (const key of keys) index.set(key, [...(index.get(key) ?? []), r]);
    }
  }

  // ── join + classify ───────────────────────────────────────────────────────
  const results = legacy.map((l) => {
    if (!l.unp) return { ...l, match: "no-unp" as const };
    const k = joinKeys(l.unp, l.contractId, l.contractorEik);
    const hits =
      (k.byNumber && index.get(k.byNumber)) ||
      (k.byEik && index.get(k.byEik)) ||
      [];
    if (!hits.length) return { ...l, match: "unmatched" as const };
    // The latest publication is the record's current state.
    const eop = hits.reduce((a, b) => (b.day > a.day ? b : a));
    return {
      ...l,
      match: (k.byNumber && index.get(k.byNumber) ? "by-number" : "by-eik") as
        | "by-number"
        | "by-eik",
      eop,
      ...classify(l.amount, eop),
    };
  });

  const count = (pred: (r: (typeof results)[number]) => boolean) =>
    results.filter(pred).length;
  const tally = <K extends string>(
    get: (r: (typeof results)[number]) => K | undefined,
  ) => {
    const out: Record<string, number> = {};
    for (const r of results) {
      const k = get(r);
      if (k !== undefined) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const summary = {
    generatedAt: new Date().toISOString(),
    window: `${from}–${to}`,
    eurLabelledLegacyRows: legacy.length,
    byYear: tally((r) => r.year),
    match: tally((r) => r.match),
    eopFields: tally((r) => ("fields" in r ? r.fields : undefined)),
    eopSays: tally((r) => ("eopSays" in r ? r.eopSays : undefined)),
    amountVsEop: tally((r) => ("amountCheck" in r ? r.amountCheck : undefined)),
    // The rows the followup is about: ЕОП records the contract in BGN with the same number the
    // legacy CSV labels EUR — i.e. the EUR label is wrong and the amount is already лева.
    bgnUnderEurLabel: count(
      (r) => "eopSays" in r && r.eopSays === "BGN" && r.amountCheck === "equal",
    ),
    // The rows that need a human: the two ЕОП fields disagree, so which one is authoritative is
    // exactly the open question.
    fieldsDisagree: count((r) => "fields" in r && r.fields === "disagree"),
    // Part 2 — the ЕОП feed itself, rows with a contract value in the window.
    eopFeed: {
      // ROW PUBLICATIONS: a contract is republished on later days, so this exceeds the number of
      // distinct contracts — which is the second figure.
      rowsWithValue,
      distinctContractsWithValue: distinctWithValue.size,
      unreadableFiles: unreadable,
      currencyPairs: pairs,
      disagreeingRowsByRatioBand: disagreeBands,
    },
  };
  fs.writeFileSync(
    OUT,
    JSON.stringify({ summary, rows: results, disagreeSample }, null, 1),
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${path.relative(ROOT, OUT)} (${results.length} rows)`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
