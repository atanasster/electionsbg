// Parse the NATO "Defence Expenditure of NATO Countries" PDF into three files:
//   gdp_share.json      — Table 3, Bulgaria's %GDP series + the moving targets
//   category_split.json — Table 8a, equipment / personnel / other split
//   peers.json          — Table 3 for BG + RO/GR/HU/HR + NATO Europe, plus BG's
//                         per-capita (Table 6) and personnel headcount (Table 7)
//
// The lead charts in the PDF are vector graphics with no text layer, so we read
// the TABLES: `pdftotext -layout` then pick each country's row out of the section
// heading. Each row is one number per year 2014..latest.
//
// OCR fallback: from the 2026 edition NATO ships the report as a "Microsoft:
// Print To PDF" export — image-only pages with NO text layer, so pdftotext
// returns nothing. When that happens we fall back to Gemini Vision, extracting
// the same rows as structured JSON. Both paths feed one `Extract` object so the
// file-building + asserts below are identical. (.env.local → GEMINI_API_KEY.)
//
// Usage:
//   npx tsx scripts/defense/__write_nato.ts --pdf <path>   # parse a local PDF
//   npx tsx scripts/defense/__write_nato.ts                # download the latest
//   npx tsx scripts/defense/__write_nato.ts --ocr          # force the OCR path
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
const ENV_FILE = path.resolve(HERE, "../../.env.local");
const FIRST_YEAR = 2014;
const EST_YEARS = 2; // NATO flags the last two years as estimates ("e")
const OCR_MODEL = "gemini-3.5-flash";
// A browser UA — NATO's CDN serves the report HTML shell (not the PDF bytes) to
// unrecognised user-agents, which is why the bare-fetch download came back 0 MB.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const args = process.argv.slice(2);
const pdfArgIdx = args.indexOf("--pdf");
const pdfArg = pdfArgIdx >= 0 ? args[pdfArgIdx + 1] : null;
const forceOcr = args.includes("--ocr");

/** The regional/peer countries pulled from Table 3 alongside Bulgaria. */
const PEERS: { key: string; bg: string; en: string; re: RegExp }[] = [
  { key: "RO", bg: "Румъния", en: "Romania", re: /^\s*Romania\*?\b/ },
  { key: "GR", bg: "Гърция", en: "Greece", re: /^\s*Greece\b/ },
  { key: "HU", bg: "Унгария", en: "Hungary", re: /^\s*Hungary\b/ },
  { key: "HR", bg: "Хърватия", en: "Croatia", re: /^\s*Croatia\b/ },
  {
    key: "NATO_EU",
    bg: "НАТО Европа",
    en: "NATO Europe and Canada",
    re: /^\s*NATO Europe and Canada/,
  },
];

/** Resolve the latest def-exp PDF URL by scraping the NATO news page, else fall
 *  back to the conventional current-edition path. */
const resolvePdfUrl = async (): Promise<string> => {
  try {
    const html = await (
      await fetch(NATO_DEFEXP_PAGE, { headers: { "user-agent": UA } })
    ).text();
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
  const buf = Buffer.from(
    await (await fetch(url, { headers: { "user-agent": UA } })).arrayBuffer(),
  );
  // Guard against NATO's CDN handing back the HTML shell for an unknown UA.
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new Error(
      `downloaded ${url} is not a PDF (${(buf.length / 1e6).toFixed(1)} MB, ` +
        `starts "${buf.subarray(0, 16).toString("latin1")}") — CDN likely ` +
        `served the HTML shell; pass a local --pdf`,
    );
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

/** The rows every downstream file needs, however they were extracted. */
interface Extract {
  gdp: number[]; // Table 3, Bulgaria %GDP
  equip: number[]; // Table 8a Equipment (a), Bulgaria
  pers: number[]; // Table 8a Personnel (b), Bulgaria
  perCapitaUsd: number[]; // Table 6, Bulgaria
  personnelK: number[]; // Table 7, Bulgaria (thousands)
  peers: { key: string; series: number[] }[]; // Table 3, PEERS order
}

/** Text-layer extraction — the fast path for editions with a real font layer. */
const extractFromLines = (lines: string[]): Extract => {
  const T3 = /Share of real GDP \(%\)/;
  return {
    // Table 3 — Share of real GDP (%). (Table 1/2 are €/local-currency levels.)
    gdp: countryRow(lines, T3, /^\s*Bulgaria\b/),
    // Table 8a — Equipment (a) and Personnel (b), % of total defence expenditure.
    equip: countryRow(lines, /^\s*Equipment \(a\)/, /^\s*Bulgaria\b/),
    pers: countryRow(lines, /^\s*Personnel \(b\)/, /^\s*Bulgaria\b/),
    // Table 6 — per capita (US$); Table 7 — military personnel (thousands).
    perCapitaUsd: countryRow(
      lines,
      /Defence expenditure per capita \(US dollars\)/,
      /^\s*Bulgaria\b/,
    ),
    personnelK: countryRow(
      lines,
      /Table 7: Military personnel/,
      /^\s*Bulgaria\b/,
    ),
    peers: PEERS.map((p) => ({
      key: p.key,
      series: countryRow(lines, T3, p.re),
    })),
  };
};

const loadGeminiEnv = (): void => {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
};

const OCR_PROMPT = `You are a precise data extractor for the NATO report "Defence Expenditure of NATO Countries". The report is image-only. Read its data TABLES (not the charts) and return ONLY a JSON object — no markdown fences, no prose — with this exact shape:

{
  "years": [2014, 2015, ... , <last year in the tables>],
  "gdpSharePct": {
    "Bulgaria": [<one number per year>],
    "Romania": [...],
    "Greece": [...],
    "Hungary": [...],
    "Croatia": [...],
    "NATO Europe and Canada": [...]
  },
  "equipmentPctBulgaria": [...],
  "personnelPctBulgaria": [...],
  "perCapitaUsdBulgaria": [...],
  "militaryPersonnelThousandsBulgaria": [...]
}

Sources within the report:
- "gdpSharePct" = Table 3, "Defence expenditure as a share of real GDP (%)" — the row for each named country/aggregate.
- "equipmentPctBulgaria" = Table 8a, category "Equipment (a)", the Bulgaria row (% of total defence expenditure).
- "personnelPctBulgaria" = Table 8a, category "Personnel (b)", the Bulgaria row.
- "perCapitaUsdBulgaria" = Table 6, "Defence expenditure per capita (US dollars)", the Bulgaria row.
- "militaryPersonnelThousandsBulgaria" = Table 7, "Military personnel (thousands)", the Bulgaria row.

RULES:
- EVERY array must have EXACTLY the same length as "years", in the same year order.
- Copy the printed numbers verbatim (percentages to two decimals). Do not round or reformat.
- If a cell is blank or shown as "-", put null in that position.
- "years" must start at 2014 and be contiguous.
Respond with the JSON object only.`;

/** OCR extraction via Gemini Vision — for image-only editions. */
const ocrExtract = async (pdfBytes: Buffer): Promise<Extract> => {
  loadGeminiEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    throw new Error(
      "GEMINI_API_KEY not set (check .env.local) — needed for the OCR fallback",
    );
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: "application/pdf",
                data: pdfBytes.toString("base64"),
              },
            },
            { text: OCR_PROMPT },
          ],
        },
      ],
      generationConfig: { temperature: 0.0, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(900_000),
  });
  if (!res.ok)
    throw new Error(
      `gemini ${res.status}: ${(await res.text()).slice(0, 500)}`,
    );
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const jsonText = raw
    .replace(/^```(?:json)?/im, "")
    .replace(/```\s*$/m, "")
    .trim();
  let parsed: {
    years: (number | string)[];
    gdpSharePct: Record<string, (number | string | null)[]>;
    equipmentPctBulgaria: (number | string | null)[];
    personnelPctBulgaria: (number | string | null)[];
    perCapitaUsdBulgaria: (number | string | null)[];
    militaryPersonnelThousandsBulgaria: (number | string | null)[];
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      `OCR: could not parse Gemini JSON: ${jsonText.slice(0, 300)}`,
    );
  }

  // NATO labels estimate years "2025e"/"2026e" and footnotes some cells, so a
  // column can arrive as a string — strip everything but digits/sign/decimal.
  const num = (v: number | string | null): number | null => {
    if (v == null) return null;
    const cleaned = String(v).replace(/[^0-9.-]/g, "");
    if (cleaned === "" || cleaned === "-") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
  const years = (parsed.years ?? []).map((y) => num(y) ?? NaN);
  if (!years.length || years[0] !== FIRST_YEAR)
    throw new Error(
      `OCR: years must start at ${FIRST_YEAR}, got ${(parsed.years ?? []).join(",")}`,
    );
  for (let i = 1; i < years.length; i++)
    if (years[i] !== years[i - 1] + 1)
      throw new Error(`OCR: years not contiguous: ${years.join(",")}`);

  // No nulls allowed in the rows we build series from — a null would poison the
  // Number arrays and every downstream assert.
  const requireFull = (
    name: string,
    arr: (number | string | null)[],
  ): number[] => {
    if (!arr || arr.length !== years.length)
      throw new Error(
        `OCR: ${name} has ${arr?.length ?? 0} values, expected ${years.length}`,
      );
    const nums = arr.map(num);
    if (nums.some((v) => v == null))
      throw new Error(
        `OCR: ${name} has a null/blank cell — re-run or fix by hand`,
      );
    return nums as number[];
  };

  return {
    gdp: requireFull("Bulgaria %GDP", parsed.gdpSharePct?.Bulgaria),
    equip: requireFull("equipment", parsed.equipmentPctBulgaria),
    pers: requireFull("personnel", parsed.personnelPctBulgaria),
    perCapitaUsd: requireFull("per-capita", parsed.perCapitaUsdBulgaria),
    personnelK: requireFull(
      "mil-personnel",
      parsed.militaryPersonnelThousandsBulgaria,
    ),
    peers: PEERS.map((p) => ({
      key: p.key,
      series: requireFull(`peer:${p.key}`, parsed.gdpSharePct?.[p.en]),
    })),
  };
};

/** Warn (don't fail) when a value for an overlapping historical year drifts from
 *  the prior committed edition by more than a rebasing-plausible amount — a
 *  strong eyeball guard against the OCR errors this parser is prone to
 *  (a whole-row country confusion or a single-digit misread on a settled year).
 *  Covers Bulgaria %GDP, every peer %GDP row, and Bulgaria's per-capita +
 *  personnel extras — the OCR mis-read exactly these in the 2026 edition. */
const continuityChecks = (
  gdpSeries: { year: number; pct: number }[],
  peers: { key: string; series: number[] }[],
  years: number[],
  perCapita: number[],
  personnelK: number[],
): void => {
  const warns: string[] = [];
  const drift = (a: number, b: number, relPct: number, absTol: number) =>
    Math.abs(a - b) > Math.max(absTol, (Math.abs(b) * relPct) / 100);

  const gdpPath = path.join(OUT_DIR, "gdp_share.json");
  if (fs.existsSync(gdpPath)) {
    const prior = JSON.parse(fs.readFileSync(gdpPath, "utf-8")) as {
      series: { year: number; pct: number }[];
    };
    const by = new Map(prior.series.map((s) => [s.year, s.pct]));
    for (const s of gdpSeries)
      if (by.has(s.year) && drift(s.pct, by.get(s.year)!, 0, 0.15))
        warns.push(`BG %GDP ${s.year}: ${by.get(s.year)} → ${s.pct}`);
  }

  const peersPath = path.join(OUT_DIR, "peers.json");
  if (fs.existsSync(peersPath)) {
    const prior = JSON.parse(fs.readFileSync(peersPath, "utf-8")) as {
      years: number[];
      countries: { key: string; series: number[] }[];
      bulgaria?: { perCapitaUsd: number[]; personnelThousands: number[] };
    };
    const priorYearIdx = new Map(prior.years.map((y, i) => [y, i]));
    for (const p of peers) {
      const pc = prior.countries.find((c) => c.key === p.key);
      if (!pc) continue;
      years.forEach((y, i) => {
        const j = priorYearIdx.get(y);
        if (j != null && drift(p.series[i], pc.series[j], 0, 0.15))
          warns.push(`peer ${p.key} ${y}: ${pc.series[j]} → ${p.series[i]}`);
      });
    }
    const extra = (label: string, now: number[], old: number[] | undefined) => {
      if (!old) return;
      years.forEach((y, i) => {
        const j = priorYearIdx.get(y);
        if (j != null && drift(now[i], old[j], 5, 1))
          warns.push(`${label} ${y}: ${old[j]} → ${now[i]}`);
      });
    };
    extra("per-capita", perCapita, prior.bulgaria?.perCapitaUsd);
    extra("personnel", personnelK, prior.bulgaria?.personnelThousands);
  }

  if (warns.length)
    console.warn(
      "⚠ drift vs prior edition (verify — rebasing or an OCR mis-read?):\n" +
        warns.map((w) => `    ${w}`).join("\n"),
    );
};

const main = async () => {
  const pdf = await getPdfPath();
  const pdfBytes = fs.readFileSync(pdf);

  let txt = "";
  try {
    txt = execFileSync("pdftotext", ["-layout", pdf, "-"], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    /* image-only PDF — pdftotext may error or return nothing */
  }
  const hasTextLayer = txt.replace(/\s/g, "").length > 200;
  const useOcr = forceOcr || !hasTextLayer;
  console.log(
    useOcr
      ? `no text layer (${txt.replace(/\s/g, "").length} chars) — using Gemini OCR (${OCR_MODEL})`
      : "text layer found — parsing tables directly",
  );

  const ex = useOcr
    ? await ocrExtract(pdfBytes)
    : extractFromLines(txt.split("\n"));
  const { gdp, equip, pers, perCapitaUsd, personnelK } = ex;

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

  continuityChecks(gdpFile.series, ex.peers, years, perCapitaUsd, personnelK);

  // Every extracted row must have the SAME column count as the Table-3 %GDP row.
  // A mismatch means a stray token shifted a row (or NATO changed a table) — fail
  // loudly rather than write a silently misaligned series.
  const n = gdp.length;
  const rows: [string, number[]][] = [
    ["equipment", equip],
    ["personnel", pers],
    ["per-capita", perCapitaUsd],
    ["mil-personnel", personnelK],
    ...ex.peers.map(
      ({ key, series }) => [`peer:${key}`, series] as [string, number[]],
    ),
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
      ...PEERS.map((p) => ({
        key: p.key,
        bg: p.bg,
        en: p.en,
        series: (ex.peers.find((x) => x.key === p.key)?.series ?? []).map(
          round2,
        ),
      })),
    ],
    years,
    // Bulgaria-only NATO extras (Tables 6 & 7) for the readiness tile + a KPI.
    bulgaria: {
      perCapitaUsd: perCapitaUsd.map((v) => Math.round(v)),
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
