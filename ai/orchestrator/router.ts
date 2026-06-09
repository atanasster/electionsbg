// Deterministic intent router (the v1 fallback / no-model path).
//
// Maps a BG/EN question to { tool, args } using keyword + entity heuristics.
// This is intentionally simple: it's the safety net beneath the
// grammar-constrained LLM router (M3). When the model lands it replaces this as
// the primary, and this stays as the offline fallback.

import { ALL_ELECTIONS } from "../tools/dataset";
import { resolveBudgetFunction } from "../tools/fiscal";
import { resolveMacroKey } from "../tools/macro";
import { SOFIA_CITY } from "../tools/areaResults";
import { findOblastInText } from "../tools/place";
import { resolveRegionKey, resolveSubnatKey } from "../tools/placesGov";
import { detectPriceProduct } from "../tools/prices";
import { TOOLS_BY_NAME } from "../tools/registry";
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

// Bulgarian + English month-name stems -> month number, used to disambiguate a
// multi-election year ("юли 2021" -> the July ballot). Matched per whole token
// (JS \b doesn't work around Cyrillic), so "май" can't hit inside another word.
const MONTH_STEMS: [string, number][] = [
  ["януари", 1],
  ["jan", 1],
  ["февруари", 2],
  ["feb", 2],
  ["март", 3],
  ["mar", 3],
  ["април", 4],
  ["apr", 4],
  ["май", 5],
  ["may", 5],
  ["юни", 6],
  ["jun", 6],
  ["юли", 7],
  ["jul", 7],
  ["август", 8],
  ["aug", 8],
  ["септ", 9],
  ["sep", 9],
  ["октом", 10],
  ["oct", 10],
  ["ноем", 11],
  ["nov", 11],
  ["декем", 12],
  ["dec", 12],
];

const detectMonth = (q: string): number | undefined => {
  const tokens = q.split(/[^a-zа-яё]+/i).filter(Boolean);
  for (const tok of tokens)
    for (const [stem, mo] of MONTH_STEMS) if (tok.startsWith(stem)) return mo;
  return undefined;
};

// A bare year normally -> the most recent election in that year. But a year that
// held more than one election (2021, 2024) keeps its ambiguity (return the bare
// year), so runTool fans it out into a combined comparison — UNLESS a month name
// pins one ballot ("юли 2021" -> the exact July election).
const detectElection = (q: string): string | undefined => {
  const m = q.match(/\b(20\d{2})\b/);
  if (!m) return undefined;
  const year = m[1];
  const inYear = ALL_ELECTIONS.filter((e) => e.name.startsWith(year));
  if (inYear.length === 0) return undefined;
  if (inYear.length === 1) return inYear[0].name; // ALL_ELECTIONS is newest-first
  const mo = detectMonth(q);
  if (mo) {
    const mm = String(mo).padStart(2, "0");
    const hit = inYear.find((e) => e.name.startsWith(`${year}_${mm}`));
    if (hit) return hit.name;
  }
  return year; // bare multi-election year -> combined in runTool
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

// An EXPLICIT "evolution over time" cue — tighter than TREND, which is too loose
// for the local/budget branches (TREND counts bare "избори"/"последните", but
// "местни избори"/"последните местни избори" are NOT trend asks). Used to split
// the cross-cycle / multi-year trend tools from their single-period snapshots.
const OVER_TIME = [
  "през годините",
  "над годините",
  "over time",
  "over the years",
  "по години",
  "year over year",
  "year-over-year",
  "по цикли",
  "across cycles",
  "от цикъл",
  "cycle to cycle",
  "по мандати",
  "тренд",
  "trend",
  "еволюц",
  "evolution",
  "как се промен",
  "как се промени",
  "променя се",
  "променят",
  "changed over",
];
const overTimeCue = (q: string): boolean =>
  has(q, ...OVER_TIME) || detectYearsWindow(q) !== undefined;

// A reference to ONE named settlement — the Bulgarian "с." (село) / "гр." (град)
// abbreviation before a name, or the spelled-out "село"/"град" / EN "village"/
// "town" + a name. This is the single-place intent ("резултатите в с. Иново"),
// distinct from the "по села / by settlement" AGGREGATION across a município
// (settlementWinners). \b is unreliable around Cyrillic, so each leading boundary
// is an explicit start / space / opening-bracket.
const SETTLEMENT_MARKERS: RegExp[] = [
  /(?:^|[\s("„])(?:с|гр)\.\s*[а-яёa-z]/, // "с. Иново" / "гр. Банско"
  /(?:^|[\s("„])(?:село|град)\s+[а-яё]/, // "село Иново" / "град Варна"
  /(?:^|[\s("„])(?:village|town)\s+(?:of\s+)?[a-z]/, // "village (of) Inovo"
];
const hasSettlementMarker = (q: string): boolean =>
  SETTLEMENT_MARKERS.some((re) => re.test(q));

// A "по / by / each" cue marks an AGGREGATION across many settlements (the
// settlementWinners list), so such a query must NOT be read as a single one.
const isAggregation = (q: string): boolean =>
  /(?:^|\s)по\s/.test(q) ||
  /\bby\s/.test(q) ||
  /\beach\b/.test(q) ||
  /всяк/.test(q);

// A SINGLE-município qualifier ("община X" / "X municipality") — the singular
// forms only. "общини"/"общините" don't contain "община" (а≠и) and "municipality"
// isn't a substring of "municipalities" (…y vs …ies), so plain includes isolates
// the singular; the aggregation gate above strips the "по общини / by municipality"
// LIST queries.
const hasMuniMarker = (q: string): boolean =>
  has(q, "община", "общината", "municipality");

// A SINGLE-oblast qualifier ("област X" / "region/province/oblast"). "области"
// (plural) is excluded by the negative lookahead; EN singular forms exclude their
// trailing "s".
const hasRegionMarker = (q: string): boolean =>
  /област(?!и)/.test(q) ||
  /\boblast\b/.test(q) ||
  /\bregion(?!s)/.test(q) ||
  /\bprovince(?!s)/.test(q);

// Sofia CITY (the three city МИР S23/S24/S25 combined) vs Sofia PROVINCE (SFO).
// Matches a Sofia/столица reference but NOT the "Софийска област / Sofia province"
// phrasing, which is the separate SFO oblast.
const isSofiaCity = (q: string): boolean =>
  /софия|sofia|столиц/.test(q) &&
  !/софийск|sofia province|sofia oblast|област софия|\bsfo\b/.test(q);

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
  "през",
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
  // drill-down level common-nouns — never a place name, so strip them so the
  // resolver sees a clean place ("по секции в Банско" -> "Банско")
  "по",
  "секции",
  "секция",
  "секциите",
  "населени",
  "населено",
  "места",
  "място",
  "село",
  "села",
  "селата",
  "section",
  "sections",
  "settlement",
  "settlements",
  "village",
  "villages",
  "municipality",
  "municipalities",
  "polling",
  "station",
  "stations",
  "region",
  "regions",
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
  // trend / evolution filler — never a place, so a national "over the years"
  // question (no município named) extracts to nothing instead of junk
  "как",
  "се",
  "променя",
  "променят",
  "промени",
  "за",
  "вот",
  "вота",
  "вотът",
  "кметовете",
  "партията",
  "години",
  "годините",
  "годината",
  "цикъл",
  "цикли",
  "цикъла",
  "мандат",
  "мандати",
  "тренд",
  "trend",
  "how",
  "have",
  "has",
  "changed",
  "change",
  "across",
  "cycles",
  "cycle",
  "over",
  "time",
  "years",
  "year",
  "per",
  "party",
  "parties",
  "share",
  "vote",
  "votes",
  "mayoralties",
  // single-settlement markers ("с." / "гр." abbreviations + spelled forms) and
  // result/trend filler — stripped so "резултатите в с. Иново за последните 5
  // години" extracts to the bare settlement name ("Иново").
  "с",
  "гр",
  "град",
  "town",
  "резултат",
  "резултати",
  "резултатите",
  "резултата",
  "последен",
  "последно",
  "последни",
  "последните",
  "last",
  // "how did X vote" verbs — so "как гласува гр. Банско" extracts to "Банско"
  "гласува",
  "гласуват",
  "гласували",
  "гласувам",
  "voted",
  "voting",
]);

const extractPlace = (q: string): string | undefined => {
  const words = q
    .replace(/[?.,!„“”"'`]/g, " ")
    .split(/\s+/)
    // a bare number is a date/count selector, never a place — drop it so
    // "съветите през 2019" or "...за последните 5 години" don't leak a digit
    // token into the município name
    .filter((w) => w && !PLACE_STOP.has(w) && !/^\d+$/.test(w));
  const cand = words.join(" ").trim();
  return cand.length > 1 ? cand : undefined;
};

export const route = (question: string, ctx: ToolContext): Route => {
  const q = question.toLowerCase().trim();
  if (!q) return null;

  // A bare polling-section id (exactly 9 digits) names ONE station, not a place —
  // route it to the section tools straight away, before the year/count detectors
  // (a section id can embed a "20xx" run) or the place extractor (which can't read
  // a number) get a chance to mis-handle it. The id self-locates: its first two
  // digits are the МИР bundle, so the tool needs nothing but the number. An
  // explicit cross-election cue ("през годините"/"trend") asks for the history;
  // otherwise it's that section's results (year resolved from the rest of the q).
  const sectionId = q.match(/\b\d{9}\b/)?.[0];
  if (sectionId) {
    const rest = q.replace(sectionId, " ");
    // Risk-screening lens for ONE station — its rap sheet (risk band per
    // election) + problem-neighborhood / persistent-cluster membership.
    // Checked before the party-share history cue so "история на риска" /
    // "risk history" (which contain "история" / "history") don't fall to the
    // vote-trend tool.
    if (
      has(
        rest,
        "риск",
        "risk",
        "проблемн",
        "problem",
        "клъстер",
        "cluster",
        "скрининг",
        "screening",
        "повтарящ",
        "persistent",
        "контролиран",
        "controlled",
      )
    )
      return { tool: "sectionRiskHistory", args: { section: sectionId } };
    if (
      has(
        rest,
        "история",
        "history",
        "тренд",
        "trend",
        "през годините",
        "over time",
        "през изборите",
        "across elections",
        "всички избори",
        "all elections",
        "по избори",
        "по години",
      )
    )
      return { tool: "sectionHistory", args: { section: sectionId } };
    const secEl = detectElection(rest);
    return {
      tool: "sectionResults",
      args: secEl
        ? { section: sectionId, election: secEl }
        : { section: sectionId },
    };
  }

  const party = detectParty(q);
  const election = detectElection(q);
  const count = detectCount(q);
  const isTrend = has(q, ...TREND) || (count !== undefined && count >= 2);
  const isMachine = has(q, "машин", "machine", "суемг", "suemg");
  const isTurnout = has(q, "активн", "turnout", "гласувал", "voters");
  const isCompare = has(q, "сравн", "compare", "срещу", " vs ", "спрямо");
  // "which party / by party" — a request to RANK parties, not filter to one. Used
  // to re-aim aggregate tools (machine share, MP assets, risk) at a per-party
  // breakdown instead of a party-blind national figure.
  const partyRanking = has(
    q,
    "коя партия",
    "кои партии",
    "коя от партиите",
    "кои от партиите",
    "по партия",
    "по партии",
    "which party",
    "which parties",
    "by party",
    "per party",
  );

  // 0. machine-vote adoption per party ("машинно гласуване по партия"). Before
  // the compare block so an EN "machine vs paper by party" isn't read as a
  // two-election comparison, and before the machine block which is party-blind.
  if (isMachine && partyRanking && !has(q, "корекци", "correction"))
    return { tool: "machineVoteByParty", args: election ? { election } : {} };

  // 0a. basket vs official inflation — needs BOTH a basket cue AND an
  // inflation/HICP cue. Placed before the compare block because "кошница спрямо
  // инфлацията" carries "спрямо" (a compare trigger); and before the prices
  // block (which EXCLUDES inflation words) and the macro block.
  if (
    has(q, "кошниц", "basket") &&
    has(q, "инфлация", "inflation", "ипц", "hicp", "хипц") &&
    !has(q, "данък", "данъц", " tax", "taxes", "бюджет", "budget", "държав")
  ) {
    return { tool: "basketVsInflation", args: {} };
  }

  // 0b. basket affordability — basket cost relative to regional income
  // (GDP/capita). "Покупателна способност"/"издръжка на живота"/"cost of living"
  // are sufficient on their own; "достъпн"/"affordable" needs a basket/income
  // context so a bare "достъпна услуга" can't trigger it. Before the compare
  // block ("спрямо доходите"), distinct from priceRanking's "най-евтини"
  // (absolute cheap) by the relative-to-income cue.
  {
    const affordConcept = has(
      q,
      "покупателн", // покупателна / покупателната способност
      "purchasing power",
      "издръжка на живот",
      "издръжката на живот",
      "цена на живот", // цена/цената на живота
      "цената на живот",
      "cost of living",
    );
    const affordWeak = has(
      q,
      "достъпн",
      "affordab",
      "спрямо доход",
      "relative to income",
      "спрямо бвп",
      "relative to gdp",
      "тежи на джоба",
    );
    const affordCtx = has(
      q,
      "кошниц",
      "basket",
      "доход",
      "income",
      "бвп",
      "gdp",
      "живот",
      "living",
    );
    if (
      (affordConcept || (affordWeak && affordCtx)) &&
      !has(q, "данък", "данъц", " tax", "taxes", "бюджет", "budget", "държав")
    ) {
      const oblHit = findOblastInText(q);
      return {
        tool: "basketAffordability",
        args: oblHit ? { oblast: oblHit.code } : {},
      };
    }
  }

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

  // --- seats per party over time (multi-election trend) ---
  // "колко места има всяка партия последните 5 години", "how have seats per
  // party changed over time". A seats/мандат word + a trend cue, with no single
  // party or election pinned. Matches even without a "parliament" word, via the
  // party-grouping signal ("по партии" / "per party" / "всяка партия"), so the
  // EN "seats per party over time" routes here. Runs BEFORE the single-election
  // hemicycle snapshot below.
  if (
    !party &&
    !election &&
    isTrend &&
    has(q, "места", "мандат", "seats", "seat") &&
    (has(
      q,
      "парламент",
      "народно събрание",
      "parliament",
      "assembly",
      "депутат",
    ) ||
      partyRanking ||
      has(
        q,
        "всяка партия",
        "всички партии",
        "each party",
        "every party",
        "all parties",
      ))
  )
    return { tool: "seatsHistory", args: seriesArgs(q, count) };

  // --- parliament seat composition (the hemicycle) — single-election snapshot ---
  // "колко места има всяка партия", "seats per party in parliament". Gated on a
  // seats word + a parliament word, with NO specific party named (a party-named
  // "колко мандата има ГЕРБ" falls through to partyResult below). Runs before the
  // roll-call rules so a seats question never reads as a voting-record query.
  if (
    !party &&
    has(q, "места", "мандат", "seats", "seat") &&
    has(q, "парламент", "народно събрание", "parliament", "assembly", "депутат")
  )
    return { tool: "parliamentSeats", args: el };

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
  ) {
    // A trend framing ("последните 5 години", "през годините", "тренд") with no
    // single election pinned -> the cross-election leader trend; otherwise the
    // current-election snapshot.
    if (isTrend && !election)
      return { tool: "romaVoteTrend", args: seriesArgs(q, count) };
    return { tool: "problemSections", args: el };
  }
  if (
    has(q, "устойчив", "persistent", "повтарящи", "recurring") &&
    has(q, "риск", "risk", "клъстер", "cluster", "огнищ", "locus", "loci")
  )
    return { tool: "clusterPersistence", args: {} };
  // risk clusters are party-grounded (each cluster has a leading party), so a
  // "which party is in the riskiest sections" question routes here rather than
  // to the party-blind risk-band index below.
  if (
    has(q, "риск", "risk", "рисков") &&
    (has(q, "клъстер", "cluster", "струпван") || partyRanking)
  )
    return { tool: "riskClusters", args: el };
  // section-level risk SCREENING ("колко критични секции", "секции по ниво на
  // риск") — the per-section band table. Checked before the composite headline
  // so a section/critical-framed question keeps the section view rather than
  // the aggregate index.
  if (
    (has(q, "риск", "risk", "рисков") &&
      has(q, "секци", "section", "критичн", "critical", "ниво", "band")) ||
    (has(q, "критичн", "critical") && has(q, "секци", "section"))
  )
    return { tool: "riskScore", args: el };
  // composite headline index — the 0–100 "47 / Висок" score + its 10 components
  // (process-integrity track + context track), as shown on /risk-analysis.
  if (
    has(
      q,
      "изборен риск",
      "изборния риск",
      "election risk",
      "risk index",
      "risk score",
    ) ||
    (has(q, "риск", "risk", "рисков") &&
      has(q, "индекс", "index", "оценка", "score"))
  )
    return { tool: "riskIndex", args: el };
  // "прахоса" (not just "прахосан") so "коя партия прахоса най-много гласове"
  // matches; a party-framed wasted question gets the per-party ranking, a
  // bare/region one keeps the by-oblast view.
  const wastedCtx = has(
    q,
    "прахоса",
    "под прага",
    "под праг",
    "wasted",
    "below threshold",
    "sub-threshold",
    "под 4",
  );
  // a trend framing ("през годините", a years-window) with no single election
  // and no party ranking -> the national wasted-share-over-elections line
  if (wastedCtx && isTrend && !election && !partyRanking)
    return { tool: "wastedVotesTrend", args: seriesArgs(q, count) };
  if (wastedCtx && partyRanking)
    return { tool: "wastedVotesByParty", args: el };
  if (wastedCtx) return { tool: "wastedVotes", args: el };
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
  ) {
    // trend framing with no single election pinned -> the cross-election
    // diaspora-leader line; otherwise the current-election party breakdown.
    if (isTrend && !election)
      return { tool: "diasporaVoteTrend", args: seriesArgs(q, count) };
    return { tool: "diasporaVote", args: el };
  }
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

  // 1a2. a single named settlement ("резултатите в с. Иново", "как гласува гр.
  // Банско") -> that settlement's own party results, or its vote-share history
  // with a trend cue. The "с." / "гр." abbreviation (or "село/град/village/town"
  // + a name) marks ONE place — distinct from the "по села / by settlement"
  // AGGREGATION below (settlementWinners), which carries a "по/by/each" cue.
  // Placed before the by-area winners block so the single place wins; runs after
  // the integrity/transition blocks so a vote cue can't steal those. Gated on a
  // results/vote intent + no party + no local signal.
  if (
    !party &&
    hasSettlementMarker(q) &&
    !isAggregation(q) &&
    !has(
      q,
      "местни",
      "местн",
      "общинск",
      "кмет",
      "mayor",
      "съвет",
      "council",
    ) &&
    has(
      q,
      "резултат",
      "result",
      "спечели",
      "won",
      "гласува",
      "гласове",
      "гласували",
      "vote",
      "voted",
      "voting",
      "кой води",
      "who leads",
    )
  ) {
    const place = extractPlace(q);
    if (place) {
      if (isTrend && !election)
        return {
          tool: "settlementHistory",
          args: { place, ...seriesArgs(q, count) },
        };
      return {
        tool: "settlementResults",
        args: election ? { place, election } : { place },
      };
    }
  }

  // 1a2b. a single named MUNICIPALITY / OBLAST / Sofia-city ("резултатите в
  // община Пловдив", "резултатите в област Варна", "резултатите в София") -> that
  // area's own party results (or its vote-share trend). Distinct from the
  // "по общини / по области" AGGREGATION lists (municipalityWinners/regionWinners)
  // below, which carry a "по/by/each" cue. Sofia city = the three city МИР summed;
  // abroad keeps its dedicated diasporaVote tools (checked earlier). Same gate as
  // the settlement block, placed right after it (most-specific level first).
  if (
    !party &&
    !isAggregation(q) &&
    !has(
      q,
      "местни",
      "местн",
      "общинск",
      "кмет",
      "mayor",
      "съвет",
      "council",
    ) &&
    has(
      q,
      "резултат",
      "result",
      "спечели",
      "won",
      "гласува",
      "гласове",
      "гласували",
      "vote",
      "voted",
      "voting",
      "кой води",
      "who leads",
    )
  ) {
    const trend = isTrend && !election;
    // Sofia city first (a Sofia reference may also carry "община"/"област").
    if (isSofiaCity(q))
      return trend
        ? {
            tool: "regionResultsTrend",
            args: { oblast: SOFIA_CITY, ...seriesArgs(q, count) },
          }
        : {
            tool: "regionResults",
            args: election
              ? { oblast: SOFIA_CITY, election }
              : { oblast: SOFIA_CITY },
          };
    // single município ("община X")
    if (hasMuniMarker(q)) {
      const place = extractPlace(q);
      if (place)
        return trend
          ? {
              tool: "municipalityHistory",
              args: { place, ...seriesArgs(q, count) },
            }
          : {
              tool: "municipalityResults",
              args: election ? { place, election } : { place },
            };
    }
    // single oblast ("област X")
    if (hasRegionMarker(q)) {
      const oblHit = findOblastInText(q);
      const oblast = oblHit ? oblHit.code : extractPlace(q);
      if (oblast)
        return trend
          ? {
              tool: "regionResultsTrend",
              args: { oblast, ...seriesArgs(q, count) },
            }
          : {
              tool: "regionResults",
              args: election ? { oblast, election } : { oblast },
            };
    }
  }

  // 1a3. parliamentary results, drilled DOWN by area, with NO party named: a
  // per-area winners list (each area + the leading party). The party-scoped
  // *Breakdown tools are handled in the `if (party)` block far below; these are
  // their party-blind equivalents. This MUST run before the local-elections
  // block — the EN word "municipality" otherwise trips that block's broad match
  // and hijacks "results by municipality" to the local dashboard. Gated on a
  // parliamentary-results intent AND the absence of any local signal so genuine
  // mayor/council/местни questions still reach the local tools. Most-specific
  // level first (section → settlement → municipality → region) so a query that
  // names two levels ("по общини в област Варна") lists the finer one.
  {
    const resultsIntent = has(
      q,
      "резултат",
      "result",
      "спечели",
      "won",
      "победител",
      "winner",
      "кой води",
      "who leads",
      "leading party",
      "класиране",
      "standings",
      "разпределение",
    );
    const localSignal = has(
      q,
      "местни",
      "местн",
      "общинск",
      "кмет",
      "mayor",
      "local election",
      "съвет",
      "council",
    );
    if (!party && resultsIntent && !localSignal) {
      if (
        has(
          q,
          "секци",
          "section",
          "polling station",
          "polling-station",
          "избирателни секции",
        )
      ) {
        const place = extractPlace(q);
        if (place)
          return {
            tool: "sectionWinners",
            args: election ? { place, election } : { place },
          };
      }
      if (has(q, "населен", "по села", "по селата", "settlement", "village")) {
        const place = extractPlace(q);
        if (place)
          return {
            tool: "settlementWinners",
            args: election ? { place, election } : { place },
          };
      }
      if (has(q, "по общини", "общин", "municipalit")) {
        const oblHit = findOblastInText(q);
        const place = oblHit ? oblHit.code : extractPlace(q);
        if (place)
          return {
            tool: "municipalityWinners",
            args: election ? { oblast: place, election } : { oblast: place },
          };
      }
      if (
        has(
          q,
          "област",
          "region",
          "oblast",
          "по области",
          "по региони",
          "региони",
        )
      )
        return { tool: "regionWinners", args: election ? { election } : {} };
    }
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
    "council",
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
    // A named year selects that local cycle ("2019" -> 2019_10_27_mi, via
    // resolveLocalCycle). Mayor history & partials span cycles, so they stay
    // unscoped; every per-cycle snapshot tool gets the cycle.
    const cyc = q.match(/\b(20\d{2})\b/)?.[0];
    const withCyc = (a: ToolArgs): ToolArgs => (cyc ? { ...a, cycle: cyc } : a);
    // Cross-cycle NATIONAL trends ("вотът за съветите през годините", "mayors
    // per party across cycles") — gated on an explicit over-time cue, no pinned
    // cycle, and no município named (filler words are stripped by PLACE_STOP, so
    // a place-specific "кметовете на София през годините" keeps a real `place`
    // and falls through to localMayorHistory below). Council checked before
    // mayors so "съветите ... кметове"-style mixed wording prefers council.
    if (!cyc && !place && overTimeCue(q)) {
      if (has(q, "съвет", "council"))
        return { tool: "localCouncilTrend", args: {} };
      if (has(q, "кмет", "mayor"))
        return { tool: "localMayorsTrend", args: {} };
    }
    // oblast/province-wide mayors-by-party rollup. Gated on the "област"/province
    // qualifier + a named oblast, so a bare município name ("Пловдив") still
    // falls through to the município tools below.
    if (has(q, "област", "province", "oblast") && has(q, "кмет", "mayor")) {
      const obl = findOblastInText(q);
      if (obl)
        return {
          tool: "localOblastMayors",
          args: withCyc({ place: obl.code }),
        };
    }
    // районни / кметствени кметове (Sofia districts or settlement mayors) —
    // more specific than the mayor-history rule below, so it goes first
    if (
      place &&
      has(q, "район", "district", "кметств", "кметства", "settlement")
    )
      return { tool: "localSubMayors", args: withCyc({ place }) };
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
      return { tool: "localMayorsWon", args: withCyc({}) };
    // council: per-place full breakdown if a place is named, else national share
    if (has(q, "съвет", "council") && place)
      return { tool: "localCouncil", args: withCyc({ place }) };
    if (has(q, "съвет", "council", "гласове"))
      return { tool: "localCouncilVoteShare", args: withCyc({}) };
    if (has(q, "кандидат", "candidates", "ran for") && place)
      return { tool: "localMayorRace", args: withCyc({ place }) };
    if (has(q, "кмет", "mayor", "община", "municipality") && place)
      return { tool: "localMunicipality", args: withCyc({ place }) };
    if (place) return { tool: "localMunicipality", args: withCyc({ place }) };
    return { tool: "localMayorsWon", args: withCyc({}) };
  }

  // 1c. governance — public finance
  // optional year (2000–2029) for slices that support one: budget fiscal year,
  // an indicator's as-of year, a governance profile's as-of year.
  const promptYearMatch = q.match(/\b(20[0-2]\d)\b/);
  const promptYear = promptYearMatch ? Number(promptYearMatch[1]) : undefined;
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
      args: promptYear ? { category: gf, year: promptYear } : { category: gf },
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
        args: promptYear ? { year: promptYear } : {},
      };
    // year-over-year revenue/spending trend (no single fiscal year pinned). Note
    // budgetExecution above already owns the within-year "през годината"/monthly
    // ask, so this is the cross-year line.
    if (!promptYear && overTimeCue(q)) return { tool: "budgetTrend", args: {} };
    return {
      tool: "budgetOverview",
      args: promptYear ? { year: promptYear } : {},
    };
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
  const wantsConnections = has(
    q,
    "връзк",
    "connection",
    "фирм",
    "company",
    "бизнес",
  );
  // "which party's MPs are richest / most connected" -> per-party rollup, before
  // the individual-MP rankings (which ignore the party-aggregation intent and
  // wouldn't even fire when "депутат" is absent, e.g. "кои партии имат връзки").
  if (partyRanking) {
    if (wantsConnections) return { tool: "mpConnectionsByParty", args: {} };
    if (wantsAssets) return { tool: "mpAssetsByParty", args: {} };
  }
  // MPs (current roster) of a NAMED party — "кои са депутатите от ПП?",
  // "MPs from GERB", "депутатите на ДПС". Lists the sitting members by name.
  // Gated on a party token + an MP word, but NOT a wealth/connections framing
  // (those keep the assets/connections rankings below) and NOT the roll-call
  // intents (loyalty/attendance/cohesion already returned earlier). Runs before
  // the generic `if (party)` results block so it isn't swallowed by partyResult.
  if (
    party &&
    has(
      q,
      "депутат",
      "народни представители",
      "представители",
      " mp",
      " mps",
      "mps",
    ) &&
    !wantsAssets &&
    !wantsConnections
  )
    return { tool: "partyMps", args: { party } };
  if (has(q, "депутат", " mp", " mps", "народни представители")) {
    if (wantsConnections) return { tool: "mpConnectionsTop", args: {} };
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
  // --- polling TRENDS (evolution over time) — must precede the snapshot/profile
  // routes below, so "история на проучванията на X" plots a trend instead of
  // falling through to a per-agency profile (or a candidate lookup). The "over
  // time" cue (история/history/през годините/тренд/…) is what splits a trend
  // from the single-period snapshots. ---
  {
    const pollCtx = has(
      q,
      "социолог",
      "pollster",
      "анкет",
      "проучван",
      " poll",
      "polls",
      "сондаж",
    );
    const accuracyCtx = has(
      q,
      "точн",
      "accura",
      "грешк",
      "error",
      "надежд",
      "reliab",
      "mae",
      "класаци",
      "ranking",
    );
    const agencyNamed = has(q, ...AGENCY_TOKENS);
    const pollTrend = has(q, "история", "history") || overTimeCue(q);
    // Require an explicit poll/accuracy context — a bare agency token alone is
    // unsafe ("тренд"/"маркет" double as common words, so "тренд на резултатите
    // през годините" must NOT resolve to the Тренд agency).
    if (pollTrend && (pollCtx || accuracyCtx)) {
      // accuracy/MAE evolution: per-agency when one is named, else comparative.
      if (accuracyCtx)
        return agencyNamed
          ? { tool: "agencyAccuracyHistory", args: { agency: q } }
          : { tool: "accuracyTrend", args: {} };
      // poll-number evolution for a named agency.
      if (agencyNamed) return { tool: "agencyPolls", args: { agency: q } };
      // generic "история на проучванията" (no agency, no accuracy word): the
      // comparative accuracy trend is the most useful historical overview.
      return { tool: "accuracyTrend", args: {} };
    }
  }
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
    if (place)
      return {
        tool: "governanceProfile",
        args: promptYear ? { place, year: promptYear } : { place },
      };
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

  // 1e0. prices (КЗП „Колко струва“) — euro-adoption retail-price monitoring.
  // Gated on a price cue; excludes official CPI ("инфлация"/HICP → macro), local
  // taxes, and the budget "колко струва държавата". Runs before the macro + rank
  // blocks so "цените"/"кошница" don't fall to an inflation/indicator read.
  {
    const priceProduct = detectPriceProduct(q);
    // An explicit price/shopping/chain cue. NOTE: a product word alone does NOT
    // trigger (e.g. "бира" hides inside "избирателна"); it only routes the
    // product sub-case once a real price cue is present. "пазарув" (not "пазар",
    // which is inside "Пазарджик"). Excludes official CPI, taxes, budget/state,
    // and risk so those keep their own tools.
    const priceWord = has(
      q,
      "цена",
      "цени",
      "цената",
      "цените",
      "кошниц",
      "basket",
      "price",
      "prices",
      "пазарув",
      " shop",
      "shopping",
    );
    const chainWord = has(
      q,
      "верига",
      "вериги",
      "магазин",
      "супермаркет",
      "supermarket",
      "chain",
      " store",
    );
    const costPhrase =
      (has(q, "колко струва") && !has(q, "държав")) ||
      has(q, "how much is", "how much are", "how much does", "how much do");
    // "cheapest/priciest <place-tier>" — a cheap/expensive word ONLY counts when
    // paired with a place tier, so a bare "евтин" can't over-trigger.
    const cheapPlace =
      has(
        q,
        "най-евтин",
        "cheapest",
        "по-евтин",
        "най-скъп",
        "most expensive",
        "скъп",
      ) &&
      has(
        q,
        "град",
        "област",
        "място",
        "община",
        "общин",
        "town",
        "city",
        "oblast",
        "place",
        "municipalit",
      );
    const priceCtx =
      (priceWord || chainWord || costPhrase || cheapPlace) &&
      !has(
        q,
        "инфлация",
        "inflation",
        "ипц",
        "hicp",
        "данък",
        "данъц",
        " tax",
        "taxes",
        "бюджет",
        "budget",
        "държав",
        "state",
        "government",
        "риск",
        "risk",
      );
    if (priceCtx) {
      // Strip price + product filler so the place extractor sees a clean name.
      // Cyrillic suffixes use [а-яё]* (JS \w matches only ASCII). Baseline
      // phrases ("от еврото") are stripped as units so a bare "от" can't leak
      // and mis-match a town (e.g. "Ботевград" contains "от").
      const PRICE_STRIP =
        /от въвеждането на еврото|от еврото|since the euro|въвеждането[а-яё]*|еврото|колко|струва[а-яё]*|цен[аи][а-яё]*|кошниц[а-яё]*|най-евтин[а-яё]*|евтин[а-яё]*|най-скъп[а-яё]*|скъп[а-яё]*|поскъп[а-яё]*|верига|вериги|магазин[а-яё]*|супермаркет[а-яё]*|пазарув[а-яё]*|how much|how|much|price[a-z]*|prices|basket|cheap[a-z]*|expensive|supermarket[a-z]*|chain[a-z]*|store|shop[a-z]*|мляко[а-яё]*|хляб[а-яё]*|яйца|олио|зехтин|кашкавал|сирене|масло|брашно|захар|ориз|пилешк[а-яё]*|пиле|свинск[а-яё]*|телешк[а-яё]*|кайма|банан[а-яё]*|ябълк[а-яё]*|домат[а-яё]*|картоф[а-яё]*|краставиц[а-яё]*|кафе|чай|бира|вино|ракия|цигари|тютюн|шампоан|сапун|лютеница|milk|bread|eggs|oil|cheese|butter|flour|sugar|rice|chicken|pork|beef|banana[a-z]*|apple[a-z]*|tomato[a-z]*|potato[a-z]*|onion[a-z]*|cucumber[a-z]*|coffee|tea|beer|wine|soap|shampoo|toothpaste/gi;
      const place = extractPlace(q.replace(PRICE_STRIP, " "));
      // chain comparison
      if (
        has(
          q,
          "верига",
          "вериги",
          "магазин",
          "супермаркет",
          "supermarket",
          "chain",
          "store",
        )
      )
        return { tool: "cheapestChains", args: place ? { place } : {} };
      // ranking of places by price (cheapest, or where it rose most)
      const superl = has(
        q,
        "най-евтин",
        "най-скъп",
        "cheapest",
        "most expensive",
        "по-евтин",
        "по-скъп",
      );
      const where = has(q, "къде", "where");
      const rose = has(q, "поскъп", "rose", "increase", "risen", "rise");
      const placeTier = has(
        q,
        "град",
        "място",
        "места",
        "област",
        "town",
        "city",
        "place",
        "oblast",
      );
      if ((superl && (placeTier || where)) || (where && rose))
        return {
          tool: "priceRanking",
          args: count ? { metric: q, n: count } : { metric: q },
        };
      // a named place (and/or a single product) → that place's prices
      if (place || priceProduct)
        return {
          tool: "settlementPrices",
          args: {
            ...(place ? { place } : {}),
            ...(priceProduct ? { product: q } : {}),
          },
        };
      // national / per-oblast basket index since the euro
      const oblHit = findOblastInText(q);
      return {
        tool: "priceIndex",
        args: oblHit ? { oblast: oblHit.code } : {},
      };
    }
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
      return {
        tool: "subnationalIndicator",
        args: promptYear
          ? { place, indicator: q, year: promptYear }
          : { place, indicator: q },
      };
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
        args: promptYear
          ? { oblast: oblHit.code, indicator: q, year: promptYear }
          : { oblast: oblHit.code, indicator: q },
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
  if (macroKey)
    return {
      tool: "macroIndicator",
      args: promptYear ? { indicator: q, year: promptYear } : { indicator: q },
    };
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
    // per-party recount reconciliation ("кои партии загубиха от преброяване
    // наново"). Only 2024-10-27 has recount data; other elections fall back to a
    // no-recount scalar. Before the anomalies counter, which is party-blind.
    const recountCtx = has(
      q,
      "преброяване наново",
      "преброени наново",
      "преброяване отново",
      "наново преброй",
      "recount",
    );
    if (recountCtx && partyIntent)
      return { tool: "recountByParty", args: election ? { election } : {} };
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
    // a party's per-settlement breakdown within one município ("ГЕРБ по
    // населени места в община Варна"). Checked before the municipality rule so
    // the "община" in such a query doesn't divert it.
    if (has(q, "населен", "settlement", "по села", "по селата")) {
      const place = extractPlace(q);
      if (place)
        return {
          tool: "settlementBreakdown",
          args: election ? { party, place, election } : { party, place },
        };
    }
    // a party's per-municipality breakdown within one oblast ("ГЕРБ по общини
    // във Варна").
    if (has(q, "по общини", "общини", "municipalit")) {
      const oblHit = findOblastInText(q);
      const place = oblHit ? oblHit.code : extractPlace(q);
      if (place)
        return {
          tool: "municipalityBreakdown",
          args: election
            ? { party, oblast: place, election }
            : { party, oblast: place },
        };
    }
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

// Conversational memory. A bare follow-on like "а ДПС?" / "and DPS?" / "what
// about Varna?" can't stand on its own — it only means "the previous question,
// but for this new entity". When the prior answer's tool has a single entity
// slot (party / person / oblast / place), swap the newly-named entity into it
// and reuse that tool, so the user doesn't have to restate the whole question.
//
// Conservative on purpose: it fires only when (a) a new entity of the right
// type is present AND (b) after dropping an optional leading follow-on particle
// the utterance is JUST that entity (a bare reference). A question with its own
// intent ("а къде е силна ГЕРБ?", "имаше ли нередности на ГЕРБ?") keeps words
// beyond the entity and is left to normal routing. Both the rules and cloud
// providers call this first.
//
// The particle must be a separate leading word (trailing \s+), so it never bites
// into a real word like "Имаше"/"избори"/"икономика" that merely starts with и/а.
const FOLLOWON_CUE =
  /^(а за|ами за|ами при|ами|а|и|what about|how about|and for|what of|and)\s+/i;

// lowercase + drop punctuation (so "ГЕРБ-СДС" and "герб сдс" compare equal) +
// collapse whitespace. Applied to BOTH sides of the bare-entity check.
const normEntity = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const ENTITY_DETECTORS: Record<
  string,
  (q: string, raw: string) => string | undefined
> = {
  party: (q) => detectParty(q),
  person: (_q, raw) => extractPersonName(raw),
  oblast: (_q, raw) => findOblastInText(raw)?.name.bg,
  place: (_q, raw) => extractPlaceCandidates(raw)[0],
};

export const resolveFollowOn = (
  question: string,
  prev: { tool: string; args: ToolArgs } | undefined,
): Route => {
  if (!prev) return null;
  const tool = TOOLS_BY_NAME[prev.tool];
  if (!tool) return null;

  // the tool's primary entity slot, if it has one
  const param = tool.params.find((p) =>
    ["party", "person", "oblast", "place"].includes(p.type),
  );
  if (!param) return null;

  const q = question.toLowerCase().trim();
  const detect = ENTITY_DETECTORS[param.type];
  const value = detect?.(q, question);
  if (!value) return null;

  // Drop a leading particle, then the remainder must equal the entity exactly.
  const remainder = normEntity(q.replace(FOLLOWON_CUE, ""));
  const target = normEntity(value);
  if (remainder !== target) return null;

  // Don't re-fire on the same entity (e.g. echoing the previous answer).
  if (normEntity(String(prev.args[param.name] ?? "")) === target) return null;

  return { tool: prev.tool, args: { ...prev.args, [param.name]: value } };
};
