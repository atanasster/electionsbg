// Reproducible build of data/judiciary/court_load.json — the ДЕЙСТВИТЕЛНА
// натовареност (actual workload: cases per judge per month) of EACH individual
// court, geolocated. This is the per-court grain the /judiciary caseload.json
// (six aggregate tiers) does not carry, and the input to the court-load map.
//
// Source: the ВСС annual PDFs, **Приложение № 2 „Таблица за натовареността на
// магистратите в съдилищата"** — one row per court, both натовареност по щат and
// действителна натовареност, for постъпили / за разглеждане / свършени per judge
// per month. The same PDFs the caseload ingest already fetches (raw_data/judiciary).
//
// Why this parse is robust despite the table's quirks (unspaced counts that weld
// into the name cell; a trailing administration block whose width differs by tier):
// each court row is reduced to its numeric sequence and anchored on the RIGHTMOST
// integer that is immediately preceded by the действителна triple — and за
// разглеждане is always the largest of the three, which disambiguates the anchor
// from the administration ratios that follow. That integer is the court's judge
// count; the three decimals before it are the map's indicators.
//
// Reconciliation asserted at ingest (a bad parse throws, never silently ships):
//   - each tier's block opens with a subtotal row naming the tier; Σ(court judges)
//     in the block == that subtotal's judges == caseload.json tier.judges
//   - the subtotal row's own действителна triple == caseload.json tier.actualLoad*
// so both the row anchor AND the tier assignment are checked against a series we
// already trust.
//
// Run (uses PDFs cached by __write_caseload.ts; run that first if raw_data is empty):
//   npx tsx scripts/judiciary/__write_court_load.ts

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { VSS_ANNUAL_TABLES, VSS_STATS_PAGE } from "./sources";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const pdfjs = require("pdfjs-dist") as any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/judiciary");
const OUT_DIR = path.resolve(__dirname, "../../data/judiciary");
const OUT = path.join(OUT_DIR, "court_load.json");
const CASELOAD = path.join(OUT_DIR, "caseload.json");
const SETTLEMENTS = path.resolve(__dirname, "../../data/settlements.json");

// ------------------------------------------------------------- pdf → cells ---

interface Item {
  s: string;
  x: number;
  y: number;
  w: number;
}

const pageRows = async (page: any): Promise<Item[][]> => {
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
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, its]) => its.sort((a, b) => a.x - b.x));
};

const SPACES = /[\u0020\u00a0\u2007\u2009\u202f]/g;

/** Permissive number reader for Приложение № 2: a plain integer ("6024"), a
 *  space-grouped thousand ("89 793") or a decimal with a dot or comma. The
 *  caseload parser deliberately rejects unspaced integers to guard column drift;
 *  here we WANT them, because the counts in this table are often printed unspaced
 *  and weld into adjacent text. */
const num = (raw: string): number | null => {
  const t = raw.trim().replace(SPACES, " ").replace(/%$/, "");
  if (!/^\d{1,3}(?: \d{3})+([.,]\d+)?$/.test(t) && !/^\d+([.,]\d+)?$/.test(t))
    return null;
  return parseFloat(t.replace(/ /g, "").replace(",", "."));
};

/** Split a row into {hasIndex, name, nums}. A court row opens with an integer
 *  index (its own token); a tier subtotal row opens directly with the tier name.
 *  The name is the run of non-numeric tokens after any leading index; `nums` are
 *  every numeric token after the index (including counts welded next to the name),
 *  so the column sequence the anchor scans is complete. */
interface Row {
  hasIndex: boolean;
  name: string;
  nums: number[];
}
const parseRow = (its: Item[]): Row => {
  const toks = its.flatMap((it) => it.s.split(/\s+/)).filter((t) => t.length);
  const hasIndex = /^\d+$/.test(toks[0] ?? "");
  const body = hasIndex ? toks.slice(1) : toks;
  const nameToks: string[] = [];
  let i = 0;
  while (i < body.length && num(body[i]) === null) nameToks.push(body[i++]);
  const name = nameToks.join(" ").replace(/\s+/g, " ").trim();
  const nums = body.map(num).filter((v): v is number => v !== null);
  return { hasIndex, name, nums };
};

// ---------------------------------------------------------------- parsing ---

// The 26 oblast-capital towns (Sofia is the СРС, handled separately). A районен
// court in one of these is `rs_oblast` (районни в областните центрове); every other
// районен is `rs_izvan`. This mirrors the ВСС's own split and is stable — the seats
// of the 28 oblasti do not move — so it replaces the wrapping section headers the
// PDF prints, which cannot be read reliably.
const OBLAST_CAPITALS = new Set([
  "Благоевград",
  "Бургас",
  "Варна",
  "Велико Търново",
  "Видин",
  "Враца",
  "Габрово",
  "Добрич",
  "Кърджали",
  "Кюстендил",
  "Ловеч",
  "Монтана",
  "Пазарджик",
  "Перник",
  "Плевен",
  "Пловдив",
  "Разград",
  "Русе",
  "Силистра",
  "Сливен",
  "Смолян",
  "Стара Загора",
  "Търговище",
  "Хасково",
  "Шумен",
  "Ямбол",
]);

/** Map a court name to its tier. The naming scheme is unambiguous: appellate is
 *  "АС - X" (plus the Военно-апелативен съд, which the ВСС counts in the appellate
 *  tier); military "ВС - X"; district "ОС - X" and the СГС; administrative "АдмС X";
 *  районни "РС - X" and the СРС, split by the oblast-capital set. */
// A court abbreviation as a standalone token — used to trim a header phrase that a
// neighbouring line occasionally bleeds onto a court row (e.g. 2018's
// "Апелативни съдилища РС - Перник"). Longest abbreviations first so АСНС is not cut
// to АС. The lookahead keeps it a whole token, never a substring of a word.
const COURT_TOKEN =
  /(?:^|\s)(АСНС|СНС|СГС|СРС|АдмС|Военно[-\s]?апелативен|АС|ОС|ВС|РС)(?=\s|[-–—]|$)/;
const cleanName = (name: string): string => {
  const m = name.match(COURT_TOKEN);
  if (!m || m.index === undefined) return name;
  return name.slice(m.index + m[0].length - m[1].length).trim();
};

const tierOfCourt = (name: string): string | null => {
  // NB: \b is an ASCII word boundary and does NOT fire after a Cyrillic letter, so
  // the bare-abbreviation tiers (СГС/СРС/АдмС) are matched by prefix, not \b.
  if (/^Военно[-\s]?апелативен/i.test(name)) return "apelativni";
  // АСНС / СНС — the specialised criminal courts (appellate / district level),
  // dissolved in 2022; the ВСС counts them in those tiers for 2018–2021.
  if (/^АСНС/.test(name)) return "apelativni";
  if (/^СНС/.test(name)) return "okrazhni";
  if (/^АС\s*[-–—]/.test(name)) return "apelativni";
  if (/^ВС\s*[-–—]/.test(name)) return "voenni";
  if (/^АдмС/.test(name)) return "administrativni";
  if (/^ОС\s*[-–—]/.test(name) || /^СГС/.test(name)) return "okrazhni";
  if (/^СРС/.test(name)) return "rs_oblast";
  if (/^РС\s*[-–—]/.test(name)) {
    const town = name.replace(/^РС\s*[-–—]\s*/, "").trim();
    return OBLAST_CAPITALS.has(town) ? "rs_oblast" : "rs_izvan";
  }
  return null;
};

export interface CourtLoad {
  name: string;
  tier: string;
  place: string | null;
  loc: [number, number] | null; // [lng, lat]
  judges: number;
  /** Отработени човеко-месеци — the denominator of действителна натовареност. */
  personMonths: number;
  /** ДЕЙСТВИТЕЛНА натовареност — cases per judge per month. */
  filedPerMonth: number;
  considerPerMonth: number;
  resolvedPerMonth: number;
}

/** Anchor the действителна triple + judges inside a court row's numeric sequence.
 *  Return {judges, triple:[filed,consider,resolved]} or null if no valid anchor.
 *
 *  Scans right→left and returns the first integer j (the judge count) preceded by a
 *  valid ДЕЙСТВИТЕЛНА-натовареност triple. "Valid" is pinned by the physics of the
 *  three columns, which separates the load block both from the case COUNTS before it
 *  and the administration RATIOS after it:
 *    - за разглеждане (middle) is the largest — it is pending + filed;
 *    - and за разглеждане ≤ (постъпили + свършени)·1.5 — the backlog per month is
 *      never a large multiple of the flow, which rejects the artifact where the
 *      judge count itself leaks into the middle slot (e.g. (0.82, 6, 2));
 *    - постъпили ≈ свършени (a court resolves roughly what arrives), within 3×;
 *    - loads are small (≤300 cases/judge/month), never a raw count. */
interface Anchor {
  judges: number;
  personMonths: number;
  filed: number;
  consider: number;
  resolved: number;
}
const anchor = (n: number[]): Anchor | null => {
  for (let j = n.length - 1; j >= 4; j--) {
    const judges = n[j];
    if (!Number.isInteger(judges) || judges < 1) continue;
    const filed = n[j - 3];
    const consider = n[j - 2];
    const resolved = n[j - 1];
    // Отработени човеко-месеци sits immediately before the действителна triple in
    // every tier's layout, and is the ВСС's own denominator for it — so it lets us
    // reconcile загруз exactly, independent of the judge-count accounting.
    const personMonths = n[j - 4];
    if (![filed, consider, resolved, personMonths].every((v) => v > 0))
      continue;
    if (consider < filed || consider < resolved) continue; // за разглеждане largest
    if (consider > 300) continue; // a load, not a case count
    if (consider > (filed + resolved) * 1.5) continue; // backlog ≉ multiple of flow
    const ratio = filed / resolved;
    if (ratio < 1 / 3 || ratio > 3) continue; // постъпили ≈ свършени
    if (personMonths < judges) continue; // each judge works whole months
    // Lock the triple to the ВСС's own definition: действителна натовареност =
    // case count ÷ отработени човеко-месеци. So the row must carry an integer count
    // C with C / personMonths ≈ the printed load — true for the real load block,
    // false for the administration ratios (5, 3, 2 …) that otherwise pass every
    // structural test on the tiny районни and mis-anchor to the right of it.
    const hasCount = (load: number): boolean =>
      n.some(
        (v) =>
          Number.isInteger(v) &&
          Math.abs(v / personMonths - load) <= Math.max(0.03, 0.015 * load),
      );
    if (!hasCount(resolved) || !hasCount(filed)) continue;
    return { judges, personMonths, filed, consider, resolved };
  }
  return null;
};

// ------------------------------------------------------------- geocoding ---

interface Settlement {
  name: string;
  t_v_m: string;
  loc: string;
}
let CITY_LOC: Map<string, [number, number]> | null = null;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const cityLoc = (): Map<string, [number, number]> => {
  if (CITY_LOC) return CITY_LOC;
  const list: Settlement[] = JSON.parse(fs.readFileSync(SETTLEMENTS, "utf8"));
  CITY_LOC = new Map();
  for (const s of list) {
    if (s.t_v_m !== "гр.") continue; // courts sit in towns, never villages
    const [lng, lat] = s.loc.split(",").map(Number);
    // Case-insensitive key: the register lower-cases the second word ("Нови пазар")
    // while the court name title-cases it ("Нови Пазар").
    if (
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      !CITY_LOC.has(norm(s.name))
    )
      CITY_LOC.set(norm(s.name), [lng, lat]);
  }
  // Sofia (the capital) is not a settlement row in settlements.json; pin its centre.
  CITY_LOC.set("софия", [23.3219, 42.6977]);
  return CITY_LOC;
};

/** Court name → its town. "АС - София"/"СГС"/"СРС" → "София"; "АдмС Пловдив" (space,
 *  no dash) → "Пловдив"; "РС - Нови Пазар" (dash) → "Нови Пазар". */
const placeOf = (name: string): string | null => {
  if (/София/.test(name)) return "София"; // АдмС София-град/-област, ОС/АС - София
  if (/^(СГС|СРС|СНС|АСНС|Военно)/.test(name)) return "София"; // Sofia, no "София" token
  // Dash form first ("АС - Пловдив", "АдмС - Перник" in 2018), then the no-dash
  // administrative form of recent years ("АдмС Пловдив").
  const dash = name.match(/[-–—]\s*(.+)$/);
  if (dash) return dash[1].replace(/\s+/g, " ").trim();
  const adm = name.match(/^АдмС\s+(.+)$/);
  if (adm) return adm[1].replace(/\s+/g, " ").trim();
  return null;
};

const geocode = (
  name: string,
): { place: string | null; loc: [number, number] | null } => {
  const place = placeOf(name);
  if (!place) return { place: null, loc: null };
  const loc = cityLoc().get(norm(place)) ?? null;
  return { place, loc };
};

// ---------------------------------------------------------------- per year ---

interface TierTarget {
  personMonths: number;
  actToc: number;
  actRes: number;
}

const parseYear = async (
  bytes: Uint8Array,
  year: number,
  targets: Record<string, TierTarget>,
): Promise<CourtLoad[]> => {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false })
    .promise;

  const courts: CourtLoad[] = [];
  let inTable = false;

  for (let p = 1; p <= doc.numPages; p++) {
    const rows = await pageRows(await doc.getPage(p));
    const flat = rows.map((r) => r.map((i) => i.s).join(" ")).join(" ");

    // The per-court table (Приложение № 2) opens with its title AND the first
    // appellate court on the same page; it closes at the next appendix. Bounding
    // by page is essential — later appendices carry per-court rows with the SAME
    // names, and must not be swept in.
    if (
      !inTable &&
      /натовареността на магистратите/i.test(flat) &&
      /АС\s*[-–—]\s*София/.test(flat)
    )
      inTable = true;
    if (!inTable) {
      if (p > 40) break; // Приложение № 2 always sits in the front matter
      continue;
    }
    if (/Приложение\s*№?\s*3\b/.test(flat) || /Отчет за дейността/i.test(flat))
      break;

    for (const its of rows) {
      const parsed = parseRow(its);
      if (!parsed.hasIndex || !parsed.name) continue; // subtotal / header / total
      const nums = parsed.nums;
      const name = cleanName(parsed.name);
      const tier = tierOfCourt(name);
      if (!tier) continue;
      const a = anchor(nums);
      if (!a) continue;
      const { place, loc } = geocode(name);
      courts.push({
        name,
        tier,
        place,
        loc,
        judges: a.judges,
        personMonths: a.personMonths,
        filedPerMonth: a.filed,
        considerPerMonth: a.consider,
        resolvedPerMonth: a.resolved,
      });
    }
  }

  if (!courts.length) throw new Error(`${year}: no court rows parsed`);

  // ---- reconciliation --------------------------------------------------
  // Hard gate, per tier: Σ(person-months) and the person-month-weighted действителна
  // натовареност must match caseload.json — the ВСС's own definitions, so both hold
  // to within rounding. This gates EXACTLY what the map shows (per-court loads and
  // their denominator), and does not depend on the judge count, whose щат-vs-заети /
  // младши-съдия accounting differs from caseload's basis by a few posts per tier.
  const rel = (a: number, b: number) =>
    b === 0 ? (a === 0 ? 0 : 1) : Math.abs(a - b) / b;
  for (const [tier, tgt] of Object.entries(targets)) {
    const inTier = courts.filter((c) => c.tier === tier);
    if (!inTier.length)
      throw new Error(`${year}/${tier}: no courts classified into this tier`);
    const pmSum = inTier.reduce((s, c) => s + c.personMonths, 0);
    if (rel(pmSum, tgt.personMonths) > 0.01)
      throw new Error(
        `${year}/${tier}: Σ person-months ${pmSum.toFixed(1)} != caseload ${tgt.personMonths} — rows mis-anchored or a court mis-tiered`,
      );
    const wRes =
      inTier.reduce((s, c) => s + c.resolvedPerMonth * c.personMonths, 0) /
      pmSum;
    const wToc =
      inTier.reduce((s, c) => s + c.considerPerMonth * c.personMonths, 0) /
      pmSum;
    if (rel(wRes, tgt.actRes) > 0.02 || rel(wToc, tgt.actToc) > 0.02)
      throw new Error(
        `${year}/${tier}: weighted действителна load (${wToc.toFixed(2)}/${wRes.toFixed(2)}) != caseload (${tgt.actToc}/${tgt.actRes}) — triple mis-slid`,
      );
  }

  return courts;
};

// ------------------------------------------------------------------- main ---

const fetchPdf = (year: number, url: string): Uint8Array => {
  const key = createHash("sha1").update(url).digest("hex").slice(0, 8);
  const file = path.join(RAW_DIR, `tables-${year}-${key}.pdf`);
  if (!fs.existsSync(file))
    throw new Error(
      `${year}: ${file} missing — run scripts/judiciary/__write_caseload.ts first to cache the PDFs`,
    );
  return new Uint8Array(fs.readFileSync(file));
};

const main = async (): Promise<void> => {
  const caseload = JSON.parse(fs.readFileSync(CASELOAD, "utf8"));
  const targetsByYear: Record<number, Record<string, TierTarget>> = {};
  for (const y of caseload.years) {
    const map: Record<string, TierTarget> = {};
    for (const t of y.tiers)
      map[t.id] = {
        personMonths: t.personMonths,
        actToc: t.actualLoadToConsider,
        actRes: t.actualLoadResolved,
      };
    targetsByYear[y.year] = map;
  }

  const allowPartial = process.argv.includes("--allow-partial");
  const years: { year: number; courts: CourtLoad[] }[] = [];
  const failed: number[] = [];
  for (const [yStr, url] of Object.entries(VSS_ANNUAL_TABLES)) {
    const year = Number(yStr);
    const targets = targetsByYear[year];
    if (!targets) {
      console.warn(`${year}: no caseload targets — skipping`);
      continue;
    }
    try {
      const courts = await parseYear(fetchPdf(year, url), year, targets);
      years.push({ year, courts });
    } catch (err) {
      console.error(`FAILED ${year}: ${(err as Error).message}`);
      failed.push(year);
    }
  }
  if (!years.length) throw new Error("no court-load years parsed");
  if (failed.length && !allowPartial)
    throw new Error(
      `${failed.length} year(s) failed (${failed.join(", ")}) — refusing partial write. Fix the parser or pass --allow-partial.`,
    );
  years.sort((a, b) => b.year - a.year);

  // Geocoding coverage — surfaced, never silent (a court with no coords is dropped
  // from the map, so the operator must see how many).
  const latest = years[0];
  const missing = latest.courts.filter((c) => !c.loc);
  if (missing.length)
    console.warn(
      `${latest.year}: ${missing.length}/${latest.courts.length} courts un-geocoded: ${missing
        .map((c) => c.name)
        .slice(0, 20)
        .join(", ")}`,
    );

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Висш съдебен съвет",
      url: VSS_STATS_PAGE,
      description:
        "Приложение № 2 „Таблица за натовареността на магистратите в съдилищата“ — действителна натовареност (постъпили / за разглеждане / свършени дела на съдия месечно) по съд.",
    },
    latestYear: latest.year,
    years,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log(`\nwrote ${OUT} — ${years.length} years`);
  for (const y of [...years].reverse()) {
    const geo = y.courts.filter((c) => c.loc).length;
    console.log(
      `${y.year}: ${y.courts.length} courts (${geo} geocoded), ` +
        `busiest: ${[...y.courts]
          .sort((a, b) => b.resolvedPerMonth - a.resolvedPerMonth)
          .slice(0, 3)
          .map((c) => `${c.name} ${c.resolvedPerMonth}`)
          .join(", ")}`,
    );
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
