import { translitKey } from "../tools/translit";
import { resolveMacroKey, MACRO_ALIASES } from "../tools/macro";
import { CHAIN_MATCH } from "../tools/chainIdentity";
import { matchParty, type PartyLike } from "../tools/matchParty";
import type { Lang, ToolArgs } from "../tools/types";

// Entity pre-extraction (plan C8 / phase 2).
//
// The routing model already receives the question and a tool catalogue; what it does
// NOT reliably get is the ENTITY the question names — a year, an indicator, a party, a
// place, a retail chain. Two things follow from extracting them first:
//
//  1. the hint can be put in the prompt, so a model that would otherwise have to infer
//     "2023" from prose sees it stated; and
//  2. an argument the model OMITS can be filled from the question, which is the only
//     safe direction to coerce. A WRONG pre-extracted entity is a new failure mode (it
//     biases the model toward valid-syntax-but-wrong arguments), so `fillMissingArgs`
//     never overwrites a value the model supplied — that is the whole of its contract.
//
// Everything here is deterministic and offline. Extraction is deliberately
// conservative: a slot stays empty unless the question clearly carries it, because the
// measured cost of a false positive (a wrong argument) is higher than a false negative
// (an argument the model can still infer).

export type ExtractedEntities = {
  years: number[];
  // A macro indicator name resolved through the tool layer's own alias table, so the
  // hint uses the same vocabulary `macroIndicator` accepts.
  indicators: string[];
  // Party tokens, normalized the way `matchParty` normalizes them.
  parties: string[];
  // Retail chain EIKs, resolved through the prices tool's own matcher.
  chains: string[];
  // True when the question mentions a place-ish token. The full place RESOLUTION is
  // async and data-backed and lives in the place resolver; this is the cheap signal
  // that lets a caller decide whether resolving is worth the round trip.
  mentionsPlace: boolean;
};

const YEAR = /\b(1[89]\d{2}|20\d{2})\b/g;

// Place-mention cues: a settlement prefix ("с.", "гр."), a municipality word, or an
// oblast word. A bare proper noun is NOT a cue — "ГЕРБ" is a party, and treating every
// capitalized word as a place was the kind of false positive this module avoids.
const PLACE_CUE =
  /(?:^|\s)(?:с\.|село|гр\.|град|община|обл\.|област|район|кметство|municipality|village|town|city|oblast|district|region)\s+\p{Lu}/u;

// A preposition followed by a capitalized token is also a place cue — "кметът на
// Пловдив" has no explicit place word — but it is a WEAKER one, because "на ГЕРБ" and
// "в Лидл" look identical. The caller suppresses it when the token is a known party or
// chain, which is why the chain match runs first.
const PLACE_PREPOSITION_CUE =
  /(?:^|\s)(?:в|на|за|от|към|до|около|in|at|for|from|near)\s+(\p{Lu}[\p{L}-]+)/u;

/**
 * The indicator the question names, if any. Uses `resolveMacroKey`, so the answer is a
 * key `macroIndicator` will accept rather than a phrase the caller would have to map.
 */
const indicatorOf = (question: string): string[] => {
  const direct = resolveMacroKey(question);
  if (direct) return [direct];
  // Fall back to scanning for an alias phrase inside the question ("инфлацията" for
  // "инфлация"): `resolveMacroKey` matches the whole string, not a substring.
  const normalized = ` ${translitKey(question).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const found = new Set<string>();
  for (const alias of Object.keys(MACRO_ALIASES)) {
    const key = ` ${translitKey(alias).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    if (key.trim().length >= 4 && normalized.includes(key)) {
      const resolved = resolveMacroKey(alias);
      if (resolved) found.add(resolved);
    }
  }
  return [...found];
};

export type ExtractOptions = {
  // The parties the caller's election actually has, so extraction cannot invent one
  // that is not on the ballot. Omitted, only the mention is recorded.
  parties?: PartyLike[];
};

export const extractEntities = (
  question: string,
  opts: ExtractOptions = {},
): ExtractedEntities => {
  const years = [
    ...new Set([...question.matchAll(YEAR)].map((m) => Number(m[1]))),
  ];
  const parties: string[] = [];
  if (opts.parties?.length) {
    const hit = matchParty(question, opts.parties);
    if (hit)
      parties.push(hit.partyNum !== undefined ? String(hit.partyNum) : "");
  }
  const chains: string[] = [];
  for (const { re } of CHAIN_MATCH) {
    const m = question.match(re);
    if (m) chains.push(m[0]);
  }
  const chainNames = [...new Set(chains)];
  const prepositional = question.match(PLACE_PREPOSITION_CUE)?.[1];
  // The weaker cue is suppressed when the token it found is one we already recognised
  // as a chain, or the party the caller's ballot gave us.
  const cueIsKnownEntity =
    !!prepositional &&
    chainNames.some((c) => translitKey(c) === translitKey(prepositional));
  const partyHit = opts.parties?.length
    ? matchParty(question, opts.parties)
    : null;
  return {
    years,
    indicators: indicatorOf(question),
    parties: parties.filter(Boolean),
    chains: chainNames,
    mentionsPlace:
      PLACE_CUE.test(question) ||
      (!!prepositional && !cueIsKnownEntity && !partyHit),
  };
};

export const hasEntities = (e: ExtractedEntities): boolean =>
  e.years.length > 0 ||
  e.indicators.length > 0 ||
  e.parties.length > 0 ||
  e.chains.length > 0 ||
  e.mentionsPlace;

/**
 * A one-line hint for the routing prompt. Kept to the slots the extractor is
 * confident about: a hint that is wrong is worse than no hint, because the model
 * treats it as given.
 */
export const renderEntityHint = (e: ExtractedEntities, lang: Lang): string => {
  const parts: string[] = [];
  if (e.years.length)
    parts.push(`${lang === "bg" ? "години" : "years"}: ${e.years.join(", ")}`);
  if (e.indicators.length)
    parts.push(
      `${lang === "bg" ? "показател" : "indicator"}: ${e.indicators.join(", ")}`,
    );
  if (e.chains.length)
    parts.push(`${lang === "bg" ? "верига" : "chain"}: ${e.chains.join(", ")}`);
  if (e.mentionsPlace)
    parts.push(lang === "bg" ? "споменато място" : "a place is mentioned");
  if (!parts.length) return "";
  return lang === "bg"
    ? `Разпознати обекти: ${parts.join("; ")}`
    : `Detected entities: ${parts.join("; ")}`;
};

/**
 * Fill an argument the model OMITTED from what the question plainly carries.
 *
 * NEVER overwrites: a value the model supplied is left alone, however odd, because the
 * model has the whole question and this extractor has one slot. The only exception is
 * an EMPTY string, which is an omission wearing a value's clothes.
 */
export const fillMissingArgs = (
  args: ToolArgs,
  e: ExtractedEntities,
): ToolArgs => {
  const out = { ...args };
  const missing = (k: string) => out[k] === undefined || out[k] === "";
  // `election`/`year` are filled ONLY when the question names exactly ONE year.
  // Measured 2026-09-16 against the starter bank's own expected args: an unfiltered
  // "fill from the last year mentioned" has recall 1.00 but precision 0.135, because a
  // question that compares 2015 with 2023 (or names a year inside a longer phrase)
  // produces several candidates and only one is the argument the tool wants. With the
  // single-year rule the fill is unambiguous.
  if (e.years.length === 1 && missing("election") && missing("year"))
    out.election = String(e.years[0]);
  if (e.indicators.length && missing("indicator"))
    out.indicator = e.indicators[0];
  if (e.chains.length && missing("chain")) out.chain = e.chains[0];
  return out;
};
