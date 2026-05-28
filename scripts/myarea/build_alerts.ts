// Build the simulated "Recent activity" feed per município.
//
// Materializes events from data we already ingest — no new scraping. The
// feed is the V1 substitute for real email alerts (no auth yet), and
// doubles as a "what's notable in this município" digest once auth lands.
//
// Sources per município:
//   1. Procurement contracts — dated from awarder topContracts (real
//      contract-award dates)
//   2. EU-funded projects — dated by inferring the programme start year
//      from programCode prefix (2014BG…, 2021BG…); falls back to a stable
//      placeholder when ambiguous
//   3. Local-election cycle — fixed event for municípios with a 2023
//      bundle (and any future cycle when the parsers add it)
//   4. Capital programmes — one event per município that has a current-
//      year capital programme line
//   5. Plenary roll-call mentions — when the MPs from this município's
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

type AlertEvent = {
  date: string; // YYYY-MM-DD
  kind:
    | "procurement"
    | "eu_funds"
    | "local_election"
    | "capital_program"
    | "plenary_keyword";
  headline_bg: string;
  headline_en: string;
  amountEur?: number;
  link?: string;
  detail?: string;
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

const readJson = <T>(p: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
};

// Infer a stable date for an EU contract from its programCode. Formats
// observed: "2014BG16M1OP002" → 2014, "2021BG-RRP" → 2021. Fallback for
// older / unrecognised prefixes is 2014 (start of the 2014-20 frame).
const inferFundsDate = (programCode?: string): string => {
  if (!programCode) return "2014-01-01";
  const m = programCode.match(/^(\d{4})/);
  if (m) return `${m[1]}-01-01`;
  return "2014-01-01";
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
  return top.map((c) => ({
    date: inferFundsDate(c.programCode),
    kind: "eu_funds",
    headline_bg: `Еврофонд: „${c.title}" · ${formatEur(c.totalEur)}`,
    headline_en: `EU funds: "${c.title}" · ${formatEur(c.totalEur)}`,
    amountEur: c.totalEur,
    detail: c.programName,
  }));
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

const main = () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const munis = readJson<MunicipalityInfo[]>(MUNICIPALITIES_FILE);
  if (!munis) {
    console.error(`failed to read municipalities`);
    process.exit(1);
  }
  let totalEvents = 0;
  let municipiosWithEvents = 0;
  for (const m of munis) {
    const allEvents: AlertEvent[] = [
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
    `Wrote ${municipiosWithEvents} per-município alerts files (${totalEvents} total events)`,
  );
};

main();
