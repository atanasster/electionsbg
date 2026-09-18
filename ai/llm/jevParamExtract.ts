// Stage 3 of the no-AI Jev lane: fill a picked tool's parameters by TYPE.
//
// Jev chooses the tool; these read the question for the values that tool takes
// — years, elections, counts, parties, places, oblasts — without a model call.
// One extractor per parameter TYPE rather than one per tool: 235 tools share
// sixteen types, and a type's reading of a question does not depend on which
// tool asked.
//
// Every extractor is written to return NOTHING rather than a guess. A value
// that is missing makes the lane ask the user; a value that is wrong answers a
// different question with full confidence. So:
//   - a year is taken only when the question names exactly one;
//   - a place is taken only when exactly one gazetteer entry is named;
//   - a misspelt place is accepted only right after a place cue („в", „in",
//     „община", …), never anywhere in the sentence;
//   - a party's name is never a place, though Възраждане is also a Sofia район;
//   - a count is never a year, a day or an id.
//
// Text parameters (a hospital name, a molecule, a project) have no extractor
// on purpose — nothing here could tell which words of the question are the
// value — so a tool that needs one asks.

import { detectElection, detectParty } from "../orchestrator/router";
import { OBLASTS } from "../tools/place";
import { fetchData } from "../tools/dataClient";
import { TOOLS_BY_NAME } from "../tools/registry";
import { translitKey } from "../tools/translit";
import type { ToolArgs, ToolParam } from "../tools/types";

const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

/** The current question only. A multi-turn eval question carries the previous
 *  turn as „Previous tool: …, args: {…}" before it; those args are the
 *  conversation's context, which is exactly what a follow-up inherits — so
 *  party / election / year read the whole text, while places and counts,
 *  which a follow-up restates, read the current question alone. */
const currentQuestion = (q: string): string => {
  const m = q.match(/(?:Current question|Текущ въпрос|Сегашен въпрос):\s*/i);
  return m ? q.slice(m.index! + m[0].length) : q;
};

// ── years and elections ────────────────────────────────────────────────────

const YEAR = /(?<!\d)((?:19|20)\d{2})(?!\d)/g;

export const yearsIn = (q: string): number[] => [
  ...new Set([...q.matchAll(YEAR)].map((m) => Number(m[1]))),
];

// ── counts ─────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  fifty: 50,
  hundred: 100,
  // Bulgarian, romanized — translitKey folds Cyrillic and Latin-typed alike.
  dve: 2,
  dva: 2,
  tri: 3,
  chetiri: 4,
  pet: 5,
  shest: 6,
  sedem: 7,
  osem: 8,
  devet: 9,
  deset: 10,
  edinadeset: 11,
  dvanadeset: 12,
  petnadeset: 15,
  dvadeset: 20,
  trideset: 30,
  petdeset: 50,
  sto: 100,
};

type Num = { value: number; at: number };

/** Numbers in the question, as token positions, with years and ids excluded.
 *  „7-те" and „51-вото" read as 7 and 51; „ten" and „десет" as 10. */
const numbersIn = (q: string): { tokens: string[]; nums: Num[] } => {
  const tokens = translitKey(q)
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
  const nums: Num[] = [];
  tokens.forEach((t, at) => {
    const digits = t.match(/^(\d{1,3})(?:-?[a-z]{1,5})?$/);
    if (digits) nums.push({ value: Number(digits[1]), at });
    else if (NUMBER_WORDS[t] !== undefined)
      nums.push({ value: NUMBER_WORDS[t], at });
  });
  return { tokens, nums };
};

const followedBy = (tokens: string[], at: number, re: RegExp, span = 2) =>
  tokens.slice(at + 1, at + 1 + span).some((t) => re.test(t));

const YEARS_WORD = /^(?:years?|godin[aiu]?|godini)$/;
const ELECTIONS_WORD =
  /^(?:elections?|votes?|polls?|ballots?|izbor[ai]?|izbori|vota|glasuvaniya)$/;
const ASSEMBLY_WORD =
  /^(?:national|assembly|parliament|narodno|sabranie|parlament|ns)$/;

/** „51st National Assembly", „51-вото Народно събрание". */
export const assemblyIn = (q: string): number | undefined => {
  const { tokens, nums } = numbersIn(q);
  const hit = nums.find(
    (n) =>
      n.value >= 36 && n.value <= 60 && followedBy(tokens, n.at, ASSEMBLY_WORD),
  );
  return hit?.value;
};

/** „the last 5 years" → 5. */
export const yearsWindowIn = (q: string): number | undefined => {
  const { tokens, nums } = numbersIn(q);
  return nums.find(
    (n) =>
      n.value >= 1 && n.value <= 30 && followedBy(tokens, n.at, YEARS_WORD),
  )?.value;
};

/** „the last 7 elections" → 7. */
export const electionCountIn = (q: string): number | undefined => {
  const { tokens, nums } = numbersIn(q);
  return nums.find(
    (n) =>
      n.value >= 2 && n.value <= 40 && followedBy(tokens, n.at, ELECTIONS_WORD),
  )?.value;
};

/** What makes a number an amount, a share or a date rather than a count. */
const NOT_A_COUNT =
  /^(?:\d{3}|%|lv|leva|eur|evro|euro|mln|mlrd|million|billion|thousand|hilyadi|protsent|percent|yan|fev|mart|apr|may|mai|yuni|yuli|avg|sep|okt|noem|dek|jan|feb|jun|jul|aug|oct|nov|dec)/;

/** A plain count — „8 municipalities", „top five". Never a number already read
 *  as an assembly or a years window, and never 1 („which one" is not a count). */

export const countIn = (q: string): number | undefined => {
  const { tokens, nums } = numbersIn(q);
  return nums.find(
    (n) =>
      n.value >= 2 &&
      n.value <= 200 &&
      !followedBy(tokens, n.at, NOT_A_COUNT, 1) &&
      !followedBy(tokens, n.at, YEARS_WORD) &&
      !(
        n.value >= 36 &&
        n.value <= 60 &&
        followedBy(tokens, n.at, ASSEMBLY_WORD)
      ),
  )?.value;
};

// ── places ─────────────────────────────────────────────────────────────────

/** Distance with adjacent transpositions — a typo swaps letters as often as it
 *  drops one („Srdeets", „Plovidv"). */
export const editDistance = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
};

/** How far a misspelling may be from the name it means. Short names get no
 *  slack: at four letters one edit reaches half the gazetteer. */
const slack = (len: number) => (len >= 8 ? 2 : len >= 5 ? 1 : 0);

/** Words after which a (possibly misspelt) word is a place. Romanized.
 *  „на" / „за" / „от" are deliberately absent: they precede a company as
 *  often as a town („отпуснати на Златия Агро" is one edit from Златица). */
const PLACE_CUE = new Set([
  "v",
  "vav",
  "grad",
  "obshtina",
  "obshtinata",
  "oblast",
  "oblastta",
  "rayon",
  "in",
  "of",
  "city",
  "town",
  "municipality",
  "province",
  "region",
]);

type Named = { value: { bg: string; en: string }; keys: string[] };

/** The gazetteer entries a question names — exact first, then within `slack`
 *  after a cue word. Longest span wins at each position. */
export const namedIn = (q: string, entries: Named[]): Named[] => {
  const raw = q.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  const tokens = raw.map((w) => translitKey(w));
  const found: Named[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const span of [3, 2, 1]) {
      if (i + span > tokens.length) continue;
      const key = tokens.slice(i, i + span).join(" ");
      if (key.length < 4) continue;
      // Only a cue word licenses a misspelling. A capital does not: company
      // and group names are capitalised too, and „Zlatia Agro" is one edit
      // from Златица, „Roma" one from Роман.
      const cued = i > 0 && PLACE_CUE.has(tokens[i - 1]);
      const hit =
        entries.find((e) => e.keys.includes(key)) ??
        (cued
          ? entries.find((e) =>
              e.keys.some(
                (k) =>
                  Math.abs(k.length - key.length) <= slack(k.length) &&
                  editDistance(k, key) <= slack(k.length),
              ),
            )
          : undefined);
      if (hit) {
        if (!found.includes(hit)) found.push(hit);
        i += span - 1;
        break;
      }
    }
  }
  return found;
};

/** Oblast names with their „(област)" / „(province)" qualifier stripped. Sofia's
 *  three МИР entries collapse onto the city — a reader does not name a МИР. */
const OBLAST_ENTRIES: Named[] = (() => {
  const base = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, "").trim();
  const seen = new Map<string, Named>();
  for (const [code, name] of Object.entries(OBLASTS)) {
    if (/^S2\d$|^32$|^PDV-00$/.test(code)) continue;
    const value = { bg: base(name.bg), en: base(name.en) };
    const k = translitKey(value.bg);
    if (!seen.has(k))
      seen.set(k, {
        value,
        keys: [...new Set([translitKey(value.bg), translitKey(value.en)])],
      });
  }
  return [...seen.values()];
})();

const SOFIA: Named = {
  value: { bg: "София", en: "Sofia" },
  keys: ["sofiya", "sofia", "stolichna obshtina", "stolitsata"],
};

/** Възраждане is a party and a Sofia район; in a question it is the party. */
const isPartyName = (name: string) =>
  detectParty(name.toLowerCase()) === name.toLowerCase();

let muniEntries: Promise<Named[]> | null = null;
/** Read through `fetchData` rather than `place.ts`'s `loadMunis`, whose module
 *  cache never forgets a load — so an outage here stays an outage. */
const municipalities = (): Promise<Named[]> =>
  (muniEntries ??= fetchData<{ name: string; name_en?: string }[]>(
    "/municipalities.json",
  ).then((ms) => [
    SOFIA,
    ...ms
      .filter((m) => !isPartyName(m.name))
      .map((m) => ({
        value: { bg: m.name, en: m.name_en || m.name },
        keys: [
          ...new Set([translitKey(m.name), translitKey(m.name_en ?? "")]),
        ].filter((k) => k.length >= 4),
      })),
  ])).catch((e) => {
    muniEntries = null;
    throw e;
  });

/** Reset between tests that serve different gazetteers. */
export const resetPlaceCache = () => {
  muniEntries = null;
};

const label = (n: Named, q: string) =>
  hasCyrillic(q) ? n.value.bg : n.value.en;

// ── the dispatcher ─────────────────────────────────────────────────────────

export type TypedArgs = {
  /** Values the question states, by parameter name. */
  args: ToolArgs;
  /** Parameters an extractor LOOKED FOR and could have found — so an absent
   *  one means the question names none, and the tool's default is what was
   *  asked. Deliberately narrower than "has an extractor":
   *    - a year parameter when the question names two years is ambiguous;
   *    - a count parameter is read only under a name a rule handles („round"
   *      and „offset" are counts nobody here reads);
   *    - a party is never read-as-absent: `detectParty` knows a dozen tokens,
   *      and a party it does not know is still a party;
   *    - a place is not read when the gazetteer failed to load, or when the
   *      question names more places than the tool takes. */
  read: Set<string>;
};

const COUNT_NAMES = new Set(["ns", "years", "n", "count", "limit", "topN"]);

/** Values for `tool`'s parameters that the question states, by parameter type. */
export const typedArgs = async (
  tool: string,
  question: string,
): Promise<TypedArgs> => {
  const params = TOOLS_BY_NAME[tool]?.params ?? [];
  const current = currentQuestion(question);
  const lower = question.toLowerCase();
  const out: ToolArgs = {};
  const read = new Set<string>();
  const of = (type: ToolParam["type"]) => params.filter((p) => p.type === type);

  const years = yearsIn(question);
  for (const p of of("year")) {
    if (years.length === 1) out[p.name] = years[0];
    if (years.length <= 1) read.add(p.name);
  }

  const elections = of("election");
  if (elections.length === 1) {
    const e = detectElection(lower);
    if (e && years.length === 1) out[elections[0].name] = e;
    if (years.length <= 1) read.add(elections[0].name);
  } else if (elections.length >= 2) {
    // compareElections(a, b): the years in the order they were written.
    if (years.length === elections.length)
      elections.forEach((p, i) => (out[p.name] = String(years[i])));
    if (years.length === 0 || years.length === elections.length)
      elections.forEach((p) => read.add(p.name));
  }

  for (const p of of("count")) {
    if (!COUNT_NAMES.has(p.name)) continue;
    read.add(p.name);
    const v =
      p.name === "ns"
        ? assemblyIn(current)
        : p.name === "years"
          ? yearsWindowIn(current)
          : p.name === "n"
            ? (electionCountIn(current) ??
              (params.some((x) => x.name === "years") ||
              yearsWindowIn(current) !== undefined
                ? undefined
                : countIn(current)))
            : countIn(current);
    if (v !== undefined) out[p.name] = v;
  }

  const party = detectParty(lower) ?? detectParty(translitKey(question));
  if (party) for (const p of of("party")) out[p.name] = party;

  const oblastParams = of("oblast");
  if (oblastParams.length) {
    const named = namedIn(current, OBLAST_ENTRIES);
    if (named.length === oblastParams.length)
      oblastParams.forEach((p, i) => (out[p.name] = label(named[i], current)));
    if (named.length <= oblastParams.length)
      oblastParams.forEach((p) => read.add(p.name));
  }

  const placeParams = of("place");
  if (placeParams.length) {
    // A gazetteer that failed to load is „could not look", never „nothing
    // named" — and it must not take the whole completion down with it.
    const gazetteer = await municipalities().catch(() => null);
    if (gazetteer) {
      const named = namedIn(current, gazetteer);
      if (named.length === placeParams.length)
        placeParams.forEach((p, i) => (out[p.name] = label(named[i], current)));
      if (named.length <= placeParams.length)
        placeParams.forEach((p) => read.add(p.name));
    }
  }
  return { args: out, read };
};
