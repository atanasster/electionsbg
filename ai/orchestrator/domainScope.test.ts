import { describe, expect, it } from "vitest";
import {
  ALL_DOMAINS,
  ANCHORS,
  curatedDomains,
  derivedDomains,
  domainScope,
  domainScopeRanked,
  scopeTokens,
  toolsInDomains,
} from "./domainScope";
import { CHALLENGES, UNSUPPORTED } from "../llm/currentEval.cases";
import { REALISTIC, CONVERSATIONS } from "../llm/currentEval.realistic";
import { STARTER_CASES } from "../llm/currentEval.starters";
import { registryEvalCases } from "../llm/currentEval";
import { TOOLS_BY_NAME } from "../tools/registry";
import type { Domain } from "../tools/types";

// The FREE harness for the domain-scope widening arm (plan phase 0.2). No model,
// no network, no tool execution: it scores whether the arm makes the GOLD tool
// reachable, and it pins the boundary traps that a naive substring match would
// capture.
//
// It reports TWO layers, because they trade off against each other:
//   curated — precise, trap-checked, ~57% reachable (measured en 0.565 / bg 0.582)
//   union   — ~98% reachable (measured en 0.983 / bg 0.995), unselective
//             (3.18 of 6 domains on average for en, 4.16 for bg)
// Both are pinned per language so a change to either layer is deliberate.

const CASES = [
  ...STARTER_CASES,
  ...registryEvalCases(),
  ...CHALLENGES,
  ...UNSUPPORTED,
  ...REALISTIC,
  ...CONVERSATIONS,
].filter((c) => c.tool !== null);

// Template starters carry literal `{municipality}` / `{topic}` placeholders. They
// are SUBSTITUTED, as the UI does, rather than dropped: dropping them would remove
// exactly the rows that miss (rollcall templates), which is how an exclusion
// quietly reports success.
const render = (s: string) => s.replace(/\{[a-zA-Z]+\}/g, "Пловдив");

const goldDomain = (id: string, tool: string): Domain => {
  const t = TOOLS_BY_NAME[tool];
  // A stale tool name in any eval corpus is registry drift, and should say so
  // rather than throwing an undefined dereference.
  if (!t) throw new Error(`eval case ${id} names unknown tool "${tool}"`);
  return t.domain;
};

type Row = {
  id: string;
  lang: "en" | "bg";
  tool: string;
  scope: Domain[];
  reachable: boolean;
  isStarter: boolean;
};
const rows: Row[] = CASES.flatMap((c) =>
  (["en", "bg"] as const).map((lang) => {
    const tool = c.tool!;
    const scope = domainScope(render(c[lang]));
    return {
      id: c.id,
      lang,
      tool,
      scope,
      reachable: scope.includes(goldDomain(c.id, tool)),
      isStarter: c.group === "starter",
    };
  }),
);
const rate = (xs: Row[]) => {
  if (!xs.length) throw new Error("rate() called with no rows");
  return xs.filter((r) => r.reachable).length / xs.length;
};
const scopeOf = (id: string, lang: "en" | "bg") =>
  curatedDomains(render(CASES.find((c) => c.id === id)![lang]));

// The benign classes a widened-scope miss can fall into. Kept as one predicate so
// the pin below and the starter assertion cannot drift apart.
//
//  - DETERMINISTIC_TOOLS: `ai/llm/openrouter.ts:220-236` returns the deterministic
//    route for these seven BEFORE calling the model, so the domain scope is never
//    consulted for their questions and a miss costs nothing.
//  - BARE_FOLLOW_UP: an utterance whose subject is in the previous turn ("And for
//    2023?", "Only show two this time.") — the documented empty-scope contract.
//  - NO_DOMAIN_WORD: "How much do the F-16s cost?" names a weapons purchase and
//    nothing else; the designator tokenizes to "f" + "16s".
const DETERMINISTIC_TOOLS = new Set([
  "rollcallQuery",
  "rollcallQuestion",
  "fundingQuery",
  "fundingQuestion",
  "procurementQuery",
  "procurementQuestion",
  "compareElections",
]);
const BARE_FOLLOW_UP = new Set(["conversation:5", "conversation:7"]);
const NO_DOMAIN_WORD = new Set(["defenseProgram:1", "starter:defenseProgram"]);
const benignMiss = (id: string, tool: string): boolean =>
  DETERMINISTIC_TOOLS.has(tool) ||
  BARE_FOLLOW_UP.has(id) ||
  NO_DOMAIN_WORD.has(id);

describe("anchor hygiene", () => {
  it("declares no anchor a tokenizer can never produce", () => {
    // A stem containing whitespace can NEVER match: scopeTokens splits on
    // [^\p{L}\p{N}]+, so no token contains a space. Three such stems were dead code
    // before this assertion existed. A multi-word anchor must be a `phrase`.
    for (const d of ALL_DOMAINS)
      for (const a of ANCHORS[d])
        if ("stem" in a) {
          expect(
            scopeTokens(a.stem),
            `stem ${a.stem} is not a single token`,
          ).toHaveLength(1);
          expect(a.stem).not.toMatch(/\s/);
        } else {
          expect(a.phrase.length).toBeGreaterThan(1);
        }
  });

  it("has no duplicate anchor per domain, and every anchor FIRES", () => {
    for (const d of ALL_DOMAINS) {
      const keys = ANCHORS[d].map((a) =>
        "stem" in a ? a.stem : a.phrase.join(" "),
      );
      expect(new Set(keys).size, `${d} has a duplicate anchor`).toBe(
        keys.length,
      );
      // Reachability is the check that catches a dead anchor: feed the anchor its
      // own text and require the domain to appear.
      for (const a of ANCHORS[d]) {
        const probe = "stem" in a ? a.stem : a.phrase.join(" ");
        expect(
          curatedDomains(probe),
          `${d} anchor ${JSON.stringify(probe)} never fires`,
        ).toContain(d);
      }
    }
  });
});

describe("domain scope makes every gold tool reachable", () => {
  it("covers every registered domain, including the catch-all `indicators`", () => {
    expect(ALL_DOMAINS).toEqual([
      "elections",
      "fiscal",
      "indicators",
      "local",
      "people",
      "place",
    ]);
    for (const d of ALL_DOMAINS)
      expect(
        rows.some((r) => r.scope.includes(d)),
        `no question in the corpus reaches domain ${d}`,
      ).toBe(true);
  });

  it("pins the exact unreachable set per language, with a floor", () => {
    // An id-level pin, not a rate tolerance: one row of 816 is 0.0012, so
    // `toBeCloseTo(rate, 3)` would be an exact pin that breaks on any corpus
    // growth. The miss SET is what must stay put; the rate is a floor.
    //
    // Every entry falls into one of the benign classes defined above, and that is
    // asserted per row so the pin cannot grow to cover a real regression.
    const MISSES: Record<"en" | "bg", string[]> = {
      en: [
        "conversation:5",
        "conversation:7",
        "defenseProgram:1",
        "starter:defenseProgram",
        "starter:rollcall-query-S03",
        "starter:rollcall-query-S06",
        "starter:rollcall-query-S14",
        "starter:rollcall-query-S15",
        "starter:rollcall-query-S17",
        "starter:rollcall-query-S18",
        "starter:rollcall-query-S19",
        "starter:rollcall-query-S23",
        "starter:rollcall-query-S26",
        "starter:rollcall-query-S27",
      ],
      bg: [
        "conversation:5",
        "starter:rollcall-query-S11",
        "starter:rollcall-query-S27",
      ],
    };
    for (const lang of ["en", "bg"] as const) {
      const l = rows.filter((r) => r.lang === lang);
      const misses = l.filter((r) => !r.reachable);
      expect(
        misses.map((r) => r.id).sort(),
        `${lang} unreachable gold domains`,
      ).toEqual(MISSES[lang]);
      // ...and each miss is one of the benign classes, so the pin cannot grow
      // silently to cover a real regression.
      for (const m of misses)
        expect(
          benignMiss(m.id, m.tool),
          `${m.id} (${m.tool}) is not a benign miss`,
        ).toBe(true);
      expect(rate(l), `${lang} reachability floor`).toBeGreaterThanOrEqual(
        lang === "en" ? 0.98 : 0.99,
      );
      // `starter:procurement-query-upheld` ("Процент уважени жалби по ЗОП през
      // 2026") was the one REAL question no arm reached, before the fiscal anchors
      // gained жалб/обжалв/зоп: `procurementQuery` is now nominated for it. The
      // remaining BG misses are all template or follow-up rows.
    }
  });

  it("scores the starter bank with placeholders substituted, not excluded", () => {
    // The starter bank is what the chips send. Substituting the placeholders keeps
    // the rollcall templates IN the denominator, where they visibly miss, instead
    // of removing them and reporting success.
    const starters = rows.filter((r) => r.isStarter);
    expect(starters.length).toBeGreaterThan(600);
    const missed = starters.filter((r) => !r.reachable);
    const nonBenign = missed.filter((r) => !benignMiss(r.id, r.tool));
    expect(
      nonBenign.map((r) => `${r.id}:${r.lang}`),
      "starter rows missed for a reason outside the pinned benign classes",
    ).toEqual([]);
  });

  it("keeps the union unselective on purpose, and the curated layer selective", () => {
    // The union's job is reachability, so it over-includes. Bounds are two-sided
    // and tight around the measurement (measured en 3.179 / bg 4.162), so a drift
    // in either direction is caught rather than admitted by a wide band.
    for (const lang of ["en", "bg"] as const) {
      const l = rows.filter((r) => r.lang === lang);
      const avgUnion = l.reduce((n, r) => n + r.scope.length, 0) / l.length;
      expect(avgUnion).toBeGreaterThan(lang === "en" ? 3.0 : 4.0);
      expect(avgUnion).toBeLessThan(lang === "en" ? 3.4 : 4.4);
    }
    // The curated layer must stay a real narrowing signal: bounded above AND
    // below, so a collapse to zero cannot pass as "still selective".
    const curatedCounts = CASES.flatMap((c) =>
      (["en", "bg"] as const).map((l) => curatedDomains(render(c[l])).length),
    );
    const avgCurated =
      curatedCounts.reduce((a, b) => a + b, 0) / curatedCounts.length;
    expect(avgCurated).toBeGreaterThan(0.5);
    expect(avgCurated).toBeLessThan(1.2);
  });

  it("ranks curated evidence above derived evidence", () => {
    // The cap in phase 1 prunes the weakest evidence first, so widening can only
    // ever cost budget — never reachability.
    const ranked = domainScopeRanked("Кой е кметът на Пловдив?");
    expect(ranked.find((r) => r.domain === "local")).toEqual({
      domain: "local",
      strength: 2,
    });
    const firstWeak = ranked.findIndex((r) => r.strength === 1);
    if (firstWeak !== -1)
      expect(ranked.slice(firstWeak).every((r) => r.strength === 1)).toBe(true);
    // A question with no curated anchor at all still widens, at strength 1.
    const neutral = "Какво се случва напоследък?";
    expect(curatedDomains(neutral)).toEqual([]);
    const weak = domainScopeRanked(neutral);
    expect(weak.length).toBeGreaterThan(0);
    expect(weak.every((d) => d.strength === 1)).toBe(true);
  });

  it("is deterministic in its ordering", () => {
    const a = domainScopeRanked("Какво се случва напоследък?");
    expect(a).toEqual(domainScopeRanked("Какво се случва напоследък?"));
    // Code-unit ordering, not localeCompare: the six names are ASCII.
    expect(a.map((d) => d.domain)).toEqual([...a.map((d) => d.domain)].sort());
  });
});

describe("the anchors are token-matched, not substring-matched", () => {
  // A trap asserts BOTH sides: the forbidden domain must be absent AND a specific
  // domain must be present. Asserting only the absence lets a trap pass by
  // matching nothing at all, which is how two of the original six were vacuous.
  const traps: [string, Domain, Domain][] = [
    ["Министерският съвет колко похарчи?", "local", "fiscal"],
    ["How much did the Council of Ministers spend?", "local", "fiscal"],
    ["Съветът на министрите колко похарчи?", "local", "fiscal"],
    ["Как се съветва министърът?", "local", "fiscal"],
  ];
  for (const [question, forbidden, expected] of traps)
    it(`reads ${JSON.stringify(question)} as ${expected}, not ${forbidden}`, () => {
      const scope = curatedDomains(question);
      expect(scope).not.toContain(forbidden);
      expect(scope).toContain(expected);
    });

  it("denies exactly the false friends, and keeps the true ones", () => {
    // Each pair is the denied token beside a legitimate inflection of the same
    // stem, so a deny list that swallowed the whole stem would fail here.
    expect(curatedDomains("градоустройството")).toEqual([]);
    expect(curatedDomains("градината")).toEqual([]);
    expect(curatedDomains("градът")).toContain("local");
    expect(curatedDomains("Кметството в Банско")).toContain("local");
    expect(curatedDomains("съветникът")).toContain("local");
  });

  it("reaches anchors through Bulgarian inflection and ъ-romanization", () => {
    // translitKey implements the official ъ → a, so `министър` romanizes to
    // `ministar`. A `minister` stem matched neither it nor `министрите`.
    expect(curatedDomains("Кой е министърът на финансите?")).toContain(
      "fiscal",
    );
    expect(curatedDomains("Кой е министър-председателят?")).toContain("fiscal");
    expect(curatedDomains("Какво реши министерството?")).toContain("fiscal");
    expect(curatedDomains("Какъв е дългът на общината?")).toContain("fiscal");
    expect(curatedDomains("Каква е инфлацията?")).toContain("indicators");
    expect(curatedDomains("Къде е най-скъпата кошница?")).toContain(
      "indicators",
    );
    expect(curatedDomains("Колко гласа взе ГЕРБ?")).toContain("elections");
    expect(curatedDomains("А втория тур?")).toContain("elections");
    // Newly added domain vocabulary the anchors lacked entirely.
    expect(scopeOf("starter:funding-query-S08", "en")).toContain("fiscal");
    expect(scopeOf("starter:procurement-query-decisions", "en")).toContain(
      "fiscal",
    );
    expect(scopeOf("starter:simulateTaxChange", "en")).toContain("fiscal");
    expect(scopeOf("realistic:9", "en")).toContain("indicators");
  });

  it("matches phrase anchors across a contiguous token window", () => {
    // A phrase cannot be a stem: the tokenizer guarantees no token holds a space.
    expect(curatedDomains("Tell me about Plovdiv")).toContain("place");
    expect(curatedDomains("How is public money spent?")).toContain("fiscal");
    expect(curatedDomains("Who is the civil servant?")).toContain("people");
    // ...and the phrase must be CONTIGUOUS, not merely co-present.
    expect(curatedDomains("Tell me something about Plovdiv")).not.toContain(
      "place",
    );
  });

  it("treats a Cyrillic and a romanized spelling as the same token", () => {
    expect(scopeTokens("Кметът на Пловдив")).toEqual(
      scopeTokens("Kmetat na Plovdiv"),
    );
    expect(curatedDomains("Kmetat na Plovdiv")).toContain("local");
  });

  it("unions the entity priors with the keyword anchors", () => {
    // An EKATTE place with no keyword, a bare party, and a bare person name each
    // widen on the SIGNAL alone — the anchors need not be in the text.
    expect(curatedDomains("Банско", { place: true })).toEqual([
      "local",
      "place",
    ]);
    expect(curatedDomains("ГЕРБ", { party: true })).toEqual(["elections"]);
    expect(curatedDomains("Бойко Борисов", { person: true })).toEqual([
      "people",
    ]);
    // A token in no example widens nothing.
    expect(derivedDomains(scopeTokens("зззз"))).toEqual([]);
  });
});

describe("scope totality and tool membership", () => {
  it("is total on empty, whitespace and punctuation-only input", () => {
    // The documented empty contract: no evidence means widen to NOTHING, and the
    // caller falls back to lexical retrieval and the core pins.
    for (const input of ["", "   ", "?!", "   ?!  "]) {
      expect(scopeTokens(input)).toEqual([]);
      expect(domainScope(input)).toEqual([]);
      expect(domainScopeRanked(input)).toEqual([]);
      expect(curatedDomains(input)).toEqual([]);
    }
  });

  it("returns the union of the requested domains, and nothing for []", () => {
    expect(toolsInDomains([])).toEqual([]);
    const both = toolsInDomains(["elections", "place"]);
    expect(
      both.every((t) => t.domain === "elections" || t.domain === "place"),
    ).toBe(true);
    expect(both.length).toBe(
      toolsInDomains(["elections"]).length + toolsInDomains(["place"]).length,
    );
    // The catch-all really is large: this is why `indicators` needed its own
    // trigger rather than relying on lexical retrieval.
    expect(toolsInDomains(["indicators"]).length).toBeGreaterThan(30);
  });
});
