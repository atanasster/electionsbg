// Build the simulated "Recent activity" feed per município.
//
// Materializes events from data we already ingest — no new scraping. The
// feed is the V1 substitute for real email alerts (no auth yet), and
// doubles as a "what's notable in this município" digest once auth lands.
//
// Sources per município:
//   1. Council resolutions — top 3 freshest decisions (last 60 days)
//      from data/council/index.json for municipalities wired into the
//      council ingest (see COUNCIL_KEY_MAP). Ranks tagged+tally-bearing
//      rows above raw entries.
//   2. Procurement contracts — dated from awarder topContracts (real
//      contract-award dates)
//   2b. Tenders (announced procedures, BEFORE a contract) — municipal-tier
//      buyers' freshly-announced tenders, joined from
//      `tenders/recent_by_buyer.json` (emitted by ingest_tenders.ts; run it
//      before this builder). Estimated value labelled as a forecast; absent
//      file → tender events skipped.
//   3. EU-funded projects — surfaces a programmePeriod label
//      ("2014-2020" / "2021-2027" / "2021-RRP") instead of a fake "1 Jan
//      YYYY" date, since the programCode prefix only identifies the
//      programming frame, not a per-contract date
//   4. Local elections — the fixed 2023 regular-cycle mayor event, plus
//      the freshest extraordinary (частични / нови) elections from
//      data/chmi_history/<obshtina>.json (mayor by-elections + council
//      re-elections), dated by the actual election day

//   5. Capital programmes — one event per município that has a current-
//      year capital programme line
//   5b. Open calls — EU-programme / ДФЗ procedures still accepting applications
//      whose territory names THIS obshtina. Read from Postgres (open_calls,
//      migration 142), because "open" is derived at query time from closes_at
//      and does not exist in the committed snapshot. Deliberately excludes
//      NATIONAL calls: /funds/calls already serves those, and 265 identical
//      copies would drown the events that are genuinely local. Returns nothing
//      today — see opencalls_alerts.ts for exactly why, and what fills it.
//   6. Plenary roll-call mentions — when the MPs from this município's
//      MIR voted on a bill whose title contains the município name, emit
//      a "Your MP voted on…" event (keyword-alerts, simulated)
//
// Combined feed sorted by event date desc, capped at 30 per município to
// keep payloads small. Run as part of `npm run prod`.
//
// Run: `npx tsx scripts/myarea/build_alerts.ts`

import fs from "node:fs";
import { readFileSync } from "node:fs";
import { exec, withClient, end } from "../db/lib/pg";
import path from "node:path";
import { readMunicipalAwardersByEkatte } from "../db/lib/muni_awarders";
import {
  readCouncilAlertsByObshtina,
  type CouncilAlertRow,
} from "../db/lib/council_alerts";
import {
  readInterregByObshtina,
  type InterregAlertRow,
} from "../db/lib/interreg_alerts";
import {
  readOpenCallsByObshtina,
  type OpenCallAlertRow,
} from "../db/lib/opencalls_alerts";
import { canonicalObshtina } from "../../src/lib/obshtinaPlace";

type MunicipalityInfo = {
  ekatte: string;
  name: string;
  obshtina: string;
  oblast: string;
};

type ProcurementAwarder = {
  eik: string;
  name: string;
  tier?: string;
};

type ProcurementAwarderFile = {
  topContracts?: Array<{
    date: string;
    amount: number;
    amountEur?: number;
    currency?: string;
    partyName?: string;
    /** OCDS notice type — drives the announced/awarded/annex sub-label. */
    tag?: "award" | "contract" | "contractAmendment";
  }>;
};

type FundsContract = {
  contractNumber: string;
  title: string;
  totalEur?: number;
  programCode?: string;
  programName?: string;
  status?: string;
};

type FundsMuniFile = {
  contracts?: FundsContract[];
};

// data/funds/projects/changes/<obshtina>.json — new/modified contracts the
// ИСУН snapshot-diff detected in the most-recent ingest. Mirrors
// scripts/funds/projects_diff.ts FundsProjectChangesFile.
type FundsChange = {
  contractNumber: string;
  title: string;
  type: "new" | "modified";
  changedFields?: string[];
  prevTotalEur?: number;
  totalEur?: number;
  programName?: string;
  detectedAt: string;
};

type FundsChangesFile = {
  changes?: FundsChange[];
};

type LocalMunicipalityBundle = {
  cycle?: string;
  obshtinaName?: string;
  mayor?: {
    elected?: { candidateName?: string; localPartyName?: string } | null;
  };
};

// Per-município extraordinary-elections history (data/chmi_history/<code>.json),
// written by scripts/parsers_local/build_chmi_history.ts. Covers partial
// (частични) + new (нови) mayor by-elections and council re-elections.
type ChmiHistoryEvent = {
  date: string;
  kind: "obshtina_mayor" | "kmetstvo_mayor" | "rayon_mayor" | "council";
  obshtinaName: string;
  kmetstvoName: string | null;
  candidateName: string;
  localPartyName: string;
  councilSeatsWon?: number;
  councilTotalSeats?: number;
};

type ChmiHistoryShard = {
  obshtinaCode: string;
  events: ChmiHistoryEvent[];
};

type AlertEvent = {
  date: string; // YYYY-MM-DD
  kind:
    | "procurement"
    | "tender"
    | "eu_funds"
    | "local_election"
    | "capital_program"
    | "plenary_keyword"
    | "council_resolution"
    | "open_call";
  headline_bg: string;
  headline_en: string;
  amountEur?: number;
  link?: string;
  detail?: string;
  /** EU-funds rows only — "2014-2020", "2021-2027", "2021-RRP". When set,
   * the tile renders this in place of the (fake) date label. */
  programPeriod?: string;
  /** Procurement rows only — the OCDS notice type, so the feed can label a
   * contract announced (обявена) / awarded (възложена) / annex (анекс). */
  noticeType?: "announced" | "awarded" | "annex";
  /** EU-funds rows only — set on contracts the snapshot-diff flagged as a
   * brand-new project ("new") or a value/status change ("modified"). */
  changeType?: "new" | "modified";
};

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const MUNICIPALITIES_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");
const PROC_AWARDERS = path.join(PROJECT_ROOT, "data/procurement/awarders");
const TENDERS_RECENT = path.join(
  PROJECT_ROOT,
  "data/procurement/tenders/recent_by_buyer.json",
);
const FUNDS_BY_MUNI = path.join(PROJECT_ROOT, "data/funds/projects/by-muni");
const FUNDS_CHANGES = path.join(PROJECT_ROOT, "data/funds/projects/changes");
const LOCAL_CYCLE_DIR = path.join(
  PROJECT_ROOT,
  "data/2023_10_29_mi/municipalities",
);
const CHMI_HISTORY_DIR = path.join(PROJECT_ROOT, "data/chmi_history");
const CAPITAL_PROGRAMS = path.join(
  PROJECT_ROOT,
  "data/budget/capital_programs",
);
const VOTES_SESSIONS = path.join(
  PROJECT_ROOT,
  "data/parliament/votes/sessions",
);
// data/myarea/alerts/ IS NO LONGER WRITTEN — json-retirement-v2 Tier 4b moved the feed into
// Postgres (myarea_alerts, migration 184). 290 files were rebuilt and re-uploaded to the
// bucket EVERY DAY; data/myarea/ was the highest churn-per-byte tree in the repo at 14,746
// file-touches over 300 commits, none of which anyone ever diffed.
//
// ⚠️ THE COMPOSITION STAYS HERE, and 184's header says why: these ten builders emit BILINGUAL
// HEADLINES, and translated user-facing prose does not belong in a migration. Only the
// STORAGE moved.
const ALERTS_SCHEMA = path.join(
  PROJECT_ROOT,
  "scripts/db/schema/pg/184_myarea_alerts.sql",
);
// data/myarea/place_tenders/ IS NO LONGER WRITTEN — json-retirement-v2 Tier 4a moved the
// tile to Postgres (migration 179, /api/db/myarea-place-tenders). This builder was
// regenerating and re-uploading 265 files a day that were a pure cache of the `tenders`
// table, with the window, the per-buyer cap and the cancelled-exclusion all reproducible in
// SQL. `buildPlaceTenderSummary` and its `recentTenders()` read went with it.
//
// ⚠️ `recentTenders()` ITSELF STAYS — buildTenderEvents() below still uses it for the
// alerts feed's "freshly announced procedure" events, which is a different artifact with a
// different shape. Removing the file read along with the shard writer would have emptied
// those events silently.

// Per-município event cap. 30 keeps the JSON ~5 KB even for active
// municípios; the SPA tile renders the top 20 by default.
const EVENT_CAP = 30;
// Procurement contracts per awarder to consider (we keep top 3 per muni-
// tier awarder, then merge & cap).
const PROC_PER_AWARDER = 3;
// EU contracts per município to surface (top by totalEur).
const FUNDS_TOP_N = 5;
// EU new/modified contracts per município to surface (most recent ingest's
// diff, top by value). Dated by the real detectedAt day so they sort honestly
// to the top of the feed, unlike the in-progress rows' synthetic period date.
const FUNDS_CHANGES_TOP_N = 5;
// Plenary keyword cap.
const PLENARY_TOP_N = 5;
// Council resolution cap + freshness window. Sofia votes weekly with
// 20+ items/session; without a cap the feed would become a council log.
// Keep the top 3 freshest tagged rows from the last 60 days.
const COUNCIL_TOP_N = 3;
const COUNCIL_LOOKBACK_DAYS = 60;
// How many dissenters to name inline before collapsing to a +N count.
const COUNCIL_DISSENT_NAMES = 3;
// Extraordinary (partial / new) elections per município. Capped so a long
// by-election history (e.g. a Столична район) can't flood the digest; the
// freshest events sort to the top of the feed anyway.
const CHMI_TOP_N = 6;

// The obshtina -> council code bridge used to live here, as a hand-maintained
// COUNCIL_KEY_MAP whose own comment said it mirrored councilObshtinaMap.ts —
// the THIRD copy of that mapping. It is gone: council_muni_code is the single
// definition and readCouncilAlertsByObshtina() resolves through it in SQL, the
// same path the serving functions take. A mapping kept in three places is how a
// município silently renders nothing, which is the failure councilObshtinaMap.ts
// was created to fix.

const readJson = <T>(p: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
};

// Infer programming period + a sort-order date from a contract's
// programCode. Formats observed: "2014BG16M1OP002" → 2014-2020 frame,
// "2021BG-RRP" → 2021-RRP (Recovery + Resilience), "2021BG…" otherwise →
// 2021-2027 frame. The contract has no real per-contract date — the
// programCode prefix only identifies the programming period. We emit
// `programPeriod` for display and a midpoint date for sort ordering so
// EU rows don't dominate the top of the feed.
const inferFundsPeriod = (
  programCode?: string,
): { sortDate: string; programPeriod: string } => {
  if (programCode?.startsWith("2014")) {
    return { sortDate: "2017-01-01", programPeriod: "2014-2020" };
  }
  if (programCode?.includes("RRP")) {
    return { sortDate: "2023-01-01", programPeriod: "2021-RRP" };
  }
  if (programCode?.startsWith("2021")) {
    return { sortDate: "2024-01-01", programPeriod: "2021-2027" };
  }
  return { sortDate: "2017-01-01", programPeriod: "2014-2020" };
};

// Format a EUR amount for the headline. Compact (1.2M, 540K) when large
// so the headline stays readable on mobile.
const formatEur = (n?: number): string => {
  if (!n || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `€${(n / 1_000).toFixed(0)}K`;
  return `€${n.toFixed(0)}`;
};

// `muniAwarders` is the município's municipal-tier awarders, resolved once in
// main from its centroid by_settlement file and shared with the tender builders.
const buildProcurementEvents = (
  muniAwarders: ProcurementAwarder[],
): AlertEvent[] => {
  const events: AlertEvent[] = [];
  for (const aw of muniAwarders) {
    const file = readJson<ProcurementAwarderFile>(
      path.join(PROC_AWARDERS, `${aw.eik}.json`),
    );
    if (!file?.topContracts) continue;
    const sorted = file.topContracts
      .filter((c) => c.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, PROC_PER_AWARDER);
    for (const c of sorted) {
      const eur =
        c.amountEur ?? (c.currency === "EUR" ? c.amount : c.amount / 1.95583);
      const noticeType =
        c.tag === "award"
          ? ("announced" as const)
          : c.tag === "contractAmendment"
            ? ("annex" as const)
            : ("awarded" as const);
      const labelBg =
        noticeType === "announced"
          ? "Обявена поръчка"
          : noticeType === "annex"
            ? "Анекс към поръчка"
            : "Възложена поръчка";
      const labelEn =
        noticeType === "announced"
          ? "Tender announced"
          : noticeType === "annex"
            ? "Contract amendment"
            : "Contract awarded";
      events.push({
        date: c.date,
        kind: "procurement",
        noticeType,
        headline_bg: `${labelBg}: ${aw.name} → ${c.partyName ?? "—"} · ${formatEur(eur)}`,
        headline_en: `${labelEn}: ${aw.name} → ${c.partyName ?? "—"} · ${formatEur(eur)}`,
        amountEur: eur,
      });
    }
  }
  return events;
};

// Tender-STAGE events: a freshly ANNOUNCED procedure (before any contract) by a
// municipal-tier buyer pinned to this município. Joins the município's awarders
// (same by_settlement pinning as the contract events) against the recent-tenders
// map emitted by ingest_tenders.ts. Estimated value is a forecast — labelled.
type RecentTender = {
  unp: string;
  subject: string;
  estimatedValueEur?: number;
  publicationDate: string;
  isCancelled: boolean;
};
type RecentByBuyer = {
  since?: string;
  buyers?: Record<string, RecentTender[]>;
};
// Loaded once (it's a single ~2-3 MB map); absent → tender alerts are skipped.
let recentTendersCache: RecentByBuyer | null | undefined;
const recentTenders = (): RecentByBuyer | null => {
  if (recentTendersCache === undefined)
    recentTendersCache = readJson<RecentByBuyer>(TENDERS_RECENT) ?? null;
  return recentTendersCache;
};

const buildTenderEvents = (
  muniAwarders: ProcurementAwarder[],
): AlertEvent[] => {
  const recent = recentTenders();
  if (!recent?.buyers) return [];
  const events: AlertEvent[] = [];
  for (const aw of muniAwarders) {
    for (const t of recent.buyers[aw.eik] ?? []) {
      const labelBg = t.isCancelled ? "Прекратена поръчка" : "Обявена поръчка";
      const labelEn = t.isCancelled ? "Tender cancelled" : "Tender announced";
      const valBg = t.estimatedValueEur
        ? ` · ${formatEur(t.estimatedValueEur)} (прогнозна)`
        : "";
      const valEn = t.estimatedValueEur
        ? ` · ${formatEur(t.estimatedValueEur)} (estimated)`
        : "";
      events.push({
        date: t.publicationDate,
        kind: "tender",
        headline_bg: `${labelBg}: ${aw.name} · ${t.subject.slice(0, 70)}${valBg}`,
        headline_en: `${labelEn}: ${aw.name} · ${t.subject.slice(0, 70)}${valEn}`,
        amountEur: t.estimatedValueEur,
        link: `/tenders/${t.unp}`,
      });
    }
  }
  return events;
};

// EU contracts don't carry per-contract dates — only a programCode whose
// prefix indicates the programming period (2014BG.. = 2014-2020 frame,
// 2021BG.. = 2021-2027 frame including RRP). Showing a contract from the
// 2014-2020 frame as "1 Jan 2014" in a "Recent activity" feed is
// misleading; the contract could be from any year in that range and is
// probably already closed.
//
// Filter to "В изпълнение" (in-progress) status — those are actively
// running contracts so "recent" framing is honest. The tile renders these
// events without a literal date label (see MyAreaAlertsTile).
const buildFundsEvents = (obshtina: string): AlertEvent[] => {
  // New/modified change events come from the committed `changes/` artifact and
  // must surface even when the gitignored `by-muni/` corpus file isn't present
  // (e.g. a checkout without a bucket sync) — so resolve them before the
  // in-progress guard, never coupling them to the heavier per-muni shard.
  const changeEvents = buildFundsChangeEvents(obshtina);
  const file = readJson<FundsMuniFile>(
    path.join(FUNDS_BY_MUNI, `${obshtina}.json`),
  );
  if (!file?.contracts) return changeEvents;
  const inProgress = file.contracts.filter((c) =>
    (c.status ?? "").includes("изпълнение"),
  );
  const top = inProgress
    .slice()
    .sort((a, b) => (b.totalEur ?? 0) - (a.totalEur ?? 0))
    .slice(0, FUNDS_TOP_N);
  const inProgressEvents: AlertEvent[] = top.map((c) => {
    const { sortDate, programPeriod } = inferFundsPeriod(c.programCode);
    return {
      date: sortDate,
      kind: "eu_funds",
      headline_bg: `Еврофонд: „${c.title}" · ${formatEur(c.totalEur)}`,
      headline_en: `EU funds: "${c.title}" · ${formatEur(c.totalEur)}`,
      amountEur: c.totalEur,
      detail: c.programName,
      programPeriod,
    };
  });
  return [...changeEvents, ...inProgressEvents];
};

// Interreg operations for one municipality.
//
// These are `eu_funds` events like the ИСУН ones and are LABELLED Interreg,
// because they are a different corpus on a different basis: ИСУН holds zero
// Interreg projects (a system boundary — Interreg runs on Jems), and since
// Interreg is cross-border by definition its money lands almost entirely on
// border municipalities. Those are exactly the places whose feed was an
// undercount, so an unlabelled row would silently change what "еврофонд" has
// meant here.
//
// `budgetEur` is the BULGARIAN PARTNER's own budget, summed over that
// municipality's partners on the operation — never the cross-border project
// total, which on BSB00963 is €1,419,208 against Малко Търново's €357,183.
const buildInterregEvents = (rows: InterregAlertRow[]): AlertEvent[] =>
  rows.map((r) => {
    const title = r.titleBg ?? r.titleEn;
    const amount = r.budgetEur != null ? ` · ${formatEur(r.budgetEur)}` : "";
    return {
      // The operation's own start date where keep.eu published one. Unlike the
      // ИСУН in-progress rows — whose dates are inferred from a programme
      // period and so are deliberately unlabelled in the tile — this is a real
      // per-project date.
      date: r.startDate ?? `${r.period.slice(0, 4)}-01-01`,
      kind: "eu_funds",
      headline_bg: `Interreg: „${title}"${amount}`,
      headline_en: `Interreg: "${title}"${amount}`,
      ...(r.budgetEur != null ? { amountEur: r.budgetEur } : {}),
      detail: r.programmeName ?? undefined,
      programPeriod: r.period,
    };
  });

// OPEN CALLS — the only FORWARD-LOOKING events in this feed, which is why they need their own
// kind rather than riding `eu_funds`.
//
// THE EVENT DATE IS `first_seen_at`, NOT THE DEADLINE, and that is the whole reason this is
// expressible as a feed event at all. Every other row here is "something happened, on this date",
// and the feed sorts by date desc; dating a call by its closing date would park it permanently at
// the top and quietly redefine the axis. „We first saw this procedure" IS a past event, and it
// sorts naturally beside a contract award. Stated plainly because `first_seen_at` is when WE
// looked, not when ИСУН published — neither register publishes a publication date on its listing,
// so this is the best available proxy and the deadline goes in the headline where it belongs.
//
// The deadline is the actionable fact, so it leads the headline. `daysLeft` comes from the same
// query-time derivation the page uses, so an expired call cannot reach here.
export const buildOpenCallEvents = (rows: OpenCallAlertRow[]): AlertEvent[] =>
  rows.map((r) => {
    const day = r.closesAt.slice(0, 10);
    const left = r.daysLeft !== null ? ` (${r.daysLeft} дни)` : "";
    const leftEn = r.daysLeft !== null ? ` (${r.daysLeft}d)` : "";
    // NULL money is „not published in the register", never zero — ИСУН's procedure page carries
    // no budget at all. An amount is only ever shown when the source published one.
    const amount = r.budgetEur != null ? ` · ${formatEur(r.budgetEur)}` : "";
    return {
      date: r.firstSeenAt.slice(0, 10),
      kind: "open_call" as const,
      headline_bg: `Отворена процедура до ${day}${left}: „${r.title}"${amount}`,
      headline_en: `Open call, deadline ${day}${leftEn}: "${r.title}"${amount}`,
      ...(r.budgetEur != null ? { amountEur: r.budgetEur } : {}),
      detail: r.programmeName ?? r.code ?? undefined,
      link: r.sourceUrl,
    };
  });

/** municipality NAME → the obshtina CODE(s) it denotes, excluding Sofia rayons. Extracted so the
 *  rayon exclusion and the fan-out are testable — see the header at the call site for why each is
 *  what it is. */
export const buildCodesByName = (
  munis: { name: string; obshtina: string }[],
): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const m of munis) {
    // S2*** is a Sofia RAYON, not a municipality. A territory is written at municipality grain, so
    // it never denotes one — and Искър/Средец each collide with a rayon, so without this a Pleven
    // or Burgas call lands in a Sofia district's feed.
    if (/^S2\d/u.test(m.obshtina)) continue;
    const list = out.get(m.name) ?? [];
    list.push(m.obshtina);
    out.set(m.name, list);
  }
  return out;
};

// New / modified EU contracts the snapshot-diff flagged in the most-recent
// ingest (data/funds/projects/changes/<obshtina>.json). Unlike the in-progress
// rows, these carry a real detectedAt date so they surface at the top of the
// feed when fresh. The directory is reset each ingest, so a município with no
// recent changes simply has no file (skipped).
const buildFundsChangeEvents = (obshtina: string): AlertEvent[] => {
  const file = readJson<FundsChangesFile>(
    path.join(FUNDS_CHANGES, `${obshtina}.json`),
  );
  if (!file?.changes?.length) return [];
  const top = file.changes
    .slice()
    .sort((a, b) => (b.totalEur ?? 0) - (a.totalEur ?? 0))
    .slice(0, FUNDS_CHANGES_TOP_N);
  return top.map((c) => {
    const isNew = c.type === "new";
    const labelBg = isNew ? "Нов проект от еврофонд" : "Промяна по проект";
    const labelEn = isNew ? "New EU-funds project" : "EU-funds project changed";
    return {
      date: c.detectedAt,
      kind: "eu_funds" as const,
      changeType: c.type,
      headline_bg: `${labelBg}: „${c.title}" · ${formatEur(c.totalEur)}`,
      headline_en: `${labelEn}: "${c.title}" · ${formatEur(c.totalEur)}`,
      amountEur: c.totalEur,
      detail: c.programName,
    };
  });
};

const buildLocalElectionEvent = (obshtina: string): AlertEvent | null => {
  const file = readJson<LocalMunicipalityBundle>(
    path.join(LOCAL_CYCLE_DIR, `${obshtina}.json`),
  );
  if (!file || !file.mayor?.elected) return null;
  const elected = file.mayor.elected;
  return {
    date: "2023-10-29",
    kind: "local_election",
    headline_bg: `Местни избори 2023: избран кмет — ${elected.candidateName} (${elected.localPartyName ?? "?"})`,
    headline_en: `2023 local elections: mayor elected — ${elected.candidateName} (${elected.localPartyName ?? "?"})`,
  };
};

// Extraordinary (частични / нови) elections held between regular cycles — the
// freshest local-democracy activity in a място (e.g. the June 2026 частични
// избори). Dated by the actual election day so they sort to the top of the
// feed, unlike the fixed 2023 cycle event above.
const buildChmiElectionEvents = (obshtina: string): AlertEvent[] => {
  const shard = readJson<ChmiHistoryShard>(
    path.join(CHMI_HISTORY_DIR, `${obshtina}.json`),
  );
  if (!shard?.events?.length) return [];
  const recent = [...shard.events]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, CHMI_TOP_N);
  return recent.map((e) => {
    const party = e.localPartyName || "?";
    if (e.kind === "council") {
      const seatsBg =
        e.councilSeatsWon != null && e.councilTotalSeats != null
          ? ` (${e.councilSeatsWon}/${e.councilTotalSeats} места)`
          : "";
      const seatsEn =
        e.councilSeatsWon != null && e.councilTotalSeats != null
          ? ` (${e.councilSeatsWon}/${e.councilTotalSeats} seats)`
          : "";
      return {
        date: e.date,
        kind: "local_election" as const,
        headline_bg: `Нов избор за общински съвет: водеща партия ${party}${seatsBg}`,
        headline_en: `New municipal council election: leading party ${party}${seatsEn}`,
      };
    }
    const placeName = e.kmetstvoName ?? e.obshtinaName;
    const roleBg =
      e.kind === "kmetstvo_mayor"
        ? `кмет на кметство ${placeName}`
        : e.kind === "rayon_mayor"
          ? `кмет на район ${placeName}`
          : "кмет на община";
    const roleEn =
      e.kind === "kmetstvo_mayor"
        ? `kmetstvo mayor (${placeName})`
        : e.kind === "rayon_mayor"
          ? `district mayor (${placeName})`
          : "municipal mayor";
    return {
      date: e.date,
      kind: "local_election" as const,
      headline_bg: `Извънредни местни избори: избран ${roleBg} — ${e.candidateName} (${party})`,
      headline_en: `By-election: ${roleEn} elected — ${e.candidateName} (${party})`,
    };
  });
};

const buildCapitalProgramEvents = (obshtina: string): AlertEvent[] => {
  if (!fs.existsSync(CAPITAL_PROGRAMS)) return [];
  const years = fs
    .readdirSync(CAPITAL_PROGRAMS)
    .filter((y) => /^\d{4}$/.test(y));
  const events: AlertEvent[] = [];
  for (const year of years) {
    const file = path.join(CAPITAL_PROGRAMS, year, `${obshtina}.json`);
    if (!fs.existsSync(file)) continue;
    events.push({
      date: `${year}-01-01`,
      kind: "capital_program",
      headline_bg: `Капиталова програма ${year} приета`,
      headline_en: `${year} capital programme adopted`,
    });
  }
  return events;
};

// Plenary keyword match — for each município, check the last 90 days of
// vote sessions for items whose title contains the município name. Each
// hit becomes a "Your MPs voted on a bill mentioning Х" event. This is
// the simulated keyword-alerts feature (no auth yet).
type SessionFile = {
  date?: string;
  itemTitles?: Record<string, string>;
};

const PLENARY_LOOKBACK_DAYS = 90;

const buildPlenaryKeywordEvents = (
  obshtina: string,
  obshtinaName: string,
): AlertEvent[] => {
  if (!fs.existsSync(VOTES_SESSIONS)) return [];
  // Recent sessions only — anything older than ~3 months gets stale fast
  // for "alerts" framing. The script can be re-run any time to refresh.
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - PLENARY_LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const files = fs
    .readdirSync(VOTES_SESSIONS)
    .filter((f) => f.endsWith(".json") && f.slice(0, 10) >= cutoffStr);
  const needle = obshtinaName.toLowerCase();
  // Skip very short município names that would create too many false
  // positives (e.g. one-syllable names that appear inside other words).
  if (needle.length < 4) return [];
  const events: AlertEvent[] = [];
  for (const f of files) {
    const sess = readJson<SessionFile>(path.join(VOTES_SESSIONS, f));
    if (!sess?.itemTitles || !sess.date) continue;
    for (const title of Object.values(sess.itemTitles)) {
      if (typeof title !== "string") continue;
      if (title.toLowerCase().includes(needle)) {
        events.push({
          date: sess.date,
          kind: "plenary_keyword",
          headline_bg: `Парламентът разглеждаше: „${title.slice(0, 120)}${title.length > 120 ? "…" : ""}"`,
          headline_en: `Parliament debated: "${title.slice(0, 120)}${title.length > 120 ? "…" : ""}"`,
        });
      }
    }
  }
  void obshtina;
  // Dedupe by headline (same title can appear across multiple sessions)
  // and cap.
  const seen = new Set<string>();
  const out: AlertEvent[] = [];
  for (const e of events.sort((a, b) => b.date.localeCompare(a.date))) {
    if (seen.has(e.headline_bg)) continue;
    seen.add(e.headline_bg);
    out.push(e);
    if (out.length >= PLENARY_TOP_N) break;
  }
  return out;
};

// Council resolutions are the freshest "what just happened" signal for any
// município wired into the council ingest. Top COUNCIL_TOP_N from the last
// COUNCIL_LOOKBACK_DAYS, ranked so named-vote and tally-bearing rows outrank
// bare ones. The window is applied in SQL (council_alerts.ts).
const councilRank = (r: CouncilAlertRow): number => {
  // A CONTESTED decision outranks everything. Without this arm the feed
  // selects away the one event type this whole tier exists to enable: ranking
  // on hasNamedVotes alone ties every resolution from the same council, the
  // date tiebreak ties again within a session, and the winner falls out of `id`
  // order — measured, 4 of the 6 dissent-bearing resolutions in the current
  // window lost their slot to same-day unanimous items.
  //
  // `tags` used to be the primary signal and is gone with the JSON index: 0 of
  // that file's 2,735 rows and 0 of Postgres's 4,727 ever carried one, so it
  // only ever contributed 0.
  const contested = r.hasNamedVotes && r.againstNames.length > 0 ? 1 : 0;
  const named = r.hasNamedVotes ? 1 : 0;
  const tallied = r.tallyFor != null ? 1 : 0;
  return contested * 4 + named * 2 + tallied;
};

/**
 * Top COUNCIL_TOP_N recent decisions for one município.
 *
 * The freshness window is applied in SQL, so `rows` is already inside it.
 *
 * Named votes are gated on the resolution's own `hasNamedVotes`, never on the
 * against-list being non-empty: 11 of the 16 councils publish an aggregate
 * only, and a unanimous decision in a council that DOES publish names has an
 * empty against-list for a completely different reason. Conflating the two
 * would put "0 against" on a council that recorded nothing.
 */
const buildCouncilResolutionEvents = (
  rows: CouncilAlertRow[] | undefined,
): AlertEvent[] => {
  if (!rows || rows.length === 0) return [];
  const ranked = [...rows].sort((a, b) => {
    const rb = councilRank(b) - councilRank(a);
    if (rb !== 0) return rb;
    return b.decidedOn.localeCompare(a.decidedOn);
  });
  return ranked.slice(0, COUNCIL_TOP_N).map((r) => {
    const title = r.summaryBg ?? r.title;
    const title_en = r.summaryEn ?? r.title;
    const tally =
      r.tallyFor != null
        ? `${r.tallyFor ?? 0}–${r.tallyAgainst ?? 0}–${r.tallyAbstain ?? 0}`
        : undefined;
    // The named-vote half — newly expressible, and the reason this source moved
    // to Postgres. Only the councillors who voted AGAINST are named: abstention
    // is the explicit refusal to take a side, so listing it as opposition would
    // attribute a position to someone who declined to take one.
    const dissent =
      r.hasNamedVotes && r.againstNames.length > 0
        ? r.againstNames.slice(0, COUNCIL_DISSENT_NAMES).join(", ") +
          (r.againstNames.length > COUNCIL_DISSENT_NAMES
            ? ` +${r.againstNames.length - COUNCIL_DISSENT_NAMES}`
            : "")
        : undefined;
    const detail = [tally, dissent ? `против: ${dissent}` : undefined]
      .filter(Boolean)
      .join(" · ");
    return {
      date: r.decidedOn,
      kind: "council_resolution",
      headline_bg: `Общинският съвет гласува: ${title}`,
      headline_en: `Municipal council voted: ${title_en}`,
      // OUR page for the decision, not the municipality's PDF. It carries the
      // full named vote, and it is one of the few inbound links the
      // function-served /council/resolution family has.
      link: `/council/resolution/${r.id}`,
      detail: detail || undefined,
    };
  });
};

const main = async () => {
  // One query for every settlement — procurement_settlement_detail() re-runs the whole
  // per-settlement aggregation per call, and this walks ~265 municípios.
  const muniAwardersByEkatte = await readMunicipalAwardersByEkatte();
  // One query for all ~265 municipalities, like the line above. Fails soft to
  // an empty map on a database without the corpus, so an alerts run never
  // depends on Interreg having been loaded.
  const interregByObshtina = await readInterregByObshtina();
  const composed: Array<{ obshtina: string; events: AlertEvent[] }> = [];
  const munis = readJson<MunicipalityInfo[]>(MUNICIPALITIES_FILE);
  // STATED, NOT SILENT: data/municipalities.json has no Sofia-city row at all —
  // only the 24 S23xx rayons — while interreg_partners places every Sofia
  // partner under the synthetic SFO_CITY. So the single largest bucket in that
  // map, 231 operations and €88,655,624, has no municipality file to land in.
  // Fanning it across the rayons would be inventing an attribution keep.eu
  // never published (the corpus places to the municipality, not the rayon), so
  // the honest behaviour is to leave it out and say so on every run. Any other
  // unmatched key is a real vocabulary drift and shows up in the same line.
  const alertMuniCodes = new Set(
    (munis ?? []).map((m) => canonicalObshtina(m.obshtina) ?? m.obshtina),
  );
  const orphanInterreg = [...interregByObshtina.keys()].filter(
    (k) => !alertMuniCodes.has(k),
  );
  if (orphanInterreg.length)
    console.warn(
      `alerts: ${orphanInterreg.length} Interreg obshtina code(s) have no ` +
        `municipality file and emit no events: ${orphanInterreg.join(", ")}`,
    );
  if (!munis) {
    console.error(`failed to read municipalities`);
    process.exit(1);
  }
  // OPEN CALLS need the reverse map: the reader matches a free-text `territory` against
  // municipality NAMES (the only place binding either register publishes), while every feed is
  // keyed by CODE.
  //
  // THREE names collide in this file, and only ONE of them is a genuine cross-oblast ambiguity:
  //   Бяла   → VAR05 (Варна)  + RSE04 (Русе)   — two real municipalities
  //   Искър  → PVN23 (Плевен) + S2414          — the second is a SOFIA RAYON
  //   Средец → BGS06 (Бургас) + S2401          — the second is a SOFIA RAYON
  // A territory is written at MUNICIPALITY grain („на територията на община Средец"), so it never
  // denotes a Sofia district — and fanning out to the rayon would put a Burgas call in a Sofia feed,
  // a place it has nothing to do with. The S2*** codes are therefore excluded from the name map
  // outright; the neighbouring Interreg arm documents the same rayons-are-not-municipalities point.
  // `Бяла` genuinely cannot be disambiguated from the name alone, so it fans out to both — the
  // alternative, picking one, is silently wrong half the time.
  const codesByName = buildCodesByName(munis);
  const openCallsByName = await readOpenCallsByObshtina([
    ...codesByName.keys(),
  ]);
  const openCallsByObshtina = new Map<string, OpenCallAlertRow[]>();
  for (const [name, rows] of openCallsByName)
    for (const code of codesByName.get(name) ?? [])
      openCallsByObshtina.set(code, [
        ...(openCallsByObshtina.get(code) ?? []),
        ...rows,
      ]);
  if (openCallsByName.size === 0)
    // NOT silent. Zero is the correct answer on today's corpus (see opencalls_alerts.ts: all 55
    // ИСУН rows carry no territory at all), but it is also what a database missing migration 142
    // looks like, and the two must not be indistinguishable on the console.
    console.warn(
      "alerts: no place-scoped open calls — expected while ИСУН publishes no " +
        "territory (Stage 7 enrichment fills it); also what an unloaded open_calls looks like.",
    );

  // One query for every município, keyed by FRONTEND code and already inside
  // the freshness window. Throws rather than degrading — see council_alerts.ts.
  const councilByObshtina = await readCouncilAlertsByObshtina(
    COUNCIL_LOOKBACK_DAYS,
  );
  let totalEvents = 0;
  let municipiosWithEvents = 0;
  let councilEvents = 0;
  for (const m of munis) {
    const council = buildCouncilResolutionEvents(
      councilByObshtina.get(m.obshtina),
    );
    councilEvents += council.length;
    // The município's municipal-tier awarders, shared across the contract + tender
    // builders (F-009). Sourced from Postgres — the by_settlement shards this used to read
    // were retired with the rest of that static tree — and already filtered to the
    // municipal tier by the query.
    const muniAwarders = muniAwardersByEkatte.get(m.ekatte) ?? [];
    const allEvents: AlertEvent[] = [
      ...council,
      ...buildProcurementEvents(muniAwarders),
      ...buildTenderEvents(muniAwarders),
      ...buildFundsEvents(m.obshtina),
      // canonicalObshtina folds SOF/SOF00 → SFO_CITY, the spelling
      // interreg_partners uses. It is a no-op for every code in
      // municipalities.json today (see the SFO_CITY note in main()) but it is
      // the correct fold, and without it a future Sofia-city row would miss.
      ...buildInterregEvents(
        interregByObshtina.get(canonicalObshtina(m.obshtina) ?? m.obshtina) ??
          [],
      ),
      ...buildOpenCallEvents(openCallsByObshtina.get(m.obshtina) ?? []),
      ...buildCapitalProgramEvents(m.obshtina),
      ...buildPlenaryKeywordEvents(m.obshtina, m.name),
    ];
    const local = buildLocalElectionEvent(m.obshtina);
    if (local) allEvents.push(local);
    allEvents.push(...buildChmiElectionEvents(m.obshtina));
    if (allEvents.length === 0) continue;
    allEvents.sort((a, b) => b.date.localeCompare(a.date));
    const trimmed = allEvents.slice(0, EVENT_CAP);
    // Collected for ONE upsert after the loop rather than written per município: 290 files
    // rebuilt and re-uploaded daily was the highest churn-per-byte tree in the repo, and
    // 290 single-row round trips over the Cloud SQL proxy is the wrong shape for the same
    // reason vote_day's insert is batched.
    composed.push({ obshtina: m.obshtina, events: trimmed });
    totalEvents += trimmed.length;
    municipiosWithEvents++;
  }
  console.log(
    `Composed ${municipiosWithEvents} per-município feeds (${totalEvents} total events, ${councilEvents} council)`,
  );

  // ⚠️ UPSERT, NEVER an anti-join merge. A município whose sources are all quiet this run
  // legitimately composes NO events and is simply absent from `composed` — deleting its row
  // for that would blank a feed that was correct yesterday, on the strength of one quiet
  // day. Absence is recorded by `refreshed_at` not moving, the same rule open_calls follows.
  //
  // ONE statement, not 290 round trips: this loader runs over the Cloud SQL proxy, where
  // per-row round trips are what dominate (CLAUDE.md measures the rollcall facts load at
  // ~10 min for exactly that reason).
  await exec(readFileSync(ALERTS_SCHEMA, "utf8"));
  if (composed.length) {
    const vals: unknown[] = [];
    const tuples = composed.map((c, i) => {
      const newest = c.events[0]?.date ?? null;
      vals.push(c.obshtina, JSON.stringify(c.events), c.events.length, newest);
      const b = i * 4;
      return `($${b + 1}, $${b + 2}::jsonb, $${b + 3}, $${b + 4}::date, now())`;
    });
    await withClient(async (c) => {
      await c.query(
        `INSERT INTO myarea_alerts (obshtina, events, event_count, newest_event, refreshed_at)
              VALUES ${tuples.join(", ")}
         ON CONFLICT (obshtina) DO UPDATE
            SET events = EXCLUDED.events,
                event_count = EXCLUDED.event_count,
                newest_event = EXCLUDED.newest_event,
                refreshed_at = now()`,
        vals,
      );
    });
    console.log(`  ✓ upserted ${composed.length} feed(s) into myarea_alerts`);
  }
  await end();
};

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  // Close the pool on the ERROR path too. Without this the process lingers until node's
  // socket timeout — measured 10.7 s — which in an unattended chain reads as a hang rather
  // than a failure. `end()` is idempotent, so this is safe after a successful main() that
  // already called it.
  await end().catch(() => {});
});
