// Reproducible build of data/judiciary/magistrate_holdings.json — the companies a
// magistrate DECLARES a link to (ownership stake or participation), resolved to an
// EIK where the name maps to exactly one Commerce-Registry entity. This is the first
// slice that folds magistrates into the connections layer (see the officials
// pipeline in scripts/declarations/*), and the input to the "магистрати" source on
// company pages + the magistrate /person lookup.
//
// Source: the ИВСС asset/interest declarations (чл. 175а ЗСВ), the v3.0 PDF form. We
// harvest COMPANY NAMES from the two sections that carry them — ЧАСТ I „Дялове в
// дружества / Ценни книги" (ownership) and ЧАСТ II „Участие в търговски дружества /
// органи на управление" (participation/management). The fillable-form text layer
// interleaves template labels with values, so we do NOT try to reconstruct each
// table's columns; we harvest cells that are company names (start with a capital,
// end in a legal-form token) and attach a stake % when the row carries one. That
// captures the connection (which companies) robustly without a per-table parse.
//
// Scope of THIS slice (see docs/plans/judiciary-vss-v1.md §6):
//   - each magistrate's MOST RECENT annual declaration. The roster ACCUMULATES rather
//     than tracking the current bench, so the ИВСС register's yearly turnover cannot
//     delete a person page (see the `byName` comment below for the whole argument).
//     Fetching stays latest-year only; earlier years survive from the cache;
//   - PLUS, since 2026-08-24, each magistrate's full FILING HISTORY — every declaration
//     the register lists for that PERSON (folded across the spellings it uses for them),
//     all years, both directories, as `{year, registerDir, ref, sourceUrl}` newest first,
//     and a `sourceUrl` on the record itself pointing at the document the figures were
//     parsed from.
//     ⚠️ This is a projection of `declarations_index.json` and opens NO PDF: it costs no
//     fetch and adds no parsed content. Only ONE filing per magistrate is ever read, so
//     `filings` is a list of documents a reader can open, never a claim that we have
//     read them. See `totalFilingsListed` in `stats` for the two bases stated apart.
//   - ownership + participation company NAMES only (not related-persons, not the
//     asset tables); a name → EIK only on a unique Commerce-Registry match.
// We emit EVERY magistrate we parse, not just the few with a declared company —
// Postgres serves one record at a time, so the person page + search cover all ~3.6k
// while the „декларирани дружества" tile stays holder-only (server-side WHERE
// company_count > 0). Companies stay sparse (most magistrates are barred from
// management); financials are attached where the parse found figures.
// `stats` is SPLIT BY BASIS: magistratesScanned / withHoldings / withFinancials /
// totalCompanies / resolvedEik describe the CURRENT bench, which is what the tile's
// „за <година>" sentence claims; `magistratesRetained` counts the rest.
// NB the financials are best-effort and UNSAMPLED beyond the original hand-checked
// set — the high tail (a handful over ~1M лв) is likely extraction noise, so they are
// shown as informational ("следа, не доказателство"), never a ranking or a total.
//
// FRAMING: magistrates are NOT elected officials. This reproduces only what the ИВСС
// itself publishes (that a company name appears in a filed declaration), name-matched
// to the registry — a LEAD, not proof. No stake is inferred that is not printed.
//
// Streaming: PDFs are fetched to memory, parsed, and discarded (the corpus is ~4 GB);
// only the small extracted holdings are cached in raw_data/judiciary/holdings_cache.json
// so a re-run does not re-fetch. EIK resolution runs once at the end against the TR
// SQLite. Run: npx tsx scripts/judiciary/__write_magistrate_holdings.ts [--limit N]

import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "module";
import { fileURLToPath } from "url";
// The SAME normaliser load_magistrates_pg.ts writes into `magistrate.name_norm` and the
// client hook looks a person up by. The retention dedupe below has to collapse exactly the
// spellings that would collide downstream, so it cannot use a local approximation.
import { normName } from "@/data/judiciary/normName";
// The register's base URL has ONE home. sources.ts owns it and documents both the trust
// boundary (plain HTTP on a bare IP) and the fact that the IP may move — "the link on
// IVSS_PAGE is the authority; update it here and both the ingest and the watcher follow".
// A second copy here would silently opt this writer out of that, and it now mints ~37k
// absolute URLs into a committed artifact.
import { IVSS_REGISTER } from "./sources";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const pdfjs = require("pdfjs-dist") as any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const RAW_DIR = path.join(ROOT, "raw_data", "judiciary");
const INDEX = path.join(RAW_DIR, "declarations_index.json");
const CACHE = path.join(RAW_DIR, "holdings_cache.json");
const SQLITE = path.join(ROOT, "raw_data", "tr", "state.sqlite");
const OUT = path.join(ROOT, "data", "judiciary", "magistrate_holdings.json");
const REGISTER_BASE = IVSS_REGISTER;

/** Absolute URL for a register path.
 *
 *  Via `new URL` rather than concatenation because the register serves paths that are not
 *  URL-safe: three in the current index carry a TAB, a non-breaking space and an
 *  apostrophe respectively. Concatenated, those ship as malformed hrefs that no browser
 *  resolves — a dead link on a named magistrate's page, in a committed artifact. */
const registerUrl = (pdfPath: string): string =>
  new URL(pdfPath, REGISTER_BASE).href;

// ------------------------------------------------------- company harvesting ---

// A cell that is a company name: opens with a capital or quote (not a template
// label word), ends with a Bulgarian legal-form token. Excludes the form's own
// column labels ("Наименование на ЕТ", "Дружество", …) and the section captions
// ("дялове в ООД", "акции").
const LEGAL_FORM = "(?:ЕООД|ЕАД|ООД|АД|КД|СД|ДЗЗД|ЕТ)";
const LABEL_START =
  /^(?:дялове|акции|Дялове|Акции|Наименование|Предмет|Описание|Участие|Дружество|Дата|Вид|Размер|Седалище)/;
const COMPANY_CELL = new RegExp(
  `^[«"„]?[А-ЯA-Z0-9][А-Яа-яA-Za-z0-9.,'"«»„“”\\-\\/ ]{1,60}\\s${LEGAL_FORM}[»"“]?$`,
);
// Only the pages that carry declared company links.
const PAGE_MARK =
  /Дялове в дружества с ограничена|Ценни книги|Участие в следните търговски дружества|орган на управление или контрол|Имам участие в следните/;

interface Item {
  s: string;
  x: number;
  y: number;
}
const pageRows = async (page: any): Promise<Item[][]> => {
  const tc = await page.getTextContent();
  const items: Item[] = tc.items
    .filter((i: any) => typeof i.str === "string" && i.str.trim())
    .map((i: any) => ({
      s: i.str.replace(/\s+/g, " ").trim(),
      x: i.transform[4],
      y: i.transform[5],
    }));
  const rows = new Map<number, Item[]>();
  for (const it of items) {
    const k = [...rows.keys()].find((kk) => Math.abs(kk - it.y) < 3);
    if (k === undefined) rows.set(it.y, [it]);
    else rows.get(k)!.push(it);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, its]) => its.sort((a, b) => a.x - b.x));
};

// ------------------------------------------------------------- financials ---
// Best-effort, INFORMATIONAL reproduction of a few declared financial figures (not a
// net-worth total, not a ranking): validated on a hand-checked sample against the PDF.
//   - bankCashLv  — cash-on-hand + bank accounts (Tables 10+11), лв equivalent. Each
//     row carries a currency; the лв value is равностойност (the number AFTER the
//     currency) when present, else размер (the number BEFORE it, since for BGN размер
//     IS the лв amount). Bounded to before Вземания (Table 12) so receivables/
//     liabilities never leak in.
//   - securitiesLv — value of shares/дялове (the лв figure after an emitter name).
//   - realEstateCount — rows in Таблица 1 („Право на собственост и ограничени вещни
//     права"), bounded before the agricultural / transferred-property tables.
//     ⚠️ ON THE ANNUAL FILING THAT TABLE IS A FLOW — property ACQUIRED during the
//     declared period — NOT a count of what the magistrate owns. Verified across
//     three of Цацаров's filings: his 2024 annual reads „Нямам нищо за деклариране"
//     while he demonstrably owned the 620,088 лв apartment bought in 2022, and every
//     row in the other two carries a Година на придобиване equal to the declared
//     year. (An ENTRY declaration — column 1, „към датата на встъпване в длъжност" —
//     IS a stock snapshot; his July 2022 one lists 11 properties acquired 2003-2018.
//     Nothing here distinguishes the two yet, which is why no surface may present
//     this as holdings.) Any surface rendering it must say so — see
//     PersonMagistrateHoldingsTile.tsx and its test.
// Income and liabilities are deliberately NOT extracted — the sample showed them
// unreliable, and a wrong figure on a named judge is not worth it.
const CUR = /^(BGN|EUR|USD|GBP|CHF)$/i;
const lvNum = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s
    .replace(/[\u0020\u00a0\u2007\u2009\u202f]/g, "")
    .replace(",", ".");
  return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
};

export interface Financials {
  bankCashLv: number;
  securitiesLv: number;
  realEstateCount: number;
}
const emptyFinancials = (): Financials => ({
  bankCashLv: 0,
  securitiesLv: 0,
  realEstateCount: 0,
});

const extractFinancials = (
  cellRows: { y: number; cells: string[] }[],
  flat: string,
  acc: Financials,
): void => {
  const headerY = (re: RegExp): number | undefined =>
    cellRows.find((r) => re.test(r.cells.join(" ")))?.y;

  // Cash-on-hand + bank accounts, bounded before receivables (Вземания).
  if (/Парични суми, в това число влогове/i.test(flat)) {
    const top = headerY(/Парични суми, в това число влогове/i) ?? Infinity;
    const bot = headerY(/^3\. Вземания|Вземания:/) ?? -Infinity;
    for (const r of cellRows) {
      if (r.y >= top || r.y <= bot) continue;
      const ci = r.cells.findIndex((s) => CUR.test(s));
      if (ci < 1) continue;
      const before = lvNum(r.cells[ci - 1]);
      const after = lvNum(r.cells[ci + 1]);
      const lv = after != null ? after : before;
      if (lv != null) acc.bankCashLv += lv;
    }
  }
  // Securities / дялове value: the лв figure right after an emitter/company name.
  if (/от Закона за пазарите на финансови инструменти/i.test(flat)) {
    for (const r of cellRows) {
      const j = r.cells.findIndex((s) => new RegExp(`${LEGAL_FORM}$`).test(s));
      if (j >= 0) {
        const v = lvNum(r.cells[j + 1]);
        if (v != null && v > 0) acc.securitiesLv += v;
      }
    }
  }
  // Real estate — Table 1 rows only, bounded before agricultural / transferred.
  // NOT a holdings count on an annual filing: see the realEstateCount note in the
  // module header for why this is a FLOW (acquisitions in the declared period).
  if (/Право на собственост и ограничени вещни права/i.test(flat)) {
    const top =
      headerY(/Право на собственост и ограничени вещни права/i) ?? Infinity;
    const bot =
      headerY(/Земеделски земи и гори|Прехвърляне на имоти/) ?? -Infinity;
    for (const r of cellRows) {
      if (r.y >= top || r.y <= bot) continue;
      if (!/^\d+\.$/.test(r.cells[0] ?? "")) continue;
      if (r.cells.map(lvNum).some((v) => v != null && v > 2000))
        acc.realEstateCount += 1;
    }
  }
};

export interface DeclaredCompany {
  name: string;
  stakePct: number | null;
}
interface Harvest {
  companies: DeclaredCompany[];
  position: string | null;
  court: string | null;
  financials: Financials;
}

/** Court/position off page 1 (best-effort; null if the layout hides it). */
const page1Meta = (
  rows: Item[][],
): { position: string | null; court: string | null } => {
  const flat = rows.map((r) => r.map((i) => i.s).join(" ")).join(" ");
  const court =
    flat.match(
      /(Върховен [А-Яа-я]+ [Сс]ъд|Апелативн[а-я]+ [а-я]+ съд|[А-Яа-я]+ съд[^,.]*|Прокуратура[^,.]*|[А-Яа-я]+ прокуратура)/,
    )?.[0] ?? null;
  const position =
    flat.match(
      /\b(съдия|прокурор|следовател|младши съдия|младши прокурор)\b/i,
    )?.[0] ?? null;
  return { position, court: court?.trim() ?? null };
};

const harvest = async (bytes: Uint8Array): Promise<Harvest> => {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false })
    .promise;
  const seen = new Map<string, number | null>();
  let meta = { position: null as string | null, court: null as string | null };
  const financials = emptyFinancials();
  for (let p = 1; p <= doc.numPages; p++) {
    const rows = await pageRows(await doc.getPage(p));
    if (p === 1) meta = page1Meta(rows);
    const flat = rows.map((r) => r.map((i) => i.s).join(" ")).join(" ");

    // Financials live on their own pages (real estate / bank / securities), so run
    // them on every page, not only the company pages.
    const cellRows = rows.map((r) => ({
      y: Math.round(r[0]?.y ?? 0),
      cells: r.map((i) => i.s),
    }));
    extractFinancials(cellRows, flat, financials);

    if (!PAGE_MARK.test(flat)) continue;
    for (const row of rows) {
      const pctCell = row.map((c) => c.s).find((s) => /^\d{1,3}%$/.test(s));
      const pct = pctCell ? Number(pctCell.replace("%", "")) : null;
      for (const c of row) {
        const s = c.s;
        if (LABEL_START.test(s)) continue;
        if (!COMPANY_CELL.test(s)) continue;
        const clean = s.replace(/^[«"„]|[»"“]$/g, "").trim();
        if (!seen.has(clean)) seen.set(clean, pct);
        else if (seen.get(clean) == null && pct != null) seen.set(clean, pct);
      }
    }
  }
  return {
    companies: [...seen.entries()].map(([name, stakePct]) => ({
      name,
      stakePct,
    })),
    ...meta,
    financials,
  };
};

// ------------------------------------------------------------ EIK resolution ---

const LEGAL_FORM_RE = /(?:^|\s)(ЕООД|ЕАД|ООД|АД|КДА|КД|СД|ДЗЗД|ЕТ)(?=\s|$)/gu;
const normCompany = (s: string): string =>
  s
    .toUpperCase()
    .replace(/["„“”»«'`]/g, " ")
    .replace(LEGAL_FORM_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

// Display cleanup: the harvested cell keeps the closing quote that sits before the
// legal form („Арете Криейтив" ООД); strip ALL quotes for display. EIK resolution is
// unaffected — normCompany already drops quotes.
const cleanDisplay = (s: string): string =>
  s
    .replace(/["„“”»«]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// A harvested cell that ends in a legal form but is an ACTION phrase, not a company
// ("Учредяване на ЕООД", "Продажба на …"). Rejected from the output.
// NB: no \b — an ASCII word boundary never fires after a Cyrillic letter.
const NOISE =
  /^(УЧРЕДЯВАНЕ|ПРОДАЖБА|ПРЕХВЪРЛЯНЕ|ПОКУПКА|ПРИДОБИВАНЕ|ЗАКУПУВАНЕ|ДЯЛОВЕ|АКЦИИ|УЧАСТИЕ)/i;
const isCompany = (s: string): boolean =>
  cleanDisplay(s).length > 3 && !NOISE.test(s);

// The page-1 court/position lands in the cache as a long jumbled string (the
// fillable form interleaves labels and values). Recover a clean court from the span
// after "власт:"; null it the moment it still carries form-label noise, so the UI
// never shows garbage. Position is a plain keyword match.
const cleanCourt = (raw: string | null): string | null => {
  if (!raw) return null;
  const m = raw.match(
    /власт:\s*(.+?)\s+(?:Извършил|Приложение|Име:|Дата:|Контролно|\/)/,
  );
  const court = (m ? m[1] : raw).trim();
  if (
    /власт|Извършил|Контролно|попълва|подпис|Приложение|Длъжност|Заключение|:/.test(
      court,
    ) ||
    court.length < 4 ||
    court.length > 45
  )
    return null;
  return court;
};
const cleanPosition = (raw: string | null): string | null =>
  raw?.match(
    /(младши съдия|младши прокурор|съдия|прокурор|следовател)/i,
  )?.[1] ?? null;

/** normalized company name → set of UICs (a unique match becomes the resolved EIK). */
const buildCompanyIndex = (): Map<string, Set<string>> => {
  const db = new DatabaseSync(SQLITE, { readOnly: true });
  const idx = new Map<string, Set<string>>();
  for (const row of db
    .prepare(`SELECT uic, name FROM companies`)
    .all() as Array<{
    uic: string;
    name: string | null;
  }>) {
    if (!row.name) continue;
    const key = normCompany(row.name);
    if (!key) continue;
    (idx.get(key) ?? idx.set(key, new Set()).get(key)!).add(row.uic);
  }
  db.close();
  return idx;
};

// ------------------------------------------------------------------- main ---

interface CacheEntry {
  companies: DeclaredCompany[];
  position: string | null;
  court: string | null;
  financials: Financials;
  /** The register path these contents were parsed FROM.
   *
   *  The cache is keyed by NAME, but its contents come from ONE document — so when the
   *  rule picking that document changes, a name-keyed hit silently returns a parse of a
   *  DIFFERENT filing than the record now claims as its `sourceUrl`. Stamping the path
   *  makes that detectable, and invalidates exactly the affected entries instead of the
   *  whole 3,596-PDF cache. Optional: entries written before this field existed are
   *  stamped on load from a replay of the old rule. */
  pdf?: string;
}

const main = async (): Promise<void> => {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const localDir = process.argv.includes("--local")
    ? process.argv[process.argv.indexOf("--local") + 1]
    : null;
  // Lift the current-bench restriction on the fetch loop for magistrates we have ALREADY
  // PUBLISHED — recovery for a pruned or wrongly-invalidated cache. Bounded by the
  // committed artifact (see `publishedNames`), never by the roster, so it can restore what
  // was lost and cannot become the retained backfill by accident.
  const fetchRetained = process.argv.includes("--fetch-retained");

  // The roster in the committed artifact: what we have published before, and therefore
  // both the floor the shrink guard defends and the bound on `--fetch-retained`.
  const publishedNames: Set<string> = fs.existsSync(OUT)
    ? new Set(
        (
          JSON.parse(fs.readFileSync(OUT, "utf8")) as {
            magistrates?: { name: string }[];
          }
        ).magistrates?.map((m) => m.name) ?? [],
      )
    : new Set();

  const index: Array<{
    year: number;
    name: string;
    /** Входящ номер, e.g. "4352/22.04.2026". May be "" — a handful carry none. */
    ref: string;
    pdf: string;
    batch: string;
  }> = JSON.parse(fs.readFileSync(INDEX, "utf8"));
  const latestYear = Math.max(...index.map((e) => e.year));
  // One declaration per magistrate: their MOST RECENT annual filing — NOT "everyone who
  // filed in the latest year".
  //
  // The ИВСС roster turns over every year: the 2026 register dropped 462 magistrates who
  // had filed in 2025. Keying the roster on `latestYear` deleted them from `magistrate`,
  // which deleted their mention in resolve_persons.ts (it builds them from
  // `SELECT name, court FROM magistrate`), which deleted their person row — 404ing every
  // /person URL they had ever been served under. No redirect can repair that: the person
  // is gone, so there is nothing to redirect TO, and the ~15 with a same-name person are
  // namesakes ("Николай Иванов Николов" has ~17 distinct people), so pointing at one would
  // attribute a stranger's judicial record. A magistrate who leaves the bench is still the
  // subject of the declarations they DID file, and that record is the accountability
  // archive — so the roster accumulates instead of tracking the current bench.
  //
  // Gate: scripts/db/tests/person_slug_retired.data.test.ts ("no slug the lock has served
  // is dead without a redirect"), which this recurrence broke on 2026-08-11.
  // Newest first, within a year too. Ordering by the date inside the входящ номер
  // ("4352/22.04.2026" → 2026-04-22); a missing or malformed ref sorts last.
  const refDate = (ref: string): number => {
    const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(ref);
    return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0;
  };

  // ⚠️ A YEAR IS NOT A TIE-BREAK. `<` on the year alone keeps whichever annual filing the
  // index happens to list first within the newest year — 164 magistrates file more than
  // one, up to 134 days apart — so the parsed companies/financials came from a SUPERSEDED
  // declaration while `filings[0]` (below) named the current one, publishing the
  // contradiction inside a single record. Break the tie on the входящ номер's date.
  const newer = (
    a: { year: number; ref: string },
    b: { year: number; ref: string },
  ): boolean =>
    a.year > b.year || (a.year === b.year && refDate(a.ref) > refDate(b.ref));

  const byName = new Map<
    string,
    { name: string; pdf: string; year: number; ref: string }
  >();
  for (const e of index) {
    if (e.batch !== "annual") continue;
    const cur = byName.get(e.name);
    const row = { name: e.name, pdf: e.pdf, year: e.year, ref: e.ref ?? "" };
    if (!cur || newer(row, cur)) byName.set(e.name, row);
  }

  // A faithful replay of the rule this REPLACED (strict `<` on year, so the FIRST annual
  // of the newest year won). Its only job is to stamp legacy cache entries with the pdf
  // they were actually parsed from, so the invalidation below can tell which 164 are now
  // pointed at a different document. Delete both once no unstamped entry survives.
  const legacyPick = new Map<string, string>();
  {
    const seenYear = new Map<string, number>();
    for (const e of index) {
      if (e.batch !== "annual") continue;
      if ((seenYear.get(e.name) ?? -1) < e.year) {
        seenYear.set(e.name, e.year);
        legacyPick.set(e.name, e.pdf);
      }
    }
  }

  // ---- the FILING HISTORY, which needs no PDF and no fetch ------------------
  //
  // Every filing the register lists for a name — ALL years, BOTH batches — so a reader
  // can reach the original documents even though we parse only one of them. This is
  // pure index projection: `declarations_index.json` already holds the входящ номер and
  // the PDF path for all 51,040 filings, and the writer used to discard both.
  //
  // NOT filtered to `batch === "annual"` like `byName` above. That filter exists because
  // the PARSE targets the annual filing; the history is a list of documents, and a change
  // filing under чл. 175в ал. 5 is as real a document as any. It is also where some of the
  // most specific facts live — Цацаров declared a 303,154 лв property sale in one.
  //
  // ⚠️ `batch` IS THE REGISTER'S DIRECTORY, NOT THE DECLARATION TYPE, and no consumer may
  // render it as one. The ИВСС files some annual declarations into the `<year>-1` directory:
  // Цацаров's filing from `2025-1` is stamped „ЕЖЕГОДНА" on its own page 2 and covers
  // 01.01-31.12.2024. Labelling that „За промяна" from this field states something the
  // document itself contradicts. The real type is readable only from the PDF, which this
  // projection deliberately does not open.
  // ⚠️ KEYED ON normName, NOT THE RAW NAME. The register re-spells people across years —
  // „… Ризова-Ръжданова" in one year, „… Ризова - Ръжданова" in another — and the roster
  // above folds those spellings together (see the dedupe below), keeping ONE. Keying the
  // history on the raw name then hands the survivor only the filings filed under that
  // exact spelling: measured on the current index, 143 folded names would lose 289 filings
  // between them, one magistrate keeping 7 of 18. Nothing downstream can detect that — the
  // record looks complete, it is just short.
  const filingsByNorm = new Map<
    string,
    Array<{ year: number; registerDir: string; ref: string; sourceUrl: string }>
  >();
  /** normName → the distinct raw spellings the register used for it. */
  const spellingsByNorm = new Map<string, Set<string>>();
  for (const e of index) {
    const key = normName(e.name);
    (
      spellingsByNorm.get(key) ?? spellingsByNorm.set(key, new Set()).get(key)!
    ).add(e.name);
    const list = filingsByNorm.get(key) ?? [];
    list.push({
      year: e.year,
      // ⚠️ THE REGISTER'S DIRECTORY, NOT THE DECLARATION TYPE — named `registerDir` rather
      // than `batch` precisely so it cannot be rendered as one. The ИВСС files some ANNUAL
      // declarations into the `<year>-1` directory: Цацаров's filing from `2025-1` is
      // stamped „ЕЖЕГОДНА" on its own page 2 and covers 01.01-31.12.2024. Labelling that
      // „За промяна" from this field states something the document itself contradicts.
      // The real type is readable only from the PDF, which this projection never opens.
      registerDir: e.batch,
      ref: e.ref ?? "",
      // Fully qualified so no consumer has to know the base. The register is plain HTTP on
      // a bare IP (see sources.ts): these links point at the register itself and must never
      // be built from anything the register NAMES.
      sourceUrl: registerUrl(e.pdf),
    });
    filingsByNorm.set(key, list);
  }
  for (const list of filingsByNorm.values())
    list.sort(
      (a, b) =>
        b.year - a.year ||
        refDate(b.ref) - refDate(a.ref) ||
        a.sourceUrl.localeCompare(b.sourceUrl),
    );

  // …but a RETAINED record whose normalised name is already on the current bench is not a
  // departure at all — it is the same serving magistrate under a second spelling, and it must
  // be dropped.
  //
  // The register is inconsistent about hyphen spacing across years („… Средкова - Петрова" in
  // 2025, „… Средкова-Петрова" in 2026) and `magistrate.name` is a PK on the RAW string, so
  // both spellings survive the widening as separate rows. resolve_persons.ts keys its mention
  // on that raw name and CANNOT merge them — two same-name magistrates with no corroborant is
  // exactly the merge this codebase forbids — so each spelling mints its own person row. The
  // first cut of this retention did that to two real serving judges: it stopped 462 people
  // losing a /person page and, in the same change, gave 2 people a second one, splitting each
  // human's record across two indexable profiles.
  //
  // Fixed HERE rather than in the resolver, which cannot tell a spelling variant from a
  // genuine namesake. Upstream it is knowable: same normalised name, still filing this year.
  // `normName` is the loader's and the client hook's shared normaliser, so this collapses
  // exactly the spellings that would collide in `magistrate.name_norm` downstream.
  // Gate: magistrate_roster_retention.data.test.ts ("no two magistrates share a normalised
  // name"), so a third spelling next year fails loudly instead of minting a third profile.
  const currentNorms = new Set(
    [...byName.values()]
      .filter((r) => r.year === latestYear)
      .map((r) => normName(r.name)),
  );
  // Two counts, because they mean different things. MOST of these are prior-year spellings
  // that were never fetched and so were never going to be emitted anyway — removing them is
  // pre-emptive, and stops one becoming a duplicate profile if it is ever cached. The number
  // that MATTERS is how many were already published, i.e. had a cache entry: those are the
  // ones currently splitting a human across two /person pages.
  const respelled: { name: string; year: number }[] = [];
  for (const [key, r] of byName)
    if (r.year !== latestYear && currentNorms.has(normName(r.name))) {
      respelled.push({ name: r.name, year: r.year });
      byName.delete(key);
    }

  let roster = [...byName.values()];
  if (Number.isFinite(limit)) roster = roster.slice(0, limit);

  const cache: Record<string, CacheEntry> = fs.existsSync(CACHE)
    ? JSON.parse(fs.readFileSync(CACHE, "utf8"))
    : {};

  // Invalidate entries parsed from a filing we no longer consider current. An unstamped
  // entry predates `CacheEntry.pdf`, so attribute it to the old rule's pick — that is what
  // it was in fact parsed from — and let the same comparison decide.
  //
  // Without this the tie-break fix above is INERT and, worse, actively misleading: the name
  // key still hits, so the record would carry the superseded filing's companies and
  // financials beside the current filing's `sourceUrl`, inviting a reader to check figures
  // against a document that does not contain them.
  // ⚠️ ONLY WHERE THE FETCH LOOP CAN ACTUALLY REPLACE IT. That loop fetches the current
  // bench only (`year !== latestYear` → skip), so dropping a RETAINED magistrate's entry
  // does not schedule a re-parse — it deletes the person: no cache hit, no emitted record,
  // and the roster guard then refuses the whole build. Measured: 11 magistrates, caught by
  // that guard rather than by this code.
  //
  // A retained record therefore keeps its existing parse, and `parsedFrom` below keeps its
  // `sourceUrl` pointing at the document those figures actually came from. Slightly older
  // than the newest filing on record, and self-consistent — which is the property that
  // matters: a reader following the link finds the numbers they were shown.
  let staleParse = 0;
  for (const [name, entry] of Object.entries(cache)) {
    const pick = byName.get(name);
    if (!pick || pick.year !== latestYear) continue;
    const parsedFrom = entry.pdf ?? legacyPick.get(name);
    if (parsedFrom && parsedFrom !== pick.pdf) {
      delete cache[name];
      staleParse++;
    }
  }
  if (staleParse)
    console.log(
      `  ${staleParse} cached parse(s) dropped — a newer filing of the same year supersedes ` +
        `the one they came from; they will be re-fetched.`,
    );

  // Which of the dropped re-spellings we had actually PUBLISHED (see the two-counts note
  // above). Only these were live duplicate profiles; the rest were never emitted.
  const respelledPublished = respelled.filter((r) => cache[r.name]);

  let fetched = 0;
  let failed = 0;
  for (let i = 0; i < roster.length; i++) {
    const { name, pdf, year } = roster[i];
    if (cache[name]) continue;
    // Fetch only the CURRENT bench. Widening the roster above must not turn this into a
    // 1,732-PDF crawl of the register as a side effect — a prior-year magistrate we have
    // never parsed simply stays out of the emitted set, exactly like a parse failure does
    // (see the emission below). The cache is keyed by NAME and already holds everyone ever
    // fetched, so every magistrate we have previously published survives from it; the rest
    // are a deliberate, separate backfill.
    //
    // ⚠️ THE COROLLARY IS THAT A RETAINED MAGISTRATE'S CACHE ENTRY IS IRREPLACEABLE. Lose
    // it — a pruned cache, a wrong invalidation, a second machine — and this loop will not
    // re-fetch it, so the record vanishes and the roster guard refuses the whole build.
    //
    // `--fetch-retained` is the way back, and it is bounded by the COMMITTED ARTIFACT, not
    // merely by cache misses: it re-fetches a retained magistrate only if we have published
    // them before. That is exactly the recovery case, and the bound is what keeps it from
    // becoming the retained backfill by accident — measured, the unbounded form starts a
    // ~1,660-PDF crawl, which is Tier 3 work and belongs in a deliberate run of its own.
    if (year !== latestYear && !(fetchRetained && publishedNames.has(name)))
      continue;
    try {
      let bytes: Uint8Array;
      if (localDir) {
        const f = path.join(localDir, path.basename(pdf));
        if (!fs.existsSync(f)) continue;
        bytes = new Uint8Array(fs.readFileSync(f));
      } else {
        const res = await fetch(registerUrl(pdf));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      const h = await harvest(bytes);
      cache[name] = {
        companies: h.companies,
        position: h.position,
        court: h.court,
        financials: h.financials,
        // Which document these contents came from — see CacheEntry.pdf.
        pdf,
      };
      fetched++;
      if (fetched % 100 === 0) {
        fs.writeFileSync(CACHE, JSON.stringify(cache));
        console.log(`  …${fetched} fetched, ${i + 1}/${roster.length}`);
      }
      // be polite to the bare-IP register
      if (!localDir) await new Promise((r) => setTimeout(r, 120));
    } catch (err) {
      failed++;
      console.error(`FAILED ${name}: ${(err as Error).message}`);
    }
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));

  // Resolve EIK once, against the whole registry.
  console.log("resolving company names → EIK …");
  const companyIdx = buildCompanyIndex();

  // Emit EVERY magistrate we successfully parsed — not only company-holders. The
  // table is now the full latest-year roster (the person-page + search cover all of
  // them), served one record at a time from Postgres; the „декларирани дружества"
  // tile stays company-focused server-side (WHERE company_count > 0). A magistrate
  // absent from the cache is one whose PDF fetch/parse FAILED — excluded, not zeroed.
  const magistrates = roster
    .map((r) => {
      const c = cache[r.name];
      if (!c) return null;
      const companies = (c.companies ?? [])
        .filter((co) => isCompany(co.name))
        .map((co) => {
          const key = normCompany(co.name);
          const uics = companyIdx.get(key);
          const eik = uics && uics.size === 1 ? [...uics][0] : null;
          return {
            name: cleanDisplay(co.name),
            stakePct: co.stakePct,
            eik,
            eikAmbiguous: !!uics && uics.size > 1,
          };
        });
      return {
        name: r.name,
        // The year of the filing this record was parsed from — per magistrate now that the
        // roster spans years. `file.year` (the register's latest) is no longer a truthful
        // stand-in for it, and it is what every "за <година>" label reads.
        declYear: r.year,
        // The document the figures above were parsed FROM — NOT necessarily the newest
        // filing on record. For a retained magistrate the cache holds a parse the fetch
        // loop will not refresh (it covers the current bench only), so naming the newest
        // filing here would send a reader to a document that does not contain the numbers
        // shown. `filings[0]` is where "the newest declaration" lives; this is provenance.
        sourceUrl: registerUrl(c.pdf ?? legacyPick.get(r.name) ?? r.pdf),
        position: cleanPosition(c.court) ?? cleanPosition(c.position),
        court: cleanCourt(c.court),
        companies,
        financials: c.financials ?? emptyFinancials(),
        // Every filing the register lists for this person, newest first — including the
        // years we never parsed, and including the ones filed under a different spelling
        // of their name. Only `sourceUrl` above is the source of the figures.
        filings: filingsByNorm.get(normName(r.name)) ?? [],
      };
    })
    .filter(Boolean) as Array<{
    name: string;
    declYear: number;
    sourceUrl: string;
    position: string | null;
    court: string | null;
    companies: Array<{
      name: string;
      stakePct: number | null;
      eik: string | null;
      eikAmbiguous: boolean;
    }>;
    financials: Financials;
    filings: Array<{
      year: number;
      registerDir: string;
      ref: string;
      sourceUrl: string;
    }>;
  }>;
  magistrates.sort((a, b) => a.name.localeCompare(b.name, "bg"));

  // Every headline stat below is scoped to the LATEST year, because that is what the
  // /judiciary tile's sentence claims: "N магистрати са посочили … в декларацията си …
  // за <year> г. (от M проверени)". The roster now also carries magistrates whose last
  // filing was 2017-2025, and counting those into `withHoldings` would leave the
  // arithmetic right and the sentence false — a 2019 filing reported as a 2026 one.
  // They are reported separately as `magistratesRetained`.
  const current = magistrates.filter((m) => m.declYear === latestYear);
  const scanned = roster.filter((r) => r.year === latestYear).length;
  const totalCompanies = current.reduce((s, m) => s + m.companies.length, 0);
  const resolved = current.reduce(
    (s, m) => s + m.companies.filter((c) => c.eik).length,
    0,
  );
  const withHoldings = current.filter((m) => m.companies.length > 0).length;
  const fin = (m: { financials: Financials }): boolean =>
    m.financials.bankCashLv > 0 ||
    m.financials.securitiesLv > 0 ||
    m.financials.realEstateCount > 0;
  const withFinancials = current.filter(fin).length;
  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Инспекторат към Висшия съдебен съвет (ИВСС)",
      register: REGISTER_BASE,
      description:
        "Декларирани от магистрати търговски дружества (дялове/акции/участие) по чл. 175а ЗСВ, разпознати по име в Търговския регистър. Лидер, не доказателство.",
    },
    year: latestYear,
    stats: {
      // Latest-year only — the denominator in the tile's "(от M проверени)".
      magistratesScanned: scanned,
      // The full roster we emit (scanned minus fetch/parse failures), ALL years.
      magistratesEmitted: magistrates.length,
      // Carried for identity from an earlier filing year, so their /person page does not
      // 404 with no redirect possible.
      //
      // ⚠️ THIS IS NOT „MAGISTRATES WHO LEFT THE BENCH", and it used to say so. The
      // predicate is "filed no ANNUAL declaration in the latest register year" — and the
      // filing history added alongside it shows most of these people filed SOMETHING that
      // year (a change declaration under чл. 175в ал. 5). Measured index-wide: 1,085 of
      // 2,194 such names have a latest-year filing. Departure is one explanation among
      // several and this number cannot distinguish them, so no caption may assert it.
      magistratesRetained: magistrates.length - current.length,
      // Dropped as re-spellings of a CURRENT magistrate rather than departures. Reported so
      // a register that starts churning spellings is visible instead of just quieter.
      // `Dropped` is roster-level (mostly prior-year spellings never fetched, removed
      // pre-emptively); `Published` is the subset we had actually emitted before — the ones
      // that were splitting one human across two /person profiles.
      respelledDropped: respelled.length,
      respelledPublished: respelledPublished.length,
      fromCache: scanned - fetched - failed,
      fetched,
      failed,
      withHoldings,
      withFinancials,
      totalCompanies,
      resolvedEik: resolved,
      // Filings LISTED (all years, both batches) across the emitted roster — the link
      // set the person page offers. Deliberately not scoped to the current bench like
      // the counts above: it describes documents on record, not this year's roster.
      //
      // ⚠️ It is NOT the number of declarations we PARSED, which is one per magistrate.
      // Two different bases, and conflating them would report the corpus as ~9x more
      // thoroughly read than it is.
      totalFilingsListed: magistrates.reduce((s, m) => s + m.filings.length, 0),
      // Records whose history was recovered from MORE THAN ONE spelling of the name — the
      // observable signal that the normName keying is doing its job. A regression to
      // raw-name keying takes this to 0 while every other count here holds.
      //
      // Replaces a „magistrates with no filing" stat, which could never fire: the roster is
      // built FROM the index, so every member has at least one. It would have reported a
      // reassuring 0 no matter what went wrong.
      magistratesWithFoldedSpellings: magistrates.filter(
        (m) => (spellingsByNorm.get(normName(m.name))?.size ?? 1) > 1,
      ).length,
    },
    magistrates,
  };
  // THE COMMITTED ARTIFACT IS THE FLOOR — refuse to publish a set that loses anyone from it.
  //
  // A retained magistrate reaches this output only if `cache[name]` exists, and the cache is
  // raw_data/judiciary/holdings_cache.json: GITIGNORED, ~1.6 MB, on one machine. So the
  // committed OUT is the only durable record of who we have published. If that cache is
  // pruned, rebuilt, or the writer runs on a second machine, the roster still lists every
  // annual filer but only the cached ones survive — and the output silently reverts to the
  // latest-year snapshot this file exists to end. The console would read
  // `emitted 3,134 (0 retained …)`, which looks like a normal run, and the loss only becomes
  // visible after a full reload AND re-resolve, as 404s.
  //
  // Same `--allow-shrink` shape load_kzk_decisions_pg.ts uses, and for the same reason: a
  // corpus whose real source is host state rather than anything committed.
  if (fs.existsSync(OUT) && !process.argv.includes("--allow-shrink")) {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8")) as {
      magistrates?: { name: string; filings?: unknown[] }[];
    };
    const now = new Set(magistrates.map((m) => m.name));
    // The dedupe above legitimately removes re-spellings, so they are not a loss.
    const dropped = new Set(respelled.map((r) => r.name));
    const lost = [...publishedNames].filter(
      (n) => !now.has(n) && !dropped.has(n),
    );
    if (lost.length)
      throw new Error(
        `${lost.length} magistrate(s) in the committed roster are absent from this build — ` +
          `their /person URLs would 404 with no redirect possible. Almost always a cold or ` +
          `pruned ${CACHE}; re-fetch it, or pass --allow-shrink if the removal is intended.\n  ` +
          lost.slice(0, 10).join("\n  "),
      );

    // A magistrate keeping their row but LOSING filings is a different failure, and a
    // quieter one: the person page still renders, just with fewer documents behind it.
    // The register only ever accumulates — a filed declaration is not withdrawn — so a
    // shrink here means the index was rebuilt from a partial crawl.
    //
    // WARN rather than throw, deliberately. The roster guard above protects /person URLs
    // from 404ing, which is unrecoverable; this protects link COUNT, which the next full
    // index rebuild restores. Escalating it would make an incomplete
    // `__write_declarations.ts` run block the whole holdings build for a degradation the
    // reader may not even notice.
    const byNamePrev = new Map(
      (prev.magistrates ?? []).map((m) => [m.name, m.filings?.length ?? 0]),
    );
    const shrunk = magistrates
      .map((m) => ({
        name: m.name,
        was: byNamePrev.get(m.name) ?? 0,
        now: m.filings.length,
      }))
      .filter((x) => x.now < x.was);
    if (shrunk.length)
      console.warn(
        `  ⚠️  ${shrunk.length} magistrate(s) lost filings vs the committed artifact — the ` +
          `register accumulates, so this means a partial declarations_index.json. Re-run ` +
          `scripts/judiciary/__write_declarations.ts.\n  ` +
          shrunk
            .slice(0, 5)
            .map((x) => `${x.name}: ${x.was} → ${x.now}`)
            .join("\n  "),
      );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  // NB: this JSON is the loader input for Postgres (scripts/db/load_magistrates_pg.ts,
  // schema 070). The company-page (by-eik), search (roster) and person-page (by-name)
  // views are all derived server-side from the `magistrate` table — no separate
  // index/search JSON is emitted any more.

  console.log(
    `\nwrote ${OUT}\n  ${latestYear}: scanned ${scanned}, ` +
      `with holdings ${withHoldings}, with financials ${withFinancials}, ` +
      `companies ${totalCompanies} (${resolved} EIK-resolved), failed ${failed}\n` +
      // Named separately from `scanned` because they are NOT of this year: these are
      // magistrates off the current bench, carried at their last filing so their /person
      // URL survives. `roster.length` is every annual filer the index knows; the gap to
      // emitted is prior-year magistrates never fetched (a deliberate non-crawl).
      `  emitted ${magistrates.length} (${magistrates.length - current.length} retained ` +
      `from earlier years; ${roster.length} annual filers in the index)` +
      (respelled.length
        ? `\n  ${respelled.length} retained record(s) dropped as a re-spelling of a CURRENT ` +
          `magistrate, not a departure — ${respelledPublished.length} of them previously ` +
          `published${
            respelledPublished.length
              ? `: ${respelledPublished
                  .slice(0, 5)
                  .map((r) => `${r.name} @${r.year}`)
                  .join("; ")}`
              : ""
          }`
        : ""),
  );
  for (const m of magistrates
    .filter((m) => m.companies.length > 0)
    .slice(0, 15))
    console.log(
      `  ${m.name} — ${m.companies
        .map(
          (c) =>
            `${c.name}${c.eik ? ` [${c.eik}]` : c.eikAmbiguous ? " [ambig]" : " [?]"}`,
        )
        .join(", ")}`,
    );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
