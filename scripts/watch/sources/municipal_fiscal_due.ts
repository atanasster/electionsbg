// Per-município financial indicators (ЗПФ чл. 130г ал. 2) — a DUE watcher.
//
// This one does not probe its upstream, and that is deliberate rather than a
// shortcut. minfin.bg serves an interactive Cloudflare Turnstile to every
// non-browser client, and web.archive.org's CDX API rate-limits this repo's
// egress hard enough that it 429'd on every attempt while this was built. A
// fingerprint over either would error or flap, and a source that cries wolf
// daily is worse than no source: the operator learns to skim past it, which is
// the state the report exists to prevent.
//
// So it is inverted. It watches OUR OWN coverage against the calendar: the
// newest quarter we hold, versus the newest that should exist by now. It never
// claims a file has been published — it says „by the calendar Q3-2025 is due
// and we hold Q2-2025", and the worst case is asking for something МФ has not
// posted yet, which costs one look at a page.
//
// The corpus is `data/budget/municipal_fiscal/index.json`, whose `newestQuarter`
// exists for this reader. Downloading is manual (see the drop directory's
// README), so the whole point of the source is the ManualRequest it raises.

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Fingerprint,
  ManualRequest,
  WatchSource,
  WatchState,
} from "../types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = resolve(
  __dirname,
  "../../../data/budget/municipal_fiscal/index.json",
);
const DROP_DIR = "data/_cache/minfin_municipal_fiscal";
const LANDING = "https://www.minfin.bg/bg/810";

/** How long after a quarter closes before МФ's release is worth asking for.
 *
 *  Conservative on purpose: the cost of being early is a wasted look at a page,
 *  the cost of being late is a quarter nobody notices is missing. Only one
 *  publication date has been observed (the Q1-2025 analysis is dated
 *  31.03.2025, its posting date unknown), so this is a floor rather than a
 *  measurement — tighten it once two or three are on record. */
export const PUBLICATION_LAG_DAYS = 90;

export interface Quarter {
  year: number;
  q: 1 | 2 | 3 | 4;
}

export const parseQuarter = (s: string): Quarter | null => {
  const m = /^(\d{4})-Q([1-4])$/.exec(s.trim());
  return m ? { year: Number(m[1]), q: Number(m[2]) as 1 | 2 | 3 | 4 } : null;
};

export const fmtQuarter = (q: Quarter): string => `${q.year}-Q${q.q}`;

/** The last day of a quarter, as UTC ms. */
export const quarterEndMs = (q: Quarter): number =>
  Date.UTC(q.year, q.q * 3, 0, 23, 59, 59, 999);

/** The newest quarter whose release should have been published by `nowMs`. */
export const newestDue = (nowMs: number, lagDays = PUBLICATION_LAG_DAYS) => {
  const lagMs = lagDays * 24 * 60 * 60 * 1000;
  const d = new Date(nowMs - lagMs);
  // The quarter that had already CLOSED by (now - lag).
  const q = Math.floor(d.getUTCMonth() / 3); // 0..3 → the quarter we are IN
  return q === 0
    ? { year: d.getUTCFullYear() - 1, q: 4 as const }
    : { year: d.getUTCFullYear(), q: q as 1 | 2 | 3 };
};

export const compareQuarters = (a: Quarter, b: Quarter): number =>
  a.year !== b.year ? a.year - b.year : a.q - b.q;

/** The filenames МФ has used for a given release, newest convention first.
 *
 *  Both are guesses and the parser treats them as such — periods are read from
 *  the workbook's own header row, never from the name. They are here so the
 *  request can say what to look for rather than „the quarterly file", and
 *  because the convention has changed at least twice (hyphens and a „1. "
 *  prefix from 2024; spaces and no prefix before that). */
export const expectedFilenames = (q: Quarter): string[] => {
  const prev = q.year - 1;
  // A Q4 release COLLAPSES its middle segment: the prior year's Q4 is already
  // the "prev" column, so it publishes two periods, not three
  // („quarterly reports Q42019-Q42020.xlsx"). All six Q4 workbooks in the drop
  // directory are that shape. Emitting Q42024-Q42024-Q42025 would name a file
  // that has never existed — and Q4 is the due quarter for a 90-day window
  // every year, so this is not an edge case.
  const stem =
    q.q === 4
      ? `Q4${prev}-Q4${q.year}`
      : `Q${q.q}${prev}-Q4${prev}-Q${q.q}${q.year}`;
  return [
    `1. quarterly-reports-${stem}-website.xlsx`,
    `quarterly reports ${stem}-website.xlsx`,
    `quarterly reports ${stem}.xlsx`,
  ];
};

export interface Coverage {
  newest: Quarter | null;
  /** Quarters between the oldest and newest held that are NOT present. The
   *  source would otherwise report „up to date" over a hole: the corpus is
   *  missing 2024-Q1 and 2025-Q1 right now, so the moment the newest quarter
   *  catches up, a two-quarter gap becomes invisible. */
  gaps: Quarter[];
  /** True when index.json exists but could not be read. Distinct from an empty
   *  corpus, because the request text differs — „no quarter has been ingested"
   *  is a false statement to publish with five quarters on disk. */
  unreadable: boolean;
}

export const coverageOf = (periods: string[]): Coverage => {
  const qs = periods
    .map(parseQuarter)
    .filter((q): q is Quarter => q != null)
    .sort(compareQuarters);
  if (qs.length === 0) return { newest: null, gaps: [], unreadable: false };
  const have = new Set(qs.map(fmtQuarter));
  const gaps: Quarter[] = [];
  for (let cur = qs[0]; compareQuarters(cur, qs[qs.length - 1]) < 0; ) {
    cur =
      cur.q === 4
        ? { year: cur.year + 1, q: 1 }
        : { ...cur, q: (cur.q + 1) as 1 | 2 | 3 | 4 };
    if (
      !have.has(fmtQuarter(cur)) &&
      compareQuarters(cur, qs[qs.length - 1]) < 0
    )
      gaps.push(cur);
  }
  return { newest: qs[qs.length - 1], gaps, unreadable: false };
};

const readCoverage = (): Coverage => {
  if (!existsSync(INDEX)) return { newest: null, gaps: [], unreadable: false };
  try {
    const idx = JSON.parse(readFileSync(INDEX, "utf8")) as {
      quarters?: { period: string }[];
      newestQuarter?: string | null;
    };
    const periods = (idx.quarters ?? []).map((q) => q.period);
    if (periods.length > 0) return coverageOf(periods);
    const n = idx.newestQuarter ? parseQuarter(idx.newestQuarter) : null;
    return { newest: n, gaps: [], unreadable: false };
  } catch (e) {
    // Reported, not swallowed: a corrupt index is a defect, and silently
    // presenting it as „nothing ingested" would send the operator to download a
    // corpus they already have.
    console.warn(
      `[watch] municipal_fiscal_due: ${INDEX} is unreadable — ${e instanceof Error ? e.message : String(e)}`,
    );
    return { newest: null, gaps: [], unreadable: true };
  }
};

export const buildRequest = (
  cov: Coverage,
  due: Quarter,
): ManualRequest | null => {
  if (cov.unreadable) {
    return {
      instruction:
        "data/budget/municipal_fiscal/index.json is unreadable — the corpus cannot be checked. " +
        "Re-run the ingest rather than re-downloading; the workbooks are probably fine.",
      url: LANDING,
      dropDir: DROP_DIR,
    };
  }
  const behind = !cov.newest || compareQuarters(cov.newest, due) < 0;
  // A gap is asked for even when the newest quarter is current: „up to date"
  // over a hole is exactly the state this source exists to make visible.
  const missing = [...cov.gaps, ...(behind ? [due] : [])];
  if (missing.length === 0) return null;

  const wanted = fmtQuarter(missing[missing.length - 1]);
  const gapNote =
    cov.gaps.length > 0
      ? ` Also missing from the middle of the series: ${cov.gaps.map(fmtQuarter).join(", ")}.`
      : "";
  return {
    instruction: cov.newest
      ? `${wanted} is due by the calendar; the corpus holds ${fmtQuarter(cov.newest)}.${gapNote}`
      : `${wanted} is due and the corpus is empty — no quarter has been ingested.`,
    url: LANDING,
    dropDir: DROP_DIR,
    // Name the files for the newest missing quarter only; the gap list in the
    // instruction says what else is short, and twenty filenames in a report
    // nobody reads is the same as none.
    files: expectedFilenames(missing[missing.length - 1]),
  };
};

export const municipalFiscalDue: WatchSource = {
  id: "municipal_fiscal_due",
  label:
    "Финансови показатели на общините (ЗПФ чл. 130г) — предстоящо тримесечие",
  url: LANDING,
  cadence: "weekly",
  publishes: "quarterly",

  async fingerprint(): Promise<Fingerprint> {
    const cov = readCoverage();
    const held = cov.newest;
    const due = newestDue(Date.now());
    // The fingerprint is (held, due) — so it moves when a quarter is ingested
    // OR when a new one falls due, and NOT while a quarter simply stays
    // outstanding. That is the distinction the whole design turns on: „still
    // needed" is not „changed", and a request that re-fired every day would be
    // indistinguishable from noise within a week.
    const heldStr = cov.unreadable
      ? "unreadable"
      : held
        ? fmtQuarter(held)
        : "none";
    const dueStr = fmtQuarter(due);
    const behind = cov.unreadable || !held || compareQuarters(held, due) < 0;
    const gapStr = cov.gaps.map(fmtQuarter).join(",");
    return {
      // Gaps are IN the fingerprint: filling an interior hole is a change worth
      // reporting, and without them the value would not move when it happened.
      value: `${heldStr}|${dueStr}|${gapStr}`,
      detail:
        (behind
          ? `holds ${heldStr}, ${dueStr} is due`
          : `up to date at ${heldStr}`) +
        (cov.gaps.length > 0 ? ` · ${cov.gaps.length} gap(s): ${gapStr}` : ""),
      meta: {
        held: heldStr,
        due: dueStr,
        behind,
        gaps: cov.gaps.map(fmtQuarter),
      },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const was = (prev?.meta?.held as string) ?? "none";
    const now = (curr.meta?.held as string) ?? "none";
    if (was === now) return curr.detail;
    if (now === "unreadable") return `corpus became UNREADABLE (was ${was})`;
    if (was === "unreadable") return `corpus readable again at ${now}`;
    // „advanced" is a claim, so only make it when the corpus actually moved
    // forward. A regression is the more interesting event and must not be
    // reported as progress.
    const a = parseQuarter(was);
    const b = parseQuarter(now);
    if (a && b && compareQuarters(b, a) < 0)
      return `corpus REGRESSED ${was} → ${now} — a quarter was dropped`;
    return `corpus advanced ${was} → ${now}`;
  },

  // Answerable without a fingerprint, which is what lets it fire on the
  // off-cadence and error paths too — see the note on WatchSource.manualRequest.
  manualRequest(): ManualRequest | null {
    return buildRequest(readCoverage(), newestDue(Date.now()));
  },
};
