// Сметна палата annual-party-report filing-status catalogue.
//
// The Court of Audit publishes, per year, which political parties filed their
// statutory annual financial report (ЗПП чл. 34) and whether the filing met
// the legal deadline and form requirements. The data lives in a legacy
// ASP.NET WebForms app, gfopp.bulnao.government.bg, split across four
// per-status list pages:
//
//   s1.aspx — filed on time, compliant            → status "on_time"
//   s2.aspx — not filed                           → status "not_filed"
//   s3.aspx — filed late, compliant               → status "late"
//   s4.aspx — filed on time but non-compliant     → status "non_compliant"
//
// The four lists are mutually exclusive: each party appears on at most one
// per year. Two WebForms quirks have to be handled:
//
//   1. Session-bound year. The s*.aspx pages read the year from the ASP.NET
//      session, not a query string. So per year we GET the landing page
//      (`/?year=YYYY`) once, keep every Set-Cookie, then drive the four
//      status pages with that cookie jar.
//   2. Paginated GridView. Each list defaults to 10 rows/page. To read every
//      row we post back __VIEWSTATE/__EVENTVALIDATION to widen the page size
//      and then walk the pager's "next" button until it disables.
//
// Each filed report row links to the uploaded document via an inline
// `ShowWndGfoUp('<docId>')` handler; the document viewer is
// `GfoUp.aspx?ID=<docId>`. We capture the id and synthesise that URL — we do
// NOT download the documents themselves (they are inconsistently-formatted
// scans; structured income/expense extraction is a separate project).
//
// Output: data/financing/reports.json — a per-year catalogue of
// {party, status, report-document link}. The filing *status* is fully
// reliable (it is which list the party is on); the document link is
// best-effort.
//
// Data-integrity contract — fail loud rather than write a stale/empty file:
//   - Any HTTP non-2xx, or a suspiciously small body          → throw.
//   - The newest expected year parses zero parties            → throw
//     (the canary: last year's reports are always published).
//   - Every year reports the same on_time count               → throw
//     (the signature of a pager cap silently truncating lists).
//   - Fewer than MIN_TOTAL_FILINGS filings across all years   → throw.
//   - An older year parsing zero parties is logged + skipped  → the gfopp
//     archive legitimately thins out for the earliest years.
//
// CLI:
//   tsx scripts/financing/scrape_reports.ts            # ingest
//   tsx scripts/financing/scrape_reports.ts --upload   # ingest + GCS push

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean } from "cmd-ts";
import { uploadText } from "../lib/upload";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, "../../data/financing");
const INDEX_FILE = path.join(OUT_DIR, "index.json");
const REPORTS_FILE = path.join(OUT_DIR, "reports.json");
// Compact per-year counts only (no party lists) — for the governance-page
// tile, which needs the headline numbers without the ~500 KB full catalogue.
const SUMMARY_FILE = path.join(OUT_DIR, "reports-summary.json");
// Per-party shards — one small file per party, so the detail page and the
// /party/:id panel can load a single party without the full catalogue.
const REPORTS_SHARD_DIR = path.join(OUT_DIR, "reports");

const BASE = "https://gfopp.bulnao.government.bg";
const UA =
  "Mozilla/5.0 (compatible; electionsbg-financing/1.0; +https://electionsbg.com)";

// Politeness delay between requests to the upstream WebForms app.
const REQUEST_DELAY_MS = 450;
// Sanity floor: a 15-year archive of ~20-50 parties/year is several hundred
// rows. Far fewer means the parser stopped matching — fail rather than ship.
const MIN_TOTAL_FILINGS = 250;

// WebForms control names on the gfopp GridView.
const CTL = "ctl00$ContentPlaceHolder1";
const ROWS_CTRL = `${CTL}$ddlRows`; // rows-per-page <select>
const NEXT_CTRL = `${CTL}$lnkbtnNext`; // pager "next" submit button
const PAGE_SIZE = "50"; // widest option the rows-per-page select offers
const MAX_PAGES = 25; // guard against a pager that never disables "next"

type FilingStatus = "on_time" | "late" | "non_compliant" | "not_filed";

// gfopp status page → our status key. Order matters only for stable logs.
const STATUS_PAGES: ReadonlyArray<{ page: string; status: FilingStatus }> = [
  { page: "s1.aspx", status: "on_time" },
  { page: "s2.aspx", status: "not_filed" },
  { page: "s3.aspx", status: "late" },
  { page: "s4.aspx", status: "non_compliant" },
];

interface PartyFilingEntry {
  /** Party name verbatim from the gfopp list (upper-case Cyrillic). */
  name: string;
  /** Stable ASCII URL slug, unique per party. Assigned in main() once the
   *  full distinct-name set is known; "" until then. */
  slug: string;
  status: FilingStatus;
  /** gfopp document id from `ShowWndGfoUp('id')`; null when no report is
   *  attached (always null for not_filed). */
  reportDocId: string | null;
  /** Synthesised `GfoUp.aspx?ID=` deep link, or null when no document id. */
  reportUrl: string | null;
}

interface YearReports {
  year: number;
  /** Statutory filing deadline — 31 March of the following year. */
  deadline: string;
  counts: Record<FilingStatus, number>;
  parties: PartyFilingEntry[];
}

interface ReportsFile {
  scrapedAt: string;
  source: string;
  /** Stable status keys + the legal basis, so the file is self-describing. */
  statusKeys: FilingStatus[];
  legalRef: string;
  totals: {
    years: number;
    filings: number;
    distinctParties: number;
  };
  years: YearReports[];
}

interface ParsedRow {
  name: string;
  reportDocId: string | null;
}

// One per-party shard — the party-pivoted view of the same data.
interface PartyShard {
  slug: string;
  name: string;
  firstYear: number;
  lastYear: number;
  counts: Record<FilingStatus, number>;
  /** on_time filings / total filings, 0..1. */
  complianceRate: number;
  /** Newest year first. */
  filings: Array<{
    year: number;
    deadline: string;
    status: FilingStatus;
    reportDocId: string | null;
    reportUrl: string | null;
  }>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const cleanCell = (html: string): string =>
  decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

// Bulgarian Cyrillic → Latin (the official transliteration, Наредба за
// транслитерация) — used to build stable ASCII slugs that are safe as both
// URL segments and shard filenames.
const BG_TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};

const slugifyName = (name: string): string => {
  const latin = [...name.toLowerCase()]
    .map((ch) => BG_TRANSLIT[ch] ?? ch)
    .join("");
  const slug = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "party";
};

// Assign a unique slug per distinct party name. Deterministic — names are
// sorted first so re-runs are stable — with -2/-3 suffixes on collision.
const assignSlugs = (names: string[]): Map<string, string> => {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const name of [...names].sort((a, b) => a.localeCompare(b, "bg"))) {
    const base = slugifyName(name);
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    map.set(name, slug);
  }
  return map;
};

// The list of years to crawl comes from data/financing/index.json (written by
// scrape_index.ts) — it is the source of truth for which years gfopp exposes.
const readYears = (): number[] => {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(
      `${INDEX_FILE} not found — run scripts/financing/scrape_index.ts first ` +
        `so the year catalogue exists.`,
    );
  }
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8")) as {
    sections: Array<{ id: string; years: Array<{ year: number }> }>;
  };
  const otcheti = index.sections.find((s) => s.id === "otcheti");
  const years = (otcheti?.years ?? [])
    .map((y) => y.year)
    .filter((y) => Number.isInteger(y));
  if (years.length === 0) {
    throw new Error(
      `${INDEX_FILE} has no "otcheti" years — cannot determine what to crawl.`,
    );
  }
  return [...new Set(years)].sort((a, b) => b - a);
};

// GET the per-year landing page and return the full cookie jar it mints. The
// year is bound to the ASP.NET session here; the s*.aspx pages read it back
// from the session, so the cookies must be carried forward.
const openYearSession = async (year: number): Promise<string> => {
  const url = `${BASE}/?year=${year}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean);
  if (cookies.length === 0) {
    throw new Error(
      `GET ${url} set no cookies — the gfopp session handshake changed.`,
    );
  }
  return cookies.join("; ");
};

const fetchHtml = async (
  url: string,
  init: { cookie: string; referer: string; ctx: string },
): Promise<string> => {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html",
      Cookie: init.cookie,
      Referer: init.referer,
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `GET ${url} (${init.ctx}) → ${res.status} ${res.statusText}`,
    );
  }
  const html = await res.text();
  if (html.length < 500) {
    throw new Error(
      `GET ${url} (${init.ctx}) returned only ${html.length} bytes — ` +
        `likely an expired session or an error page.`,
    );
  }
  return html;
};

// One value="..." hidden input by id. ASP.NET renders name, then id, then
// value — so anchoring on id and reading the following value is stable.
const hiddenField = (html: string, id: string): string => {
  const m = html.match(new RegExp(`id="${id}"[^>]*\\bvalue="([^"]*)"`));
  return m ? m[1] : "";
};

interface AspForm {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
}

const extractForm = (html: string, ctx: string): AspForm => {
  const viewState = hiddenField(html, "__VIEWSTATE");
  const eventValidation = hiddenField(html, "__EVENTVALIDATION");
  if (!viewState || !eventValidation) {
    throw new Error(
      `${ctx}: missing __VIEWSTATE/__EVENTVALIDATION — the gfopp page ` +
        `structure changed.`,
    );
  }
  return {
    viewState,
    viewStateGenerator: hiddenField(html, "__VIEWSTATEGENERATOR"),
    eventValidation,
  };
};

// Is the GridView pager's "next page" submit button present and enabled?
const hasNextPage = (html: string): boolean => {
  const m = html.match(/<input\b[^>]*\blnkbtnNext\b[^>]*>/);
  return !!m && !/\bdisabled\b/.test(m[0]);
};

// Post back to a status page. `fields` carries the event-specific bits —
// either the rows-per-page change or the next-page button.
const postBack = async (
  page: string,
  cookie: string,
  year: number,
  form: AspForm,
  fields: Record<string, string>,
): Promise<string> => {
  const url = `${BASE}/${page}`;
  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: form.viewState,
    __VIEWSTATEGENERATOR: form.viewStateGenerator,
    __EVENTVALIDATION: form.eventValidation,
    [ROWS_CTRL]: PAGE_SIZE,
    ...fields,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "text/html",
      Cookie: cookie,
      Referer: url,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `POST ${url} (year ${year}) → ${res.status} ${res.statusText}`,
    );
  }
  const html = await res.text();
  if (html.length < 500) {
    throw new Error(
      `POST ${url} (year ${year}) returned only ${html.length} bytes.`,
    );
  }
  return html;
};

// Parse one rendered s*.aspx GridView page. Each data row's first cell is the
// party name; a filed report row also carries an inline
// ShowWndGfoUp('<docId>') handler. Header ("Партия") and the bottom pager row
// are skipped.
const parseParties = (html: string): ParsedRow[] => {
  const out: ParsedRow[] = [];
  const seen = new Set<string>();
  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const inner = rowMatch[1];
    const cells = [...inner.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)];
    if (cells.length === 0) continue;
    const name = cleanCell(cells[0][1]);
    if (!name) continue;
    if (name === "Партия") continue; // header row
    if (/Ред\.\/Стр\.|^Стр\./.test(name)) continue; // DataGrid pager row
    if (/^Липсват данни\.?$/.test(name)) continue; // GridView empty-data row
    if (!/[А-Яа-я]/.test(name)) continue; // a party name is Cyrillic text
    if (seen.has(name)) continue;
    seen.add(name);
    const doc = inner.match(/ShowWndGfoUp\('(\d+)'\)/);
    out.push({ name, reportDocId: doc ? doc[1] : null });
  }
  return out;
};

// Read every party row from one status page: GET page 1 for the form fields,
// post back to widen the page size, then walk the pager to the end.
const fetchStatusPage = async (
  page: string,
  cookie: string,
  year: number,
): Promise<ParsedRow[]> => {
  const ctx = `${page} ${year}`;
  const firstHtml = await fetchHtml(`${BASE}/${page}`, {
    cookie,
    referer: `${BASE}/?year=${year}`,
    ctx,
  });
  await sleep(REQUEST_DELAY_MS);
  let html = await postBack(page, cookie, year, extractForm(firstHtml, ctx), {
    __EVENTTARGET: ROWS_CTRL,
  });

  const byName = new Map<string, ParsedRow>();
  for (let p = 0; p < MAX_PAGES; p++) {
    const before = byName.size;
    for (const row of parseParties(html)) {
      if (!byName.has(row.name)) byName.set(row.name, row);
    }
    // Stop at the last page, or if a page added nothing new (a pager that
    // re-serves the same page would otherwise spin until MAX_PAGES).
    if (!hasNextPage(html) || byName.size === before) break;
    await sleep(REQUEST_DELAY_MS);
    html = await postBack(page, cookie, year, extractForm(html, ctx), {
      [NEXT_CTRL]: "",
    });
  }
  return [...byName.values()];
};

const emptyCounts = (): Record<FilingStatus, number> => ({
  on_time: 0,
  late: 0,
  non_compliant: 0,
  not_filed: 0,
});

const scrapeYear = async (year: number): Promise<YearReports> => {
  const cookie = await openYearSession(year);
  // One entry per party — the four lists are mutually exclusive, but guard
  // against an upstream double-listing by keeping the first occurrence.
  const byName = new Map<string, PartyFilingEntry>();
  for (const { page, status } of STATUS_PAGES) {
    await sleep(REQUEST_DELAY_MS);
    for (const { name, reportDocId } of await fetchStatusPage(
      page,
      cookie,
      year,
    )) {
      if (byName.has(name)) continue;
      byName.set(name, {
        name,
        slug: "", // stamped in main() once every party name is known
        status,
        reportDocId,
        reportUrl: reportDocId ? `${BASE}/GfoUp.aspx?ID=${reportDocId}` : null,
      });
    }
  }
  const parties = [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "bg"),
  );
  const counts = emptyCounts();
  for (const p of parties) counts[p.status] += 1;
  return { year, deadline: `${year + 1}-03-31`, counts, parties };
};

const main = async (args: { upload: boolean }): Promise<void> => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const years = readYears();
  const newestYear = years[0];
  console.log(`→ crawling gfopp annual reports for ${years.length} year(s)`);

  const yearReports: YearReports[] = [];
  for (const year of years) {
    const report = await scrapeYear(year);
    const total = report.parties.length;
    const c = report.counts;
    console.log(
      `  ${year}: ${total} part(y/ies) — on_time=${c.on_time} late=${c.late} ` +
        `non_compliant=${c.non_compliant} not_filed=${c.not_filed}`,
    );
    if (total === 0) {
      if (year === newestYear) {
        throw new Error(
          `Newest year ${year} parsed zero parties across all four status ` +
            `pages — the gfopp parser or session handshake broke. Refusing ` +
            `to overwrite ${REPORTS_FILE}.`,
        );
      }
      console.warn(`  ! ${year}: empty — skipped (older years can be absent)`);
      continue;
    }
    yearReports.push(report);
  }

  // Truncation canary — a pager cap silently capped every list at 10/page in
  // an earlier revision, leaving an identical on_time count for every year.
  const distinctOnTime = new Set(yearReports.map((y) => y.counts.on_time));
  if (yearReports.length > 3 && distinctOnTime.size === 1) {
    throw new Error(
      `Every year reports on_time=${[...distinctOnTime][0]} — the GridView ` +
        `pager is likely capping each list. Refusing to overwrite ` +
        `${REPORTS_FILE}.`,
    );
  }

  const totalFilings = yearReports.reduce((s, y) => s + y.parties.length, 0);
  if (totalFilings < MIN_TOTAL_FILINGS) {
    throw new Error(
      `Only ${totalFilings} filing rows across ${yearReports.length} year(s) ` +
        `— below the ${MIN_TOTAL_FILINGS} sanity floor. The parser likely ` +
        `stopped matching. Refusing to overwrite ${REPORTS_FILE}.`,
    );
  }

  const distinctParties = new Set<string>();
  for (const y of yearReports) {
    for (const p of y.parties) distinctParties.add(p.name);
  }

  // Stamp a stable slug onto every party entry now that the full name set is
  // known — the frontend index links each row by this slug.
  const slugByName = assignSlugs([...distinctParties]);
  for (const y of yearReports) {
    for (const p of y.parties) p.slug = slugByName.get(p.name) ?? "";
  }

  const out: ReportsFile = {
    scrapedAt: new Date().toISOString(),
    source: BASE,
    statusKeys: ["on_time", "late", "non_compliant", "not_filed"],
    legalRef: "ЗПП чл. 34 — annual financial reports of political parties",
    totals: {
      years: yearReports.length,
      filings: totalFilings,
      distinctParties: distinctParties.size,
    },
    years: yearReports.sort((a, b) => b.year - a.year),
  };
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `✓ wrote ${REPORTS_FILE} — ${yearReports.length} years, ` +
      `${totalFilings} filings, ${distinctParties.size} distinct parties`,
  );

  const summary = {
    scrapedAt: out.scrapedAt,
    source: out.source,
    statusKeys: out.statusKeys,
    totals: out.totals,
    years: out.years.map((y) => ({
      year: y.year,
      deadline: y.deadline,
      counts: y.counts,
    })),
  };
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2) + "\n");
  console.log(`✓ wrote ${SUMMARY_FILE}`);

  // Per-party shards — the party-pivoted view of the same data.
  const shardByName = new Map<string, PartyShard>();
  for (const y of yearReports) {
    for (const p of y.parties) {
      let shard = shardByName.get(p.name);
      if (!shard) {
        shard = {
          slug: p.slug,
          name: p.name,
          firstYear: y.year,
          lastYear: y.year,
          counts: emptyCounts(),
          complianceRate: 0,
          filings: [],
        };
        shardByName.set(p.name, shard);
      }
      shard.firstYear = Math.min(shard.firstYear, y.year);
      shard.lastYear = Math.max(shard.lastYear, y.year);
      shard.counts[p.status] += 1;
      shard.filings.push({
        year: y.year,
        deadline: y.deadline,
        status: p.status,
        reportDocId: p.reportDocId,
        reportUrl: p.reportUrl,
      });
    }
  }
  // Rewrite the shard directory from scratch so a party that vanished
  // upstream does not leave a stale file behind.
  fs.rmSync(REPORTS_SHARD_DIR, { recursive: true, force: true });
  fs.mkdirSync(REPORTS_SHARD_DIR, { recursive: true });
  for (const shard of shardByName.values()) {
    shard.filings.sort((a, b) => b.year - a.year);
    shard.complianceRate =
      shard.filings.length > 0
        ? shard.counts.on_time / shard.filings.length
        : 0;
    fs.writeFileSync(
      path.join(REPORTS_SHARD_DIR, `${shard.slug}.json`),
      JSON.stringify(shard, null, 2) + "\n",
    );
  }
  console.log(
    `✓ wrote ${shardByName.size} per-party shard(s) → ${REPORTS_SHARD_DIR}/`,
  );

  if (args.upload) {
    await uploadText(REPORTS_FILE, "financing/reports.json");
    await uploadText(SUMMARY_FILE, "financing/reports-summary.json");
    console.log(`✓ uploaded`);
  }
};

const cli = command({
  name: "scrape_reports",
  args: {
    upload: flag({
      type: optional(boolean),
      long: "upload",
      defaultValue: () => false,
    }),
  },
  handler: (args) => main({ upload: !!args.upload }),
});

run(cli, process.argv.slice(2));
