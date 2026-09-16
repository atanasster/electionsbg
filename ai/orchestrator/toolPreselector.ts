import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import type { Domain, ToolDef } from "../tools/types";
import { stemPrefix, translitKey } from "../tools/translit";
import { retrieveTools } from "../llm/retrieve";
import {
  domainScopeRanked,
  scopeTokens,
  type ScopeSignals,
} from "./domainScope";
import { typoMatches } from "./typoMatch";

// Candidate pre-selection for the cloud routing prompt (plan C2).
//
// WHY: the routing prompt serializes all 235 tool declarations and measures
// 85,121 BG / 56,632 EN bytes. The proxy caps a request at 96,000 bytes, and
// breaching it is SILENT — openrouter.ts catches the 413, falls back to the
// keyword router, and still narrates with the model, so the answer keeps its "AI"
// label while its routing came from the 76–83%-accurate deterministic engine.
// Measured 2026-09-16: a TYPICAL Bulgarian 6-turn window serializes to ~88.9 KB
// (under the 92,000 budget) while the largest context the system admits reaches
// ~92.2 KB and is therefore OVER it — so this path already runs, and the registry
// grew 7 tools in the preceding 6 days. See `ai/llm/promptBudget.test.ts`, which
// pins both measurements.
//
// THE DESIGN IS A UNION OF WIDENING ARMS, AND THAT IS THE WHOLE POINT. An arm may
// only ever ADD candidates. A domain or retriever that is silent about a tool must
// not be able to remove it, because the failure mode is asymmetric: an extra
// candidate costs prompt bytes that the byte bound prunes, while a missing
// candidate makes its tool UNREACHABLE, and no later stage can recover it.
//
// The arms, strongest evidence first:
//   verbatim — the question IS a registry example (the tool the registry itself
//              declares for that exact wording)
//   typo     — a surface variant of a word the tool vocabulary uses
//   domain   — the domains the question's vocabulary and entities reach
//   lexical  — fuse.js over name + description + examples
//   pin      — a small always-available core
//
// `pruneToBudget` then drops the WEAKEST evidence first, so narrowing can only
// ever cost prompt budget.

export type Arm =
  | "verbatim"
  | "typo"
  | "domain-curated"
  | "domain-derived"
  | "lexical"
  | "pin";

// Higher wins. The gaps matter: everything above `pin` is question-specific
// evidence, so a pin is only ever kept when there is room for it.
const ARM_STRENGTH: Record<Arm, number> = {
  verbatim: 6,
  typo: 5,
  "domain-curated": 4,
  // LEXICAL ABOVE DERIVED-DOMAIN, deliberately. A rank-i fuse hit is returned for
  // THIS question, while a derived-domain candidate is only "in a domain the
  // question's vocabulary touches" — `domainScope` describes its own derived layer
  // as "deliberately unselective" (it unions to ~4.4 of 6 domains). With the older
  // order, 313 of 1,632 corpus calls dropped a lexical-only candidate while
  // keeping derived-only ones.
  lexical: 3,
  "domain-derived": 2,
  pin: 1,
};

/** The strength of one arm. Exported so a test or a caller can order without a stored field. */
export const armStrength = (arm: Arm): number => ARM_STRENGTH[arm];

/** A candidate's strength: its STRONGEST arm. Derived, never stored. */
export const candidateStrength = (c: Candidate): number =>
  Math.max(...c.arms.map(armStrength));

export type Candidate = {
  tool: string;
  // Every arm that nominated this tool, strongest first. Reported so a caller can
  // see WHY a tool is in the set, and so a test can assert an arm only adds.
  arms: Arm[];
  // Position in the lexical retriever's ranking, when it nominated this tool.
  lexicalRank?: number;
  // Position in the domain ranking, when an entity/keyword arm nominated it.
  domainRank?: number;
  // How much the tool's own vocabulary resembles the question, used to order
  // candidates WITHIN one arm's block.
  similarity: number;
};

// The core pins: three cheap tools that answer the commonest broad questions.
export const CORE_PINS = [
  "governanceProfile",
  "macroIndicator",
  "budgetOverview",
];

const norm = (s: string): string =>
  translitKey(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// A tool's example strings, normalized once. A question that IS an example is the
// registry's own declaration of its tool, which is why this arm outranks every
// inferred one.
const exampleIndex: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const t of TOOLS)
    for (const ex of t.examples)
      for (const text of [ex.bg, ex.en]) {
        const key = norm(text);
        if (key && !m.has(key)) m.set(key, t.name);
      }
  return m;
})();

const byDomain: Map<Domain, string[]> = (() => {
  const m = new Map<Domain, string[]>();
  for (const t of TOOLS) m.set(t.domain, [...(m.get(t.domain) ?? []), t.name]);
  return m;
})();

// Each tool's example vocabulary, so a whole-domain nomination can be ordered by
// how much the tool actually looks like the question. Without this the `domain`
// arm contributes its ENTIRE domain as one undifferentiated block (40 tools for
// the catch-all `indicators`, 90 for `fiscal`), which under a byte cap is dropped
// from the wrong end: the block is nominally "strong" evidence while most of it is
// unrelated to the question. The score below is what orders that block.
const tokensOf = (text: string): string[] =>
  scopeTokens(text).filter((t) => t.length >= 4);

// The tool's EXAMPLE vocabulary only — not its description. A description is long
// and generic, so including it made the Dice denominator ~200 tokens and the score
// 0 for 200 of 203 candidates; the ordering it was added for never happened.
const toolVocabulary: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const t of TOOLS) {
    const set = new Set<string>(tokensOf(t.name));
    for (const ex of t.examples)
      for (const tk of tokensOf(`${ex.bg} ${ex.en}`)) set.add(tk);
    // An ARRAY, because this is read once per candidate per call: materialising
    // the Set on every read dominated the pre-selector's cost.
    m.set(t.name, [...set]);
  }
  return m;
})();

// Dice over the question's content tokens and the tool's vocabulary. Cheap,
// deterministic, and only ever used to ORDER candidates — never to include or
// exclude one, so an imperfect score cannot make a tool unreachable.
const lexicalScore = (
  questionTokens: readonly string[],
  tool: string,
): number => {
  if (!questionTokens.length) return 0;
  const list = toolVocabulary.get(tool);
  if (!list) return 0;
  const matched = questionTokens.filter((q) =>
    list.some((v) => v === q || stemPrefix(v, q)),
  );
  return (2 * matched.length) / (questionTokens.length + list.length);
};

export type PreselectOptions = {
  signals?: ScopeSignals;
  // How many tools the lexical arm contributes. Raised for the fiscal overflow,
  // where one domain holds 90 tools.
  lexicalK?: number;
};

/**
 * The candidate set for a question, ordered by strength of evidence. NOT yet
 * pruned to any budget — `pruneToBudget` does that, and a caller that only needs
 * the ranking (a test, or an offline measurement) can use it directly.
 */
export const preselectCandidates = (
  question: string,
  opts: PreselectOptions = {},
): Candidate[] => {
  const questionTokens = tokensOf(question);
  const found = new Map<string, Candidate>();
  // `extra` may carry ONLY the evidence positions: if it could carry `tool`,
  // `arms` or `strength` a later nomination could overwrite an earlier one, and the
  // union property this module's safety rests on would be enforced by nothing but
  // caller discipline.
  const nominate = (
    tool: string,
    arm: Arm,
    extra?: Partial<Pick<Candidate, "lexicalRank" | "domainRank">>,
  ) => {
    if (!TOOLS_BY_NAME[tool]) return;
    const prev = found.get(tool);
    if (!prev) {
      found.set(tool, {
        tool,
        arms: [arm],
        similarity: lexicalScore(questionTokens, tool),
        ...extra,
      });
      return;
    }
    // The union property: an arm may only ADD. Nothing here removes, and the
    // strongest arm is derived from the arm list rather than stored, so there is
    // no field a later nomination could lower.
    if (!prev.arms.includes(arm)) prev.arms.push(arm);
    if (extra?.lexicalRank !== undefined && prev.lexicalRank === undefined)
      prev.lexicalRank = extra.lexicalRank;
    if (extra?.domainRank !== undefined && prev.domainRank === undefined)
      prev.domainRank = extra.domainRank;
  };

  // 1. Verbatim: the question is a registry example.
  const exact = exampleIndex.get(norm(question));
  if (exact) nominate(exact, "verbatim");

  // 2. Typo / alternate surface form.
  for (const hit of typoMatches(question, 3)) nominate(hit.tool, "typo");

  // 3. Domain scope — curated evidence above derived, so the pruning order below
  //    reflects which domain claims are actually supported.
  domainScopeRanked(question, opts.signals).forEach(
    ({ domain, strength }, i) => {
      for (const tool of byDomain.get(domain) ?? [])
        nominate(tool, strength === 2 ? "domain-curated" : "domain-derived", {
          domainRank: i,
        });
    },
  );

  // 4. Lexical retrieval, as an EXTRA arm and never the sole one: measured 49.1%
  //    recall@8 on the model's real input. GATED on content tokens, because
  //    `retrieveToolNames` PADS deterministically from registry order when fuse
  //    finds fewer than k hits — so an empty or punctuation-only question used to
  //    nominate the first 12 registry tools as if they were evidence, at a
  //    strength above `pin`, evicting the three core pins that exist for exactly
  //    that input class.
  if (questionTokens.length)
    retrieveTools(question, opts.lexicalK ?? 12).forEach((t, i) =>
      nominate(t.name, "lexical", { lexicalRank: i }),
    );

  // 5. Core pins.
  for (const tool of CORE_PINS) nominate(tool, "pin");

  return [...found.values()].sort(
    (a, b) =>
      candidateStrength(b) - candidateStrength(a) ||
      // Within a block, order by resemblance to the question FIRST, then by the
      // retriever's own ranking: a domain block is mostly unrelated tools, and a
      // byte cap drops its tail.
      b.similarity - a.similarity ||
      (a.lexicalRank ?? Number.MAX_SAFE_INTEGER) -
        (b.lexicalRank ?? Number.MAX_SAFE_INTEGER) ||
      (a.domainRank ?? Number.MAX_SAFE_INTEGER) -
        (b.domainRank ?? Number.MAX_SAFE_INTEGER) ||
      (a.tool < b.tool ? -1 : 1),
  );
};

export type PruneResult = {
  kept: string[];
  dropped: string[];
  // The strongest arm for a kept tool, for a caller that wants to explain the set.
  arms: Record<string, Arm[]>;
};

/**
 * Drop the WEAKEST evidence until `fits` accepts the set.
 *
 * `fits` is a callback rather than a byte number so the byte bound stays in one
 * place (`promptBudget.ts`) and this module needs no knowledge of the prompt
 * format. Dropping order: pins and derived-domain-only candidates first, then up
 * the strength ladder, and within a strength the lowest-ranked lexical/domain
 * evidence. It never drops the single strongest candidate, so a budget too small
 * for anything still yields a usable one-tool prompt instead of an empty one.
 */
export const pruneToBudget = (
  candidates: readonly Candidate[],
  fits: (tools: readonly string[]) => boolean,
  kMax = Number.MAX_SAFE_INTEGER,
): PruneResult => {
  // K_MAX is a CAP, so it can never be zero: this function's contract is that the
  // prompt is never emptied, and a caller asking for 0 tools is asking for a broken
  // request rather than an empty one.
  const cap = Math.max(1, kMax);
  const keptSet = new Set(candidates.slice(0, cap).map((c) => c.tool));
  // Anything beyond the cap is dropped by rank alone, before any byte reasoning.
  const dropped: string[] = candidates.slice(cap).map((c) => c.tool);
  const armsOf = (tool: string) =>
    candidates.find((c) => c.tool === tool)?.arms ?? [];
  const result = () => ({
    kept: candidates.filter((c) => keptSet.has(c.tool)).map((c) => c.tool),
    dropped,
    arms: Object.fromEntries(
      candidates
        .filter((c) => keptSet.has(c.tool))
        .map((c) => [c.tool, armsOf(c.tool)]),
    ),
  });
  if (fits([...keptSet])) return result();

  // The drop order is the RANKING REVERSED, and that is deliberate rather than
  // incidental: the ranking already sorts weakest-evidence-last, so reversing it is
  // weakest-first AND it makes the kept set a PREFIX of the ranking. That identity is
  // what lets `prunePrefixToBudget` binary-search the same answer instead of
  // rebuilding an 85 KB prompt ~200 times. An earlier form re-sorted with a different
  // comparator, so the two pruners could disagree — which they did, on the first test
  // that compared them.
  //
  // `dropped` records only an ACTUAL removal: an over-cap candidate is already
  // reported above, and pushing it again made `dropped` a multiset with up to 198
  // duplicate entries for a 203-candidate question.
  const order = [...candidates].reverse();
  for (const candidate of order) {
    if (keptSet.size < cap && fits([...keptSet])) break;
    if (keptSet.size <= 1) break; // never empty the prompt
    if (!keptSet.delete(candidate.tool)) continue;
    dropped.push(candidate.tool);
  }
  return result();
};

/**
 * The same result as `pruneToBudget`, by BINARY SEARCH over the prefix length.
 *
 * Valid because dropping weakest-first is exactly truncating the ranking's tail: the
 * kept set for any count is a prefix of `candidates`. That matters at the call site,
 * where `fits` rebuilds an 85 KB prompt — the linear form would rebuild it ~200
 * times (seconds of latency on the routing path) where this needs ~8.
 *
 * `fits` MUST be monotone in the prefix length (a longer prefix never fits when a
 * shorter one did not), which is true of the byte bound it exists for. The unit test
 * asserts this agrees with `pruneToBudget` on the same inputs, so the fast path
 * cannot drift from the contract.
 */
export const prunePrefixToBudget = (
  candidates: readonly Candidate[],
  fits: (tools: readonly string[]) => boolean,
  kMax = Number.MAX_SAFE_INTEGER,
): PruneResult => {
  const cap = Math.min(candidates.length, Math.max(1, kMax));
  const names = (n: number) => candidates.slice(0, n).map((c) => c.tool);
  let keep: number;
  if (fits(names(cap))) keep = cap;
  else {
    let lo = 1,
      hi = cap - 1;
    keep = 1; // never empty the prompt, even if a single tool does not fit
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(names(mid))) {
        keep = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
  }
  const kept = candidates.slice(0, keep);
  return {
    kept: kept.map((c) => c.tool),
    dropped: candidates.slice(keep).map((c) => c.tool),
    arms: Object.fromEntries(kept.map((c) => [c.tool, c.arms])),
  };
};

/** The candidate ToolDefs, in ranking order, for a caller building a prompt. */
export const candidateToolDefs = (
  question: string,
  opts: PreselectOptions = {},
): ToolDef[] =>
  preselectCandidates(question, opts)
    .map((c) => TOOLS_BY_NAME[c.tool])
    .filter(Boolean);
