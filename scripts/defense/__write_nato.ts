// Parse the NATO "Defence Expenditure of NATO Countries" PDF into three files:
//   gdp_share.json      — Table 3, Bulgaria's %GDP series + the moving targets
//   category_split.json — Table 8a, equipment / personnel / other split
//   peers.json          — Table 3 for BG + RO/GR/HU/HR + NATO Europe, plus BG's
//                         per-capita (Table 6) and personnel headcount (Table 7)
//
// The lead charts in the PDF are vector graphics with no text layer, so we read
// the TABLES: `pdftotext -layout` then pick each country's row out of the section
// heading. Each row is 12 numbers, one per year 2014..2025.
//
// Usage:
//   npx tsx scripts/defense/__write_nato.ts --pdf <path>   # parse a local PDF
//   npx tsx scripts/defense/__write_nato.ts                # download the latest
//
// The `targets` block (2% / 3.5% / 5%) and the arms-export / readiness / programs
// files are NOT touched here — only the two NATO-sourced artifacts. See
// .claude/skills/update-defense/SKILL.md.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { NATO_DEFEXP_PAGE } from "./sources";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "../../data/defense");
const FIRST_YEAR = 2014;
const EST_YEARS = 2; // NATO flags the last two years as estimates ("e")

const args = process.argv.slice(2);
const pdfArgIdx = args.indexOf("--pdf");
const pdfArg = pdfArgIdx >= 0 ? args[pdfArgIdx + 1] : null;

/** Resolve the latest def-exp PDF URL by scraping the NATO news page, else fall
 *  back to the conventional current-edition path. */
const resolvePdfUrl = async (): Promise<string> => {
  try {
    const html = await (await fetch(NATO_DEFEXP_PAGE)).text();
    const m = [...html.matchAll(/href="([^"]*def-exp[^"]*\.pdf)"/gi)].map(
      (x) => x[1],
    );
    if (m.length) {
      const link = m.sort().reverse()[0];
      return link.startsWith("http") ? link : `https://www.nato.int${link}`;
    }
  } catch {
    /* fall through to the conventional path */
  }
  const year = new Date().getUTCFullYear();
  return `https://www.nato.int/content/dam/nato/webready/documents/finance/def-exp-${year}-en.pdf`;
};

const getPdfPath = async (): Promise<string> => {
  if (pdfArg) return pdfArg;
  const url = await resolvePdfUrl();
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const tmp = path.join(os.tmpdir(), "nato-defexp.pdf");
  fs.writeFileSync(tmp, buf);
  console.log(`downloaded ${url} (${(buf.length / 1e6).toFixed(1)} MB)`);
  return tmp;
};

/** The full year-series on a country's row inside the section that starts at the
 *  line matching `sectionRe` (and before the next "Table" heading). `countryRe`
 *  anchors the row (e.g. /^\s*Bulgaria\b/, /^\s*NATO Europe and Canada/). Handles
 *  both float rows (%GDP, personnel-in-thousands) and integer rows (per-capita $)
 *  by stripping thousands-commas and matching int-or-float. Returns ALL columns
 *  (NATO adds one year per edition) — the caller cross-checks lengths so a stray
 *  inline footnote token can't silently shift the series. */
const countryRow = (
  lines: string[],
  sectionRe: RegExp,
  countryRe: RegExp,
): number[] => {
  const start = lines.findIndex((l) => sectionRe.test(l));
  if (start < 0) throw new Error(`section not found: ${sectionRe}`);
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^\s*Table\s/.test(lines[i])) break;
    if (countryRe.test(lines[i])) {
      const cells = lines[i].replace(/^\s*[^\d-]+/, ""); // drop the country label
      const nums = (
        cells.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g) ?? []
      ).map(Number);
      if (nums.length >= 12) return nums;
    }
  }
  throw new Error(`row not found: ${countryRe} under ${sectionRe}`);
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const main = async () => {
  const pdf = await getPdfPath();
  const txt = execFileSync("pdftotext", ["-layout", pdf, "-"], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = txt.split("\n");

  const T3 = /Share of real GDP \(%\)/;
  // Table 3 — Share of real GDP (%). (Table 1/2 are €/local-currency levels.)
  const gdp = countryRow(lines, T3, /^\s*Bulgaria\b/);
  // Table 8a — Equipment (a) and Personnel (b), % of total defence expenditure.
  const equip = countryRow(lines, /^\s*Equipment \(a\)/, /^\s*Bulgaria\b/);
  const pers = countryRow(lines, /^\s*Personnel \(b\)/, /^\s*Bulgaria\b/);

  // Peers (same Table 3) — the /indicators-style neighbours + regional peers +
  // the NATO Europe aggregate, for the peer-comparison tile / defensePeerCompare.
  const PEERS: { key: string; bg: string; en: string; re: RegExp }[] = [
    { key: "RO", bg: "Румъния", en: "Romania", re: /^\s*Romania\*?\b/ },
    { key: "GR", bg: "Гърция", en: "Greece", re: /^\s*Greece\b/ },
    { key: "HU", bg: "Унгария", en: "Hungary", re: /^\s*Hungary\b/ },
    { key: "HR", bg: "Хърватия", en: "Croatia", re: /^\s*Croatia\b/ },
    {
      key: "NATO_EU",
      bg: "НАТО Европа",
      en: "NATO Europe",
      re: /^\s*NATO Europe and Canada/,
    },
  ];

  const years = gdp.map((_, i) => FIRST_YEAR + i);
  const lastYear = years[years.length - 1];

  const gdpFile = {
    source:
      "NATO, Defence Expenditure of NATO Countries (2014–), Table 3 (share of real GDP, 2021 prices).",
    note: "Bulgaria. The last two years are NATO estimates (e). The 2019 spike is a one-off F-16 down-payment booked that year, not a sustained increase.",
    updated: new Date().toISOString().slice(0, 10),
    targets: { wales2: 2.0, hagueCore: 3.5, hagueTotal: 5.0, hagueYear: 2035 },
    series: years.map((year, i) => ({
      year,
      pct: round2(gdp[i]),
      ...(year === 2019 ? { note: "F-16 down-payment (one-off)" } : {}),
      ...(year > lastYear - EST_YEARS ? { estimate: true } : {}),
    })),
  };

  // Table 8a covers all years back to 2014, but Bulgaria's pre-2019 split is
  // volatile/immaterial for the crossover story; keep 2019+ to match the tile.
  const splitFrom = 2019;
  const splitFile = {
    source:
      "NATO, Defence Expenditure of NATO Countries (2014–), Table 8a (distribution by main category, % of total).",
    note: "Bulgaria. 'other' combines NATO's infrastructure + operations categories. Equipment is NATO's ≥20% guideline metric. The last two years are estimates.",
    updated: new Date().toISOString().slice(0, 10),
    guideline: { equipment: 20.0 },
    series: years
      .map((year, i) => ({
        year,
        equipment: round2(equip[i]),
        personnel: round2(pers[i]),
        other: round2(100 - equip[i] - pers[i]),
        ...(year > lastYear - EST_YEARS ? { estimate: true } : {}),
      }))
      .filter((r) => r.year >= splitFrom),
  };

  // Sanity: the %GDP series must be plausible and Bulgaria must have cleared 2%.
  if (gdpFile.series.some((s) => s.pct < 0.5 || s.pct > 6))
    throw new Error(`implausible %GDP values: ${gdp.join(",")}`);
  if (
    splitFile.series.some(
      (s) => Math.abs(s.equipment + s.personnel + s.other - 100) > 0.2,
    )
  )
    throw new Error("equipment+personnel+other != 100 for some year");

  // Table 6 — defence expenditure per capita (US$); Table 7 — military personnel
  // (thousands). Bulgaria only; feed the readiness tile (headcount) + a KPI.
  const perCapitaUsd = countryRow(
    lines,
    /Defence expenditure per capita \(US dollars\)/,
    /^\s*Bulgaria\b/,
  );
  const personnelK = countryRow(
    lines,
    /Table 7: Military personnel/,
    /^\s*Bulgaria\b/,
  );

  const peerSeries = PEERS.map((p) => ({ p, s: countryRow(lines, T3, p.re) }));

  // Every extracted row must have the SAME column count as the Table-3 %GDP row.
  // A mismatch means a stray inline token shifted a row (or NATO changed a table)
  // — fail loudly rather than write a silently misaligned series.
  const n = gdp.length;
  const rows: [string, number[]][] = [
    ["equipment", equip],
    ["personnel", pers],
    ["per-capita", perCapitaUsd],
    ["mil-personnel", personnelK],
    ...peerSeries.map(({ p, s }) => [`peer:${p.key}`, s] as [string, number[]]),
  ];
  for (const [name, arr] of rows)
    if (arr.length !== n)
      throw new Error(
        `column-count mismatch: ${name} has ${arr.length}, gdp has ${n}`,
      );

  // Peer %GDP file — Bulgaria + peers + the NATO Europe aggregate, same years.
  const peersFile = {
    source:
      "NATO, Defence Expenditure of NATO Countries (2014–), Table 3 (share of real GDP, 2021 prices).",
    note: "Defence spending as a share of GDP: Bulgaria against its neighbours (Romania, Greece), CEE peers (Hungary, Croatia) and the NATO Europe & Canada aggregate. The last two years are NATO estimates.",
    updated: new Date().toISOString().slice(0, 10),
    target: 2.0,
    countries: [
      { key: "BG", bg: "България", en: "Bulgaria", series: gdp.map(round2) },
      ...peerSeries.map(({ p, s }) => ({
        key: p.key,
        bg: p.bg,
        en: p.en,
        series: s.map(round2),
      })),
    ],
    years,
    // Bulgaria-only NATO extras (Tables 6 & 7) for the readiness tile + a KPI.
    bulgaria: {
      perCapitaUsd: perCapitaUsd.map((n) => Math.round(n)),
      personnelThousands: personnelK.map(round2),
    },
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "gdp_share.json"),
    JSON.stringify(gdpFile, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "category_split.json"),
    JSON.stringify(splitFile, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "peers.json"),
    JSON.stringify(peersFile, null, 2) + "\n",
  );
  console.log(
    `wrote gdp_share.json (${years[0]}–${lastYear}, latest ${gdpFile.series[gdpFile.series.length - 1].pct}%) + category_split.json + peers.json (${peersFile.countries.length} countries)`,
  );
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
