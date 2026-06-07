// Maps a tool Envelope to the real electionsbg.com pages that back it, so an
// answer points the reader at a page they can actually open — not the raw JSON
// filenames in `env.provenance` (which are an internal data-source identifier).
//
// Pure + deterministic (mirrors followups.ts): a switch on `env.tool`, with a
// per-domain fallback. Deep links read ONLY values already present in
// `env.facts` (e.g. the party nickName) — nothing is added to facts, so the
// model's narration input is never polluted. Election/cycle-scoped section pages
// default to the latest cycle (which is what almost every chat query is about).

import { latestLocalCycle } from "../tools/localDataset";
import type { Domain, Envelope } from "../tools/types";

const SITE = "https://electionsbg.com";

export type SiteLink = { label: { bg: string; en: string }; href: string };

const url = (path: string): string => `${SITE}${path}`;

const fact = (env: Envelope, key: string): string | undefined =>
  env.facts?.[key] != null ? String(env.facts[key]) : undefined;

// /party/:id is keyed by the party nickName (the app's own convention, see
// BubbleTimeline), which the party tools already expose as facts.party.
const partyLink = (env: Envelope, suffix = ""): SiteLink | null => {
  const party = fact(env, "party");
  if (!party) return null;
  return {
    label: { bg: `${party} — профил`, en: `${party} — profile` },
    href: url(`/party/${encodeURIComponent(party)}${suffix}`),
  };
};

// Stable section pages, each confirmed against src/routes.tsx.
const SECTION: Record<string, SiteLink> = {
  results: {
    label: { bg: "Резултати по партии", en: "Results by party" },
    href: url("/parties"),
  },
  regions: {
    label: { bg: "Резултати по области", en: "Results by region" },
    href: url("/regions"),
  },
  home: {
    label: { bg: "Резултати и активност", en: "Results & turnout" },
    href: url("/"),
  },
  polls: {
    label: { bg: "Социологически проучвания", en: "Opinion polls" },
    href: url("/polls"),
  },
  governments: {
    label: { bg: "Правителства от 2005", en: "Governments since 2005" },
    href: url("/governments"),
  },
  assets: {
    label: { bg: "Активи на депутатите", en: "MP assets" },
    href: url("/mp-assets"),
  },
  connections: {
    label: { bg: "Бизнес връзки", en: "Business connections" },
    href: url("/connections"),
  },
  votes: {
    label: { bg: "Парламентарни гласувания", en: "Parliamentary votes" },
    href: url("/votes"),
  },
  parliament: {
    label: { bg: "Народно събрание", en: "National Assembly" },
    href: url("/parliament"),
  },
  financing: {
    label: { bg: "Партийно финансиране", en: "Party financing" },
    href: url("/financing"),
  },
  budget: {
    label: { bg: "Държавен бюджет", en: "State budget" },
    href: url("/budget"),
  },
  procurement: {
    label: { bg: "Обществени поръчки", en: "Public procurement" },
    href: url("/procurement"),
  },
  funds: {
    label: { bg: "Европейски средства", en: "EU funds" },
    href: url("/funds"),
  },
  fiscal: {
    label: { bg: "Фискални показатели", en: "Fiscal indicators" },
    href: url("/indicators/fiscal"),
  },
  indicators: {
    label: { bg: "Показатели", en: "Indicators" },
    href: url("/indicators"),
  },
  governance: {
    label: { bg: "Моето населено място", en: "My area" },
    href: url("/governance"),
  },
  riskScore: {
    label: { bg: "Индекс на изборния риск", en: "Election risk index" },
    href: url("/risk-score"),
  },
  riskAnalysis: {
    label: { bg: "Анализ на изборния риск", en: "Election risk analysis" },
    href: url("/risk-analysis"),
  },
};

const localSection = (): SiteLink => ({
  label: { bg: "Местни избори", en: "Local elections" },
  href: url(`/local/${latestLocalCycle()}`),
});

// First match wins; tools sharing a section page are grouped.
const TOOL_SECTION: Record<string, SiteLink | undefined> = {
  nationalResults: SECTION.results,
  regionWinners: SECTION.regions,
  regionResults: SECTION.regions,
  regionResultsTrend: SECTION.regions,
  municipalityWinners: SECTION.regions,
  municipalityResults: SECTION.regions,
  municipalityHistory: SECTION.regions,
  settlementWinners: SECTION.regions,
  sectionWinners: SECTION.regions,
  parliamentSeats: SECTION.parliament,
  seatsHistory: SECTION.parliament,
  compareElections: SECTION.results,
  demographicCleavages: SECTION.results,
  turnout: SECTION.home,
  turnoutSeries: SECTION.home,
  machineVoteShare: SECTION.home,
  machineVoteSeries: SECTION.home,
  machineVoteByParty: SECTION.home,
  voteTransitions: SECTION.home,
  voterPersistence: SECTION.home,
  diasporaVote: SECTION.home,
  electionAnomalies: SECTION.riskScore,
  riskIndex: SECTION.riskAnalysis,
  riskScore: SECTION.riskScore,
  riskClusters: SECTION.riskAnalysis,
  clusterPersistence: SECTION.riskAnalysis,
  benfordAnomalies: SECTION.riskAnalysis,
  wastedVotes: SECTION.riskAnalysis,
  wastedVotesByParty: SECTION.riskAnalysis,
  suspiciousSettlements: SECTION.riskAnalysis,
  problemSections: SECTION.riskAnalysis,
  romaVoteTrend: SECTION.riskAnalysis,
  flashMemoryByParty: SECTION.riskAnalysis,
  recountByParty: SECTION.riskAnalysis,
  pollAccuracy: SECTION.polls,
  agencyProfile: SECTION.polls,
  latestPolls: SECTION.polls,
  agencyPolls: SECTION.polls,
  agencyAccuracyHistory: SECTION.polls,
  accuracyTrend: SECTION.polls,
  governments: SECTION.governments,
  mpAssetsTop: SECTION.assets,
  mpAssetsByParty: SECTION.assets,
  officialsAssetsTop: SECTION.assets,
  mpConnectionsTop: SECTION.connections,
  mpConnectionsByParty: SECTION.connections,
  mpLoyalty: SECTION.votes,
  mpAttendance: SECTION.votes,
  factionCohesion: SECTION.votes,
  mpVotingProfile: SECTION.votes,
  mpSimilarity: SECTION.votes,
  voteSearch: SECTION.votes,
  partyMps: SECTION.parliament,
  financingOverview: SECTION.financing,
  budgetOverview: SECTION.budget,
  budgetByFunction: SECTION.budget,
  budgetFunction: SECTION.budget,
  budgetExecution: SECTION.budget,
  ministryBudget: SECTION.budget,
  investmentProjects: SECTION.budget,
  procurementTotals: SECTION.procurement,
  fundsOverview: SECTION.funds,
  govDebt: SECTION.fiscal,
  noiFunds: SECTION.fiscal,
  macroIndicator: SECTION.indicators,
  macroOverview: SECTION.indicators,
  macroByCategory: SECTION.indicators,
  subnationalIndicator: SECTION.indicators,
  rankPlaces: SECTION.indicators,
  regionIndicator: SECTION.indicators,
  transparencyScore: SECTION.indicators,
  localTaxes: SECTION.indicators,
  landUse: SECTION.indicators,
  schoolScores: SECTION.indicators,
  governanceProfile: SECTION.governance,
  comparePlaces: SECTION.governance,
  census: SECTION.governance,
  procurementBySettlement: SECTION.governance,
  airQuality: SECTION.governance,
  graoPopulation: SECTION.governance,
  councilResolutions: SECTION.governance,
};

const DOMAIN_FALLBACK: Record<Domain, SiteLink> = {
  elections: SECTION.home,
  local: localSection(),
  fiscal: SECTION.budget,
  people: SECTION.governments,
  indicators: SECTION.indicators,
  place: SECTION.governance,
};

export const siteLinks = (env: Envelope): SiteLink[] => {
  const out: SiteLink[] = [];

  // Party-scoped tools get a deep link to the party's own page first.
  switch (env.tool) {
    case "partyTimeline":
    case "partyResult":
    case "partyDemographics": {
      const l = partyLink(env);
      if (l) out.push(l);
      break;
    }
    case "regionBreakdown": {
      const l = partyLink(env, "/regions");
      if (l) out.push(l);
      break;
    }
    // Single-section answers deep-link to that station's own page (/section/:id),
    // built from facts.section — the id the section tools always expose.
    case "sectionResults":
    case "sectionHistory": {
      const sec = fact(env, "section");
      if (sec)
        out.push({
          label: { bg: "Секция — пълни данни", en: "Section — full data" },
          href: url(`/section/${encodeURIComponent(sec)}`),
        });
      break;
    }
    // Single-settlement answers deep-link to that place's own dashboard
    // (/sections/:ekatte). The EKATTE is read from the locator overlay these
    // tools always attach, so it never enters facts (the model's narration
    // input) as an opaque code.
    case "settlementResults":
    case "settlementHistory": {
      const ekatte = env.geo?.focus?.[0] ?? env.geo?.areas?.[0]?.code;
      if (ekatte)
        out.push({
          label: {
            bg: "Населено място — пълни данни",
            en: "Settlement — full data",
          },
          href: url(`/sections/${encodeURIComponent(ekatte)}`),
        });
      break;
    }
    // Per-agency poll/accuracy trends deep-link to that agency's own page
    // (/polls/:agencyId), built from facts.agency_id.
    case "agencyPolls":
    case "agencyAccuracyHistory": {
      const id = fact(env, "agency_id");
      if (id)
        out.push({
          label: { bg: "Агенция — пълен профил", en: "Agency — full profile" },
          href: url(`/polls/${encodeURIComponent(id)}`),
        });
      break;
    }
  }

  // Local-ELECTION tools (domain "local") link to the local-elections page.
  // NB: branch on domain, not a "local" name prefix — `localTaxes` is an
  // indicators tool and must follow its TOOL_SECTION mapping instead.
  if (env.domain === "local") {
    out.push(localSection());
  } else {
    const section = TOOL_SECTION[env.tool];
    if (section) out.push(section);
  }

  // Always leave at least one link: fall back to the domain landing page.
  if (out.length === 0 && env.domain) out.push(DOMAIN_FALLBACK[env.domain]);

  // De-dupe by href (a party tool may share a section with its deep link).
  const seen = new Set<string>();
  return out.filter((l) =>
    seen.has(l.href) ? false : (seen.add(l.href), true),
  );
};
