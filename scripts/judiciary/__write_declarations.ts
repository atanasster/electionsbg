// Reproducible build of data/judiciary/declarations.json — the ИВСС register of
// magistrates' asset declarations (чл. 175а, ал. 1 ЗСВ), indexed.
//
// Two sources, both plain HTML (no WAF, no JS):
//
//  1. The declarations register itself, a Joomla site at a bare IP that the ИВСС
//     links to as "Публикувани декларации". It is indexed by year × first letter
//     of the given name — 9 years × 29 letters = 261 pages — each listing
//     (name, входящ номер, PDF). Each year has TWO batches: `/declaracii/<year>/`
//     (the annual declaration, due 15 May) and `/declaracii/<year>-1/` (change
//     declarations under чл. 175в, ал. 5, filed through the autumn).
//
//  2. The ИВСС's own integrity lists: magistrates who filed late, those who left
//     office without filing, and — the sharpest signal — those where a
//     discrepancy was found and NOT corrected within the чл. 175ж, ал. 2 window.
//
// What this artifact is NOT: the *contents* of the declarations. Each PDF is a
// 12-page multi-table form (v3.0 since 2022) with a real text layer, so parsing
// the assets is feasible — but it is 46k PDFs / ~37 GB and a separate project.
// The full per-declaration index (with PDF paths) is written to
// raw_data/judiciary/declarations_index.json (gitignored) as its input.
//
// Framing note: magistrates are not elected officials. This artifact reports
// only what the ИВСС itself publishes — that a declaration was filed, when, and
// whom the ИВСС names on its own non-compliance lists. Filing gaps across years
// mostly reflect entering or leaving the corps, NOT misconduct, and are
// deliberately not surfaced as a compliance score.
//
// Run: npx tsx scripts/judiciary/__write_declarations.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  FILED_LATE_MARKER,
  INTEGRITY_PAGES,
  IVSS_PAGE,
  IVSS_REGISTER as REGISTER,
  stripHtml,
} from "./sources";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/judiciary");
const OUT_DIR = path.resolve(__dirname, "../../data/judiciary");
const OUT = path.join(OUT_DIR, "declarations.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const strip = stripHtml;

const get = async (url: string, tries = 3): Promise<string> => {
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (a === tries - 1) throw err;
      await sleep(1200);
    }
  }
  throw new Error("unreachable");
};

// ------------------------------------------------------------- the register --

interface DeclRow {
  /** Year of the register page the row was listed under (the heading). */
  year: number;
  /** Year encoded in the PDF path. Independent of `year`; reconciled at ingest. */
  pdfYear: number;
  name: string;
  /** Входящ номер, e.g. "7567/14.05.2025". */
  ref: string;
  pdf: string;
  /** "annual" = /declaracii/<year>/ · "change" = /declaracii/<year>-1/ */
  batch: "annual" | "change";
}

/** The register's home page lists, per year, one link per first letter. The year
 *  sits inside a <strong> so the heading regex must tolerate tags. */
const letterPages = (
  home: string,
): { year: number; letter: string; url: string }[] => {
  const pat =
    /през(?:<[^>]+>|\s)*?(20\d\d)|href="(\/index\.php\?option=com_content[^"]+)"[^>]*>\s*([А-Я])\s*<\/a>/g;
  const out: { year: number; letter: string; url: string }[] = [];
  let cur = 0;
  for (const m of home.matchAll(pat)) {
    if (m[1]) cur = Number(m[1]);
    else if (cur)
      out.push({
        year: cur,
        letter: m[3],
        url: m[2].replace(/&amp;/g, "&"),
      });
  }
  return out;
};

const parseLetterPage = (html: string, year: number): DeclRow[] => {
  const out: DeclRow[] = [];
  for (const tr of html.split(/<tr[^>]*>/i).slice(1)) {
    const a =
      /href="(\/images\/declaracii\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/i.exec(
        tr,
      );
    if (!a) continue;
    const name = strip(a[2]);
    if (!name) continue;
    const cells = tr
      .replace(/<[^>]+>/g, "\t")
      .split("\t")
      .map((s) => s.replace(/&nbsp;/g, " ").trim())
      .filter(Boolean);
    const ref =
      cells.find((c) => /^\d+\s*\/\s*\d{2}\.\d{2}\.\d{4}$/.test(c)) ?? "";
    const dir = /\/declaracii\/([^/]+)\//.exec(a[1])?.[1] ?? "";
    out.push({
      year,
      // The year the PDF path itself claims — an INDEPENDENT signal from the
      // page heading `year`, so the two can be reconciled at ingest.
      pdfYear: Number(dir.replace(/-1$/, "")) || 0,
      name,
      ref,
      pdf: a[1],
      batch: dir.endsWith("-1") ? "change" : "annual",
    });
  }
  return out;
};

// ------------------------------------------------------- the integrity lists --

interface Person {
  name: string;
  position: string;
  court: string;
  /** ИВСС footnote „(1) - лицето е подало декларация извън срока": the person
   *  DID file, after the deadline. Absent = never filed at all. The two are
   *  materially different statements about a named individual, so the flag is
   *  carried through to the UI rather than dropped with the marker. */
  filedLate: boolean;
  /** The list's fifth column, where it has one (discrepancy: "Вид декларация"). */
  extra?: string;
}

/** Parse one non-compliance list. `cols` is the exact table width the ИВСС
 *  publishes for this page; a row that doesn't match it is a shape change, and
 *  we throw rather than silently truncate a column. */
const parseIntegrityPage = (
  html: string,
  cols: number,
  pageId: string,
): { year: number | null; people: Person[] } => {
  const y =
    /-\s*(20\d\d)\s*г\./.exec(html)?.[1] ?? /(20\d\d)\s*г\./.exec(html)?.[1];
  const people: Person[] = [];
  let rowsWithCells = 0;
  for (const tr of html.split(/<tr[^>]*>/i).slice(1)) {
    const tds = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      strip(m[1]),
    );
    if (!tds.length) continue;
    // Shape FIRST, content second. If the ИВСС inserts a leading column — a row
    // ordinal, a checkbox, an icon — the name slides from tds[1] to tds[2], the
    // Cyrillic test below fails on "1.", and every data row would be skipped:
    // the ingest exits 0 and publishes an empty list, i.e. the false claim that
    // no magistrate filed late. That is exactly the kzk_appeals "0 complaints"
    // regression. The header row carries `cols` cells too, so asserting here is
    // safe for every row that has cells at all.
    if (tds.length !== cols)
      throw new Error(
        `${pageId}: expected ${cols} columns, got ${tds.length} — the ИВСС changed the table shape: ${JSON.stringify(tds)}`,
      );
    rowsWithCells++;
    const raw = tds[1] ?? "";
    if (!raw || raw === "Име" || !/[А-Яа-я]{3}/.test(raw)) continue;
    people.push({
      name: raw.replace(/\s*\(\d\)\s*$/, "").trim(),
      filedLate: FILED_LATE_MARKER.test(raw),
      position: tds[2] ?? "",
      court: tds[3] ?? "",
      ...(cols > 4 && tds[4] ? { extra: tds[4] } : {}),
    });
  }
  // Completeness. A genuinely empty list is header-only (one row with cells and
  // no names) — that happens and is published as "няма". But a page carrying
  // DATA rows from which we extracted no names means the name column moved:
  // fail loudly rather than assert to the reader that nobody was listed.
  if (rowsWithCells > 1 && people.length === 0)
    throw new Error(
      `${pageId}: ${rowsWithCells} table rows but 0 names parsed — the ИВСС moved the name column`,
    );
  return { year: y ? Number(y) : null, people };
};

// ------------------------------------------------------------------- main ----

const monthOf = (ref: string): number | null => {
  const m = /\/\s*\d{2}\.(\d{2})\.\d{4}/.exec(ref);
  return m ? Number(m[1]) : null;
};
const dayOf = (ref: string): number | null => {
  const m = /\/\s*(\d{2})\.\d{2}\.\d{4}/.exec(ref);
  return m ? Number(m[1]) : null;
};

const main = async (): Promise<void> => {
  console.log("fetching the register index …");
  const home = await get(REGISTER);
  const pages = letterPages(home);
  if (pages.length < 200)
    throw new Error(`register index: only ${pages.length} letter pages found`);

  const rows: DeclRow[] = [];
  const CONC = 4;
  for (let i = 0; i < pages.length; i += CONC) {
    const batch = pages.slice(i, i + CONC);
    const htmls = await Promise.all(batch.map((p) => get(REGISTER + p.url)));
    htmls.forEach((h, k) => rows.push(...parseLetterPage(h, batch[k].year)));
    if ((i / CONC) % 10 === 0)
      console.log(
        `  ${Math.min(i + CONC, pages.length)}/${pages.length} pages · ${rows.length} rows`,
      );
    await sleep(180);
  }

  // Dedupe on the PDF path — a hyphenated surname can be listed under two letters.
  const seen = new Set<string>();
  const decls = rows.filter((r) => !seen.has(r.pdf) && seen.add(r.pdf));

  // ---- per-year rollup ---------------------------------------------------
  const yearMap = new Map<
    number,
    { annual: number; change: number; names: Set<string> }
  >();
  for (const d of decls) {
    const y = yearMap.get(d.year) ?? {
      annual: 0,
      change: 0,
      names: new Set<string>(),
    };
    y[d.batch]++;
    y.names.add(d.name);
    yearMap.set(d.year, y);
  }
  const years = [...yearMap.entries()]
    .map(([year, v]) => ({
      year,
      declarations: v.annual + v.change,
      magistrates: v.names.size,
      annual: v.annual,
      change: v.change,
    }))
    .sort((a, b) => b.year - a.year);

  // ---- filing calendar (annual batch only — it has a statutory deadline) --
  const annual = decls.filter((d) => d.batch === "annual" && d.ref);
  const byMonth = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    count: 0,
  }));
  const mayDays = new Map<number, number>();
  const oddRefs: string[] = [];
  for (const d of annual) {
    const m = monthOf(d.ref);
    if (m == null || m < 1 || m > 12) {
      oddRefs.push(d.ref);
      continue;
    }
    byMonth[m - 1].count++;
    if (m === 5) {
      const day = dayOf(d.ref);
      if (day) mayDays.set(day, (mayDays.get(day) ?? 0) + 1);
    }
  }
  // A handful of входящи номера carry a malformed date; report rather than hide.
  if (oddRefs.length)
    console.warn(
      `  ${oddRefs.length} annual refs with an unparsable date, excluded from the calendar (e.g. ${oddRefs.slice(0, 3).join(", ")})`,
    );
  const calTotal = byMonth.reduce((s, x) => s + x.count, 0);
  const filingCalendar = {
    basis: "annual" as const,
    total: calTotal,
    deadline: "15.05",
    byMonth,
    byDayOfMay: [...mayDays.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day - b.day),
  };

  // ---- integrity lists ---------------------------------------------------
  console.log("fetching the ИВСС integrity lists …");
  const lists = [];
  for (const p of INTEGRITY_PAGES) {
    const html = await get(`https://www.inspectoratvss.bg/bg/page/${p.page}`);
    const { year, people } = parseIntegrityPage(html, p.cols, p.id);
    lists.push({
      id: p.id,
      bg: p.bg,
      en: p.en,
      legalRef: p.legalRef,
      url: `https://www.inspectoratvss.bg/bg/page/${p.page}`,
      year,
      people,
      ...("extraBg" in p ? { extraBg: p.extraBg, extraEn: p.extraEn } : {}),
    });
    await sleep(250);
  }

  // ---- asserts -----------------------------------------------------------
  // The newest year is legitimately incomplete: change declarations (чл. 175в,
  // ал. 5) arrive through the autumn, so between the register opening a year and
  // the first change filing, `change === 0` is the truth — not a bad parse. Only
  // closed years must satisfy the completeness asserts. Failing the open year
  // would also take the fast-moving ИВСС integrity lists down with it.
  if (years.length < 8)
    throw new Error(`expected >=8 years of declarations, got ${years.length}`);
  const latestYear = years[0].year;
  for (const y of years) {
    if (y.year === latestYear) continue;
    if (y.magistrates < 3000)
      throw new Error(
        `${y.year}: only ${y.magistrates} magistrates — bad parse`,
      );
    if (y.annual === 0 || y.change === 0)
      throw new Error(
        `${y.year}: missing a filing batch (annual=${y.annual}, change=${y.change})`,
      );
  }
  // The open year still has to look like a year, just not a complete one.
  if (years[0].annual === 0)
    throw new Error(`${latestYear}: no annual declarations at all — bad parse`);
  if (years[0].change === 0)
    console.warn(
      `  ${latestYear}: no change declarations yet — normal before the autumn filings`,
    );
  // NOT `Σ years.declarations === decls.length` — that holds by construction
  // (`declarations = annual + change`, both incremented once per row) and would
  // pass even if every `year` were NaN. Reconcile against signals the year
  // grouping does not come from:
  //
  //  1. Dedupe soundness: every surviving row must name a distinct PDF. (A
  //     "kept + dropped == listed" check would be a tautology — `dropped` is
  //     derived from the two operands it would be compared against.)
  if (decls.length !== new Set(decls.map((d) => d.pdf)).size)
    throw new Error("dedupe failed: duplicate PDF paths survived");

  //  2. Page heading vs PDF path: `year` is read from the register page's year
  //     heading, `pdfYear` from `/declaracii/<year>[-1]/` in the href. They are
  //     independent signals, so this catches a page grouped under the wrong year —
  //     the failure the old assert could never see.
  //
  //     Measured on the live register: exactly 5 of 46,528 rows disagree, always
  //     by +1 (page year = path year + 1). Those are genuine — the ИВСС files a
  //     declaration submitted in January into the directory of the cycle it
  //     amends. So a +1 offset is tolerated, in small numbers; ANY other offset,
  //     or a sudden crop of them, means the letter pages have been mis-grouped.
  const offsets = decls
    .filter((d) => d.pdfYear > 0 && d.pdfYear !== d.year)
    .map((d) => ({ d, delta: d.year - d.pdfYear }));
  const wrongDelta = offsets.filter((o) => o.delta !== 1);
  if (wrongDelta.length)
    throw new Error(
      `${wrongDelta.length} declaration(s) whose page heading and PDF path disagree by something other than +1 year — the pages are mis-grouped. e.g. ${wrongDelta
        .slice(0, 3)
        .map((o) => `${o.d.name}: page ${o.d.year} vs path ${o.d.pdfYear}`)
        .join("; ")}`,
    );
  const CARRYOVER_LIMIT = Math.max(50, Math.ceil(decls.length * 0.001));
  if (offsets.length > CARRYOVER_LIMIT)
    throw new Error(
      `${offsets.length} prior-cycle carry-over declarations exceeds the expected handful (limit ${CARRYOVER_LIMIT}) — check the year grouping`,
    );
  if (offsets.length)
    console.log(
      `  ${offsets.length} declaration(s) filed into the prior cycle's directory (expected; the ИВСС does this for January change filings)`,
    );
  const mayShare = byMonth[4].count / calTotal;
  if (!(mayShare > 0.4))
    throw new Error(
      `May share ${(100 * mayShare).toFixed(1)}% — deadline clustering lost, check ref parsing`,
    );

  // ---- write -------------------------------------------------------------
  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Инспекторат към Висшия съдебен съвет (ИВСС)",
      url: IVSS_PAGE,
      register: REGISTER,
      description:
        "Регистър на декларациите по чл. 175а, ал. 1 ЗСВ на съдии, прокурори и следователи, плюс списъците на ИВСС за неподадени в срок декларации и установени несъответствия.",
    },
    latestYear: years[0].year,
    totals: {
      declarations: decls.length,
      magistrates: new Set(decls.map((d) => d.name)).size,
      firstYear: years[years.length - 1].year,
      lastYear: years[0].year,
    },
    years,
    filingCalendar,
    integrity: lists,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  // The full per-declaration index (with PDF paths) is the input for a future
  // asset-extraction job. Too big to commit; raw_data/judiciary/ is gitignored.
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RAW_DIR, "declarations_index.json"),
    JSON.stringify(decls),
  );

  console.log(`\nwrote ${OUT}`);
  console.log(
    `  ${decls.length} declarations · ${out.totals.magistrates} magistrates · ${out.totals.firstYear}-${out.totals.lastYear}`,
  );
  console.log(
    `  filing calendar: ${(100 * mayShare).toFixed(1)}% of annual declarations filed in May (deadline 15.05)`,
  );
  for (const l of lists)
    console.log(
      `  ${l.id.padEnd(18)} ${String(l.people.length).padStart(3)} people (${l.year ?? "?"})`,
    );
  console.log(`  raw index → ${path.join(RAW_DIR, "declarations_index.json")}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
