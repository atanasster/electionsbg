import { describe, expect, it } from "vitest";
import {
  DOMAIN_OF_TOOL,
  KNOWN_PRECEDENCE_GAPS,
  PRECEDENCE_RULES,
  RULES_BY_DOMAIN,
} from "./precedence";
import { route } from "../router";
import { TOOLS } from "../../tools/registry";
import type { Lang } from "../../tools/types";

// The CONFLICT TEST for the routing cascade's precedence contract (plan C9).
//
// For every documented overlap, the question that exercises it must reach the declared
// WINNER. Reordering the cascade then fails here with the reason attached, instead of
// silently changing which tool answers a question that has two plausible branches.

const ctxFor = (lang: Lang) => ({ lang, election: "2026_04_19" });

const probeLang = (q: string): Lang => (/[А-Яа-я]/.test(q) ? "bg" : "en");

describe("every documented overlap reaches its declared winner", () => {
  for (const rule of PRECEDENCE_RULES)
    for (const probe of rule.probes)
      it(`${JSON.stringify(probe)} → ${rule.winner} (not ${rule.over})`, () => {
        const got = route(probe, ctxFor(probeLang(probe)))?.tool ?? null;
        expect(
          got,
          `${probe}: expected ${rule.winner} over ${rule.over} — ${rule.because}`,
        ).toBe(rule.winner);
        // The loser is a REAL tool, so the pair is a genuine conflict and not a
        // typo'd name that could never have matched.
        expect(TOOLS.some((t) => t.name === rule.over)).toBe(true);
      });
});

describe("the contract is well formed", () => {
  it("names only real tools, and never a rule against itself", () => {
    for (const rule of PRECEDENCE_RULES) {
      expect(
        TOOLS.some((t) => t.name === rule.winner),
        rule.winner,
      ).toBe(true);
      expect(rule.winner).not.toBe(rule.over);
      expect(rule.probes.length).toBeGreaterThan(0);
      expect(rule.because.length).toBeGreaterThan(10);
    }
  });

  it("documents each overlap ONCE", () => {
    const pairs = PRECEDENCE_RULES.map((r) => `${r.winner}>${r.over}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("attributes every rule to a registered domain", () => {
    // A rule whose winner has no domain would be invisible to a domain-based split,
    // which is the whole point of grouping them.
    for (const rule of PRECEDENCE_RULES)
      expect(DOMAIN_OF_TOOL[rule.winner], rule.winner).toBeDefined();
    const grouped = Object.values(RULES_BY_DOMAIN()).flat();
    expect(grouped).toHaveLength(PRECEDENCE_RULES.length);
  });

  it("covers more than one domain, so the contract is not one module's private note", () => {
    expect(Object.keys(RULES_BY_DOMAIN()).length).toBeGreaterThan(2);
  });
});

describe("the documented gaps stay visible", () => {
  for (const gap of KNOWN_PRECEDENCE_GAPS)
    it(`${JSON.stringify(gap.question)} is still unreachable (${gap.intended})`, () => {
      const got = route(gap.question, ctxFor(gap.lang))?.tool ?? null;
      // If this starts passing, the gap is FIXED: delete the entry rather than
      // loosening the assertion.
      expect(
        got,
        `${gap.question} now reaches ${got} — remove this known gap (${gap.note})`,
      ).toBe(gap.observed);
    });
});
