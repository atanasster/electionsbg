// Deterministic intent router (the v1 fallback / no-model path).
//
// Maps a BG/EN question to { tool, args } using keyword + entity heuristics.
// This is intentionally simple: it's the safety net beneath the
// grammar-constrained LLM router (M3). When the model lands it replaces this as
// the primary, and this stays as the offline fallback.

import { ALL_ELECTIONS } from "../tools/dataset";
import { resolveBudgetFunction } from "../tools/fiscal";
import { resolveMacroKey } from "../tools/macro";
import { findOblastInText } from "../tools/place";
import { resolveRegionKey, resolveSubnatKey } from "../tools/placesGov";
import type { ToolArgs, ToolContext } from "../tools/types";

export type Route = { tool: string; args: ToolArgs } | null;

// Longest-first so "пп-дб" wins over "пп", "герб-сдс" over "герб".
const PARTY_TOKENS = [
  "герб-сдс",
  "пп-дб",
  "възраждане",
  "величие",
  "герб",
  "дпс",
  "бсп",
  "итн",
  "вмро",
  "нфсб",
  "меч",
  "дсб",
  "пп",
  "дб",
  "gerb-sds",
  "vazrazhdane",
  "gerb",
  "dps",
  "bsp",
  "itn",
  "pp-db",
  "pp",
  "db",
].sort((a, b) => b.length - a.length);

const detectParty = (q: string): string | undefined =>
  PARTY_TOKENS.find((tok) => q.includes(tok));

// Extract a person name (2–3 capitalized words) from the ORIGINAL-case question.
// All-caps acronyms (ГЕРБ) need a lowercase tail so they don't match; single
// capitalized words (Възраждане) need a second word so they don't either.
const NAME_BG = /[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}/;
const NAME_EN = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}/;
const extractPersonName = (raw: string): string | undefined => {
  const m = raw.match(NAME_BG) ?? raw.match(NAME_EN);
  return m ? m[0].trim() : undefined;
};

// Capitalized place candidates from a compare question ("Сравни Варна и Бургас"
// -> ["Варна","Бургас"]), dropping the compare verb and any party token.
const COMPARE_VERBS = new Set([
  "сравни",
  "сравнение",
  "compare",
  "срещу",
  "спрямо",
  "vs",
]);
const extractPlaceCandidates = (raw: string): string[] => {
  const caps =
    raw.match(/[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?/g) ?? [];
  return caps
    .map((s) => s.trim())
    .filter((s) => {
      const l = s.toLowerCase();
      return !COMPARE_VERBS.has(l) && !detectParty(l);
    });
};

// Polling-agency name fragments, for routing "how accurate is <agency>".
const AGENCY_TOKENS = [
  "алфа",
  "alpha",
  "тренд",
  "trend",
  "галъп",
  "gallup",
  "маркет",
  "market",
  "сова",
  "sova",
  "медиана",
  "mediana",
  "мяра",
  "цам",
  "афис",
  "afis",
  "екзакта",
  "exacta",
  "ноема",
  "барометър",
];

// A bare year -> the most recent election in that year (heuristic; the LLM will
// disambiguate multi-election years like 2021 better in M3).
const detectElection = (q: string): string | undefined => {
  const m = q.match(/\b(20\d{2})\b/);
  if (!m) return undefined;
  const year = m[1];
  const inYear = ALL_ELECTIONS.filter((e) => e.name.startsWith(year));
  return inYear.length ? inYear[0].name : undefined; // ALL_ELECTIONS is newest-first
};

const detectCount = (q: string): number | undefined => {
  const m = q.match(/(\d{1,2})/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n >= 2 && n <= 13 ? n : undefined;
};

// "последните 7 години" / "last 7 years" — a TIME window, not an election count.
// Bulgaria holds several elections a year, so "last 7 years" ≠ "last 7 elections":
// the trend series must filter by DATE, not slice off the last N. The negative
// lookbehind keeps a 4-digit year ("2019 година") from matching as "19 years".
const detectYearsWindow = (q: string): number | undefined => {
  const m = q.match(/(?<!\d)(\d{1,2})\s*(?:годин|years?\b)/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 30 ? n : undefined;
};

// Trend-series args: a years phrase wins (date window); otherwise a bare count
// (election count); otherwise empty (full history since 2005).
const seriesArgs = (q: string, count: number | undefined): ToolArgs => {
  const years = detectYearsWindow(q);
  if (years) return { years };
  return count ? { n: count } : {};
};

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

const TREND = [
  "тренд",
  "trend",
  "през годините",
  "over time",
  "история",
  "history",
  "последните",
  "last",
  "всички",
  "all",
  "избори",
  "elections",
];

// Words to strip when extracting a place name from a question. Includes party
// tokens so a party reference is never mistaken for a município.
const PLACE_STOP = new Set([
  "кой",
  "коя",
  "кое",
  "кои",
  "е",
  "кмет",
  "кметът",
  "кмета",
  "кметове",
  "на",
  "в",
  "във",
  "община",
  "общината",
  "общински",
  "общинският",
  "общинските",
  "местни",
  "местните",
  "избори",
  "избора",
  "съвет",
  "съвета",
  "съвети",
  "съветите",
  "спечели",
  "колко",
  "партия",
  "партии",
  "mayor",
  "of",
  "the",
  "who",
  "is",
  "in",
  "at",
  "council",
  "won",
  "show",
  "results",
  "what",
  "какъв",
  "каква",
  "какво",
  "покажи",
  "герб",
  "бсп",
  "дпс",
  "итн",
  "възраждане",
  "меч",
  "дб",
  "пп",
  "величие",
]);

const extractPlace = (q: string): string | undefined => {
  const words = q
    .replace(/[?.,!„“”"'`]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !PLACE_STOP.has(w));
  const cand = words.join(" ").trim();
  return cand.length > 1 ? cand : undefined;
};

export const route = (question: string, ctx: ToolContext): Route => {
  const q = question.toLowerCase().trim();
  if (!q) return null;

  const party = detectParty(q);
  const election = detectElection(q);
  const count = detectCount(q);
  const isTrend = has(q, ...TREND) || (count !== undefined && count >= 2);
  const isMachine = has(q, "машин", "machine", "суемг", "suemg");
  const isTurnout = has(q, "активн", "turnout", "гласувал", "voters");
  const isCompare = has(q, "сравн", "compare", "срещу", " vs ", "спрямо");

  // 1. comparison of two elections
  if (isCompare) {
    const years = Array.from(q.matchAll(/\b(20\d{2})\b/g)).map((m) => m[1]);
    // two named places (no years, no party) -> compare their governance profiles
    if (years.length === 0 && !detectParty(q)) {
      const cands = extractPlaceCandidates(question);
      if (cands.length >= 2)
        return { tool: "comparePlaces", args: { a: cands[0], b: cands[1] } };
    }
    const pick = (y?: string) =>
      y ? ALL_ELECTIONS.find((e) => e.name.startsWith(y))?.name : undefined;
    let a = pick(years[0]);
    let b = pick(years[1]) ?? ctx.election;
    // No explicit year ("сравни изборите последните 5 години", "compare the
    // last few elections"): default to the two most recent elections so a bare
    // compare still answers. A party-named compare ("сравни ... за ГЕРБ") is
    // skipped here and falls through to partyTimeline, which fits better.
    if (!a && !detectParty(q)) {
      const recent = ALL_ELECTIONS.map((e) => e.name); // newest-first
      b = ctx.election ?? recent[0];
      a = recent.find((n) => n !== b) ?? recent[1];
    }
    if (a) return { tool: "compareElections", args: { a, b } };
  }

  // 1a. new analytical tools (integrity, demographics, parliament, schools).
  // Placed before the domain blocks so these specific intents win over the
  // broader party / place / anomaly / results rules below.
  const el = election ? { election } : {};
  const personName = extractPersonName(question);

  // --- parliament roll-call (current НС) ---
  // similarity ("who votes like X") before the per-MP profile (both mention "X").
  if (
    has(
      q,
      "гласува като",
      "votes like",
      "vote like",
      "vote similarly",
      "подобно на",
    ) &&
    personName
  )
    return { tool: "mpSimilarity", args: { name: personName } };
  // a named MP + a roll-call cue -> that MP's voting profile (not preferences)
  if (
    personName &&
    has(
      q,
      "как гласува",
      "voting record",
      "в парламента",
      "in parliament",
      "лоялен",
      "дисциплин",
      "поименно",
      "roll call",
      "roll-call",
    )
  )
    return { tool: "mpVotingProfile", args: { name: personName } };
  if (
    has(
      q,
      "сплотен",
      "cohesion",
      "единно",
      "единство на групата",
      "vote together",
    )
  )
    return { tool: "factionCohesion", args: {} };
  if (
    has(q, "лоялн", "loyal", "дисциплин", "party line", "с групата") &&
    has(q, "депутат", " mp", " mps", "парламент", "групи", "групите", "faction")
  )
    return { tool: "mpLoyalty", args: {} };
  if (
    has(q, "присъстви", "отсъств", "attendance", "absent", "absentee") &&
    has(
      q,
      "депутат",
      " mp",
      " mps",
      "парламент",
      "гласуван",
      "session",
      "заседани",
    )
  )
    return { tool: "mpAttendance", args: {} };
  if (
    has(
      q,
      "най-оспорван",
      "most contested",
      "most controversial",
      "ключови гласувания",
    )
  )
    return { tool: "voteSearch", args: {} };
  if (
    has(q, "поименно гласуване", "roll call", "roll-call") ||
    (has(q, "гласува", "гласуван", "vote", "voted") &&
      has(
        q,
        "парламент",
        "парламентът",
        "народно събрание",
        "нс ",
        "parliament",
        "assembly",
      ) &&
      !personName)
  )
    return { tool: "voteSearch", args: { query: question } };

  // --- demographics (census correlations) ---
  if (
    party &&
    has(
      q,
      "демограф",
      "корелаци",
      "етнос",
      "етничес",
      "религи",
      "образовани",
      "кой гласува за",
      "кой подкрепя",
      "профил на гласопод",
      "demographic",
      "correlat",
      "ethnic",
      "religio",
      "who votes for",
      "who supports",
      "voter profile",
    )
  )
    return { tool: "partyDemographics", args: { party, ...el } };
  if (
    has(
      q,
      "разделени",
      "разделя",
      "cleavage",
      "what divides",
      "what splits",
      "демографски различия",
    ) &&
    !party
  )
    return { tool: "demographicCleavages", args: el };

  // --- schools / exam scores (per-município) ---
  if (has(q, "училищ", "гимназ", "school", "schools")) {
    const place = extractPlace(q);
    if (place) return { tool: "schoolScores", args: { place } };
  }

  // --- election integrity & anomalies ---
  if (
    has(q, "бенфорд", "benford", "първа цифра", "first digit", "second digit")
  )
    return { tool: "benfordAnomalies", args: el };
  // Roma neighbourhoods / controlled voting (specific tokens so "промени" never hits)
  if (
    has(q, "контролиран вот", "купен вот", "vote buying", "controlled vot") ||
    (has(q, "роми", "ромск", "roma", "махал", "гето", "ghetto") &&
      has(
        q,
        "секци",
        "квартал",
        "гласува",
        "гласове",
        "vote",
        "neighbourhood",
        "neighborhood",
      ))
  )
    return { tool: "problemSections", args: el };
  if (
    has(q, "устойчив", "persistent", "повтарящи", "recurring") &&
    has(q, "риск", "risk", "клъстер", "cluster", "огнищ", "locus", "loci")
  )
    return { tool: "clusterPersistence", args: {} };
  if (has(q, "клъстер", "cluster") && has(q, "риск", "risk", "струпван"))
    return { tool: "riskClusters", args: el };
  if (
    has(
      q,
      "изборен риск",
      "изборния риск",
      "election risk",
      "risk index",
      "risk score",
    ) ||
    (has(q, "риск", "risk") &&
      has(
        q,
        "индекс",
        "index",
        "секци",
        "section",
        "критичн",
        "critical",
        "ниво",
        "band",
      )) ||
    (has(q, "критичн", "critical") && has(q, "секци", "section"))
  )
    return { tool: "riskScore", args: el };
  if (
    has(
      q,
      "прахосан",
      "под прага",
      "wasted vote",
      "below threshold",
      "sub-threshold",
      "под 4",
    )
  )
    return { tool: "wastedVotes", args: el };
  if (
    has(
      q,
      "съмнителни населени",
      "концентриран вот",
      "concentration of vote",
      "suspicious settlement",
    ) ||
    (has(q, "съмнителн", "suspicious", "съмнителни места") &&
      has(q, "населен", "settlement", "село", "градче"))
  )
    return { tool: "suspiciousSettlements", args: el };
  if (
    has(
      q,
      "чужбина",
      "диаспора",
      "diaspora",
      "abroad",
      "out-of-country",
      "out of country",
      "извън страната",
    )
  )
    return { tool: "diasporaVote", args: el };
  if (
    has(
      q,
      "устойчивост на вот",
      "voter persistence",
      "stay rate",
      "запазиха",
      "задържане на глас",
    ) ||
    (has(q, "лоялност", "loyalty") && has(q, "избирател", "voter")) ||
    (has(q, "останаха", "stayed") && has(q, "парти", "party"))
  )
    return { tool: "voterPersistence", args: el };

  // 1b. local elections (municipal) — before party/turnout so a local question
  // mentioning a party isn't routed to the parliamentary tools.
  const isLocal = has(
    q,
    "местни",
    "местн",
    "общинск",
    "кмет",
    "mayor",
    "municipal",
    "local election",
  );
  // extraordinary (partial/new) local elections feed
  if (has(q, "частичн", "извънредн", "partial elec", "chmi")) {
    const place = extractPlace(q);
    return { tool: "chmiEvents", args: place ? { place } : {} };
  }
  // council *resolutions* (what the council decided) — before the local block so
  // a "реши" question doesn't get the council-seats breakdown.
  if (
    has(q, "реши", "решени", "resolution", "decide", "decision") &&
    has(q, "съвет", "council")
  ) {
    const place = extractPlace(q);
    if (place) return { tool: "councilResolutions", args: { place } };
  }
  if (isLocal) {
    const place = extractPlace(q);
    // oblast/province-wide mayors-by-party rollup. Gated on the "област"/province
    // qualifier + a named oblast, so a bare município name ("Пловдив") still
    // falls through to the município tools below.
    if (has(q, "област", "province", "oblast") && has(q, "кмет", "mayor")) {
      const obl = findOblastInText(q);
      if (obl) return { tool: "localOblastMayors", args: { place: obl.code } };
    }
    // районни / кметствени кметове (Sofia districts or settlement mayors) —
    // more specific than the mayor-history rule below, so it goes first
    if (
      place &&
      has(q, "район", "district", "кметств", "кметства", "settlement")
    )
      return { tool: "localSubMayors", args: { place } };
    // mayors of a NAMED place over time ("последните кметове на София") -> history;
    // "кметове"/"mayors won" with no place -> the national mayors-by-party rollup
    if (
      place &&
      has(
        q,
        "кметове",
        "кметовете",
        "mayors",
        "история",
        "history",
        "през годините",
        "по мандат",
        "досега",
      )
    )
      return { tool: "localMayorHistory", args: { place } };
    if (has(q, "кметове", "кметск", "mayors won") && !place)
      return { tool: "localMayorsWon", args: {} };
    // council: per-place full breakdown if a place is named, else national share
    if (has(q, "съвет", "council") && place)
      return { tool: "localCouncil", args: { place } };
    if (has(q, "съвет", "council", "гласове"))
      return { tool: "localCouncilVoteShare", args: {} };
    if (has(q, "кандидат", "candidates", "ran for") && place)
      return { tool: "localMayorRace", args: { place } };
    if (has(q, "кмет", "mayor", "община", "municipality") && place)
      return { tool: "localMunicipality", args: { place } };
    if (place) return { tool: "localMunicipality", args: { place } };
    return { tool: "localMayorsWon", args: {} };
  }

  // 1c. governance — public finance
  // optional budget year (2010–2029) for slices that support it
  const budgetYearMatch = q.match(/\b(20[0-2]\d)\b/);
  const budgetYear = budgetYearMatch ? Number(budgetYearMatch[1]) : undefined;
  // pensions / social-security funds -> the NOI pension funds, even when phrased
  // "...в бюджета" (otherwise the generic budget view below would swallow it)
  if (
    has(q, "пенси", "pension", "нои", " nssi", "осигурителн", "social security")
  )
    return { tool: "noiFunds", args: {} };
  // a specific budget FUNCTION (health/defence/education/social/…) -> its share
  // + trend, with or without the word "бюджет"
  const gf = resolveBudgetFunction(q);
  if (gf)
    return {
      tool: "budgetFunction",
      args: budgetYear ? { category: gf, year: budgetYear } : { category: gf },
    };
  if (has(q, "бюджет", "budget")) {
    if (has(q, "министерств", "ministry", "ведомств"))
      return { tool: "ministryBudget", args: { ministry: q } };
    if (
      has(
        q,
        "изпълнение",
        "execution",
        "по месеци",
        "месечно",
        "monthly",
        "през годината",
      )
    )
      return { tool: "budgetExecution", args: { series: q } };
    if (
      has(q, "функц", "cofog", "за какво", "spent on", "spend on", "разход по")
    )
      return {
        tool: "budgetByFunction",
        args: budgetYear ? { year: budgetYear } : {},
      };
    return { tool: "budgetOverview", args: {} };
  }
  // ministry budget without the word "бюджет"
  if (
    has(q, "министерств", "ministry", "ведомств") &&
    has(q, "разход", "харчи", "spend", "програм", "programme")
  )
    return { tool: "ministryBudget", args: { ministry: q } };
  // investment programme (capital projects) — specific so it doesn't eat FDI
  if (
    has(
      q,
      "инвестиционн",
      "investment proj",
      "капиталов",
      "приложение iii",
      "capital project",
    )
  ) {
    const obl = extractPlace(q);
    return { tool: "investmentProjects", args: obl ? { oblast: obl } : {} };
  }
  if (has(q, "поръчк", "procurement", "аоп", " aop")) {
    const place = extractPlace(q);
    if (place && has(q, " в ", " във ", " in "))
      return { tool: "procurementBySettlement", args: { place } };
    return { tool: "procurementTotals", args: {} };
  }
  if (has(q, "европейск", "еврофонд", "eu funds", "isun", "исун", "фондове"))
    return { tool: "fundsOverview", args: {} };
  // debt emissions vs the macro debt level: only route emissions on explicit terms
  if (has(q, "емиси", "облигаци", " bond", "дцк", "issuance"))
    return { tool: "govDebt", args: {} };
  // (pensions / NOI are handled earlier, before the budget block)

  // 1d. governance — people / oversight
  if (
    has(
      q,
      "правителств",
      "government",
      "кабинет",
      "премиер",
      "prime minister",
      " pm",
    )
  )
    return { tool: "governments", args: {} };
  const wantsAssets = has(
    q,
    "актив",
    "богат",
    "asset",
    "richest",
    "wealth",
    "състояние",
    "имот",
  );
  if (has(q, "депутат", " mp", " mps", "народни представители")) {
    if (has(q, "връзк", "connection", "фирм", "company", "бизнес"))
      return { tool: "mpConnectionsTop", args: {} };
    if (wantsAssets) return { tool: "mpAssetsTop", args: {} };
  }
  if (
    has(q, "министр", "служител", "official", "управител", "губернатор") &&
    wantsAssets
  )
    return { tool: "officialsAssetsTop", args: { category: q } };
  if (
    has(
      q,
      "партийно финанс",
      "финансиране на парти",
      "party financ",
      "campaign financ",
      "сметна палата",
      "финансови отчети",
    )
  )
    return { tool: "financingOverview", args: {} };
  if (
    has(q, "социолог", "pollster", "анкет", "проучван", " poll", "polls") &&
    has(q, "точн", "accura", "надежд", "reliab", "грешк", "класаци", "ranking")
  ) {
    // a specific agency named + accuracy/profile context -> per-agency profile
    if (
      has(q, ...AGENCY_TOKENS) ||
      has(q, "профил", "profile", "bias", "house effect")
    )
      return { tool: "agencyProfile", args: { agency: q } };
    return { tool: "pollAccuracy", args: {} };
  }
  if (
    has(q, ...AGENCY_TOKENS) &&
    has(
      q,
      "точн",
      "accura",
      "профил",
      "profile",
      "bias",
      "house",
      "грешк",
      "надежд",
    )
  )
    return { tool: "agencyProfile", args: { agency: q } };
  // latest poll snapshot / "if elections now"
  if (
    has(q, "ако изборите", "if elections", "if the election") ||
    (has(
      q,
      "последн",
      "latest",
      "какво показват",
      "what do the polls",
      "what would",
    ) &&
      has(q, "социолог", "анкет", "проучван", " poll", "polls", "сондаж"))
  )
    return { tool: "latestPolls", args: {} };

  // 1e. place ("about my area"): composite profile + census, before the
  // single-metric place reads so a broad "tell me about X" gets the dashboard.
  if (
    has(
      q,
      "разкажи за",
      "разкажи ми за",
      "профил на",
      "tell me about",
      "за моето",
      "моят град",
      "my area",
      "my town",
      "всичко за",
    )
  ) {
    const place = extractPlace(q);
    if (place) return { tool: "governanceProfile", args: { place } };
  }
  // GRAO registered population — only on explicit registry terms (plain
  // "население/живеят" stays with the 2021 census below).
  if (
    has(
      q,
      "грао",
      "регистрира",
      "постоянен адрес",
      "настоящ адрес",
      "registered popul",
    )
  ) {
    const place = extractPlace(q);
    if (place) return { tool: "graoPopulation", args: { place } };
  }
  if (
    has(
      q,
      "население",
      "жители",
      "живеят",
      "демограф",
      "етнос",
      "етничес",
      "роми",
      "ромск",
      "турци",
      "census",
      "population",
      "inhabitants",
      "live in",
    )
  ) {
    const place = extractPlace(q);
    if (place) return { tool: "census", args: { place } };
  }
  // air quality
  if (has(q, "въздух", "air ", "фпч", "pm10", "pm2", "замърся", "pollut")) {
    const place = extractPlace(q);
    if (place) return { tool: "airQuality", args: { place } };
  }

  // 1e1. ranking across a whole tier ("which oblast/община has the highest X",
  // "top 5 by Y") — a superlative intent + a rankable indicator. Runs before the
  // per-place indicator rules, which need a specific place.
  if (
    has(
      q,
      "най-висок",
      "най-голям",
      "най-много",
      "най-богат",
      "най-нисък",
      "най-ниска",
      "най-малк",
      "най-слаб",
      "най-малко",
      "най-бедн",
      "най-прозрачн",
      "най-непрозрач",
      "топ ",
      "класаци",
      "highest",
      "lowest",
      "most ",
      "least ",
      "top ",
      "largest",
      "smallest",
      "richest",
      "poorest",
      "ranking",
    )
  ) {
    const areaCtx = has(q, "област", "region", "oblast", "община", "общин");
    const rankInd =
      resolveSubnatKey(q) ||
      resolveRegionKey(q) ||
      (has(q, "прозрачн", "transparency", "lisi", "интегритет")
        ? "transparency"
        : has(q, "богат", "rich", "беден", "бедн", "poor") && areaCtx
          ? "gdpPerCapita"
          : undefined);
    if (rankInd)
      return {
        tool: "rankPlaces",
        args: count ? { indicator: q, n: count } : { indicator: q },
      };
  }

  // 1e2. governance — place-based indicators (before macro: a named place wins)
  if (has(q, "прозрачн", "transparency", "lisi", "интегритет")) {
    const place = extractPlace(q);
    if (place) return { tool: "transparencyScore", args: { place } };
  }
  if (has(q, "данъц", "данък", "такс", " tax", "taxes")) {
    const place = extractPlace(q);
    if (place) return { tool: "localTaxes", args: { place } };
  }
  if (
    resolveSubnatKey(q) &&
    has(q, " в ", " във ", " in ", "община", "municipality")
  ) {
    const place = extractPlace(q);
    if (place)
      return { tool: "subnationalIndicator", args: { place, indicator: q } };
  }
  // per-oblast indicator (e.g. "БВП на човек във Варна") — needs an oblast +
  // a region-level signal so it doesn't shadow the município subnational case
  if (
    resolveRegionKey(q) &&
    has(
      q,
      "на човек",
      "per capita",
      "по области",
      "областта",
      "област",
      "oblast",
    )
  ) {
    const oblHit = findOblastInText(q);
    if (oblHit)
      return {
        tool: "regionIndicator",
        args: { oblast: oblHit.code, indicator: q },
      };
  }

  // land use (national, or oblast if one is named)
  if (
    has(
      q,
      "земепол",
      "land use",
      "land-use",
      " гора",
      "forest",
      "земеделск",
      "agricultural land",
    )
  ) {
    const obl = extractPlace(q);
    return { tool: "landUse", args: obl ? { oblast: obl } : {} };
  }

  // 1f. governance — macro indicators (national)
  if (
    has(q, "показатели", "indicators") &&
    has(
      q,
      "икон",
      "фискал",
      "управл",
      "общест",
      "econom",
      "fiscal",
      "govern",
      "society",
    )
  )
    return { tool: "macroByCategory", args: { category: q } };
  const macroKey = resolveMacroKey(q);
  if (macroKey) return { tool: "macroIndicator", args: { indicator: q } };
  if (has(q, "икономик", "economy", "макро", "macro"))
    return { tool: "macroOverview", args: {} };

  // 1g. election analytical drill-down (before machine/turnout/party)
  // per-party machine-vs-flash reconciliation — a flash/СУЕМГ/machine-correction
  // question that also asks per party ("кои партии загубиха от флаш памет").
  // Must precede both the anomalies counter (keyword "флаш памет") and the
  // generic machine block (keyword "суемг"), which ignore the party dimension.
  {
    const flashCtx = has(q, "флаш", "суемг", "suemg", "flash");
    const machineCorrection = has(
      q,
      "машинни корекции",
      "машинни добавени",
      "машинни премахнати",
      "machine votes added",
      "machine votes removed",
      "machine correction",
    );
    const partyIntent = !!party || has(q, "парти", "part");
    if ((flashCtx || machineCorrection) && partyIntent)
      return {
        tool: "flashMemoryByParty",
        args: election ? { election } : {},
      };
  }
  // anomalies — before machine so "машинни корекции/флаш" isn't read as machine vote
  if (
    has(
      q,
      "аномал",
      "нередност",
      "засечк",
      "recount",
      "преброяване наново",
      "проблемни секции",
      "problem section",
      "манипул",
      "измам",
      "флаш памет",
    )
  )
    return { tool: "electionAnomalies", args: election ? { election } : {} };
  if (
    has(
      q,
      "прелива",
      "къде отидоха",
      "къде отиват",
      "трансфер на глас",
      "vote flow",
      "vote transition",
      "преминаха глас",
      "миграция на глас",
    )
  )
    return { tool: "voteTransitions", args: election ? { election } : {} };

  // 2. machine voting
  if (isMachine) {
    if (isTrend || !election)
      return { tool: "machineVoteSeries", args: seriesArgs(q, count) };
    return { tool: "machineVoteShare", args: { election } };
  }

  // 3. turnout
  if (isTurnout) {
    // per-oblast turnout history if an oblast is named (e.g. "активността в Хасково")
    const oblHit = findOblastInText(q);
    if (oblHit) return { tool: "regionHistory", args: { oblast: oblHit.code } };
    if (isTrend && !election)
      return { tool: "turnoutSeries", args: seriesArgs(q, count) };
    if (election) return { tool: "turnout", args: { election } };
    return { tool: "turnoutSeries", args: seriesArgs(q, count) };
  }

  // 4. a specific party
  if (party) {
    // a party's regional strength ("къде е силна ГЕРБ", "ГЕРБ по области")
    if (
      has(
        q,
        "област",
        "region",
        "по области",
        "къде",
        "where",
        "силн",
        "strong",
        "regional",
      )
    )
      return {
        tool: "regionBreakdown",
        args: election ? { party, election } : { party },
      };
    const wantsTimeline =
      has(q, "през годините", "over time", "история", "history", "timeline") ||
      (isTrend && !election);
    if (wantsTimeline) return { tool: "partyTimeline", args: { party } };
    return {
      tool: "partyResult",
      args: election ? { party, election } : { party },
    };
  }

  // 4b. a person's candidate preferential results — a name (2–3 capitalized
  // words) that isn't a known oblast or party. Runs after the specific
  // party/place rules so those win first, and BEFORE the generic "резултат"
  // rule so "резултатите за Божидар Божанов" isn't swallowed by national results.
  // (personName was resolved once at the top of route().)
  if (personName) {
    const nm = personName.toLowerCase();
    if (!findOblastInText(nm) && !detectParty(nm)) {
      return {
        tool: "candidateResult",
        args: election ? { name: personName, election } : { name: personName },
      };
    }
  }

  // 5. generic national results / "who won" / "what happened"
  if (
    has(
      q,
      "резултат",
      "result",
      "спечели",
      "won",
      "победител",
      "winner",
      "кой",
      "какво стана",
      "какво показа",
      "what happened",
      "обобщ",
      "summary",
      "overview",
      "класиране",
      "standings",
      "разпределение",
    )
  ) {
    return { tool: "nationalResults", args: election ? { election } : {} };
  }

  // 6. catch-all: the question is clearly about an election but matched no
  // specific intent -> show the national results (a sensible default) rather
  // than declining. Keeps a weak/over-eager model from inventing a tool.
  if (has(q, "избор", "election", "вот", " vote", "избирате")) {
    return { tool: "nationalResults", args: election ? { election } : {} };
  }

  return null;
};
