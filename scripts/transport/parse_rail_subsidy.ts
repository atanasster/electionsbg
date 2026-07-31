// Phase 3a — parse the state RAIL SUBSIDY out of the already-cached State Budget Law
// HTML (raw_data/budget/law-YYYY.html.gz), for the rail subsidy-dependency tile on
// /sector/transport. NO new fetch: the subsidies appendix carries the numbered lines
//   1.2.1.1 – за „БДЖ – Пътнически превози"           (PSO operating subsidy)
//   1.2.1.2 – за НКЖИ                                   (infrastructure operating subsidy)
//   2.2.2   – за „БДЖ – Пътнически превози"            (capital transfer)
//   2.2.1   – за НКЖИ                                   (capital transfer)
// The operating line always precedes the capital line in document order (section 1.2.1
// before 2.2), so we take [0] = operating, [1] = capital per recipient. Amounts are in
// thousands: хил. лв through the FY2025 law (converted at the fixed 1.95583 peg), and
// хил. евро from the FY2026 law on, which needs no conversion — the denomination is
// detected per document. Writes data/transport/rail_subsidy.json.
//
// See docs/plans/transport-view-v1.md "Phase 3 scope". Fold the trigger into
// update-budget (budget_law watcher) — re-run when a new ЗДБ lands. Run:
//   npx tsx scripts/transport/parse_rail_subsidy.ts

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAW_DV_MATERIALS } from "../budget/fetch_sources";
import { detectLawCurrency } from "../budget/law_html";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const LAW_DIR = path.join(ROOT, "raw_data/budget");
const OUT_DIR = path.join(ROOT, "data/transport");
const OUT_FILE = path.join(OUT_DIR, "rail_subsidy.json");

const BGN_PER_EUR = 1.95583; // fixed euro-adoption rate (see feedback_bg_uses_eur)

// Thousands string like "227 890,0" → EUR. Laws through FY2025 are denominated
// in хил. лв and need the peg; the FY2026 law onward is already хил. евро, so
// dividing again would halve every figure. Currency is detected per document.
const thousandsToEur = (raw: string, currency: "BGN" | "EUR"): number => {
  const units = Number(raw.replace(/\s/g, "").replace(",", ".")) * 1000;
  return Math.round(currency === "EUR" ? units : units / BGN_PER_EUR);
};

// Ordered amounts (operating first, capital second) for a recipient, from the flattened
// law text. Digit-bounded lazy gaps absorb the dash/quote/spacing variants across years.
const grab = (
  text: string,
  re: RegExp,
  currency: "BGN" | "EUR",
): number[] => {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, "g");
  while ((m = g.exec(text)) !== null) out.push(thousandsToEur(m[1], currency));
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
  // Resolve each catalogued ЗДБРБ through LAW_DV_MATERIALS rather than globbing
  // `law-<year>.html.gz`. Those year-keyed blobs are the LEGACY cache naming:
  // the budget fetcher now writes `law-<idMat>.html.gz`, so a glob would silently
  // stop at 2025 and every newly-promulgated law would be missing from the tile
  // with nothing failing. Prefer the idMat cache, fall back to the legacy name.
  const files = Object.entries(LAW_DV_MATERIALS)
    .map(([y, idMat]) => {
      const year = Number(y);
      for (const file of [`law-${idMat}.html.gz`, `law-${year}.html.gz`]) {
        if (existsSync(path.join(LAW_DIR, file))) return { year, file };
      }
      console.warn(`  ${year}: no cached law HTML — skipped`);
      return null;
    })
    .filter((f): f is { year: number; file: string } => f !== null)
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
    const { currency } = detectLawCurrency(html);
    const bdz = grab(text, BDZ_RE, currency);
    const nkzhi = grab(text, NKZHI_RE, currency);
    if (bdz.length === 0 && nkzhi.length === 0) {
      console.warn(`  ${year}: no rail subsidy lines found — skipped`);
      continue;
    }
    // We assume exactly two matches per recipient (operating then capital, in document
    // order). A stray reference elsewhere in the law would push extra matches in and shift
    // the positional [0]=operating / [1]=capital assignment, silently mis-labelling the
    // subsidy. Warn loudly so a future ЗДБ layout change surfaces instead of mis-parsing.
    if (bdz.length > 2 || nkzhi.length > 2)
      console.warn(
        `  ${year}: unexpected match count (БДЖ ${bdz.length}, НКЖИ ${nkzhi.length}, ` +
          `expected ≤2 each) — positional operating/capital assignment may be wrong`,
      );
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
      note: "Субсидии и капиталови трансфери за железопътния транспорт от Закона за държавния бюджет (приложение „Субсидии и други текущи трансфери“ + „Капиталови трансфери“), административна единица МТС. До 2025 г. сумите са в хил. лв, конвертирани в EUR по 1,95583; от 2026 г. законът е в хил. евро.",
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
