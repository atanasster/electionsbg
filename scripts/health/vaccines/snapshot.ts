// Capture the vaccine sources into their durable copies.
// Plan: docs/plans/vaccines-flow-v1.md §2, T1.5 + T2.1/T2.3.
//
//   pnpm run vaccines:snapshot                 # every part
//   pnpm run vaccines:snapshot --only his,sespa
//
// TWO KINDS OF COPY, by whether the source keeps its own history:
//
//   COMMITTED, append-only JSONL under data/health/vaccines/ — the series no
//   source can give back later. The НЗИС report page shows only today's
//   counter, СЕСПА only this week's list, НЦЗПБ only the last two weeks. A day
//   or week not captured is gone, so these are written from day one, before
//   any table exists.
//
//   CACHED, gitignored under raw_data/health/vaccines/ — the НЗИС monthly set
//   (every fetch carries full history from 2021-01), Comext trade and the
//   Eurostat coverage table. Re-fetchable; only the latest copy is kept.
//
// data/health/vaccines/ is a Postgres LOAD SOURCE, never a served path: it is
// excluded from every bucket upload path (scripts/bucket_sync_paths.ts).
//
// Each part fails on its own: an unreachable СЕСПА must not cost the НЗИС
// counter its day. The run exits non-zero when any part failed.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchText } from "../../watch/fingerprint";
import { HIS_INFOAPP_URL, parseImmunizations } from "./his_infoapp";
import {
  fetchFluCoverage,
  fetchHisReport,
  fetchIncidence,
  fetchSespa,
  fetchVaccineTrade,
  fetchVirology,
  type HisReport,
  type IncidenceWeek,
  type ShortageList,
  type VirologyWeek,
} from "./sources";

export const SNAPSHOT_DIR = "data/health/vaccines";
export const CACHE_DIR = "raw_data/health/vaccines";

export const FILES = {
  daily: "his_daily.jsonl",
  shortage: "shortage_weeks.jsonl",
  flu: "flu_weeks.jsonl",
} as const;

export const CACHE_FILES = {
  infoapp: "his_monthly.json",
  trade: "trade.json",
  coverage: "flu_coverage_eu.json",
} as const;

/** A year-to-date counter may fall slightly when НЗИС withdraws a record;
 *  a fall beyond this (and beyond a handful of doses) is a broken capture. */
export const MAX_COUNTER_FALL = 0.02;
const COUNTER_FALL_FLOOR = 50;

// ------------------------------------------------------------------ JSONL io

export const readJsonl = <T>(file: string): T[] => {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        throw new Error(`${file}:${i + 1} is not valid JSON`);
      }
    });
};

const appendJsonl = (file: string, rows: object[]): void => {
  if (!rows.length) return;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
};

// ------------------------------------------------------------ НЗИС counters

export interface DailyLine {
  fetched_at: string;
  year: number;
  /** "vaccine" (national, key = НЗИС English label) or "district" (all
   *  vaccines, key = ISO BG-NN). */
  scope: "vaccine" | "district";
  key: string;
  n_ytd: number;
  /** The page's own „актуализирани" stamp — the counter's as-of. */
  updated_at: string;
}

/** Lines to append: one per (year, scope, key) whose counter moved since the
 *  last recorded value — runs, not daily copies. Throws on a fall beyond
 *  MAX_COUNTER_FALL rather than recording it. */
export const dailyLinesToAppend = (
  existing: DailyLine[],
  report: HisReport,
  fetchedAt: string,
): DailyLine[] => {
  const last = new Map<string, number>();
  for (const l of existing)
    if (l.year === report.year) last.set(`${l.scope}|${l.key}`, l.n_ytd);
  const updatedAt = [...report.updatedAt].sort().at(-1) ?? "";
  const cells: Array<[DailyLine["scope"], string, number]> = [
    ...report.byVaccine.map(
      (v) =>
        ["vaccine", v.labelEn, v.n] as [DailyLine["scope"], string, number],
    ),
    ...report.byDistrict.map(
      (d) => ["district", d.iso, d.n] as [DailyLine["scope"], string, number],
    ),
  ];
  const out: DailyLine[] = [];
  for (const [scope, key, n] of cells) {
    const prev = last.get(`${scope}|${key}`);
    if (prev === n) continue;
    if (
      prev !== undefined &&
      n < prev &&
      prev - n > COUNTER_FALL_FLOOR &&
      (prev - n) / prev > MAX_COUNTER_FALL
    )
      throw new Error(
        `НЗИС ${report.year} ${scope} ${key}: counter fell ${prev} → ${n} — refusing to record`,
      );
    out.push({
      fetched_at: fetchedAt,
      year: report.year,
      scope,
      key,
      n_ytd: n,
      updated_at: updatedAt,
    });
  }
  return out;
};

// ------------------------------------------------------------------ СЕСПА

export interface ShortageLine {
  fetched_at: string;
  valid_from: string;
  valid_to: string;
  ncpr_code: string;
  name: string;
  inn: string;
  strength: string;
  unit: string;
  form: string;
  pack: string;
  is_vaccine: boolean;
}

/** A window's list is appended whole whenever it differs from the latest
 *  capture of that same window — so a product СЕСПА drops mid-week is recorded
 *  as dropped (the loader reads the latest `fetched_at` per window), not left
 *  standing because its earlier row is still in the file. */
export const shortageLinesToAppend = (
  existing: ShortageLine[],
  list: ShortageList,
  fetchedAt: string,
): ShortageLine[] => {
  let latestAt = "";
  for (const l of existing)
    if (l.valid_from === list.validFrom && l.fetched_at > latestAt)
      latestAt = l.fetched_at;
  const captured = existing
    .filter((l) => l.valid_from === list.validFrom && l.fetched_at === latestAt)
    .map((l) => l.ncpr_code)
    .sort()
    .join(",");
  const current = list.rows
    .map((r) => r.ncprCode)
    .sort()
    .join(",");
  if (latestAt && captured === current) return [];
  return list.rows.map((r) => ({
    fetched_at: fetchedAt,
    valid_from: list.validFrom,
    valid_to: list.validTo,
    ncpr_code: r.ncprCode,
    name: r.name,
    inn: r.inn,
    strength: r.strength,
    unit: r.unit,
    form: r.form,
    pack: r.pack,
    is_vaccine: r.isVaccine,
  }));
};

/** True when a whole window lies between the newest captured list's end and
 *  the list the source shows now. Measured from `valid_to`, so a window that
 *  shifts by a day or two is not reported as a miss. */
export const missedAShortageWindow = (
  lastValidTo: string,
  validFrom: string,
): boolean => {
  const gapDays =
    (Date.parse(`${validFrom}T00:00:00Z`) -
      Date.parse(`${lastValidTo}T00:00:00Z`)) /
    86_400_000;
  return gapDays > 7;
};

/** The newest captured list, for the watcher's missed-week check. */
export const lastShortageWindow = (
  existing: ShortageLine[],
): { valid_from: string; valid_to: string } | null => {
  let best: ShortageLine | null = null;
  for (const l of existing)
    if (!best || l.valid_from > best.valid_from) best = l;
  return best ? { valid_from: best.valid_from, valid_to: best.valid_to } : null;
};

// ------------------------------------------------------------------ НЦЗПБ

export type FluLine =
  | {
      fetched_at: string;
      kind: "incidence";
      iso_week: number;
      week_start: string;
      week_end: string;
      area: string;
      is_national: boolean;
      served: number[];
      cases: number[];
      rate: number[];
    }
  | {
      fetched_at: string;
      kind: "virology";
      iso_week: number;
      week_start: string;
      week_end: string;
      tested: number;
      a_h1n1: number;
      a_h3n2: number;
      a_h1n1pdm09: number;
      b_victoria: number;
      b_yamagata: number;
    };

const fluKey = (l: FluLine): string =>
  l.kind === "incidence"
    ? `incidence|${l.week_start}|${l.area}`
    : `virology|${l.week_start}`;
const fluValues = (l: FluLine): string =>
  JSON.stringify(l, (k, v: unknown) => (k === "fetched_at" ? undefined : v));

/** Append a week's rows when absent, and again when НЦЗПБ revised them (the
 *  loader takes the latest `fetched_at` per key; the revision stays visible). */
export const fluLinesToAppend = (
  existing: FluLine[],
  weeks: IncidenceWeek[],
  virology: VirologyWeek[],
  fetchedAt: string,
): FluLine[] => {
  const latest = new Map<string, string>();
  for (const l of existing) latest.set(fluKey(l), fluValues(l));
  const candidates: FluLine[] = [
    ...weeks.flatMap((w) =>
      w.rows.map(
        (r): FluLine => ({
          fetched_at: fetchedAt,
          kind: "incidence",
          iso_week: w.isoWeek,
          week_start: w.weekStart,
          week_end: w.weekEnd,
          area: r.area,
          is_national: r.isNational,
          served: r.served,
          cases: r.cases,
          rate: r.rate,
        }),
      ),
    ),
    ...virology.map(
      (v): FluLine => ({
        fetched_at: fetchedAt,
        kind: "virology",
        iso_week: v.isoWeek,
        week_start: v.weekStart,
        week_end: v.weekEnd,
        tested: v.tested,
        a_h1n1: v.aH1n1,
        a_h3n2: v.aH3n2,
        a_h1n1pdm09: v.aH1n1pdm09,
        b_victoria: v.bVictoria,
        b_yamagata: v.bYamagata,
      }),
    ),
  ];
  const out: FluLine[] = [];
  for (const c of candidates) {
    const k = fluKey(c);
    if (latest.get(k) === fluValues(c)) continue;
    latest.set(k, fluValues(c));
    out.push(c);
  }
  return out;
};

/** Newest incidence week captured, for the watcher's missed-week check. */
export const lastIncidenceWeek = (existing: FluLine[]): string | null => {
  let best: string | null = null;
  for (const l of existing)
    if (l.kind === "incidence" && (!best || l.week_start > best))
      best = l.week_start;
  return best;
};

/** True when `visibleOldest` (the oldest week the source still shows) is
 *  later than the week after our newest capture — i.e. a week fell off the
 *  source before we recorded it. */
export const missedAWeek = (
  lastCaptured: string | null,
  visibleOldest: string,
): boolean => {
  if (!lastCaptured) return false;
  const next = new Date(`${lastCaptured}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString().slice(0, 10) < visibleOldest;
};

// ------------------------------------------------------------------ runner

type Part = "his" | "sespa" | "ncipd" | "infoapp" | "eurostat";
const PARTS: Part[] = ["his", "sespa", "ncipd", "infoapp", "eurostat"];

const snap = (f: string) => path.join(SNAPSHOT_DIR, f);
const cache = (f: string) => path.join(CACHE_DIR, f);

const writeCache = (f: string, data: unknown) => {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cache(f), JSON.stringify(data));
};

const run: Record<Part, (fetchedAt: string) => Promise<string>> = {
  async his(fetchedAt) {
    // The closed year still moves as late records arrive (T2.3).
    const year = Number(fetchedAt.slice(0, 4));
    const existing = readJsonl<DailyLine>(snap(FILES.daily));
    // Each year is appended on its own: a failure on one (a refused counter
    // fall, an unreachable page) must not cost the other its day.
    let appended = 0;
    const errors: string[] = [];
    for (const y of [year, year - 1]) {
      try {
        const report = await fetchHisReport(y, y < year);
        const lines = dailyLinesToAppend(existing, report, fetchedAt);
        appendJsonl(snap(FILES.daily), lines);
        appended += lines.length;
      } catch (e) {
        errors.push(`${y}: ${(e as Error).message}`);
      }
    }
    if (errors.length)
      throw new Error(
        `${appended} counter change(s) recorded; failed ${errors.join("; ")}`,
      );
    return `${appended} counter change(s)`;
  },
  async sespa(fetchedAt) {
    const list = await fetchSespa();
    const existing = readJsonl<ShortageLine>(snap(FILES.shortage));
    const lines = shortageLinesToAppend(existing, list, fetchedAt);
    appendJsonl(snap(FILES.shortage), lines);
    return `${list.validFrom}…${list.validTo}: ${list.rows.length} listed, ${lines.length} new`;
  },
  async ncipd(fetchedAt) {
    const weeks = [await fetchIncidence(1), await fetchIncidence(2)];
    const virology = [await fetchVirology()];
    const existing = readJsonl<FluLine>(snap(FILES.flu));
    const lines = fluLinesToAppend(existing, weeks, virology, fetchedAt);
    appendJsonl(snap(FILES.flu), lines);
    return `weeks ${weeks.map((w) => w.isoWeek).join(", ")}: ${lines.length} line(s)`;
  },
  async infoapp() {
    const html = await fetchText(HIS_INFOAPP_URL, { retries: 2 });
    if (!html) throw new Error("НЗИС info-app unreachable");
    const rows = parseImmunizations(html);
    if (!rows.length) throw new Error("НЗИС info-app decoded to zero rows");
    writeCache(CACHE_FILES.infoapp, {
      fetched_at: new Date().toISOString(),
      rows,
    });
    const maxPeriod = rows.reduce((m, r) => (r.period > m ? r.period : m), "");
    return `${rows.length.toLocaleString()} cells to ${maxPeriod}`;
  },
  async eurostat() {
    const trade = await fetchVaccineTrade();
    writeCache(CACHE_FILES.trade, trade);
    const cov = await fetchFluCoverage();
    writeCache(CACHE_FILES.coverage, cov);
    return `trade ${trade.rows.length} rows, coverage ${cov.rows.length} rows`;
  },
};

const main = async () => {
  const onlyArg = process.argv.find((a) => a.startsWith("--only"));
  const onlyVal = onlyArg?.includes("=")
    ? onlyArg.split("=")[1]
    : onlyArg
      ? process.argv[process.argv.indexOf(onlyArg) + 1]
      : undefined;
  const parts = onlyVal
    ? (onlyVal.split(",").map((s) => s.trim()) as Part[])
    : PARTS;
  for (const p of parts)
    if (!PARTS.includes(p)) throw new Error(`unknown part ${p} (${PARTS})`);
  const fetchedAt = new Date().toISOString();
  let failed = 0;
  for (const p of parts) {
    try {
      console.log(`vaccines:${p} — ${await run[p](fetchedAt)}`);
    } catch (e) {
      failed++;
      console.error(`vaccines:${p} FAILED — ${(e as Error).message}`);
    }
  }
  if (failed) process.exit(1);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) void main();
