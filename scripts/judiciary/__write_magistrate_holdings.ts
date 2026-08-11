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
//   - LATEST year, annual declarations only (the current-holdings snapshot);
//   - ownership + participation company NAMES only (not related-persons, not the
//     asset tables); a name → EIK only on a unique Commerce-Registry match.
// We emit EVERY magistrate we parse (the full latest-year roster), not just the few
// with a declared company — Postgres serves one record at a time, so the person page
// + search cover all ~3.1k while the „декларирани дружества" tile stays holder-only
// (server-side WHERE company_count > 0). Companies stay sparse (most magistrates are
// barred from management); financials are attached where the parse found figures.
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
const REGISTER_BASE = "http://62.176.124.194";

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
//   - realEstateCount — OWNED properties only (Table 1), bounded before the
//     agricultural / transferred-property tables.
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
  // Owned real estate (Table 1 only), bounded before agricultural / transferred.
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
}

const main = async (): Promise<void> => {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const localDir = process.argv.includes("--local")
    ? process.argv[process.argv.indexOf("--local") + 1]
    : null;

  const index: Array<{
    year: number;
    name: string;
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
  const byName = new Map<string, { name: string; pdf: string; year: number }>();
  for (const e of index)
    if (e.batch === "annual" && (byName.get(e.name)?.year ?? -1) < e.year)
      byName.set(e.name, { name: e.name, pdf: e.pdf, year: e.year });
  let roster = [...byName.values()];
  if (Number.isFinite(limit)) roster = roster.slice(0, limit);

  const cache: Record<string, CacheEntry> = fs.existsSync(CACHE)
    ? JSON.parse(fs.readFileSync(CACHE, "utf8"))
    : {};

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
    if (year !== latestYear) continue;
    try {
      let bytes: Uint8Array;
      if (localDir) {
        const f = path.join(localDir, path.basename(pdf));
        if (!fs.existsSync(f)) continue;
        bytes = new Uint8Array(fs.readFileSync(f));
      } else {
        const res = await fetch(`${REGISTER_BASE}${pdf}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      const h = await harvest(bytes);
      cache[name] = {
        companies: h.companies,
        position: h.position,
        court: h.court,
        financials: h.financials,
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
        position: cleanPosition(c.court) ?? cleanPosition(c.position),
        court: cleanCourt(c.court),
        companies,
        financials: c.financials ?? emptyFinancials(),
      };
    })
    .filter(Boolean) as Array<{
    name: string;
    declYear: number;
    position: string | null;
    court: string | null;
    companies: Array<{
      name: string;
      stakePct: number | null;
      eik: string | null;
      eikAmbiguous: boolean;
    }>;
    financials: Financials;
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
      // Carried for identity from an earlier filing year: magistrates who have left the
      // bench and whose /person page would otherwise 404 with no redirect possible.
      magistratesRetained: magistrates.length - current.length,
      fromCache: scanned - fetched - failed,
      fetched,
      failed,
      withHoldings,
      withFinancials,
      totalCompanies,
      resolvedEik: resolved,
    },
    magistrates,
  };
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
      `from earlier years; ${roster.length} annual filers in the index)`,
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
