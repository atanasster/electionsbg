// Deterministic intent router (the v1 fallback / no-model path).
//
// Maps a BG/EN question to { tool, args } using keyword + entity heuristics.
// This is intentionally simple: it's the safety net beneath the
// grammar-constrained LLM router (M3). When the model lands it replaces this as
// the primary, and this stays as the offline fallback.

import { ALL_ELECTIONS } from "../tools/dataset";
import { resolveMacroKey } from "../tools/macro";
import { resolveSubnatKey } from "../tools/placesGov";
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
    const pick = (y?: string) =>
      y ? ALL_ELECTIONS.find((e) => e.name.startsWith(y))?.name : undefined;
    const a = pick(years[0]);
    const b = pick(years[1]) ?? ctx.election;
    if (a) return { tool: "compareElections", args: { a, b } };
  }

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
    if (has(q, "кметове", "кметск", "mayors won"))
      return { tool: "localMayorsWon", args: {} };
    const place = extractPlace(q);
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
      return { tool: "budgetByFunction", args: {} };
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
  if (
    has(q, "нои", " nssi", "осигурителн", "пенси", "social security", "pension")
  )
    return { tool: "noiFunds", args: {} };

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
    has(q, "точн", "accura", "надежд", "reliab", "грешк")
  )
    return { tool: "pollAccuracy", args: {} };

  // 1e. place ("about my area"): composite profile + census, before the
  // single-metric place reads so a broad "tell me about X" gets the dashboard.
  if (
    has(
      q,
      "разкажи",
      "профил",
      "tell me about",
      "about ",
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

  // 2. machine voting
  if (isMachine) {
    if (isTrend || !election)
      return { tool: "machineVoteSeries", args: count ? { n: count } : {} };
    return { tool: "machineVoteShare", args: { election } };
  }

  // 3. turnout
  if (isTurnout) {
    if (isTrend && !election)
      return { tool: "turnoutSeries", args: count ? { n: count } : {} };
    if (election) return { tool: "turnout", args: { election } };
    return { tool: "turnoutSeries", args: count ? { n: count } : {} };
  }

  // 4. a specific party
  if (party) {
    const wantsTimeline =
      has(q, "през годините", "over time", "история", "history", "timeline") ||
      (isTrend && !election);
    if (wantsTimeline) return { tool: "partyTimeline", args: { party } };
    return {
      tool: "partyResult",
      args: election ? { party, election } : { party },
    };
  }

  // 5. generic national results / "who won"
  if (
    has(q, "резултат", "result", "спечели", "won", "победител", "winner", "кой")
  ) {
    return { tool: "nationalResults", args: election ? { election } : {} };
  }

  return null;
};
