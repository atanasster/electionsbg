import { TOOLS } from "../tools/registry";
import { STARTERS } from "../app/starters";
import { stemPrefix, translitKey } from "../tools/translit";

// Typo and alternate-word tolerance for a question the deterministic router
// DECLINED (plan C5).
//
// It answers a different question from the rest of the pipeline. `route()` is a
// cascade of keyword rules: when the user's wording is not one it knows, it returns
// null and the chat dead-ends into `clarify()`'s one static sentence. This module
// recognises the SAME intent through surface variation — a misspelling, a
// diminutive, an inflection, a Latin transliteration, a synonym.
//
// Three properties are deliberate:
//
// 1. It is a LAST RESORT, never a competitor. It is only meaningful for a question
//    `route()` already declined; a confident keyword match keeps precedence, so the
//    fix cannot regress a question that already works. Wiring that precedence lives
//    in the caller (see near-miss clarification), and the regression test here
//    pins the property the caller depends on: on every corpus question the router
//    answers today, this matcher either agrees with it or stays silent.
//
// 2. It is SURFACE variation only. It does not raise retrieval quality on novel
//    phrasing — the plan's explicit non-objective. A question whose vocabulary
//    shares no token with any example is out of scope here.
//
// 3. It is deterministic and offline: no model, no network, no committed artifact.
//
// WHERE THIS NARROWS PLAN C5, all three measured rather than assumed:
//   (a) The edit bound applies ONLY to a key of the curated ALTERNATES table, not
//       to any out-of-vocabulary token. "Correct anything within N edits" was
//       built and rejected: it offered wrong-only suggestions on 27 of the 1444
//       corpus questions the router already answers, because ordinary Bulgarian
//       words absent from the example corpus look exactly like typos.
//   (b) The effective tolerance is ONE edit, not C5's "≤1 for short, ≤2 for long".
//       The length-dependent 2-edit branch was built and rejected for the same
//       reason: at 2 edits a 9-character Bulgarian word reaches unrelated words.
//   (c) The vocabulary is registry examples ∪ starter bank. C5 also names "topic
//       keywords"; `ai/app/toolTopics.json` was measured inadequate by the plan
//       (35 of 90 fiscal tools covered, 4 double-assigned) and is not consulted.
//   (d) NFC normalization now lives in the shared `translitKey`, so it applies here
//       and to every other romanized comparison in the pipeline.

// One edit, always. See note (b) above.
const MAX_EDITS = 1;

// Optimal-string-alignment (restricted Damerau-Levenshtein): adjacent
// transposition counts as one edit, which is the commonest real typo
// ("лекрства" → "лекарства" is a transposition plus one substitution).
const editDistance = (a: string, b: string, max: number): number => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    // Every remaining row can only grow, so a row whose minimum already exceeds
    // the bound cannot come back under it.
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
};

const MIN_TOKEN = 4;

// Question words and other generic tokens. They appear in hundreds of examples, so
// a match on one is no evidence at all — before these were excluded, "Колко НПО има
// в България?" matched armsExports at full coverage on "колко"/"има"/"българия".
const STOPWORDS = new Set(
  [
    "колко",
    "какво",
    "каква",
    "какъв",
    "какви",
    "как",
    "кога",
    "къде",
    "кой",
    "кои",
    "коя",
    "защо",
    "има",
    "дали",
    "моля",
    "покажи",
    "покажете",
    "ми",
    "ме",
    "на",
    "за",
    "от",
    "до",
    "през",
    "със",
    "съм",
    "the",
    "and",
    "for",
    "with",
    "from",
    "how",
    "what",
    "which",
    "when",
    "where",
    "who",
    "why",
    "many",
    "much",
    "show",
    "give",
    "list",
    "tell",
    "about",
    "are",
    "was",
    "were",
    "does",
    "did",
    "have",
    "has",
    "there",
    "their",
    "its",
    "his",
    "her",
    "that",
    "this",
    "these",
    "those",
    "than",
    "then",
    "into",
    "over",
    "under",
    "per",
    "all",
    "any",
    "some",
    "more",
    "most",
    "least",
    "last",
    "latest",
    "each",
    "between",
    "during",
    "after",
  ].map(translitKey),
);

export const typoTokens = (text: string): string[] =>
  translitKey(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TOKEN && !STOPWORDS.has(t));

export type ToolVocabulary = {
  // Every example question (registry + starter bank) that declares a tool, with
  // its romanized token set. Built once at module load.
  entries: { tool: string; tokens: string[] }[];
  // IDF weight per token, and the weight of a token absent from the corpus.
  weight: Map<string, number>;
  defaultWeight: number;
};

// Inverse document frequency, over TOOLS: a token appearing in one tool's
// vocabulary is strong evidence; one appearing in fifty is nearly worthless. This
// is what stops "резултати" (results) from matching every results-ish tool equally
// and lets "инфлацята" carry the whole decision.
const idf = (toolCount: number, total: number): number =>
  Math.log(1 + total / (1 + toolCount));

const buildVocabulary = (): ToolVocabulary => {
  const entries: ToolVocabulary["entries"] = [];
  for (const tool of TOOLS)
    for (const ex of tool.examples)
      for (const text of [ex.bg, ex.en]) {
        const tokens = typoTokens(text);
        if (tokens.length) entries.push({ tool: tool.name, tokens });
      }
  for (const s of STARTERS)
    for (const text of [s.bg, s.en]) {
      const tokens = typoTokens(text.replace(/\{[a-zA-Z]+\}/g, " "));
      if (tokens.length) entries.push({ tool: s.tool, tokens });
    }
  // Document frequency per tool, so a query token's weight reflects how
  // discriminative it is.
  const toolsByName = new Map<string, Set<string>>();
  for (const e of entries) {
    const set = toolsByName.get(e.tool) ?? new Set<string>();
    for (const t of e.tokens) set.add(t);
    toolsByName.set(e.tool, set);
  }
  const df = new Map<string, number>();
  for (const tokens of toolsByName.values())
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const total = toolsByName.size || 1;
  const weight = new Map<string, number>();
  for (const [t, n] of df) weight.set(t, idf(n, total));
  return { entries, weight, defaultWeight: idf(total, total) };
};

const vocabulary = buildVocabulary();

export type TypoHit = {
  tool: string;
  score: number;
  corrections: { from: string; to: string }[];
};

// ALTERNATE SURFACE FORMS: the word a user writes, mapped to the word this corpus
// uses for it. A generalization from "alternates" to "anything within N edits"
// was measured and REJECTED — see the note below.
//
// Each entry is a measured pair, not a guess: the left side is what the question
// said, the right side what the registry's examples say. Romanized, because both
// sides compare in one space.
const ALTERNATES: Record<string, string[]> = {
  // Misspellings (transposition / substitution).
  inflatsyata: ["inflatsiya"],
  lekrstva: ["lekarstva"],
  aktivnos: ["aktivnost"],
  bezrabotnosta: ["bezrabotitsa"],
  // Diminutives and colloquialisms.
  koshnichka: ["koshnitsa"],
  medikament: ["lekarstva"],
  // A different word for the same thing.
  uchenitsi: ["uchilishte"],
};

// Keys and targets are curated against measurement, not guessed:
//  - An entry whose LEFT side is already corpus vocabulary is dead (`заплатата`,
//    `активността`, `безработността` were all removed for this reason): the `known`
//    guard below short-circuits before the table is consulted.
//  - An entry whose RIGHT side reaches no tool is dead too (`izbiratelna`).
//  - The pay synonyms (`заплата`/`възнаграждение`) were removed outright: the only
//    token they reached was `zaplatata` in noiPensionSeries, a PENSION-versus-wage
//    tool, so a question about a mayor's remuneration came back as a pension
//    series. There is no tool in this registry that answers mayoral pay, so the
//    honest behaviour is to correct nothing.
//  - `ценичка` was removed because `tsena`/`tseni` prefix-match tokens in a dozen
//    tools (gas, electricity, medicines), which is not a near miss.
//  - `лек` was removed for the same reason at the other end of the scale: a
//    three-character key is reachable through the one-edit fallback from the
//    ordinary inflections `лека`/`леки` ("light/easy"), so a question about how
//    light a procedure is fired all four drug tools.
//
// A general "correct anything within N edits" rule was tried and REJECTED on
// measurement: on the 1444 corpus questions the deterministic router already
// answers correctly it produced wrong-only suggestions for 27 of them (it
// "corrected" ordinary Bulgarian words the corpus does not happen to use, e.g.
// reading a budget question as machineVoteSeries). A matcher that competes with a
// rule that already works is worse than no matcher, so the edit bound is applied
// ONLY to an ALTERNATES key. Within that table a one-edit tolerance absorbs a
// further typo in the variant itself (a one-deletion "инфлцята" → "inflatsyata").

const known = new Set<string>();
for (const e of vocabulary.entries) for (const t of e.tokens) known.add(t);

const alternateIndex = new Map<string, string[]>(
  Object.entries(ALTERNATES).map(([k, v]) => [
    translitKey(k),
    v.map(translitKey),
  ]),
);

// A token that is already corpus vocabulary needs no correction.
const correctedTo = (token: string): string[] | undefined => {
  if (known.has(token)) return undefined;
  const exact = alternateIndex.get(token);
  if (exact) return exact;
  // One edit of tolerance, but only ONTO a curated key: a word that is one edit
  // from a known variant. `editDistance` is called once, with the bound it is
  // tested against — an earlier version computed the distance twice under two
  // different bounds, so the length-dependent branch could never take effect.
  // The KEY must clear the same length floor the query token does, or a short key
  // reaches ordinary short words: a 3-character key matched `лека`/`леки` and
  // corrected them to a drug name.
  for (const [key, targets] of alternateIndex)
    if (
      key.length >= MIN_TOKEN &&
      editDistance(key, token, MAX_EDITS) <= MAX_EDITS
    )
      return targets;
  return undefined;
};

/**
 * Tools a question plausibly means when it contains a surface variant of a word
 * the corpus uses — a misspelling, a diminutive, an inflection, a synonym.
 *
 * RANKING is Dice similarity over the corrected token sets, with the IDF weight of
 * the corrected words as a TIE-BREAK only. Two weaker rankings were measured and
 * rejected: coverage-of-question tied every tool whose examples mention the
 * corrected word at 1.00 and fell through to an ALPHABETICAL tie-break (a wrong
 * top-1 on four of the module's own variants, with the plan's named `nzokDrugs` at
 * rank 4 — past the 3-option chooser cap), and Jaccard over-penalised the entries
 * sharing the MOST of the query, so a long example matching both query tokens lost
 * to a short one matching a single token.
 *
 * An empty result means no evidence: the caller keeps its existing behaviour
 * (the clarification), it does not guess.
 */
export const typoMatches = (question: string, limit = 3): TypoHit[] => {
  const tokens = typoTokens(question);
  if (!tokens.length) return [];
  const corrections: { from: string; to: string }[] = [];
  for (const token of tokens) {
    const targets = correctedTo(token);
    // The target is matched against an example's tokens by stem prefix, so it may
    // legitimately be a stem the examples only carry inflected ("кошница" against
    // "кошницата").
    if (targets)
      for (const to of targets) corrections.push({ from: token, to });
  }
  if (!corrections.length) return [];
  // The corrected question: each token replaced by what it was corrected to.
  const fixOf = new Map(corrections.map((c) => [c.from, c.to]));
  const qSet = new Set(tokens.map((t) => fixOf.get(t) ?? t));
  const weightOf = (t: string) =>
    vocabulary.weight.get(t) ?? vocabulary.defaultWeight;
  const byTool = new Map<
    string,
    TypoHit & { evidence: number; similarity: number }
  >();
  for (const entry of vocabulary.entries) {
    const eSet = new Set(entry.tokens);
    const matched = [...qSet].filter((q) =>
      [...eSet].some((e) => e === q || stemPrefix(e, q)),
    );
    if (!matched.length) continue;
    // Dice over the CORRECTED token sets. Two weaker scores were measured and
    // rejected: coverage-of-question alone tied every tool whose example merely
    // mentions the corrected word at 1.00 and fell through to an alphabetical
    // tie-break (wrong top-1 on four of this module's own variants), and Jaccard
    // then OVER-penalised the entries that share the MOST of the query — a long
    // example matching both query tokens lost to a short one matching one. Dice
    // rewards the shared tokens without charging for the example's length.
    const similarity = (2 * matched.length) / (qSet.size + eSet.size);
    const mine = corrections.filter((c) =>
      entry.tokens.some((t) => t === c.to || stemPrefix(t, c.to)),
    );
    // A tool must be here BECAUSE of a correction. Without this gate a tool whose
    // example happens to contain the raw (misspelled) token is recorded with an
    // empty correction list — a hit with no surface variation behind it, which is
    // exactly the "fires where it should stay silent" failure the caller's
    // precedence depends on.
    if (!mine.length) continue;
    // Rarity of the corrected words, used only to order near-ties: a correction
    // that a dozen tools could also claim is weaker evidence than a rare one.
    const evidence = [...new Set(mine.map((c) => c.to))].reduce(
      (n, t) => n + weightOf(t),
      0,
    );
    const prev = byTool.get(entry.tool);
    // Highest similarity wins, with evidence as a TIE-BREAK only — an earlier form
    // let a lower similarity overwrite a higher one when its evidence was larger,
    // which contradicted the comment and made `score` stop being the maximum.
    if (
      !prev ||
      similarity > prev.similarity ||
      (similarity === prev.similarity && evidence > prev.evidence)
    )
      byTool.set(entry.tool, {
        tool: entry.tool,
        score: similarity,
        corrections: mine,
        evidence,
        similarity,
      });
  }
  return [...byTool.values()]
    .sort(
      (a, b) =>
        b.similarity - a.similarity ||
        b.evidence - a.evidence ||
        (a.tool < b.tool ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ tool, score, corrections: c }) => ({
      tool,
      score,
      corrections: c,
    }));
};

/** The single best match, or null when the question carries no evidence. */

/** The single best match, or null when the question carries no evidence. */
export const typoMatch = (question: string): TypoHit | null =>
  typoMatches(question, 1)[0] ?? null;
