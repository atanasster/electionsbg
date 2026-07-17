// Maps a tool Envelope to the real electionsbg.com pages that back it, so an
// answer points the reader at a page they can actually open — not the raw JSON
// filenames in `env.provenance` (which are an internal data-source identifier).
//
// Pure + deterministic (mirrors followups.ts): a switch on `env.tool`, with a
// per-domain fallback. Deep links read ONLY values already present in
// `env.facts` (e.g. the party nickName) — nothing is added to facts, so the
// model's narration input is never polluted. Parliamentary pages are scoped by
// `?elections=<YYYY_MM_DD>` (read by ElectionContext, URL-only with no
// persistence, defaulting to the latest election); we append it to election-
// scoped links so a historical answer opens on ITS election, not the latest.

import { latestLocalCycle } from "../tools/localDataset";
import type { Domain, Envelope } from "../tools/types";

const SITE = "https://electionsbg.com";

export type SiteLink = { label: { bg: string; en: string }; href: string };

const url = (path: string): string => `${SITE}${path}`;

const fact = (env: Envelope, key: string): string | undefined =>
  env.facts?.[key] != null ? String(env.facts[key]) : undefined;

// The parliamentary election a SINGLE-election answer is about, taken from the
// canonical `<YYYY_MM_DD>/…` provenance prefix every election-scoped tool fetches
// from. A multi-election answer (trend / two-election compare / yearCompare)
// lists several distinct dates — we return undefined for those and let the page
// fall back to its latest-election default. Local cycles ("2023_10_29_mi/…") and
// non-election sources ("polls/…", "council/…") have no bare date+"/" prefix, so
// they're naturally excluded.
const electionOf = (env: Envelope): string | undefined => {
  const dates = new Set<string>();
  for (const p of env.provenance ?? []) {
    const m = p.match(/^(\d{4}_\d{2}_\d{2})\//);
    if (m) dates.add(m[1]);
  }
  return dates.size === 1 ? [...dates][0] : undefined;
};

// Pages whose content ElectionContext scopes by `?elections=`. NB /candidate/ is
// listed, but an MP page (/candidate/mp-…) comes from a parliament-data answer
// whose provenance has no election prefix, so electionOf() returns undefined and
// nothing is appended — only the per-election candidate result gets the param.
const isElectionScopedPath = (path: string): boolean =>
  path === "/" ||
  path === "/parties" ||
  path === "/regions" ||
  /^\/sections?\//.test(path) || // /section/:id and /sections/:ekatte
  /^\/municipality\//.test(path) ||
  /^\/settlement\//.test(path) ||
  /^\/candidate\//.test(path);

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
  administration: {
    label: { bg: "Държавна администрация", en: "State administration" },
    href: url("/sector/administration"),
  },
  regional: {
    label: { bg: "Регионално развитие", en: "Regional development" },
    href: url("/sector/regional"),
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
  procurementFlags: {
    label: {
      bg: "Сигнали за риск в поръчките",
      en: "Procurement red flags",
    },
    href: url("/procurement/flags"),
  },
  procurementContractors: {
    label: { bg: "Топ изпълнители", en: "Top contractors" },
    href: url("/procurement/contractors"),
  },
  procurementMps: {
    label: {
      bg: "Топ депутати по свързани поръчки",
      en: "Top MPs by connected procurement",
    },
    href: url("/procurement/mps"),
  },
  procurementMap: {
    label: { bg: "Поръчки по място", en: "Procurement by place" },
    href: url("/procurement/by-settlement"),
  },
  tenders: {
    label: { bg: "Обявени поръчки (търгове)", en: "Announced tenders" },
    href: url("/procurement/tenders"),
  },
  procurementAppeals: {
    label: { bg: "Жалби пред КЗК", en: "КЗК appeals" },
    href: url("/procurement/appeals"),
  },
  funds: {
    label: { bg: "Европейски средства", en: "EU funds" },
    href: url("/funds"),
  },
  nzok: {
    label: { bg: "Здравна каса (НЗОК)", en: "Health fund (NHIF)" },
    href: url("/awarder/121858220"),
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
  administrationOverview: SECTION.administration,
  nationalResults: SECTION.results,
  regionWinners: SECTION.regions,
  municipalityWinners: SECTION.regions,
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
  voteSearch: SECTION.votes,
  partyMps: SECTION.parliament,
  financingOverview: SECTION.financing,
  budgetOverview: SECTION.budget,
  simulateTaxChange: SECTION.budget,
  budgetByFunction: SECTION.budget,
  budgetFunction: SECTION.budget,
  budgetExecution: SECTION.budget,
  ministryBudget: SECTION.budget,
  investmentProjects: SECTION.budget,
  procurementTotals: SECTION.procurement,
  procurementRedFlags: SECTION.procurementFlags,
  procurementSingleBidSectors: SECTION.procurementFlags,
  procurementDebarred: SECTION.procurementFlags,
  topContractors: SECTION.procurementContractors,
  contractSearch: SECTION.procurementContractors,
  procurementAppeals: SECTION.procurementAppeals,
  mpProcurement: SECTION.procurementMps,
  procurementByOblast: SECTION.procurementMap,
  fundsOverview: SECTION.funds,
  nzokBudget: SECTION.nzok,
  nzokDrugs: SECTION.nzok,
  nzokDrugGrowth: SECTION.nzok,
  nzokHospitals: SECTION.nzok,
  nzokActivities: SECTION.nzok,
  nzokDrugMolecule: SECTION.nzok,
  nzokDrugSavings: SECTION.nzok,
  nzokHospitalScorecard: SECTION.nzok,
  nzokPathwayHospitals: SECTION.nzok,
  govDebt: SECTION.fiscal,
  noiFunds: SECTION.fiscal,
  mrrbSpending: SECTION.regional,
  cohesionAbsorption: SECTION.regional,
  regionalInvestment: SECTION.regional,
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
  procurementBySettlement: SECTION.procurementMap,
  airQuality: SECTION.governance,
  graoPopulation: SECTION.governance,
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
    case "sectionHistory":
    case "sectionRiskHistory": {
      const sec = fact(env, "section");
      if (sec)
        out.push({
          label: { bg: "Секция — пълни данни", en: "Section — full data" },
          href: url(`/section/${encodeURIComponent(sec)}`),
        });
      break;
    }
    // "Results by section in a place" is settlement- or município-scoped, so it
    // deep-links to that place's own page (where the per-section breakdown
    // lives), read from the hidden _id facts the tool exposes. The TOOL_SECTION
    // mapping still adds the /regions overview as the secondary category link.
    case "sectionWinners": {
      const ekatte = fact(env, "ekatte_id");
      const ob = fact(env, "obshtina_id");
      if (ekatte)
        out.push({
          label: {
            bg: "Населено място — по секции",
            en: "Settlement — by section",
          },
          href: url(`/sections/${encodeURIComponent(ekatte)}`),
        });
      else if (ob)
        out.push({
          label: { bg: "Община — пълни данни", en: "Municipality — full data" },
          href: url(`/settlement/${encodeURIComponent(ob)}`),
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
    // A contractor's contracts deep-link to the firm's own page (the full,
    // filterable contracts list) and to its single biggest contract — the
    // by-id shard store now resolves /procurement/contract/:key for every row.
    case "contractSearch": {
      const eik = fact(env, "eik_id");
      if (eik)
        out.push({
          label: { bg: "Фирма — пълни данни", en: "Company — full profile" },
          href: url(`/company/${encodeURIComponent(eik)}`),
        });
      const key = fact(env, "contract_id");
      if (key)
        out.push({
          label: { bg: "Най-голям договор", en: "Largest contract" },
          href: url(`/procurement/contract/${encodeURIComponent(key)}`),
        });
      break;
    }
    // Top hospitals paid by НЗОК → the biggest hospital's own company page, when
    // it is confidently matched to a Commerce-Register EIK (hidden facts.eik_id).
    // The TOOL_SECTION mapping still adds the health-fund page as the category link.
    case "nzokHospitals": {
      const eik = fact(env, "eik_id");
      if (eik)
        out.push({
          label: { bg: "Болница — профил", en: "Hospital — profile" },
          href: url(`/company/${encodeURIComponent(eik)}`),
        });
      break;
    }
    // A hospital scorecard → that hospital's own /company/:eik page, where the
    // full report card + decile fan + reporting-coverage live.
    case "nzokHospitalScorecard": {
      const eik = fact(env, "eik_id");
      if (eik)
        out.push({
          label: { bg: "Болница — профил", en: "Hospital — profile" },
          href: url(`/company/${encodeURIComponent(eik)}`),
        });
      break;
    }
    // A per-molecule drug-price answer → that molecule's own /molecule/:inn page
    // (which hospitals overpay + the month-by-month price trend). The category
    // link (health-fund page) is still added via TOOL_SECTION.
    case "nzokDrugMolecule": {
      const inn = fact(env, "inn_id");
      if (inn)
        out.push({
          label: { bg: "Лекарство — профил", en: "Molecule — profile" },
          href: url(`/molecule/${encodeURIComponent(inn)}`),
        });
      break;
    }
    // Tender-stage answers → the /procurement/tenders search, pre-filtered to
    // the same topic / keyword + year (hidden link facts), so the reader lands
    // on the exact result set the answer summarised.
    case "openTenders": {
      const params = new URLSearchParams();
      const slug = fact(env, "link_topic");
      const q = fact(env, "link_q");
      if (slug) params.set("topic", slug);
      else if (q) params.set("q", q);
      const yr = fact(env, "year");
      if (yr) params.set("year", yr);
      const qs = params.toString();
      out.push({
        label: { bg: "Обявени поръчки", en: "Announced tenders" },
        href: url(`/procurement/tenders${qs ? `?${qs}` : ""}`),
      });
      break;
    }
    // A single procedure → its detail page (/tenders/:unp).
    case "tenderLookup": {
      const unp = fact(env, "unp");
      out.push(
        unp
          ? {
              label: { bg: "Поръчката (процедура)", en: "The tender" },
              href: url(`/tenders/${encodeURIComponent(unp)}`),
            }
          : SECTION.tenders,
      );
      break;
    }
    // Per-agency profile / poll / accuracy answers deep-link to that agency's
    // own page (/polls/:agencyId), built from facts.agency_id.
    case "agencyProfile":
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
    // Single-candidate answers deep-link to that person's own page, built from
    // facts.candidate_id (the unambiguous c-{partyNum}-{slug} form the tool
    // emits). The _id fact is hidden from the scalar UI (see AnswerView).
    case "candidateResult": {
      const id = fact(env, "candidate_id");
      if (id)
        out.push({
          label: { bg: "Кандидат — профил", en: "Candidate — profile" },
          href: url(`/candidate/${encodeURIComponent(id)}`),
        });
      break;
    }
    // Single-MP answers deep-link to that MP's own page — the voting profile to
    // the full MP dashboard, "who votes like X" to the similarity ranking. Both
    // read facts.mp_id (hidden from the scalar UI).
    case "mpVotingProfile": {
      const id = fact(env, "mp_id");
      if (id)
        out.push({
          label: { bg: "Депутат — профил", en: "MP — profile" },
          href: url(`/candidate/mp-${encodeURIComponent(id)}`),
        });
      break;
    }
    case "mpSimilarity": {
      const id = fact(env, "mp_id");
      if (id)
        out.push({
          label: { bg: "Кой гласува като…", en: "Voting peers" },
          href: url(`/parliament/similarity/${encodeURIComponent(id)}`),
        });
      break;
    }
    // Single-region / single-municipality answers deep-link to that place's own
    // dashboard, read from the locator overlay (no facts pollution). Sofia-city
    // is summed from 3 МИР and has no single page, so it keeps the regions
    // overview: its region locator then carries 3 focus codes (not 1) and its
    // municipality locator falls back to the oblast level — both detected here.
    case "regionResults":
    case "regionResultsTrend": {
      const g = env.geo;
      if (g && g.focus?.length === 1)
        out.push({
          label: { bg: "Област — пълни данни", en: "Region — full data" },
          href: url(`/municipality/${encodeURIComponent(g.focus[0])}`),
        });
      else out.push(SECTION.regions);
      break;
    }
    case "municipalityResults":
    case "municipalityHistory": {
      const g = env.geo;
      const ob = g?.level === "municipality" ? g.areas?.[0]?.code : undefined;
      if (ob)
        out.push({
          label: {
            bg: "Община — пълни данни",
            en: "Municipality — full data",
          },
          href: url(`/settlement/${encodeURIComponent(ob)}`),
        });
      else out.push(SECTION.regions);
      break;
    }
    // Single-município LOCAL answers deep-link to that município's local page
    // (overview / mayor race / council / sub-mayors / mayor history). The
    // município code + cycle come from hidden _id facts the tools expose — NOT
    // the geo locator, whose Sofia fallback (oblast level) would otherwise drop
    // the synthetic "SOF" bundle. localMayorHistory is cross-cycle, so its
    // cycle_id pins the latest cycle.
    case "localMunicipality":
    case "localMayorRace":
    case "localCouncil":
    case "localSubMayors":
    case "localMayorHistory": {
      const ob = fact(env, "obshtina_id");
      const cycle = fact(env, "cycle_id");
      if (ob && cycle) {
        const suffix =
          env.tool === "localMayorRace"
            ? "/mayor"
            : env.tool === "localCouncil"
              ? "/council"
              : "";
        out.push({
          label: {
            bg: "Община — местни избори",
            en: "Municipality — local elections",
          },
          href: url(`/local/${cycle}/${encodeURIComponent(ob)}${suffix}`),
        });
      }
      break;
    }
    // Extraordinary (partial + new) local elections -> the dedicated feed page,
    // not the cycle landing. The chat can filter the feed to one município, but
    // the site has a single chronological page for all of them.
    case "chmiEvents": {
      out.push({
        label: {
          bg: "Извънредни местни избори",
          en: "Extraordinary local elections",
        },
        href: url("/local/chmi"),
      });
      break;
    }
    // A scored tax-policy what-if deep-links to the simulator with the exact
    // scenario pre-set (facts.scenario_id carries the simulator's own query
    // string, e.g. "dds=22"; empty = current law, plain page).
    case "simulateTaxChange": {
      const qs = fact(env, "scenario_id");
      out.push({
        label: {
          bg: "Отвори в бюджетния симулатор",
          en: "Open in the budget simulator",
        },
        href: url(`/budget/simulator${qs ? `?${qs}` : ""}`),
      });
      break;
    }
    // Single-settlement procurement -> that place's own procurement page
    // (/procurement/settlement/:ekatte), read from the locator overlay the tool
    // attaches (focus = ekatte). The procurement-map page is the category link.
    case "procurementBySettlement": {
      const ekatte = env.geo?.focus?.[0] ?? env.geo?.areas?.[0]?.code;
      if (ekatte)
        out.push({
          label: {
            bg: "Поръчки в населеното място",
            en: "Procurement in this place",
          },
          href: url(`/procurement/settlement/${encodeURIComponent(ekatte)}`),
        });
      break;
    }
    // Single-município council resolutions -> that município's governance page
    // (which mounts the council tile), not the generic governance landing.
    case "councilResolutions": {
      const ob = fact(env, "obshtina_id");
      if (ob)
        out.push({
          label: { bg: "Общинско управление", en: "Municipal governance" },
          href: url(`/governance/${encodeURIComponent(ob)}`),
        });
      else out.push(SECTION.governance);
      break;
    }
  }

  // Local-ELECTION tools (domain "local") link to the local-elections page.
  // NB: branch on domain, not a "local" name prefix — `localTaxes` is an
  // indicators tool and must follow its TOOL_SECTION mapping instead.
  if (env.domain === "local") {
    // a single-município deep link (pushed above) already covers it; otherwise
    // fall back to the cycle landing.
    if (out.length === 0) out.push(localSection());
  } else {
    const section = TOOL_SECTION[env.tool];
    if (section) out.push(section);
  }

  // Always leave at least one link: fall back to the domain landing page.
  if (out.length === 0 && env.domain) out.push(DOMAIN_FALLBACK[env.domain]);

  // De-dupe by href (a party tool may share a section with its deep link), then
  // pin the election on parliamentary pages so the link opens on the same
  // election the answer is about (not the site's latest-election default).
  const election = electionOf(env);
  const seen = new Set<string>();
  return out
    .filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true)))
    .map((l) => {
      if (!election) return l;
      const path = l.href.slice(SITE.length);
      return isElectionScopedPath(path)
        ? { ...l, href: `${l.href}?elections=${election}` }
        : l;
    });
};
