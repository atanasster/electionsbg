import { describe, expect, it } from "vitest";
import {
  CORE_PINS,
  candidateStrength,
  candidateToolDefs,
  preselectCandidates,
  pruneToBudget,
} from "./toolPreselector";
import { STARTER_CASES } from "../llm/currentEval.starters";
import { registryEvalCases } from "../llm/currentEval";
import { CHALLENGES, UNSUPPORTED } from "../llm/currentEval.cases";
import { REALISTIC, CONVERSATIONS } from "../llm/currentEval.realistic";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";

// The FREE harness for candidate pre-selection (plan C2). No model, no network, no
// tool execution.
//
// The property that matters most is the ASYMMETRY of the failure modes: an extra
// candidate costs prompt bytes that the byte cap prunes, while a MISSING candidate
// makes its tool unreachable and nothing downstream can recover it. So the arms are
// unioned and every assertion below is about inclusion, or about the order in which
// candidates are dropped.
//
// MEASURED 2026-09-16 over the corpus (816 cases x 2 languages): the arms nominate
// the gold tool for 1,624 of 1,632 calls; the 8 misses are all `{}`-placeholder
// templates or a conversational follow-up, and they are listed explicitly below so a
// NEW miss on a real question fails loudly. Nomination is not guaranteed — it is
// measured. The arms guarantee REACHABILITY, not selection: they nominate a mean of
// ~170 of 235 tools, so the byte bound is what actually selects.
//
// The cap here is a TOOL COUNT, driven through the same `fits` callback the byte
// bound will use, so the drop algorithm is exercised without depending on the prompt
// builder. Wiring the real byte callback into `selectRoute` is step 7's job; nothing
// outside these tests calls the pre-selector yet.
//
// A pre-selection costs ~84 ms (fuse over 235 tools plus a vocabulary scan per
// nomination), so the corpus-wide assertions below run on a SAMPLE that is
// stratified BY DOMAIN — a plain stride can miss a whole domain, and the domain a
// prices regression lives in is exactly what a diagnostic must not omit.

const CASES = [
  ...STARTER_CASES,
  ...registryEvalCases(),
  ...CHALLENGES,
  ...UNSUPPORTED,
  ...REALISTIC,
  ...CONVERSATIONS,
].filter((c) => c.tool !== null);

describe("the arms only ever add", () => {
  it("includes the tool the registry declares for a verbatim example", () => {
    for (const tool of ["partyResult", "turnout", "localMunicipality"]) {
      const example = TOOLS_BY_NAME[tool].examples[0].bg;
      const picked = preselectCandidates(example);
      expect(picked[0].tool, example).toBe(tool);
      expect(picked[0].arms).toContain("verbatim");
      // Verbatim is the strongest evidence, so it outranks every inferred arm.
      expect(candidateStrength(picked[0])).toBeGreaterThan(5);
    }
  });

  it("includes a typo-corrected tool", () => {
    const picked = preselectCandidates("Каква е инфлацята?");
    expect(picked.some((c) => c.arms.includes("typo"))).toBe(true);
  });

  it("includes the whole domain, not just its best tool", () => {
    // A domain claim is a statement about a RANGE of tools, so the arm must add
    // every tool of the domain — narrowing within it is the byte cap's job, and a
    // domain arm that picked one tool would be a retriever, which is a different
    // (and weaker) thing.
    const picked = preselectCandidates("Кой е кметът на Пловдив?");
    const voted = new Set(picked.map((c) => c.tool));
    expect(voted.size).toBeGreaterThan(50);
    for (const t of ["localMunicipality", "localMayorsWon", "localCouncil"])
      expect(voted.has(t), t).toBe(true);
  });

  it("always includes the core pins", () => {
    const picked = preselectCandidates("Какво е възнаграждението на кмета?");
    for (const pin of CORE_PINS)
      expect(
        picked.map((c) => c.tool),
        pin,
      ).toContain(pin);
  });

  it("records EVERY arm that nominated a tool, so the set is explainable", () => {
    // "Каква е инфлацията?" is a registry example AND a domain hit AND a lexical
    // hit; a tool nominated by several arms must report all of them.
    const top = preselectCandidates("Каква е инфлацията?")[0];
    expect(new Set(top.arms).size).toBeGreaterThan(1);
  });

  it("is deterministic across calls", () => {
    const q = "Кой е кметът на Пловдив?";
    expect(preselectCandidates(q)).toEqual(preselectCandidates(q));
    expect(candidateToolDefs(q).map((t) => t.name)).toEqual(
      preselectCandidates(q).map((c) => c.tool),
    );
  });
});

describe("pruning drops the weakest evidence first", () => {
  const fitsAlways = () => true;
  const fitsNeverButOne = (tools: readonly string[]) => tools.length <= 40;

  it("keeps everything when the budget is not exceeded", () => {
    const candidates = preselectCandidates("Каква е инфлацията?");
    const pruned = pruneToBudget(candidates, fitsAlways);
    expect(pruned.dropped).toEqual([]);
    expect(pruned.kept).toHaveLength(candidates.length);
  });

  it("drops the low-strength arms before the question-specific ones", () => {
    const candidates = preselectCandidates("Каква е инфлацията?");
    const pruned = pruneToBudget(candidates, fitsNeverButOne);
    expect(pruned.kept.length).toBeLessThanOrEqual(40);
    // The strongest evidence survives: a verbatim example hit is never dropped
    // while anything weaker remains.
    expect(pruned.kept).toContain(candidates[0].tool);
    const keptStrength = Math.min(
      ...pruned.kept.map((t) =>
        candidateStrength(candidates.find((c) => c.tool === t)!),
      ),
    );
    const droppedStrength = Math.max(
      ...pruned.dropped.map((t) =>
        candidateStrength(candidates.find((c) => c.tool === t)!),
      ),
    );
    expect(droppedStrength).toBeLessThanOrEqual(keptStrength);
    // Pins go first: they are the only arm with no question-specific evidence.
    for (const pin of CORE_PINS)
      if (!pruned.kept.includes(pin)) expect(pruned.dropped).toContain(pin);
  });

  it("never empties the prompt, even for an impossible budget", () => {
    const candidates = preselectCandidates("Каква е инфлацията?");
    const pruned = pruneToBudget(candidates, () => false);
    expect(pruned.kept).toHaveLength(1);
    expect(pruned.kept[0]).toBe(candidates[0].tool);
  });

  it("honours K_MAX as a cap independent of the byte callback", () => {
    const candidates = preselectCandidates("Каква е инфлацията?");
    const pruned = pruneToBudget(candidates, fitsAlways, 24);
    expect(pruned.kept).toHaveLength(24);
    expect(pruned.dropped.length).toBe(candidates.length - 24);
  });
});

describe("the prune contract", () => {
  const QUESTIONS = [
    "Каква е инфлацията?",
    "Кой е кметът на Пловдив?",
    "Какво е възнаграждението на кмета?",
    "",
  ];
  const CAPS = [1, 5, 24, 40, 235];
  const FITS: [string, (t: readonly string[]) => boolean][] = [
    ["always", () => true],
    ["never", () => false],
    ["<=20", (t) => t.length <= 20],
    ["<=1", (t) => t.length <= 1],
  ];

  it("keeps `kept` and `dropped` a partition with no duplicates", () => {
    // The earlier form pushed every over-cap candidate into `dropped` and then
    // pushed it AGAIN when the drop loop reached it — 346 entries for a
    // 203-candidate question. A caller that renders or logs the dropped set, or
    // asserts `kept.length + dropped.length === candidates.length`, got a wrong
    // answer, and only the finite-`kMax` + strict-`fits` combination showed it.
    for (const q of QUESTIONS)
      for (const kMax of CAPS)
        for (const [label, fits] of FITS) {
          const candidates = preselectCandidates(q);
          const pruned = pruneToBudget(candidates, fits, kMax);
          const all = candidates.map((c) => c.tool);
          const where = `${JSON.stringify(q)} kMax=${kMax} fits=${label}`;
          expect(
            new Set(pruned.dropped).size,
            `duplicate in dropped: ${where}`,
          ).toBe(pruned.dropped.length);
          expect(
            pruned.kept.some((t) => pruned.dropped.includes(t)),
            `a tool is both kept and dropped: ${where}`,
          ).toBe(false);
          // Total: nothing vanishes.
          expect(
            new Set([...pruned.kept, ...pruned.dropped]).size,
            `not a partition: ${where}`,
          ).toBe(all.length);
          expect(pruned.kept.length, `kept is empty: ${where}`).toBeGreaterThan(
            0,
          );
        }
  });

  it("treats K_MAX as a cap that can never empty the prompt", () => {
    // kMax = 0 asked for a broken request rather than an empty one; the contract is
    // that a usable single-tool prompt always survives.
    const candidates = preselectCandidates("Каква е инфлацията?");
    expect(pruneToBudget(candidates, () => true, 0).kept).toHaveLength(1);
    expect(pruneToBudget(candidates, () => true, 1).kept).toHaveLength(1);
  });

  it("gives an evidence-free question exactly the core pins", () => {
    // The regression for the disarmed fallback: `retrieveToolNames` PADS from
    // registry order when fuse finds nothing, so an empty question used to nominate
    // 12 arbitrary tools at a strength ABOVE `pin` and evict all three pins.
    for (const q of ["", "   ", "?! ?!"]) {
      const candidates = preselectCandidates(q);
      expect(candidates.map((c) => c.tool).sort(), q).toEqual(
        [...CORE_PINS].sort(),
      );
      expect(pruneToBudget(candidates, () => true, 1).kept).toHaveLength(1);
    }
  });
});

describe("the gold tool survives a forced cap", () => {
  // A pre-selection costs ~84 ms, so these sample. BOTH populations are built
  // explicitly — a per-domain stride that happened to contain no verbatim-gold row
  // made the "verbatim is total" assertion unreachable, which is the same
  // vacuity-by-construction the split exists to avoid.
  const exampleTool = (() => {
    const m = new Map<string, string>();
    for (const t of TOOLS)
      for (const ex of t.examples)
        for (const text of [ex.bg, ex.en])
          if (!m.has(text)) m.set(text, t.name);
    return m;
  })();
  const PER_DOMAIN = 4;
  const { VERBATIM, OTHER } = (() => {
    const verbatim: typeof CASES = [];
    const other: typeof CASES = [];
    // Counted PER BUCKET, so both populations are filled rather than the first one
    // consuming the domain's whole quota.
    const seen = new Map<string, { v: number; o: number }>();
    for (const c of CASES) {
      const d = TOOLS_BY_NAME[c.tool!].domain;
      const n = seen.get(d) ?? { v: 0, o: 0 };
      const isVerbatim = exampleTool.get(c.bg) === c.tool;
      if (isVerbatim ? n.v >= PER_DOMAIN : n.o >= PER_DOMAIN) continue;
      if (isVerbatim) n.v++;
      else n.o++;
      seen.set(d, n);
      (isVerbatim ? verbatim : other).push(c);
    }
    return { VERBATIM: verbatim, OTHER: other };
  })();

  const retentionAt = (cap: number) => {
    const rate = (rows: typeof CASES) => {
      let kept = 0,
        n = 0;
      for (const c of rows)
        for (const lang of ["en", "bg"] as const) {
          const pruned = pruneToBudget(
            preselectCandidates(c[lang]),
            (t) => t.length <= cap,
          );
          n++;
          if (pruned.kept.includes(c.tool!)) kept++;
        }
      return { rate: kept / (n || 1), n };
    };
    return { verbatim: rate(VERBATIM), other: rate(OTHER) };
  };

  it("is total for a verbatim example and high for everything else, at the cap the budget forces", () => {
    // Cap 150 is roughly what today's byte bound prunes to: the largest BG request
    // measures ~92.2 KB against a 92,000 budget. Measured 2026-09-16 on a
    // domain-stratified sample: verbatim 100%, non-verbatim ~95%.
    const { verbatim, other } = retentionAt(150);
    expect(verbatim.n).toBeGreaterThan(0);
    expect(other.n).toBeGreaterThan(0);
    // Split by POPULATION: folding them together is near-vacuous, because most of
    // the corpus IS a verbatim example retained by construction.
    expect(verbatim.rate, "verbatim retention").toBe(1);
    expect(other.rate, "non-verbatim retention").toBeGreaterThan(0.7);
  });

  it("degrades honestly at a cap far tighter than the budget ever forces", () => {
    // A 40-tool cap is ~14 KB, several times tighter than anything today's budget
    // needs. This is the pre-selector's HEADROOM, not a prediction.
    const { other } = retentionAt(40);
    expect(other.rate).toBeGreaterThan(0.2);
    expect(other.rate).toBeLessThan(0.95);
  });

  it("keeps a verbatim example at any cap", () => {
    for (const tool of ["partyResult", "turnout", "localMunicipality"]) {
      const example = TOOLS_BY_NAME[tool].examples[0].bg;
      const pruned = pruneToBudget(preselectCandidates(example), () => false);
      expect(pruned.kept).toEqual([tool]);
    }
  });
});

describe("nomination is measured, not guaranteed", () => {
  it("names every call where NO arm nominates the gold tool", () => {
    // Eight of 1,632 calls have no arm for the gold tool, so no budget can recover
    // it — the one thing the union design cannot compensate for. All eight are
    // `{}`-placeholder templates or a conversational follow-up, and they are listed
    // so a NEW miss on a real question fails loudly instead of reading as "pruned".
    //
    // `starter:procurement-query-upheld` ("Процент уважени жалби по ЗОП през 2026")
    // was a real question among them; it is nomination-reachable now that the fiscal
    // anchors carry жалб/обжалв/зоп.
    //
    // Run over the template rows (where the known misses live) plus a per-domain
    // sample, rather than all 1,632 calls, which would cost ~2 minutes.
    const ALLOWED = new Set([
      "rollcallQuestion",
      "rollcallQuery",
      "contractSearch",
    ]);
    const TEMPLATES = CASES.filter((c) => /\{[a-zA-Z]+\}/.test(c.bg));
    const SAMPLE = [...TEMPLATES, ...CASES.filter((_, i) => i % 25 === 0)];
    const never = new Set<string>();
    for (const c of SAMPLE)
      for (const lang of ["en", "bg"] as const)
        if (!preselectCandidates(c[lang]).some((x) => x.tool === c.tool))
          never.add(c.tool!);
    const unexpected = [...never].filter((t) => !ALLOWED.has(t)).sort();
    expect(
      unexpected,
      `${never.size} tools unreachable by every arm; ${unexpected.length} are not known templates`,
    ).toEqual([]);
    // Not vacuous: the sample really does contain misses.
    expect(never.size).toBeGreaterThan(0);
  });
});
