// Reproducible build of data/budget/vss/budget.json — the judiciary's own
// budget, as adopted in each year's State Budget Law (ЗДБРБ).
//
// The съдебна власт is a first-level spending body with its own article in the
// ЗДБРБ, which prints TWO tables we care about:
//
//   (1) "Приема бюджета на съдебната власт за <year> г." — the fund's own
//       revenue (съдебни такси, глоби, приходи от собственост, други) and its
//       expenditure split (Текущи / Капиталови / Резерв).
//   (2) "Определя бюджетните разходи на органите на съдебната власт" — the
//       per-body split across the eight spending bodies (ВСС, ВКС, ВАС, ПРБ,
//       Съдилища, НИП, ИВСС, Резерв). Σ bodies == total expenditure.
//
// Both tables are stable across 2018-2025 (verified: identical eight labels every
// year), so we parse them straight off the same cached law HTML the budget
// ingest already uses (raw_data/budget/law-<year>.html.gz) via LAW_DV_MATERIALS —
// no new fetch, no new watcher.
//
// NOTE on издръжка: data/budget/izdrazhka_by_institution.json reports "Съдебна
// власт" as its Текущи разходи, NOT a personnel-excluded residual — the ЗДБРБ
// prints no Персонал line for the judiciary, so the residual formula subtracts
// nothing. (Verified: 2024 Текущи 1,192,854.9 хил. лв ÷ 1.95583 = €609,897k,
// exactly the izdrazhka figure.) That is why this artifact exists: the pack must
// show the judiciary's TOTAL budget, not the izdrazhka number.
//
// 2026 is a draft with no cached law — omitted rather than guessed.
//
// Run after a budget-law refresh (the budget_law watcher → update-budget):
//   npx tsx scripts/budget/__write_judiciary.ts

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";
import { LAW_DV_MATERIALS } from "./fetch_sources";
import { flatLines } from "../lib/html";

// The budget laws 2018-2025 are denominated in thousand leva.
const BGN_PER_EUR = 1.95583;
const THOUSAND = 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/budget");
const OUT_DIR = path.resolve(__dirname, "../../data/budget/vss");
const OUT = path.join(OUT_DIR, "budget.json");

interface Money {
  amountEur: number;
  amount: number;
  currency: "BGN";
}

/** One line of the judiciary budget — a spending body or a revenue source. The
 *  two tables share a shape; mirrors `JudiciaryBudgetLine` in
 *  src/data/budget/types.ts, which the frontend reads. */
interface JudiciaryBudgetLine {
  id: string;
  bg: string;
  en: string;
  amount: Money;
}

interface JudiciaryBudgetYear {
  fiscalYear: number;
  basis: "law";
  currencyOfRecord: "BGN";
  totalRevenue: Money;
  totalExpenditure: Money;
  currentExpenditure: Money;
  capitalExpenditure: Money;
  /** Σ bodies == totalExpenditure. */
  bodies: JudiciaryBudgetLine[];
  /** Σ revenue lines == totalRevenue. */
  revenue: JudiciaryBudgetLine[];
}

// ---------------------------------------------------------------- parsing ---

/** Space-like digit groupers seen in Държавен вестник's HTML tables. */
const DV_SPACES = /[\u0020\u00a0\u2007\u2009\u202f]/g;

/** "1 221 324,9" → 1221324.9 (thousand leva, as printed). Pure-number lines
 *  only, so a row code ("1.2.1.") is never mistaken for a value — which is why
 *  the decimal mark here is a COMMA only, unlike the caseload parser's `num()`:
 *  accepting a dot would make "1.2.1." look like a number.
 *
 *  The integer branch accepts any length: a small ЗДБРБ line (a `Резерв` of 900,
 *  or an ИВСС line under 100 хил. лв.) must not parse as `null` and let
 *  `valAfter` grab a later row's figure. */
const asNum = (s: string): number | null => {
  const t = s.trim().replace(DV_SPACES, " ");
  if (/^-?\d[\d ]*,\d+$/.test(t) || /^-?\d[\d ]*$/.test(t))
    return parseFloat(t.replace(/ /g, "").replace(",", "."));
  return null;
};

/** First numeric line within `lookahead` lines after the label. */
const valAfter = (
  lines: string[],
  labelRe: RegExp,
  lookahead = 3,
): number | null => {
  for (let i = 0; i < lines.length; i++) {
    if (labelRe.test(lines[i]))
      for (let t = 1; t <= lookahead && i + t < lines.length; t++) {
        const v = asNum(lines[i + t]);
        if (v !== null) return v;
      }
  }
  return null;
};

/** Thousand leva (as printed) → Money in absolute BGN + EUR. */
const money = (levaK: number): Money => {
  const amount = Math.round(levaK * THOUSAND);
  return {
    amount,
    amountEur: Math.round(amount / BGN_PER_EUR),
    currency: "BGN",
  };
};

// The eight per-body rows, in the законов order. Labels verified identical for
// every year 2018-2025 — an exact match is therefore an assertion, not a guess.
const BODIES: { id: string; label: string; en: string }[] = [
  { id: "vss", label: "Висш съдебен съвет", en: "Supreme Judicial Council" },
  {
    id: "vks",
    label: "Върховен касационен съд",
    en: "Supreme Court of Cassation",
  },
  {
    id: "vas",
    label: "Върховен административен съд",
    en: "Supreme Administrative Court",
  },
  {
    id: "prb",
    label: "Прокуратура на Република България",
    en: "Prosecutor's Office",
  },
  { id: "courts", label: "Съдилища на Република България", en: "The courts" },
  {
    id: "nip",
    label: "Национален институт на правосъдието",
    en: "National Institute of Justice",
  },
  {
    id: "ivss",
    label: "Инспекторат към Висшия съдебен съвет",
    en: "Inspectorate to the SJC",
  },
  {
    id: "reserve",
    label: "Резерв за непредвидени и/или неотложни разходи",
    en: "Contingency reserve",
  },
];

const REVENUE: { id: string; re: RegExp; bg: string; en: string }[] = [
  {
    id: "courtFees",
    re: /^Съдебни такси$/,
    bg: "Съдебни такси",
    en: "Court fees",
  },
  {
    id: "property",
    re: /^Приходи и доходи от собственост$/,
    bg: "Приходи и доходи от собственост",
    en: "Income from property",
  },
  {
    id: "fines",
    re: /^Глоби, санкции и наказателни лихви$/,
    bg: "Глоби, санкции и наказателни лихви",
    en: "Fines & penalties",
  },
  {
    id: "other",
    re: /^Други приходи$/,
    bg: "Други приходи",
    en: "Other revenue",
  },
];

const cachedHtml = (year: number): string =>
  zlib
    .gunzipSync(fs.readFileSync(path.join(RAW_DIR, `law-${year}.html.gz`)))
    .toString("utf8");

const parseYear = (html: string, year: number): JudiciaryBudgetYear => {
  const lines = flatLines(html);

  // --- table (1): the judiciary's own budget block -------------------------
  const startRe = new RegExp(`Приема бюджета на съдебната власт за ${year} г`);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) throw new Error(`${year}: judiciary budget article not found`);
  // Table (1) ends at the next numbered paragraph, whatever it is. From 2025 the
  // law inserts a functional-area ("програмен бюджет") table as paragraph (2),
  // pushing the per-body split to (3) — so the block boundary must not assume a
  // paragraph number, and the per-body paragraph is matched by its wording.
  const nextPara = lines.findIndex((l, i) => i > start && /^\(\d+\)\s/.test(l));
  if (nextPara < 0)
    throw new Error(`${year}: no paragraph after the budget table`);
  const block = lines.slice(start, nextPara);

  const bodyHdr = lines.findIndex(
    (l, i) => i > start && /^\(\d+\)\s.*органите на съдебната власт/.test(l),
  );
  if (bodyHdr < 0) throw new Error(`${year}: per-body paragraph not found`);

  const totalRevK = valAfter(block, /^ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ$/);
  const totalExpK = valAfter(block, /^РАЗХОДИ$/);
  const currentK = valAfter(block, /^Текущи разходи$/);
  const capitalK = valAfter(block, /^Капиталови разходи$/);
  if (totalRevK === null || totalExpK === null)
    throw new Error(`${year}: revenue/expenditure totals not parsed`);
  if (currentK === null || capitalK === null)
    throw new Error(`${year}: current/capital expenditure not parsed`);

  const revenue: JudiciaryBudgetLine[] = [];
  for (const r of REVENUE) {
    const v = valAfter(block, r.re);
    if (v === null)
      throw new Error(`${year}: revenue line "${r.id}" not found`);
    revenue.push({ id: r.id, bg: r.bg, en: r.en, amount: money(v) });
  }

  // --- table (2): the per-body split --------------------------------------
  const tblIdx = lines.findIndex(
    (l, i) => i >= bodyHdr && l === "Органи на съдебната власт",
  );
  if (tblIdx < 0) throw new Error(`${year}: per-body table header not found`);
  const totalIdx = lines.findIndex((l, i) => i > tblIdx && /^Всичко/.test(l));
  if (totalIdx < 0) throw new Error(`${year}: per-body "Всичко" row not found`);
  const tbl = lines.slice(tblIdx, totalIdx);

  const bodies: JudiciaryBudgetLine[] = [];
  for (const b of BODIES) {
    const esc = b.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const v = valAfter(tbl, new RegExp(`^${esc}$`));
    if (v === null) throw new Error(`${year}: body "${b.label}" not found`);
    bodies.push({ id: b.id, bg: b.label, en: b.en, amount: money(v) });
  }

  // --- reconciliation asserts ---------------------------------------------
  const bodySumK = bodies.reduce((s, b) => s + b.amount.amount, 0) / THOUSAND;
  if (Math.abs(bodySumK - totalExpK) > 0.5)
    throw new Error(
      `${year}: Σ bodies (${bodySumK}) != total expenditure (${totalExpK}) хил. лв`,
    );
  const revSumK = revenue.reduce((s, r) => s + r.amount.amount, 0) / THOUSAND;
  if (Math.abs(revSumK - totalRevK) > 0.5)
    throw new Error(
      `${year}: Σ revenue (${revSumK}) != total revenue (${totalRevK}) хил. лв`,
    );
  // Текущи and Капиталови are the only figures `valAfter` reads that nothing
  // else cross-checks: a ДВ layout shift that made the label match a neighbouring
  // sub-line or a percentage cell would ship a wrong split while every other
  // assert above still passed. The law's third expenditure bucket is the Резерв,
  // so the three must exhaust the total. (Holds exactly, all years 2018-2025.)
  const reserveK =
    (bodies.find((b) => b.id === "reserve")?.amount.amount ?? 0) / THOUSAND;
  if (Math.abs(currentK + capitalK + reserveK - totalExpK) > 0.5)
    throw new Error(
      `${year}: Текущи (${currentK}) + Капиталови (${capitalK}) + Резерв (${reserveK}) != РАЗХОДИ (${totalExpK}) хил. лв`,
    );

  return {
    fiscalYear: year,
    basis: "law",
    currencyOfRecord: "BGN",
    totalRevenue: money(totalRevK),
    totalExpenditure: money(totalExpK),
    currentExpenditure: money(currentK),
    capitalExpenditure: money(capitalK),
    bodies,
    revenue,
  };
};

// ------------------------------------------------------------------- main ---

const main = (): void => {
  // A year that fails to parse must NOT silently shrink the committed artifact.
  // The judiciary budget article's paragraph numbering already shifted once (a
  // functional-area table appeared in 2025), so a future layout change is likely
  // — and writing the remainder would regress `latestYear` and quietly ship a
  // stale budget. Fail loudly; require an explicit opt-in for a partial rebuild.
  // (A year with NO cached law HTML is a different case: it is simply not
  // available yet, so it is skipped without failing.)
  const allowPartial = process.argv.includes("--allow-partial");
  const years: JudiciaryBudgetYear[] = [];
  const failed: number[] = [];
  for (const yearStr of Object.keys(LAW_DV_MATERIALS)) {
    const year = parseInt(yearStr, 10);
    const file = path.join(RAW_DIR, `law-${year}.html.gz`);
    if (!fs.existsSync(file)) {
      console.warn(`skip ${year}: no cached law HTML`);
      continue;
    }
    try {
      years.push(parseYear(cachedHtml(year), year));
    } catch (err) {
      console.error(`FAILED ${year}:`, (err as Error).message);
      failed.push(year);
    }
  }
  if (!years.length) throw new Error("no judiciary budget years parsed");
  if (failed.length && !allowPartial)
    throw new Error(
      `${failed.length} year(s) failed to parse (${failed.join(", ")}) — refusing to overwrite ${OUT} with a partial rebuild. ` +
        `Fix the parser, or re-run with --allow-partial if the loss is intended.`,
    );
  if (failed.length)
    console.warn(
      `--allow-partial: writing WITHOUT ${failed.join(", ")} — latestYear will be ${Math.max(...years.map((y) => y.fiscalYear))}`,
    );
  years.sort((a, b) => b.fiscalYear - a.fiscalYear);

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Държавен вестник",
      law: "Закон за държавния бюджет на Република България",
      url: "https://dv.parliament.bg/",
      description:
        "Бюджетът на съдебната власт и разходите по органи, приети с ЗДБРБ за съответната година (чл. „Бюджет на съдебната власт“).",
    },
    latestYear: years[0].fiscalYear,
    years,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `wrote ${OUT} — ${years.length} years (${years[years.length - 1].fiscalYear}-${years[0].fiscalYear})`,
  );
  for (const y of years)
    console.log(
      `  ${y.fiscalYear}: разходи €${(y.totalExpenditure.amountEur / 1e6).toFixed(1)}M · приходи €${(y.totalRevenue.amountEur / 1e6).toFixed(1)}M · ВСС €${((y.bodies.find((b) => b.id === "vss")?.amount.amountEur ?? 0) / 1e6).toFixed(1)}M`,
    );
};

main();
