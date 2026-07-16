// Phase 3a — parse the state RAIL SUBSIDY out of the already-cached State Budget Law
// HTML (raw_data/budget/law-YYYY.html.gz), for the rail subsidy-dependency tile on
// /sector/transport. NO new fetch: the subsidies appendix carries the numbered lines
//   1.2.1.1 – за „БДЖ – Пътнически превози"           (PSO operating subsidy)
//   1.2.1.2 – за НКЖИ                                   (infrastructure operating subsidy)
//   2.2.2   – за „БДЖ – Пътнически превози"            (capital transfer)
//   2.2.1   – за НКЖИ                                   (capital transfer)
// The operating line always precedes the capital line in document order (section 1.2.1
// before 2.2), so we take [0] = operating, [1] = capital per recipient. Amounts are in
// хил. лв (thousand BGN); Bulgaria displays EUR since 2026, so we convert at the fixed
// rate (хил.лв × 1000 ÷ 1.95583). Writes data/transport/rail_subsidy.json.
//
// See docs/plans/transport-view-v1.md "Phase 3 scope". Fold the trigger into
// update-budget (budget_law watcher) — re-run when a new ЗДБ lands. Run:
//   npx tsx scripts/transport/parse_rail_subsidy.ts

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const LAW_DIR = path.join(ROOT, "raw_data/budget");
const OUT_DIR = path.join(ROOT, "data/transport");
const OUT_FILE = path.join(OUT_DIR, "rail_subsidy.json");

const BGN_PER_EUR = 1.95583; // fixed euro-adoption rate (see feedback_bg_uses_eur)

// хил. лв (thousand BGN) string like "227 890,0" → EUR.
const thousandBgnToEur = (raw: string): number => {
  const bgn = Number(raw.replace(/\s/g, "").replace(",", ".")) * 1000;
  return Math.round(bgn / BGN_PER_EUR);
};

// Ordered amounts (operating first, capital second) for a recipient, from the flattened
// law text. Digit-bounded lazy gaps absorb the dash/quote/spacing variants across years.
const grab = (text: string, re: RegExp): number[] => {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, "g");
  while ((m = g.exec(text)) !== null) out.push(thousandBgnToEur(m[1]));
  return out;
};

const BDZ_RE = /БДЖ[^\d]{0,40}?Пътнически[^\d]{0,30}?([\d][\d ]*,\d)/;
const NKZHI_RE =
  /Национална компания[^\d]{0,20}?Железопътна инфраструктура[^\d]{0,15}?([\d][\d ]*,\d)/;

interface YearRow {
  fiscalYear: number;
  /** PSO operating subsidy to БДЖ — Пътнически превози (the per-ticket subsidy). */
  bdzPassengerPsoEur: number | null;
  /** Operating subsidy to НКЖИ (railway infrastructure). */
  nkzhiOperatingEur: number | null;
  /** Capital transfer to БДЖ — Пътнически превози (rolling stock etc.). */
  bdzCapitalEur: number | null;
  /** Capital transfer to НКЖИ (infrastructure investment). */
  nkzhiCapitalEur: number | null;
}

const main = (): void => {
  const files = readdirSync(LAW_DIR)
    .map((f) => f.match(/^law-(\d{4})\.html\.gz$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ year: Number(m[1]), file: `law-${m[1]}.html.gz` }))
    .sort((a, b) => a.year - b.year);

  const years: YearRow[] = [];
  for (const { year, file } of files) {
    const html = gunzipSync(readFileSync(path.join(LAW_DIR, file))).toString(
      "utf8",
    );
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;|&#\d+;/gi, " ")
      .replace(/\s+/g, " ");
    const bdz = grab(text, BDZ_RE);
    const nkzhi = grab(text, NKZHI_RE);
    if (bdz.length === 0 && nkzhi.length === 0) {
      console.warn(`  ${year}: no rail subsidy lines found — skipped`);
      continue;
    }
    years.push({
      fiscalYear: year,
      bdzPassengerPsoEur: bdz[0] ?? null,
      nkzhiOperatingEur: nkzhi[0] ?? null,
      bdzCapitalEur: bdz[1] ?? null,
      nkzhiCapitalEur: nkzhi[1] ?? null,
    });
  }

  years.sort((a, b) => a.fiscalYear - b.fiscalYear);
  const latest = years[years.length - 1] ?? null;

  const payload = {
    source: {
      name: "Държавен бюджет (ЗДБРБ)",
      note: "Субсидии и капиталови трансфери за железопътния транспорт от Закона за държавния бюджет (приложение „Субсидии и други текущи трансфери“ + „Капиталови трансфери“), административна единица МТС. хил. лв, конвертирани в EUR по 1,95583.",
      unit: "EUR",
      files: files.map((f) => `raw_data/budget/${f.file}`),
    },
    fetchedAt: new Date().toISOString(),
    years,
    latest,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  const eur = (v: number | null) =>
    v == null ? "—" : `€${(v / 1e6).toFixed(1)}M`;
  console.log(`Wrote ${OUT_FILE} — ${years.length} years`);
  for (const y of years)
    console.log(
      `  ${y.fiscalYear}: PSO ${eur(y.bdzPassengerPsoEur)} · НКЖИ oper ${eur(
        y.nkzhiOperatingEur,
      )} · БДЖ cap ${eur(y.bdzCapitalEur)} · НКЖИ cap ${eur(y.nkzhiCapitalEur)}`,
    );
};

main();
