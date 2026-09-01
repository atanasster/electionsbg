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
// These four read COMMITTED sources, so the feed builds on a fresh clone with no database.
// A family whose source is absent is reported in `sourceCoverage`, never silently dropped —
// „we have nothing to show" and „we could not look" are different answers.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §6.2.

import fs from "node:fs";
import path from "node:path";
import type { HomeEventV1 } from "../../../../src/data/home/homeTypes";

export interface AdapterContext {
  root: string;
  /** Repo-relative reader; returns null when the source is absent. */
  readJson: <T>(rel: string) => T | null;
}

export interface AdapterResult {
  events: HomeEventV1[];
  /** The newest SOURCE date this adapter saw, as an ISO day. Feeds `computedAt`. */
  newest: string | null;
  available: boolean;
}

const isoDay = (v: string): string => v.slice(0, 10);
const atMidnight = (day: string): string => `${day}T00:00:00.000Z`;

/** ⚠️ `firstSeenAt` IS REQUIRED BY THE TYPE, so an adapter with no detection clock must put
 *  something honest there. These sources are committed files: the day the fact is dated is
 *  the earliest moment we can prove we had it, so it doubles as the floor. It is NEVER the
 *  displayed date unless `dateBasis` says `first_seen`. */
const seen = (day: string): string => atMidnight(day);

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
  if (!raw) return { events: [], newest: null, available: false };
  const sessions = Array.isArray(raw) ? raw : (raw.sessions ?? []);
  const rows = sessions.filter((s) => s?.date && Number.isFinite(s.items));
  const newest =
    rows
      .map((s) => isoDay(s.date))
      .sort()
      .at(-1) ?? null;

  return {
    available: true,
    newest,
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
      factArgs: { items: s.items, ...(s.ns ? { ns: s.ns } : {}) },
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

/** Committed shards, `data/council/<code>/<YYYY>/<id>.json`. Read directly rather than
 *  through `index.json`, whose per-município window is capped at 200 rows — the cap that
 *  left 530 resolutions on disk and unserved (see CLAUDE.md's council section). */
export const councilAdapter = (ctx: AdapterContext): AdapterResult => {
  const base = path.join(ctx.root, "data/council");
  if (!fs.existsSync(base))
    return { events: [], newest: null, available: false };

  const events: HomeEventV1[] = [];
  let newest: string | null = null;
  for (const code of fs.readdirSync(base)) {
    const codeDir = path.join(base, code);
    if (!fs.statSync(codeDir).isDirectory()) continue;
    for (const year of fs.readdirSync(codeDir)) {
      const yearDir = path.join(codeDir, year);
      if (!/^\d{4}$/.test(year) || !fs.statSync(yearDir).isDirectory())
        continue;
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
        if (!newest || day > newest) newest = day;
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
            ...(s.number ? { number: s.number } : {}),
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
  return { events, newest, available: true };
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
  if (!any) return { events: [], newest: null, available: false };

  // ⚠️ THE VINTAGE IS THE CRAWL DATE, NOT THE NEWEST EVENT DATE — and using the latter
  // COLLAPSES THE WHOLE FEED. A call may be published before it opens (`upcoming` is a
  // first-class status in `CallStatus`), so one row with `opensAt` in December drags this
  // adapter's `newest` into the future — and since `newest` feeds the feed's `computedAt`,
  // the 30-day window slides there with it. Measured with one injected 2026-12-01 call: 65
  // in-window events became 1, one category survived, and the page announced „данни към
  // 01.12.2026" for a corpus crawled in August. The snapshot carries `crawledAt` for
  // exactly this.
  const newest = [...crawls].sort().at(-1) ?? null;

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
      factKey: "home_fact_call_opened",
      factArgs: {
        title: r.title.slice(0, 120),
        ...(r.programmeName ? { programme: r.programmeName } : {}),
        // NULL money is „not published in the register", never zero — ИСУН's procedure page
        // frequently carries no budget at all.
        ...(typeof r.budgetEur === "number" ? { budgetEur: r.budgetEur } : {}),
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
  if (!rows) return { events: [], newest: null, available: false };
  const days = rows
    .map((r) => r?.name)
    .filter(Boolean)
    .map((n) => n.replace(/_/g, "-"));
  const newest = [...days].sort().at(-1) ?? null;
  return {
    available: true,
    newest,
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
      factArgs: { date: day },
      backfill: false,
      verification: "automatic" as const,
      // A national election is the most material thing in this corpus.
      materiality: 1,
      actionability: 0.6,
    })),
  };
};

export const ADAPTERS = [
  { id: "parliament", run: parliamentAdapter },
  { id: "council", run: councilAdapter },
  { id: "opencalls", run: openCallsAdapter },
  { id: "elections", run: electionsAdapter },
] as const;
