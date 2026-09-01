// The "what changed" adapters — one per source family.
//
// Each owns its event kinds, its date authority and its materiality. The rule they all obey
// is the one the whole feed rests on:
//
//   ⚠️ A DATE IS THE SOURCE'S OWN, AND ITS BASIS IS NAMED. `occurred`, `published`,
//   `effective`, `deadline` and `first_seen` are five different claims. A row dated by when
//   WE looked says „found in the data on…", never „happened on…" — and the renderer can only
//   say that if the artifact tells it which it is.
//
// ⚠️ AND NOTHING NOW-RELATIVE IS STORED. `deadlineAt` is a fact; „closes in 3 days" is a
// rendering. That is the `open_calls` (migration 142) rule one layer up: a status frozen at
// generation time shows an expired call as open all weekend after a Friday failure.
//
// EVERY ONE reads a COMMITTED source, so the feed builds on a fresh clone with no database.
// A family whose source is absent is reported in `sourceCoverage`, never silently dropped —
// „we have nothing to show" and „we could not look" are different answers.
//
// ⚠️ THE PRICE ARM IS THE ONE THAT NEEDED HELP TO OBEY THAT RULE. The retail corpus lives
// only in Postgres, so `db:gen-home-price-events` measures it and commits the measurements to
// `data/home/price_events.json`; this adapter reads that file. See `events/priceSource.ts`
// for why the indirection is a correctness property rather than plumbing.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §6.2.

import fs from "node:fs";
import path from "node:path";
import type { HomeEventV1 } from "../../../../src/data/home/homeTypes";
import { periodToIsoDay } from "../period";
import type { PriceEventsV1 } from "./priceSource";

export interface AdapterContext {
  root: string;
  /** Repo-relative reader; returns null when the source is absent. */
  readJson: <T>(rel: string) => T | null;
}

export interface AdapterResult {
  events: HomeEventV1[];
  /** The newest SOURCE date this adapter saw, as an ISO day. Feeds `computedAt`. */
  newest: string | null;
  /**
   * What `sourceCoverage.asOf` reports, when it differs from `newest`.
   *
   * ⚠️ THEY ARE DIFFERENT QUESTIONS. `newest` decides where the feed's WINDOW ends, so it has
   * to be the freshest thing the family saw. `asOf` is a claim to a reader about how current
   * the family IS — and a family reading three independent snapshots is only as current as its
   * stalest one. Reporting the max there asserts that a 23-day-old ДФЗ crawl is current.
   */
  disclosedAsOf?: string | null;
  /**
   * Whether `newest` is a date we OBSERVED the source on, or a date the source's own rows
   * carry.
   *
   * ⚠️ ONLY A `crawl` VINTAGE MAY SET THE FEED'S WINDOW. A crawl timestamp cannot be in the
   * future — it is when we looked — while an event date can be: a scheduled election, a
   * forecast period, a call published before it opens, a typo. `feed.ts` takes `computedAt`
   * from the crawl-based families alone, so a future-dated row can no longer move the window
   * from three months away, and every family still reports its own honest `asOf`.
   */
  vintageBasis: "crawl" | "event";
  available: boolean;
}

const isoDay = (v: string): string => v.slice(0, 10);
const atMidnight = (day: string): string => `${day}T00:00:00.000Z`;

/**
 * ⚠️ A LOWER BOUND ON DETECTION, NOT THE DETECTION CLOCK — read it as „we cannot have had this
 * before X", never as „we found it on X". `firstSeenAt` is required by the type and most of
 * these sources are committed files with no ingestion timestamp in them, so the honest value is
 * the day the fact itself is dated: nobody ingested a Разград resolution on the day it was
 * voted, and `state/watch/eurostat.json` exists precisely because a release date and a period
 * are different things.
 *
 * ⚠️ NOTHING RENDERS IT, and nothing may treat it as evidence of when a pipeline last ran.
 * Phase 6's stale-source monitoring reads `sourceCoverage.asOf` — each adapter's own declared
 * vintage — which is a real detection clock where a source carries one.
 *
 * It is NEVER the displayed date unless `dateBasis` says `first_seen`.
 */
const seen = (day: string): string => atMidnight(day);

/**
 * The newest date a family saw. A plain maximum — the FUTURE-DATE guard is not here.
 *
 * ⚠️ AND IT CANNOT BE, WHICH IS WORTH RECORDING BECAUSE THE OBVIOUS FIXES ARE WRONG. The
 * hazard is real and measured: `newest` feeds the feed's `computedAt`, which is where the
 * 30-day window ENDS, so one open call opening in December dragged the window three months
 * forward and took 65 in-window events down to 1. But a generator that must rebuild
 * byte-identically cannot consult the clock, and no corpus-relative clamp survives contact
 * with these sources:
 *
 *   - „more than N days past the MEDIAN day" clamps every long-history family to mid-history —
 *     tried, and it reported the elections vintage as 2021 and the debt vintage as 2022;
 *   - „more than N days past the SECOND-newest" cannot work either: Bulgaria's last two
 *     elections are **539 days** apart, so any ceiling loose enough for that is loose enough
 *     to admit a row a year out.
 *
 * The guard therefore lives in `feed.ts`, where all nine families are visible at once and one
 * of them holds a date that CANNOT be in the future — a crawl timestamp. See `vintageBasis`.
 */
const vintageOf = (days: string[]): string | null =>
  [...days].filter(Boolean).sort().at(-1) ?? null;

// ---------------------------------------------------------------------------
// parliament — a sitting is a thing that happened, on the day it happened
// ---------------------------------------------------------------------------

interface VoteSession {
  date: string;
  items: number;
  ns?: string;
}

export const parliamentAdapter = (ctx: AdapterContext): AdapterResult => {
  const raw = ctx.readJson<VoteSession[] | { sessions: VoteSession[] }>(
    "data/parliament/votes/index.json",
  );
  if (!raw)
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };
  const sessions = Array.isArray(raw) ? raw : (raw.sessions ?? []);
  const rows = sessions.filter((s) => s?.date && Number.isFinite(s.items));
  const newest = vintageOf(rows.map((s) => isoDay(s.date)));

  return {
    available: true,
    newest,
    vintageBasis: "event" as const,
    events: rows.map((s) => ({
      schemaVersion: 1 as const,
      // Stable from the source's own identity — the sitting day. No ingestion time, or
      // every rebuild would mint a new row for the same sitting.
      id: `parliament:sitting:${isoDay(s.date)}`,
      kind: "plenary_sitting",
      category: "parliament_elections" as const,
      occurredAt: atMidnight(isoDay(s.date)),
      firstSeenAt: seen(isoDay(s.date)),
      dateBasis: "occurred" as const,
      scope: { level: "national" as const },
      source: { id: "parliament_votes", labelKey: "home_source_parliament" },
      coverage: { complete: true },
      route: `/votes/${isoDay(s.date)}`,
      factKey: "home_fact_plenary_sitting",
      factArgs: { items: s.items },
      backfill: false,
      verification: "automatic" as const,
      // A sitting with more items on the agenda is a bigger day. Capped so a single long
      // sitting cannot dominate the ranking.
      materiality: Math.min(1, s.items / 40),
      actionability: 0.4,
    })),
  };
};

// ---------------------------------------------------------------------------
// council — a municipal resolution, dated by the vote
// ---------------------------------------------------------------------------

interface CouncilShard {
  id: string;
  date: string;
  title: string;
  number?: string;
  tally?: { for?: number; against?: number; abstain?: number };
}

/** The council scraper's literal for „I could not read a title". */
const UNPARSED_TITLE = /^\(no title parsed\)$/i;

/** Committed shards, `data/council/<code>/<YYYY>/<id>.json`. Read directly rather than
 *  through `index.json`, whose per-município window is capped at 200 rows — the cap that
 *  left 530 resolutions on disk and unserved (see CLAUDE.md's council section). */
export const councilAdapter = (ctx: AdapterContext): AdapterResult => {
  const base = path.join(ctx.root, "data/council");
  if (!fs.existsSync(base))
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };

  const events: HomeEventV1[] = [];
  let newest: string | null = null;
  // ⚠️ `statSync` THROWS on a dangling symlink or an unreadable entry, and an unguarded one
  // here takes the whole generator down over a stray file under `data/council/`.
  const isDir = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  // The feed's window is 30 days, so only the newest two year directories can contribute — two
  // rather than one because a January window reaches back across the boundary. 5,085 shards are
  // read otherwise, and the tree only grows.
  const years = (dir: string): string[] => {
    const found = fs
      .readdirSync(dir)
      .filter((y) => /^\d{4}$/.test(y) && isDir(path.join(dir, y)))
      .sort();
    return found.slice(-2);
  };
  for (const code of fs.readdirSync(base)) {
    const codeDir = path.join(base, code);
    if (!isDir(codeDir)) continue;
    for (const year of years(codeDir)) {
      const yearDir = path.join(codeDir, year);
      for (const file of fs.readdirSync(yearDir)) {
        if (!file.endsWith(".json")) continue;
        let s: CouncilShard;
        try {
          s = JSON.parse(fs.readFileSync(path.join(yearDir, file), "utf-8"));
        } catch {
          continue;
        }
        if (!s?.date || !s?.id || !s?.title) continue;
        const day = isoDay(s.date);
        // ⚠️ THE VINTAGE IS TAKEN BEFORE THE TITLE FILTER. An unparsed resolution is still
        // evidence of when this corpus was last ingested; dropping it from `newest` would make
        // a município look staler than it is.
        if (!newest || day > newest) newest = day;
        // ⚠️ THE SCRAPER WRITES THIS LITERAL WHEN IT CANNOT EXTRACT A TITLE, AND IT IS TRUTHY.
        // A bare `s.title` check published „RAZ26: решение №545 — (no title parsed)" as the
        // substance of a municipal decision, in Bulgarian AND in English, with a working link —
        // 21 of 40 rows in the first committed artifact, 1,562 of 5,085 shards corpus-wide. A
        // row with no readable subject has no fact to state; the coverage note already says we
        // read only sixteen councils.
        if (UNPARSED_TITLE.test(s.title.trim())) continue;
        const votes =
          (s.tally?.for ?? 0) +
          (s.tally?.against ?? 0) +
          (s.tally?.abstain ?? 0);
        events.push({
          schemaVersion: 1,
          id: `council:resolution:${s.id}`,
          kind: "council_resolution",
          category: "local",
          occurredAt: atMidnight(day),
          firstSeenAt: seen(day),
          dateBasis: "occurred",
          scope: { level: "municipality", id: code },
          source: { id: "council_minutes", labelKey: "home_source_council" },
          // ⚠️ INCOMPLETE BY CONSTRUCTION and it must say so. Sixteen municipal councils are
          // ingested out of 265, so „no resolutions near you" is almost always „we do not
          // read your council" rather than „your council decided nothing".
          coverage: {
            complete: false,
            noteKey: "home_coverage_council_partial",
          },
          route: `/council/resolution/${s.id}`,
          factKey: "home_fact_council_resolution",
          factArgs: {
            title: s.title.slice(0, 120),
            council: code,
            // Unconditional for the reason the debt rows are: the template interpolates it.
            number: s.number ?? "—",
          },
          backfill: false,
          verification: "automatic",
          // A contested vote is more interesting than a unanimous one, and a named-vote
          // record more than a bare tally.
          materiality: votes > 0 ? Math.min(0.6, 0.2 + votes / 100) : 0.2,
          actionability: 0.3,
        });
      }
    }
  }
  return { events, newest, available: true, vintageBasis: "event" };
};

// ---------------------------------------------------------------------------
// funds — an open call, dated by when it OPENED
// ---------------------------------------------------------------------------

/** The snapshot envelope. `crawledAt` is the SOURCE VINTAGE — see the adapter. */
interface Snapshot {
  source?: string;
  crawledAt?: string;
  calls?: OpenCall[];
}

interface OpenCall {
  source: string;
  sourceKey: string;
  code?: string | null;
  kind?: string;
  title: string;
  programmeName?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  budgetEur?: number | null;
  sourceUrl?: string | null;
}

export const openCallsAdapter = (ctx: AdapterContext): AdapterResult => {
  const files = ["isun.json", "sp2023.json", "interreg.json"];
  const rows: OpenCall[] = [];
  const crawls: string[] = [];
  let any = false;
  for (const f of files) {
    const raw = ctx.readJson<OpenCall[] | Snapshot>(`data/opencalls/${f}`);
    if (!raw) continue;
    any = true;
    if (Array.isArray(raw)) rows.push(...raw);
    else {
      rows.push(...(raw.calls ?? []));
      if (raw.crawledAt) crawls.push(isoDay(raw.crawledAt));
    }
  }
  if (!any)
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };

  // ⚠️ THE VINTAGE IS THE CRAWL DATE, NOT THE NEWEST EVENT DATE — and using the latter
  // COLLAPSES THE WHOLE FEED. A call may be published before it opens (`upcoming` is a
  // first-class status in `CallStatus`), so one row with `opensAt` in December drags this
  // adapter's `newest` into the future — and since `newest` feeds the feed's `computedAt`,
  // the 30-day window slides there with it. Measured with one injected 2026-12-01 call: 65
  // in-window events became 1, one category survived, and the page announced „данни към
  // 01.12.2026" for a corpus crawled in August. The snapshot carries `crawledAt` for
  // exactly this.
  const newest = [...crawls].sort().at(-1) ?? null;
  // ⚠️ …BUT THE DISCLOSED VINTAGE IS THE STALEST OF THE THREE. The max drives the „has it
  // opened yet" filter above and must stay the max; reporting it as the FAMILY's `asOf` asserts
  // that ДФЗ and Interreg are current to the ИСУН crawl. Measured 2026-09-01: ИСУН 09-01, ДФЗ
  // 08-09, Interreg 08-11 — 23 and 21 days behind. That is the same „the freshest arm speaks
  // for the whole family" shape this adapter refuses one level down, for event dates.
  const disclosed = [...crawls].sort().at(0) ?? null;

  const dated = rows.filter(
    (r) =>
      r?.opensAt &&
      r?.title &&
      r?.sourceKey &&
      // ⚠️ AN ALLOWLIST ON `kind`, NOT THE ABSENCE OF A FILTER. The ИСУН snapshot holds
      // `/Active` procedures AND `/PublicDiscussion` ones in the SAME `calls` array, and a
      // consultation's `closesAt` is the deadline for COMMENTS on a draft, not for
      // applying. Through this adapter it would become „Отворен прием: …" at actionability
      // 0.9 with „остават N дни" — telling a reader to apply for something that does not
      // exist yet. `/funds/calls` keeps the two in separate sections and refuses the
      // urgency badge on a consultation for exactly that reason.
      (r.kind ?? "call") === "call" &&
      // A call that has not opened yet is not an event. It becomes one on its opening day.
      (!newest || isoDay(r.opensAt) <= newest),
  );

  return {
    available: true,
    newest,
    disclosedAsOf: disclosed,
    // The crawl timestamp — see `vintageBasis`. This is the family the measured incident came
    // from, and it is also the one that can anchor the window safely.
    vintageBasis: "crawl" as const,
    events: dated.map((r) => ({
      schemaVersion: 1 as const,
      id: `funds:call_opened:${r.source}:${r.sourceKey}`,
      kind: "call_opened",
      category: "funds" as const,
      // ⚠️ `effective`, NOT `published`. The register states when the intake OPENS, which is
      // when the call becomes a thing a reader can act on — it does not state when the page
      // was published, and claiming it did would be inventing a provenance.
      effectiveAt: r.opensAt!,
      // The DEADLINE IS STORED AS A FACT and never as a countdown. „Closes in 3 days" is
      // computed by the renderer against the reader's own clock; frozen here it would be
      // wrong the day after generation. Kinds like „deadline approaching" do not exist for
      // the same reason — they are a rendering of this field, not events.
      ...(r.closesAt ? { deadlineAt: r.closesAt } : {}),
      firstSeenAt: seen(isoDay(r.opensAt!)),
      dateBasis: "effective" as const,
      scope: { level: "national" as const },
      source: {
        id: `opencalls_${r.source}`,
        labelKey: "home_source_opencalls",
        ...(r.sourceUrl ? { url: r.sourceUrl } : {}),
      },
      // ИСУН + ДФЗ + two of six Interreg programmes. The page says so; so does the row.
      coverage: { complete: false, noteKey: "home_coverage_calls_partial" },
      route: "/funds/calls",
      // ⚠️ TWO KEYS, chosen by what the register published — never one template with a
      // conditionally-supplied placeholder. i18next's `skipOnVariables` default renders a
      // missing argument as the LITERAL `{{programme}}`, on the home page, at a 200.
      factKey: r.programmeName
        ? "home_fact_call_opened_programme"
        : "home_fact_call_opened",
      factArgs: {
        title: r.title.slice(0, 120),
        ...(r.programmeName ? { programme: r.programmeName } : {}),
      },
      backfill: false,
      verification: "automatic" as const,
      materiality:
        typeof r.budgetEur === "number"
          ? Math.min(1, Math.log10(Math.max(r.budgetEur, 1)) / 9)
          : 0.4,
      // The highest of any kind here: this is the one row a reader can act on.
      actionability: 0.9,
    })),
  };
};

// ---------------------------------------------------------------------------
// elections — a polling day
// ---------------------------------------------------------------------------

interface ElectionRow {
  name: string;
}

export const electionsAdapter = (ctx: AdapterContext): AdapterResult => {
  const rows = ctx.readJson<ElectionRow[]>("src/data/json/elections.json");
  if (!rows)
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };
  const days = rows
    .map((r) => r?.name)
    .filter(Boolean)
    .map((n) => n.replace(/_/g, "-"));
  // ⚠️ CLAMPED. `HOME_MODES` already anticipates a scheduled election, which is a future-dated
  // row in this very file — and a future vintage moves the feed's whole window.
  const newest = vintageOf(days);
  return {
    available: true,
    newest,
    vintageBasis: "event" as const,
    events: days.map((day) => ({
      schemaVersion: 1 as const,
      id: `elections:polling_day:${day}`,
      kind: "election_held",
      category: "parliament_elections" as const,
      occurredAt: atMidnight(day),
      firstSeenAt: seen(day),
      dateBasis: "occurred" as const,
      scope: { level: "national" as const },
      source: { id: "cik_results", labelKey: "home_source_cik" },
      coverage: { complete: true },
      route: `/elections/${day.replace(/-/g, "_")}`,
      factKey: "home_fact_election_held",
      factArgs: {},
      backfill: false,
      verification: "automatic" as const,
      // A national election is the most material thing in this corpus.
      materiality: 1,
      actionability: 0.6,
    })),
  };
};

// ---------------------------------------------------------------------------
// prices — the twelve-product basket, and a corroborated promotion
// ---------------------------------------------------------------------------

/**
 * Reads the COMMITTED measurements, never Postgres — see `priceSource.ts`.
 *
 * ⚠️ NEITHER ARM RECOMPUTES ANYTHING. The thresholds, the fixed cohort and the promotion
 * corroboration are settled in `gen_home/price_events.ts` against a 90-day replay, and this
 * adapter's only job is to turn an accepted measurement into a sentence. Re-deriving here
 * would mean two rules for the same claim, and the one the audit approved is the other one.
 */
export const pricesAdapter = (ctx: AdapterContext): AdapterResult => {
  const src = ctx.readJson<PriceEventsV1>("data/home/price_events.json");
  if (!src?.computedAt)
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };
  const newest = isoDay(src.computedAt);
  const events: HomeEventV1[] = [];

  for (const m of src.basketMoves ?? []) {
    events.push({
      schemaVersion: 1,
      // The strongest day of the episode. A run that later extends with a WEAKER day keeps
      // this id; one that extends with a stronger day gets a new id — correct, because the
      // claim itself has changed.
      id: `prices:basket_moved:${m.peakDay}`,
      kind: "basket_moved",
      category: "prices",
      // ⚠️ `occurred`, and the date is the day the move was MEASURED THROUGH — not the start
      // of the week it covers. „Поскъпване от 14 август" would name a day on which nothing
      // had yet been measured.
      occurredAt: atMidnight(m.peakDay),
      firstSeenAt: seen(m.peakDay),
      dateBasis: "occurred",
      scope: { level: "national" },
      source: { id: "prices_grid", labelKey: "home_source_prices" },
      // The crawl covers the chains that publish, not every shop in the country.
      coverage: { complete: false, noteKey: "home_coverage_prices_partial" },
      route: "/consumption",
      factKey:
        m.pctChange >= 0 ? "home_fact_basket_up" : "home_fact_basket_down",
      factArgs: {
        pct: Math.abs(m.pctChange).toFixed(1),
        costEur: m.costEur.toFixed(2),
        days: src.thresholds?.basketWindowDays ?? 7,
      },
      backfill: false,
      verification: "automatic",
      // The accepted floor is 1.5% and the largest move in three months was 3.28%, so the
      // scale is anchored at 4% rather than at 100% — otherwise every real move scores ~0.03
      // and the whole category sinks below every other row in the feed.
      materiality: Math.min(1, Math.abs(m.pctChange) / 4),
      // A price move is something to know, not something to do.
      actionability: 0.5,
    });
  }

  for (const p of src.promotions ?? []) {
    events.push({
      schemaVersion: 1,
      // ⚠️ THE SLUG ALONE, never the derived date. `atOrBelowSince` is the output of a
      // walk-back whose band moves with the day's minimum, so an id carrying it mints a SECOND
      // row for one unchanged offer the first time a cheaper listing appears and disappears —
      // measured on `limoni`, where the same €1.28 promotion produced 2026-08-21 or 2026-08-31
      // on consecutive days. The SQL groups by product, so the slug is unique by construction.
      id: `prices:promotion:${p.slug}`,
      kind: "promotion_started",
      category: "prices",
      // ⚠️ `occurred` AT THE CORPUS DAY, not at the run start. The event is „this product is on
      // promotion", and what we can prove about that day is that we observed it. The run start
      // is the weaker claim „nothing has been cheaper since", which stays in the measurements
      // artifact — where it gates the 30-day window — rather than being rendered: a raw ISO day
      // in the middle of a sentence is worse copy than saying nothing, and formatting it would
      // need a locale the generator does not have.
      occurredAt: atMidnight(newest),
      firstSeenAt: seen(newest),
      dateBasis: "occurred",
      scope: { level: "national" },
      source: { id: "prices_grid", labelKey: "home_source_prices" },
      coverage: { complete: false, noteKey: "home_coverage_prices_partial" },
      route: `/product/${p.slug}`,
      factKey: "home_fact_promotion",
      factArgs: {
        title: p.title.slice(0, 90),
        pct: p.discountPct,
        promoEur: p.promoEur.toFixed(2),
        regularEur: p.regularEur.toFixed(2),
        chains: p.chains,
      },
      backfill: false,
      verification: "automatic",
      // Deeper is more material, on the board's own 15–70% band.
      materiality: Math.min(1, p.discountPct / 70),
      // The single most actionable row in the corpus: it is a thing to go and buy.
      actionability: 0.85,
    });
  }

  // The corpus day the price crawl loaded — an observation date, not an event date.
  return { events, newest, available: true, vintageBasis: "crawl" };
};

// ---------------------------------------------------------------------------
// macro — the official HICP release
// ---------------------------------------------------------------------------

interface MacroJson {
  latestMonthly?: {
    inflation?: {
      period?: string;
      value?: number;
      datasetCode?: string;
      sourceUrl?: string;
    };
  };
}

interface EurostatWatch {
  meta?: { datasets?: Record<string, string> };
}

/**
 * ⚠️ THE RELEASE DATE COMES FROM EUROSTAT'S OWN DATASET TIMESTAMP, and that is the whole
 * reason this adapter reads two files. `macro.json` states WHICH month the figure covers and
 * nothing about when it was published, so dating the event by the period would put the July
 * HICP at 31 July — a month before Eurostat actually released it, and outside the feed's
 * window on the day it was news. `state/watch/eurostat.json` carries the update timestamp the
 * API itself reports per dataset; the committed watcher state is the only place we hold it.
 *
 * The id is keyed on the PERIOD rather than on that timestamp, so a revision updates the row
 * in place instead of minting a second „July inflation".
 */
export const macroAdapter = (ctx: AdapterContext): AdapterResult => {
  const macro = ctx.readJson<MacroJson>("data/macro.json");
  const inf = macro?.latestMonthly?.inflation;
  if (!macro || !inf?.period || typeof inf.value !== "number")
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };

  const watch = ctx.readJson<EurostatWatch>("state/watch/eurostat.json");
  const stamp = inf.datasetCode
    ? watch?.meta?.datasets?.[inf.datasetCode]
    : undefined;
  // No release timestamp means no honest date for a „released" event. Reporting the source as
  // available with no rows is the truthful answer — the alternative is inventing a date.
  if (!stamp)
    return { events: [], newest: null, available: true, vintageBasis: "crawl" };

  const publishedAt = new Date(stamp).toISOString();
  const day = isoDay(publishedAt);
  return {
    available: true,
    newest: day,
    // Eurostat's own dataset-update timestamp: when the figure was PUBLISHED, never a future
    // period. Safe to anchor the window on.
    vintageBasis: "crawl" as const,
    events: [
      {
        schemaVersion: 1,
        id: `macro:cpi_release:${inf.datasetCode}:${inf.period}`,
        kind: "cpi_released",
        category: "prices",
        publishedAt,
        firstSeenAt: seen(day),
        dateBasis: "published",
        scope: { level: "national" },
        source: {
          id: "eurostat_hicp",
          labelKey: "home_source_eurostat",
          ...(inf.sourceUrl ? { url: inf.sourceUrl } : {}),
        },
        coverage: { complete: true },
        route: "/indicators",
        factKey: "home_fact_cpi_released",
        factArgs: { period: inf.period, pct: inf.value.toFixed(1) },
        backfill: false,
        verification: "automatic",
        // The official inflation print is the most-read number in this corpus.
        materiality: 0.8,
        actionability: 0.3,
      },
    ],
  };
};

// ---------------------------------------------------------------------------
// budget — a promulgated law, and the newest КФП execution period
// ---------------------------------------------------------------------------

interface BudgetDoc {
  id: string;
  kind: string;
  title: string;
  fiscalYear?: number | null;
  promulgationDate?: string | null;
  reportDate?: string | null;
}

interface KfpJson {
  observations?: { period?: string; asOf?: string }[];
}

/** Laws and amendments that were PROMULGATED — a document notice, never a numeric claim. */
const PROMULGATED_KINDS = new Set([
  "law",
  "amendment",
  "fund-law",
  "interim-law",
]);

/**
 * ⚠️ A DOCUMENT NOTICE, AND IT MUST NOT CLAIM A NUMBER (§6.2's last row). „Обнародван е
 * Законът за бюджета на НЗОК за 2026" is a fact about a publication; „бюджетът се промени с
 * X" is a claim about appropriations that would need the tables parsed and reconciled, and
 * this corpus holds the document index rather than the diff. The copy keys therefore carry a
 * title and a fiscal year and nothing else — `home_feed.data.test.ts` fails on a budget fact
 * that ships a money argument.
 */
export const budgetAdapter = (ctx: AdapterContext): AdapterResult => {
  const docs =
    ctx.readJson<{ documents?: BudgetDoc[] }>("data/budget/documents.json")
      ?.documents ?? null;
  const kfp = ctx.readJson<KfpJson>("data/budget/kfp.json");
  if (!docs && !kfp)
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };

  const events: HomeEventV1[] = [];
  const vintages: string[] = [];

  for (const d of docs ?? []) {
    if (!d?.id || !d?.title || !PROMULGATED_KINDS.has(d.kind)) continue;
    if (!d.promulgationDate) continue;
    const day = isoDay(d.promulgationDate);
    vintages.push(day);
    events.push({
      schemaVersion: 1,
      id: `budget:promulgated:${d.id}`,
      kind: "budget_document",
      category: "budget_debt",
      // Държавен вестник publishes it; that is a publication date and nothing else.
      publishedAt: atMidnight(day),
      firstSeenAt: seen(day),
      dateBasis: "published",
      scope: { level: "national" },
      source: { id: "budget_documents", labelKey: "home_source_budget" },
      coverage: { complete: true },
      route: "/budget/law",
      factKey: "home_fact_budget_document",
      factArgs: { title: d.title.slice(0, 120) },
      backfill: false,
      verification: "automatic",
      materiality: d.kind === "law" || d.kind === "fund-law" ? 0.7 : 0.5,
      actionability: 0.2,
    });
  }

  // One row for the newest КФП period on file, dated by the period it reports on. The feed's
  // window then decides whether last month's execution is still news.
  const periods = (kfp?.observations ?? [])
    .map((o) => o?.period)
    .filter((p): p is string => !!p && /^\d{4}-\d{2}$/.test(p))
    .sort();
  const latestPeriod = periods.at(-1);
  const end = latestPeriod ? periodToIsoDay(latestPeriod) : null;
  if (latestPeriod && end) {
    vintages.push(end);
    events.push({
      schemaVersion: 1,
      id: `budget:kfp_release:${latestPeriod}`,
      kind: "kfp_release",
      category: "budget_debt",
      // ⚠️ `effective`, not `published`. МФ's release day is not in this corpus, and the
      // figures ARE the state of the consolidated programme at the period end — which is a
      // real date that names exactly what the row claims.
      effectiveAt: atMidnight(end),
      firstSeenAt: seen(end),
      dateBasis: "effective",
      scope: { level: "national" },
      source: { id: "budget_kfp", labelKey: "home_source_kfp" },
      coverage: { complete: true },
      route: "/budget/execution",
      factKey: "home_fact_kfp_release",
      factArgs: { period: latestPeriod },
      backfill: false,
      verification: "automatic",
      materiality: 0.6,
      actionability: 0.2,
    });
  }

  return {
    events,
    newest: vintageOf(vintages),
    available: true,
    vintageBasis: "event",
  };
};

// ---------------------------------------------------------------------------
// debt — a domestic ДЦК auction
// ---------------------------------------------------------------------------

interface Emission {
  id: string;
  issueDate?: string;
  maturityDate?: string;
  termYears?: number | null;
  currency?: string;
  principalMillion?: number | null;
  couponPct?: number | null;
  settlementYieldPct?: number | null;
}

/**
 * The БНБ fiscal-agent auction results — §6.2's „structured domestic sources", and the only
 * debt arm that may publish automatically.
 */
export const domesticDebtAdapter = (ctx: AdapterContext): AdapterResult => {
  const raw = ctx.readJson<{ emissions?: Emission[] }>(
    "data/debt-emissions-domestic.json",
  );
  if (!raw)
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };
  const rows = (raw.emissions ?? []).filter(
    (e): e is Emission & { issueDate: string; principalMillion: number } =>
      !!e?.id && !!e?.issueDate && typeof e.principalMillion === "number",
  );
  const newest = vintageOf(rows.map((e) => isoDay(e.issueDate)));

  return {
    available: true,
    newest,
    vintageBasis: "event" as const,
    events: rows.map((e) => {
      const hasYield = typeof e.settlementYieldPct === "number";
      return {
        schemaVersion: 1 as const,
        id: `debt:domestic_auction:${e.id}`,
        kind: "debt_auction",
        category: "budget_debt" as const,
        // The auction settled on that day. It happened.
        occurredAt: atMidnight(isoDay(e.issueDate)),
        firstSeenAt: seen(isoDay(e.issueDate)),
        dateBasis: "occurred" as const,
        scope: { level: "national" as const },
        source: { id: "bnb_auctions", labelKey: "home_source_bnb" },
        coverage: { complete: true },
        route: "/indicators/fiscal",
        // ⚠️ ROUNDED, and the fact key is chosen by what БНБ actually published. A raw
        // `95.003` reads as spurious precision on an auction result, and a `yieldPct` spread in
        // conditionally against a template that interpolates it unconditionally renders the
        // LITERAL `{{yieldPct}}` — i18next's `skipOnVariables` default. 9 of 67 emissions carry
        // no settlement yield.
        factKey: hasYield
          ? "home_fact_debt_auction_yield"
          : "home_fact_debt_auction",
        factArgs: {
          millions: Number(e.principalMillion.toFixed(1)),
          currency: e.currency ?? "EUR",
          years: e.termYears ?? "—",
          ...(hasYield ? { yieldPct: e.settlementYieldPct!.toFixed(2) } : {}),
        },
        backfill: false,
        verification: "automatic" as const,
        // A €500m issue is not a €95m one; the log keeps a small auction from scoring zero.
        materiality: Math.min(
          1,
          Math.log10(Math.max(e.principalMillion, 1) + 1) / 3,
        ),
        actionability: 0.2,
      } satisfies HomeEventV1;
    }),
  };
};

// ---------------------------------------------------------------------------
// international debt — built, gated, and NEVER auto-published
// ---------------------------------------------------------------------------

/**
 * ⚠️ EVERY ROW IS `editorial_review`, AND `feed.ts` DROPS THEM BEFORE WRITING. Phase 5's
 * fifth item: „do not auto-publish until a structured authority exists". `debt-emissions.json`
 * is a HAND-MAINTAINED file — its `fetchedAt` is a bare date typed by a person, there is no
 * crawler behind it and no watcher — so a Eurobond row can carry a terms error that no gate
 * here could catch, on a claim about the Republic's own borrowing. The domestic arm above has
 * БНБ's auction results behind it and publishes; this one is staged for a human.
 *
 * Building it anyway is the point of an editorial-review FLOW: the rows exist, they are
 * counted in the generator's output, and `--include-review` lists them — so promoting the
 * family later is a change of one field rather than a new adapter written under time pressure.
 */
export const intlDebtAdapter = (ctx: AdapterContext): AdapterResult => {
  const raw = ctx.readJson<{ emissions?: Emission[] }>(
    "data/debt-emissions.json",
  );
  if (!raw)
    return {
      events: [],
      newest: null,
      available: false,
      vintageBasis: "event",
    };
  const rows = (raw.emissions ?? []).filter(
    (e): e is Emission & { issueDate: string; principalMillion: number } =>
      !!e?.id && !!e?.issueDate && typeof e.principalMillion === "number",
  );
  return {
    available: true,
    // ⚠️ NO VINTAGE. `newest` feeds the feed's `computedAt`, i.e. the end of the window every
    // OTHER adapter is measured against — so a family that publishes nothing must not move it.
    newest: null,
    vintageBasis: "event" as const,
    events: rows.map((e) => ({
      schemaVersion: 1 as const,
      id: `debt:eurobond:${e.id}`,
      kind: "eurobond_issued",
      category: "budget_debt" as const,
      occurredAt: atMidnight(isoDay(e.issueDate)),
      firstSeenAt: seen(isoDay(e.issueDate)),
      dateBasis: "occurred" as const,
      scope: { level: "national" as const },
      source: { id: "minfin_eurobond", labelKey: "home_source_minfin" },
      coverage: { complete: true },
      route: "/indicators/fiscal",
      factKey: "home_fact_eurobond",
      factArgs: {
        millions: Number(e.principalMillion.toFixed(1)),
        currency: e.currency ?? "EUR",
        // Supplied unconditionally: the template interpolates it, and a missing value renders
        // the literal `{{years}}` rather than nothing.
        years: e.termYears ?? "—",
      },
      backfill: false,
      verification: "editorial_review" as const,
      materiality: 0.8,
      actionability: 0.2,
    })),
  };
};

export const ADAPTERS = [
  { id: "parliament", run: parliamentAdapter },
  { id: "council", run: councilAdapter },
  { id: "opencalls", run: openCallsAdapter },
  { id: "elections", run: electionsAdapter },
  { id: "prices", run: pricesAdapter },
  { id: "macro", run: macroAdapter },
  { id: "budget", run: budgetAdapter },
  { id: "debt", run: domesticDebtAdapter },
  { id: "intl_debt", run: intlDebtAdapter },
] as const;

/**
 * How far a family's own vintage may fall behind the newest observation before the artifact
 * says so — the „stale source" half of the operational contract (plan §12.2 / Phase 6.3).
 *
 * ⚠️ IT IS A DECLARED EXPECTATION, NOT A DERIVED ONE, because nothing in the corpus states how
 * often a source is SUPPOSED to move. A number here is a claim someone made and can be argued
 * with; a threshold inferred from the data would just describe whatever the pipeline last did,
 * which is the failure it exists to detect.
 *
 * ⚠️ AND `null` IS „CANNOT GO STALE", NOT „DO NOT CHECK". Bulgaria's last two elections are 539
 * days apart — a ceiling loose enough for that detects nothing, so the honest answer is that
 * the family has no cadence at all. `intl_debt` is null because it publishes nothing.
 *
 * Measured against the 2026-09-01 corpus (lag in days behind `computedAt`): prices 1,
 * parliament 4, council 7, debt 8, macro 13, opencalls 23, budget 35, elections 135. Each
 * ceiling sits above its measured lag with room for one missed cycle; they are a first cut and
 * are meant to be tuned as the pipeline's real cadence is observed.
 *
 * ⚠️ KEYED TO THE ADAPTER-ID UNION, so a typo or a missing family is a COMPILE error. Typed
 * `Record<string, …>` it was neither: `pricess: 5` compiled, and the only thing that noticed a
 * missing entry was a test — while `home:health` silently skipped that family and reported it
 * as fine, because nobody asked. This is also why it sits below `ADAPTERS` rather than above.
 */
export const STALE_AFTER_DAYS: Record<
  (typeof ADAPTERS)[number]["id"],
  number | null
> = {
  // Daily crawl. Two missed days is already a story.
  prices: 5,
  // Sittings are weekly in session and stop for recess; a two-month silence is normal in
  // August, three is not.
  parliament: 90,
  // Sixteen councils, each on its own protocol schedule.
  council: 45,
  // ⚠️ THE STALEST ARM SPEAKS. ИСУН is crawled daily but ДФЗ's indicative schedule and the two
  // Interreg programmes are not, and `asOf` deliberately reports the slowest of the three.
  opencalls: 45,
  // Eurostat publishes monthly HICP about two and a half weeks after the month closes.
  macro: 60,
  // Promulgations and КФП periods are episodic; a whole quarter with neither is worth a look.
  budget: 120,
  // БНБ auctions run roughly monthly.
  debt: 75,
  // ⚠️ No cadence exists. See the header.
  elections: null,
  intl_debt: null,
};
