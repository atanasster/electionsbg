// Reproducible build of data/judiciary/caseload.json — the national + per-tier
// caseload, duration and workload series of the Bulgarian courts.
//
// Source: the ВСС annual "Обобщени статистически таблици за дейността на
// съдилищата" PDFs (vss.justice.bg). Each year's **Приложение № 1** carries the
// two tables that are the spine of the judiciary view:
//
//   I.  Движение на делата — за всеки съдебен ред: висящи в началото, постъпили,
//       всичко за разглеждане, свършени, свършени в срок до 3 месеца (брой + %),
//       решени по същество, прекратени, висящи в края, обжалвани.
//   II. Брой съдии по щат + натовареност ПО ЩАТ (nominal, per allocated post)
//       и ДЕЙСТВИТЕЛНА натовареност (actual, per month worked).
//
// Publishing both workload measures matters: the ВСС's own workload methodology
// (SINS) is publicly contested, so the view shows the nominal and the actual
// figure side by side rather than picking one.
//
// Parsing: the PDFs have a real text layer (fonts + ToUnicode), so no OCR. We
// reconstruct the table with pdfjs text positioning — bucket items into rows by
// y, merge into cells by x-gap — the same technique as the investment-annex
// parser. Rows are keyed by ORDER + numeric-cell count, NEVER by label: the
// wrapped "Районни съдилища извън / областните центрове" label leaves its data
// row label-less in section I, and the "Окръжни + СГС" label gained/lost "+ СНС"
// when the specialised criminal court closed in 2022.
//
// Reconciliation asserted at ingest (a bad parse throws, it never silently ships):
//   - exactly 6 tier rows + 1 total row in each section
//   - Σ tiers == total, per column
//   - the stock-flow identity: pendingEnd == pendingStart + filed − resolved
//   - the printed "% в срок" == round(withinDeadline / resolved)
//
// Run (fetches missing PDFs into raw_data/judiciary/, which is gitignored):
//   npx tsx scripts/judiciary/__write_caseload.ts

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { VSS_ANNUAL_TABLES, VSS_STATS_PAGE, COURT_LEVELS } from "./sources";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const pdfjs = require("pdfjs-dist") as any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/judiciary");
const OUT_DIR = path.resolve(__dirname, "../../data/judiciary");
const OUT = path.join(OUT_DIR, "caseload.json");

// ------------------------------------------------------------- pdf → cells ---

interface Item {
  s: string;
  x: number;
  y: number;
  w: number;
}

/** Bucket a page's text items into rows (by y) and merge each row into cells
 *  (by x-gap). A gap < 6pt means the items belong to one cell — that is what
 *  keeps a space-grouped thousand ("129 030") from splitting into two cells. */
const pageRows = async (page: any): Promise<string[][]> => {
  const tc = await page.getTextContent();
  const items: Item[] = tc.items
    .filter((i: any) => typeof i.str === "string" && i.str.trim())
    .map((i: any) => ({
      s: i.str,
      x: i.transform[4],
      y: i.transform[5],
      w: i.width ?? 0,
    }));

  const rows = new Map<number, Item[]>();
  for (const it of items) {
    const key = [...rows.keys()].find((k) => Math.abs(k - it.y) < 3);
    if (key === undefined) rows.set(it.y, [it]);
    else rows.get(key)!.push(it);
  }

  const cellsOf = (its: Item[]): string[] => {
    its.sort((a, b) => a.x - b.x);
    const out: string[] = [];
    let cur = "";
    let endX = -1;
    for (const it of its) {
      if (endX >= 0 && it.x - endX < 6)
        cur += (it.x - endX > 1.2 ? " " : "") + it.s;
      else {
        if (cur.trim()) out.push(cur.trim());
        cur = it.s;
      }
      endX = it.x + it.w;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0]) // top of page first
    .map(([, its]) => cellsOf(its));
};

/** Every space-like separator the ВСС's PDFs have used as a digit grouper:
 *  ASCII space, NBSP (U+00A0), narrow NBSP (U+202F), thin space (U+2009) and the
 *  figure space (U+2007). A cell whose thousands separator is any of these must
 *  parse — a `null` here silently drops a numeric cell, shifts the row's cell
 *  count and mis-maps columns. */
const SPACES = /[\u0020\u00a0\u2007\u2009\u202f]/g;

/** "129 030" → 129030 · "1 944,77" → 1944.77 · "8.74" → 8.74 · "72%" → 72.
 *  The decimal separator drifts by year — a dot up to 2021, a comma from 2022 —
 *  while the thousands separator is always some kind of space, so accepting
 *  either mark as the decimal is unambiguous. */
const num = (cell: string): number | null => {
  const t = cell.trim().replace(SPACES, " ").replace(/%$/, "");
  // A space must be a THOUSANDS separator (groups of exactly 3), not any spacing.
  // If pageRows' 6pt x-gap heuristic ever welds two adjacent numeric columns into
  // one cell ("129030 8600"), a permissive `[\d ]*` would silently return
  // 1290308600 instead of null and leave the Σ asserts as the only line of
  // defence.
  if (!/^\d{1,3}(?: \d{3})*([.,]\d+)?$/.test(t)) return null;
  return parseFloat(t.replace(/ /g, "").replace(",", "."));
};

const nums = (cells: string[]): number[] =>
  cells.map(num).filter((v): v is number => v !== null);

// ---------------------------------------------------------------- parsing ---

export interface TierCaseload {
  id: string;
  bg: string;
  en: string;
  pendingStart: number;
  filed: number;
  toConsider: number;
  resolved: number;
  withinDeadline: number;
  withinDeadlinePct: number;
  onMerits: number;
  terminated: number;
  pendingEnd: number;
  appealed: number;
  judges: number;
  /** Натовареност ПО ЩАТ — cases per allocated judge post, per month. */
  loadPerPostToConsider: number;
  loadPerPostResolved: number;
  personMonths: number;
  /** ДЕЙСТВИТЕЛНА натовареност — cases per month actually worked. */
  actualLoadToConsider: number;
  actualLoadResolved: number;
}

interface YearCaseload {
  year: number;
  tiers: TierCaseload[];
  total: Omit<TierCaseload, "id" | "bg" | "en"> & {
    id: "total";
    bg: string;
    en: string;
  };
}

const SECTION_I_COLS = 10;
const SECTION_II_COLS = 6;

const parseYear = async (
  bytes: Uint8Array,
  year: number,
): Promise<YearCaseload> => {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false })
    .promise;

  // Find Приложение № 1 — the page carrying BOTH the "ОБОБЩЕН ОТЧЕТ" heading
  // and the section-I movement table (the table of contents also mentions the
  // appendix by name, so require the "Движение на делата" heading too).
  let rows: string[][] | null = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const r = await pageRows(await doc.getPage(p));
    const flat = r.map((c) => c.join(" ")).join(" ");
    if (/ОБОБЩЕН ОТЧЕТ/.test(flat) && /Движение на делата/.test(flat)) {
      rows = r;
      break;
    }
    if (p > 30) break; // Приложение 1 always sits in the front matter
  }
  if (!rows) throw new Error(`${year}: Приложение № 1 page not found`);

  // Section I — the first 7 rows with >= 10 numeric cells (6 tiers + Всичко).
  // The row's non-numeric cells are kept so the ORDER-keyed tier assignment can
  // be checked against the printed label (see TIER_STEM below).
  const sec1: number[][] = [];
  const sec1Labels: string[] = [];
  let iEnd = -1;
  for (let i = 0; i < rows.length && sec1.length < 7; i++) {
    const n = nums(rows[i]);
    if (n.length >= SECTION_I_COLS) {
      sec1.push(n.slice(0, SECTION_I_COLS));
      sec1Labels.push(
        rows[i]
          .filter((c) => num(c) === null)
          .join(" ")
          .trim(),
      );
      iEnd = i;
    }
  }
  if (sec1.length !== 7)
    throw new Error(`${year}: section I — expected 7 rows, got ${sec1.length}`);

  // Section II — the next 7 rows with >= 6 numeric cells (6 tiers + ОБЩО).
  // Take the first three (judges, load/post to-consider, load/post resolved) and
  // the last three (person-months, actual load to-consider, actual resolved);
  // the optional civil/criminal middle block is absent for the tiers that don't
  // split their bench, so positional slicing from both ends is the stable read.
  const sec2: number[][] = [];
  for (let i = iEnd + 1; i < rows.length && sec2.length < 7; i++) {
    const n = nums(rows[i]);
    if (n.length >= SECTION_II_COLS)
      sec2.push([...n.slice(0, 3), ...n.slice(-3)]);
  }
  if (sec2.length !== 7)
    throw new Error(
      `${year}: section II — expected 7 rows, got ${sec2.length}`,
    );

  const build = (i: number, id: string, bg: string, en: string) => {
    const a = sec1[i];
    const b = sec2[i];
    return {
      id,
      bg,
      en,
      pendingStart: a[0],
      filed: a[1],
      toConsider: a[2],
      resolved: a[3],
      withinDeadline: a[4],
      withinDeadlinePct: a[5],
      onMerits: a[6],
      terminated: a[7],
      pendingEnd: a[8],
      appealed: a[9],
      judges: b[0],
      loadPerPostToConsider: b[1],
      loadPerPostResolved: b[2],
      personMonths: b[3],
      actualLoadToConsider: b[4],
      actualLoadResolved: b[5],
    };
  };

  // Rows are keyed by ORDER, and every assert in this file is either
  // order-invariant (Σ tiers == total) or computed from that row's own cells —
  // so a pure REORDER by the ВСС would silently attribute Военни's ~500 cases to
  // Административни and still reconcile. Where the ВСС prints a label, check it.
  // The stems are the wording actually used in the PDFs 2018-2025, not the tier's
  // display name: `rs_oblast` prints "РС в областните центрове + СРС", never
  // "Районни съдилища". `rs_izvan`'s label wraps onto the row above and leaves
  // its data row label-less — that one row, and only that one, is unchecked.
  const TIER_STEM: Record<string, RegExp | null> = {
    apelativni: /апелативн/i,
    voenni: /военн/i,
    okrazhni: /окръжн/i,
    rs_oblast: /областните\s+центрове/i,
    rs_izvan: null,
    administrativni: /административн/i,
  };
  COURT_LEVELS.forEach((l, i) => {
    const stem = TIER_STEM[l.id];
    const label = sec1Labels[i];
    if (stem && label && !stem.test(label))
      throw new Error(
        `${year}: row ${i} should be ${l.id} (${stem.source}) but is labelled "${label}" — the ВСС reordered the tiers`,
      );
  });
  if (sec1Labels[6] && !/всичко/i.test(sec1Labels[6]))
    throw new Error(
      `${year}: row 6 should be the total but is labelled "${sec1Labels[6]}"`,
    );

  const tiers = COURT_LEVELS.map((l, i) => build(i, l.id, l.bg, l.en));
  const total = build(
    6,
    "total",
    "Всичко дела",
    "All courts",
  ) as YearCaseload["total"];

  // ---- reconciliation asserts -------------------------------------------
  const sumOf = (k: keyof TierCaseload) =>
    tiers.reduce((s, t) => s + (t[k] as number), 0);
  for (const k of [
    "pendingStart",
    "filed",
    "toConsider",
    "resolved",
    "withinDeadline",
    "onMerits",
    "terminated",
    "pendingEnd",
    "appealed",
    "judges",
  ] as const) {
    const got = sumOf(k);
    if (Math.abs(got - (total[k] as number)) > 1)
      throw new Error(
        `${year}: Σ tiers ${k} = ${got} != total ${total[k]} — bad row mapping`,
      );
  }
  // Stock-flow identity. Reopened / transferred cases can move it by a hair, so
  // allow a tiny tolerance but never a silent drift.
  const ident = total.pendingStart + total.filed - total.resolved;
  if (Math.abs(ident - total.pendingEnd) > 5)
    throw new Error(
      `${year}: pendingEnd ${total.pendingEnd} != pendingStart+filed-resolved ${ident}`,
    );
  // The printed "% в срок" must agree with the printed counts.
  const pct = Math.round((100 * total.withinDeadline) / total.resolved);
  if (Math.abs(pct - total.withinDeadlinePct) > 1)
    throw new Error(
      `${year}: printed within-deadline ${total.withinDeadlinePct}% != computed ${pct}%`,
    );

  // Section II's five workload columns are read positionally (first three + last
  // three numeric cells), and NOTHING above checks them: `judges` reconciles via
  // sumOf even if the slice mis-maps, so a future layout shift could publish
  // wrong workload figures silently. Tie them back to Section I. Both identities
  // are the ВСС's own definitions, and hold to <0.1% across 2018-2025:
  //   loadPerPostResolved  == resolved / judges / 12   (cases per post, monthly)
  //   actualLoadResolved   == resolved / personMonths  (cases per month worked)
  const relErr = (a: number, b: number) => (b === 0 ? 1 : Math.abs(a - b) / b);
  for (const t of [...tiers, total]) {
    if (t.judges > 0 && t.loadPerPostResolved > 0) {
      const derived = t.resolved / t.judges / 12;
      if (relErr(derived, t.loadPerPostResolved) > 0.02)
        throw new Error(
          `${year}/${t.id}: loadPerPostResolved ${t.loadPerPostResolved} != resolved/judges/12 ${derived.toFixed(2)} — section II columns mis-sliced`,
        );
    }
    if (t.personMonths > 0 && t.actualLoadResolved > 0) {
      const derived = t.resolved / t.personMonths;
      if (relErr(derived, t.actualLoadResolved) > 0.02)
        throw new Error(
          `${year}/${t.id}: actualLoadResolved ${t.actualLoadResolved} != resolved/personMonths ${derived.toFixed(2)} — section II columns mis-sliced`,
        );
    }
  }

  return { year, tiers, total };
};

// ------------------------------------------------------------------- main ---

/** Fetch a year's tables, caching under a filename keyed on the URL.
 *
 *  Keying the cache on the year alone means a corrected re-publication is never
 *  picked up: point VSS_ANNUAL_TABLES at the new URL and the stale
 *  `tables-2021.pdf` still wins, so `update-judiciary` quietly re-emits the old
 *  numbers. The ВСС does re-publish — the 2021 entry is literally named
 *  `…-2021_new.pdf`. A URL-keyed name makes a new URL a cache miss by
 *  construction; `--refetch` covers the harder case of a same-URL re-upload.
 *
 *  (The watcher can't catch a same-URL re-upload either — it fingerprints the set
 *  of links, not their bytes. Hashing 8 × ~10 MB PDFs on every watcher run is too
 *  expensive to be worth it; `--refetch` is the operator's escape hatch.) */
const fetchPdf = async (year: number, url: string): Promise<Uint8Array> => {
  const key = createHash("sha1").update(url).digest("hex").slice(0, 8);
  const file = path.join(RAW_DIR, `tables-${year}-${key}.pdf`);
  const refetch = process.argv.includes("--refetch");
  if (fs.existsSync(file) && !refetch)
    return new Uint8Array(fs.readFileSync(file));
  console.log(`fetching ${year}${refetch ? " (--refetch)" : ""} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${year}: fetch ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(file, buf);
  return new Uint8Array(buf);
};

const main = async (): Promise<void> => {
  // A year that fails to parse must NOT silently shrink the committed artifact —
  // if the newest year's layout changes, writing the remainder would regress
  // `latestYear` and quietly ship a stale dashboard. Fail loudly instead, and
  // require an explicit opt-in to publish a partial rebuild.
  const allowPartial = process.argv.includes("--allow-partial");
  const years: YearCaseload[] = [];
  const failed: number[] = [];
  for (const [yStr, url] of Object.entries(VSS_ANNUAL_TABLES)) {
    const year = Number(yStr);
    try {
      years.push(await parseYear(await fetchPdf(year, url), year));
    } catch (err) {
      console.error(`FAILED ${year}: ${(err as Error).message}`);
      failed.push(year);
    }
  }
  if (!years.length) throw new Error("no judiciary caseload years parsed");
  if (failed.length && !allowPartial)
    throw new Error(
      `${failed.length} year(s) failed to parse (${failed.join(", ")}) — refusing to overwrite ${OUT} with a partial rebuild. ` +
        `Fix the parser, or re-run with --allow-partial if the loss is intended.`,
    );
  if (failed.length)
    console.warn(
      `--allow-partial: writing WITHOUT ${failed.join(", ")} — latestYear will be ${Math.max(...years.map((y) => y.year))}`,
    );
  years.sort((a, b) => b.year - a.year);

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Висш съдебен съвет",
      url: VSS_STATS_PAGE,
      description:
        "Обобщени статистически таблици за дейността на съдилищата, Приложение № 1 — движение на делата и натовареност на съдиите (по щат и действителна).",
    },
    latestYear: years[0].year,
    years,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log(`\nwrote ${OUT} — ${years.length} years`);
  console.log(
    `${"year".padEnd(6)}${"filed".padStart(9)}${"resolved".padStart(10)}${"pending".padStart(10)}${"clear%".padStart(8)}${"in-3mo".padStart(8)}${"judges".padStart(8)}${"load/post".padStart(11)}`,
  );
  for (const y of [...years].reverse()) {
    const t = y.total;
    const clear = (100 * t.resolved) / t.filed;
    console.log(
      `${String(y.year).padEnd(6)}${t.filed.toLocaleString("en").padStart(9)}${t.resolved.toLocaleString("en").padStart(10)}${t.pendingEnd.toLocaleString("en").padStart(10)}${clear.toFixed(1).padStart(8)}${String(t.withinDeadlinePct + "%").padStart(8)}${t.judges.toLocaleString("en").padStart(8)}${t.loadPerPostToConsider.toFixed(2).padStart(11)}`,
    );
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
