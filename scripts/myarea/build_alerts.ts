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
//   3. EU-funded projects — surfaces a programmePeriod label
//      ("2014-2020" / "2021-2027" / "2021-RRP") instead of a fake "1 Jan
//      YYYY" date, since the programCode prefix only identifies the
//      programming frame, not a per-contract date
//   4. Local-election cycle — fixed event for municípios with a 2023
//      bundle (and any future cycle when the parsers add it)
//   5. Capital programmes — one event per município that has a current-
//      year capital programme line
//   6. Plenary roll-call mentions — when the MPs from this município's
//      MIR voted on a bill whose title contains the município name, emit
//      a "Your MP voted on…" event (keyword-alerts, simulated)
//
// Combined feed sorted by event date desc, capped at 30 per município to
// keep payloads small. Run as part of `npm run prod`.
//
// Run: `npx tsx scripts/myarea/build_alerts.ts`

import fs from "node:fs";
import path from "node:path";

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

type ProcurementBySettlement = {
  awarders?: ProcurementAwarder[];
};

type ProcurementAwarderFile = {
  topContracts?: Array<{
    date: string;
    amount: number;
    amountEur?: number;
    currency?: string;
    partyName?: string;
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

type LocalMunicipalityBundle = {
  cycle?: string;
  obshtinaName?: string;
  mayor?: {
    elected?: { candidateName?: string; localPartyName?: string } | null;
  };
};

type CouncilTag =
  | "financial"
  | "personnel"
  | "urban_planning"
  | "procurement"
  | "social"
  | "other";

type CouncilTally = {
  for?: number;
  against?: number;
  abstain?: number;
};

type CouncilResolution = {
  id: string;
  date: string;
  title: string;
  tally?: CouncilTally;
  result?: string;
  summary_bg?: string;
  summary_en?: string;
  tags?: CouncilTag[];
  sourceUrl?: string;
};

type CouncilIndexFile = {
  resolutionsByObshtina: Record<string, CouncilResolution[]>;
};

type AlertEvent = {
  date: string; // YYYY-MM-DD
  kind:
    | "procurement"
    | "eu_funds"
    | "local_election"
    | "capital_program"
    | "plenary_keyword"
    | "council_resolution";
  headline_bg: string;
  headline_en: string;
  amountEur?: number;
  link?: string;
  detail?: string;
  /** EU-funds rows only — "2014-2020", "2021-2027", "2021-RRP". When set,
   * the tile renders this in place of the (fake) date label. */
  programPeriod?: string;
};

type AlertsFile = {
  obshtina: string;
  generatedAt: string;
  events: AlertEvent[];
};

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const MUNICIPALITIES_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");
const COUNCIL_INDEX = path.join(PROJECT_ROOT, "data/council/index.json");
const PROC_BY_SETTLEMENT = path.join(
  PROJECT_ROOT,
  "data/procurement/by_settlement",
);
const PROC_AWARDERS = path.join(PROJECT_ROOT, "data/procurement/awarders");
const FUNDS_BY_MUNI = path.join(PROJECT_ROOT, "data/funds/projects/by-muni");
const LOCAL_CYCLE_DIR = path.join(
  PROJECT_ROOT,
  "data/2023_10_29_mi/municipalities",
);
const CAPITAL_PROGRAMS = path.join(
  PROJECT_ROOT,
  "data/budget/capital_programs",
);
const VOTES_SESSIONS = path.join(
  PROJECT_ROOT,
  "data/parliament/votes/sessions",
);
const OUT_DIR = path.join(PROJECT_ROOT, "data/myarea/alerts");

// Per-município event cap. 30 keeps the JSON ~5 KB even for active
// municípios; the SPA tile renders the top 20 by default.
const EVENT_CAP = 30;
// Procurement contracts per awarder to consider (we keep top 3 per muni-
// tier awarder, then merge & cap).
const PROC_PER_AWARDER = 3;
// EU contracts per município to surface (top by totalEur).
const FUNDS_TOP_N = 5;
// Plenary keyword cap.
const PLENARY_TOP_N = 5;
// Council resolution cap + freshness window. Sofia votes weekly with
// 20+ items/session; without a cap the feed would become a council log.
// Keep the top 3 freshest tagged rows from the last 60 days.
const COUNCIL_TOP_N = 3;
const COUNCIL_LOOKBACK_DAYS = 60;

// Bridge between frontend obshtina codes (BGS04, S2401, SFO_CITY) and the
// council ingest's keys (BGS01, SOF). Mirrors STATIC_MAP +
// councilKeyForObshtina() in src/data/council/councilObshtinaMap.ts.
// Duplicated rather than imported so this script stays free of frontend
// imports. Keep in sync.
const COUNCIL_KEY_MAP: Record<string, string> = {
  SFO_CITY: "SOF",
  VTR04: "VTR01",
  PDV22: "PDV01",
  VAR06: "VAR01",
  BGS04: "BGS01",
  SZR31: "SZR01",
  RSE27: "RSE01",
  PVN24: "PVN01",
  SLV20: "SLV01",
  BLG03: "BLG03",
  GAB05: "GAB05",
  SZR12: "SZR12",
  HKV34: "HKV34",
  HKV09: "HKV09",
  DOB28: "DOB28",
  RAZ26: "RAZ26",
  PER32: "PER32",
};

const councilKeyFor = (obshtina: string): string | null => {
  if (obshtina.startsWith("S2")) return "SOF";
  return COUNCIL_KEY_MAP[obshtina] ?? null;
};

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

const buildProcurementEvents = (
  obshtina: string,
  centroidEkatte: string,
): AlertEvent[] => {
  // The município's central settlement file lists muni-tier awarders by
  // EIK; we walk each and grab their most-recent topContracts.
  const bySettlement = readJson<ProcurementBySettlement>(
    path.join(PROC_BY_SETTLEMENT, `${centroidEkatte}.json`),
  );
  if (!bySettlement?.awarders) return [];
  const muniAwarders = bySettlement.awarders.filter(
    (a) => a.tier === "municipal",
  );
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
      events.push({
        date: c.date,
        kind: "procurement",
        headline_bg: `Обществена поръчка: ${aw.name} → ${c.partyName ?? "—"} · ${formatEur(eur)}`,
        headline_en: `Procurement: ${aw.name} → ${c.partyName ?? "—"} · ${formatEur(eur)}`,
        amountEur: eur,
      });
    }
  }
  // Mark obshtina as referenced (keeps the param list lint-clean for
  // futures that may filter by obshtina-tier awarders outside the
  // centroid settlement).
  void obshtina;
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
  const file = readJson<FundsMuniFile>(
    path.join(FUNDS_BY_MUNI, `${obshtina}.json`),
  );
  if (!file?.contracts) return [];
  const inProgress = file.contracts.filter((c) =>
    (c.status ?? "").includes("изпълнение"),
  );
  const top = inProgress
    .slice()
    .sort((a, b) => (b.totalEur ?? 0) - (a.totalEur ?? 0))
    .slice(0, FUNDS_TOP_N);
  return top.map((c) => {
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

// Council resolutions are the freshest "what just happened" signal for
// any município wired into the council ingest. We take the top 3 from the
// last COUNCIL_LOOKBACK_DAYS, prefer tagged + tally-bearing rows so they
// outrank uncategorised entries. resolutionsForKey is sorted date-desc by
// the council build script, so we walk in order and rank-sort within the
// freshness window.
const daysAgoFromIso = (iso: string, today: number): number => {
  const d = new Date(iso + "T00:00:00Z").getTime();
  return Math.floor((today - d) / (1000 * 60 * 60 * 24));
};

const councilRank = (r: CouncilResolution): number => {
  const tagged = (r.tags?.length ?? 0) > 0 ? 1 : 0;
  const tallied = r.tally ? 1 : 0;
  return tagged * 2 + tallied;
};

const buildCouncilResolutionEvents = (
  obshtina: string,
  resolutionsByObshtina: Record<string, CouncilResolution[]> | null,
  todayMs: number,
): AlertEvent[] => {
  if (!resolutionsByObshtina) return [];
  const key = councilKeyFor(obshtina);
  if (!key) return [];
  const all = resolutionsByObshtina[key];
  if (!all || all.length === 0) return [];
  const fresh = all.filter(
    (r) => daysAgoFromIso(r.date, todayMs) <= COUNCIL_LOOKBACK_DAYS,
  );
  if (fresh.length === 0) return [];
  // Rank by content quality (tagged + tallied first), break ties by date
  // desc. Sort copy so the source array stays intact.
  const ranked = [...fresh].sort((a, b) => {
    const rb = councilRank(b) - councilRank(a);
    if (rb !== 0) return rb;
    return b.date.localeCompare(a.date);
  });
  const top = ranked.slice(0, COUNCIL_TOP_N);
  return top.map((r) => {
    const title = r.summary_bg ?? r.title;
    const title_en = r.summary_en ?? r.title;
    const tally = r.tally
      ? `${r.tally.for ?? 0}–${r.tally.against ?? 0}–${r.tally.abstain ?? 0}`
      : undefined;
    return {
      date: r.date,
      kind: "council_resolution",
      headline_bg: `Общинският съвет гласува: ${title}`,
      headline_en: `Municipal council voted: ${title_en}`,
      link: r.sourceUrl,
      detail: tally,
    };
  });
};

const main = () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const munis = readJson<MunicipalityInfo[]>(MUNICIPALITIES_FILE);
  if (!munis) {
    console.error(`failed to read municipalities`);
    process.exit(1);
  }
  // Single read of the council index — feeds all 265 município iterations.
  const councilIndex = readJson<CouncilIndexFile>(COUNCIL_INDEX);
  const resolutionsByObshtina = councilIndex?.resolutionsByObshtina ?? null;
  const todayMs = Date.now();
  let totalEvents = 0;
  let municipiosWithEvents = 0;
  let councilEvents = 0;
  for (const m of munis) {
    const council = buildCouncilResolutionEvents(
      m.obshtina,
      resolutionsByObshtina,
      todayMs,
    );
    councilEvents += council.length;
    const allEvents: AlertEvent[] = [
      ...council,
      ...buildProcurementEvents(m.obshtina, m.ekatte),
      ...buildFundsEvents(m.obshtina),
      ...buildCapitalProgramEvents(m.obshtina),
      ...buildPlenaryKeywordEvents(m.obshtina, m.name),
    ];
    const local = buildLocalElectionEvent(m.obshtina);
    if (local) allEvents.push(local);
    if (allEvents.length === 0) continue;
    allEvents.sort((a, b) => b.date.localeCompare(a.date));
    const trimmed = allEvents.slice(0, EVENT_CAP);
    const out: AlertsFile = {
      obshtina: m.obshtina,
      generatedAt: new Date().toISOString(),
      events: trimmed,
    };
    fs.writeFileSync(
      path.join(OUT_DIR, `${m.obshtina}.json`),
      JSON.stringify(out, null, 2) + "\n",
    );
    totalEvents += trimmed.length;
    municipiosWithEvents++;
  }
  console.log(
    `Wrote ${municipiosWithEvents} per-município alerts files (${totalEvents} total events, ${councilEvents} council)`,
  );
};

main();
