// The dated FX table the declaration parser converts foreign-currency asset rows with.
//
// WHY THIS EXISTS. Each money table of the cacbg form (4 налични, 5 банкови сметки,
// 8 вложения) carries a `<Cell Num="4">` headed „Равностойност в лв." / „…в евро." that the
// DECLARANT fills in, and `pickEurValue` prefers it. Most foreign rows therefore already
// convert — 4,347 of 4,717 USD rows. The 462 that do not are the filings where that cell was
// left blank, and before this they were stored with `amount` + `currency` and a NULL
// `value_eur`, dropping out of every wealth aggregate with nothing flagging it. Пеевски's 2017
// balance of 4,481,442 USD is one of them.
// See docs/plans/declaration-fx-conversion-v1.md.
//
// WHY YEAR-END AND NOT AN ANNUAL AVERAGE. Tables 4/5/8 declare a STOCK — a balance as of
// 31 December of the reporting period — not a flow across it. An annual average is the wrong
// statistic for a point-in-time quantity, whichever one happens to sit closer to a given
// declarant's arithmetic.
//
// AND NOT A REVERSE-ENGINEERED "DECLARANT CONVENTION" EITHER. The 4,347 valued rows imply a
// median rate per (currency, period year), and it matches the ECB year-end fixing to four
// decimals for 2018, 2019, 2021 and 2025 — and matches nothing in particular for 2016, 2020 or
// 2022. Some declarants use the 31.12 fixing, some the rate at filing time, some a stale
// number. There is no convention to reproduce, so the rule has to be defensible on its own
// terms rather than imitative. The medians are still useful, but as a GATE rather than a
// source: declaration_fx_conversion.data.test.ts fails an imputed rate that strays more than
// 25% from the declarant median for the same (currency, year), which is what catches an
// inverted rate — the one failure here that no row count can see.
//
// WHY THE OUTPUT IS COMMITTED. A network fetch at parse time would make the corpus depend on
// WHEN it was parsed: re-parsing a 2017 filing in 2029 must yield the euro figure it yields
// today. The ECB revises nothing, so the committed table is stable by construction — this
// script only ever appends a year.
//
// Operator-run, not in any chain: it moves once a year, when a year closes.
//
//   npx tsx scripts/declarations/fetch_fx_rates.ts           # dry run, prints the diff
//   npx tsx scripts/declarations/fetch_fx_rates.ts --apply

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { FX_CURRENCIES, FX_TABLE_PATH, type FxTable } from "./fx";

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), "../..");

const SOURCE = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip";

/** The ECB quotes units of X per 1 EUR; every consumer here wants EUR per 1 X. */
const invert = (perEur: number): number => 1 / perEur;

/** Rates rounded to 6 significant decimals. The raw reciprocal carries float noise
 *  (0.8237232128...) that would churn the committed file on every re-run for no gain; six
 *  decimals is four more than any declared balance can resolve. */
const round6 = (n: number): number => Number(n.toFixed(6));

const fetchCsv = (): string => {
  const tmp = fs.mkdtempSync(path.join(REPO, ".fx-"));
  try {
    const zip = path.join(tmp, "hist.zip");
    const curl = spawnSync(
      "curl",
      ["-sSL", "--max-time", "120", "-o", zip, SOURCE],
      { stdio: "inherit" },
    );
    if (curl.status !== 0) throw new Error(`curl failed for ${SOURCE}`);
    const unzip = spawnSync("unzip", ["-o", "-q", zip, "-d", tmp], {
      stdio: "inherit",
    });
    if (unzip.status !== 0) throw new Error("unzip failed");
    const csv = fs
      .readdirSync(tmp)
      .find((f) => f.endsWith(".csv") && f !== "hist.zip");
    if (!csv) throw new Error("no CSV inside the ECB archive");
    return fs.readFileSync(path.join(tmp, csv), "utf8");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

/** Last QUOTED day of each year, not 31 December: the ECB publishes on TARGET business days,
 *  so most years end on the 30th or 31st and some on the 28th. Taking "the last row of the
 *  year" is the only formulation that does not silently return nothing for a year whose
 *  31 December was a weekend. */
const buildTable = (csv: string): FxTable => {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  const colOf = new Map(header.map((h, i) => [h, i]));

  const out: FxTable = {};
  // The ECB file is newest-first, so the FIRST row seen for a year is that year's last
  // quoted day. Asserted rather than assumed — see the ordering check below.
  const seen = new Set<string>();
  let prevDate = "";
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const date = (cells[0] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (prevDate && date > prevDate) {
      throw new Error(
        `ECB file is not newest-first (${date} follows ${prevDate}) — the "first row of a year is its last quoted day" rule no longer holds`,
      );
    }
    prevDate = date;
    const year = date.slice(0, 4);
    for (const ccy of FX_CURRENCIES) {
      const key = `${ccy}:${year}`;
      if (seen.has(key)) continue;
      const idx = colOf.get(ccy);
      if (idx === undefined) continue;
      const raw = (cells[idx] ?? "").trim();
      if (!raw || raw === "N/A") continue;
      const perEur = Number(raw);
      if (!Number.isFinite(perEur) || perEur <= 0) continue;
      seen.add(key);
      (out[ccy] ??= {})[year] = round6(invert(perEur));
    }
  }
  return out;
};

const main = (): void => {
  const apply = process.argv.includes("--apply");
  const abs = path.join(REPO, FX_TABLE_PATH);

  const table = buildTable(fetchCsv());
  for (const ccy of FX_CURRENCIES) {
    const years = Object.keys(table[ccy] ?? {});
    if (years.length === 0) throw new Error(`no ECB rates parsed for ${ccy}`);
    console.log(
      `${ccy}: ${years.length} years, ${years.sort()[0]}..${years.sort().at(-1)}`,
    );
  }

  const prev: FxTable = fs.existsSync(abs)
    ? JSON.parse(fs.readFileSync(abs, "utf8"))
    : {};
  // A rate that MOVES is the alarming case — the ECB revises nothing, so a changed historical
  // value means the parse changed, and every re-parse from here would silently restate filings
  // we have already published.
  //
  // THE OPEN YEAR IS THE ONE EXEMPTION, and it is not a loophole. Its entry is the last day
  // quoted SO FAR, not a year-end, so it legitimately moves on every run until the year
  // closes — and refusing there would make the guard fire on the only case that is expected.
  // Rows dated into the open year are the „при встъпване"/„при напускане" filings, which cover
  // a partial year and for which the latest fixing is the closest thing to a period end that
  // exists. The value settles by construction at the first run after the year closes.
  const openYear = new Date().getUTCFullYear();
  const moved: string[] = [];
  for (const ccy of FX_CURRENCIES) {
    for (const [year, rate] of Object.entries(prev[ccy] ?? {})) {
      if (Number(year) >= openYear) continue;
      const now = table[ccy]?.[year];
      if (now !== undefined && now !== rate)
        moved.push(`${ccy} ${year}: ${rate} → ${now}`);
    }
  }
  if (moved.length) {
    console.error(
      `REFUSING: ${moved.length} historical rate(s) changed — the ECB does not revise, so this is a parse change:\n  ${moved.join("\n  ")}`,
    );
    process.exit(1);
  }

  const added = FX_CURRENCIES.flatMap((c) =>
    Object.keys(table[c] ?? {})
      .filter((y) => prev[c]?.[y] === undefined)
      .map((y) => `${c} ${y} = ${table[c]![y]}`),
  );
  console.log(added.length ? `new: ${added.join(", ")}` : "no new rates");

  if (!apply) {
    console.log("dry run — pass --apply to write");
    return;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(table, null, 2) + "\n");
  console.log(`wrote ${FX_TABLE_PATH}`);
};

main();
