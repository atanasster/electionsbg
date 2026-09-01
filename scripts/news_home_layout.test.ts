import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface GridRule {
  /** Min-width in CSS pixels the rule applies from; 0 for the base rule. */
  minWidth: number;
  /** Declared tracks, or null when the count is `auto-fit`/`auto-fill`. */
  tracks: string[] | null;
  raw: string;
}

const MIN_WIDTH = /\(\s*min-width:\s*([\d.]+)(px|rem)\s*\)/;

/**
 * Split a stylesheet into its top-level `@media` blocks and everything else.
 * Brace-matched rather than regex-matched, so a rule that is not the first in
 * its block, or a compound query, is still attributed to the right breakpoint.
 */
const mediaBlocks = (css: string) => {
  const blocks: { query: string; body: string }[] = [];
  let base = "";
  let index = 0;
  while (index < css.length) {
    const start = css.indexOf("@media", index);
    if (start === -1) {
      base += css.slice(index);
      break;
    }
    base += css.slice(index, start);
    const open = css.indexOf("{", start);
    if (open === -1) throw new Error("unterminated @media block");
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      else if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push({
      query: css.slice(start + "@media".length, open).trim(),
      body: css.slice(open + 1, cursor - 1),
    });
    index = cursor;
  }
  return { blocks, base };
};

const parseTracks = (value: string): string[] | null => {
  const auto = value.match(/^repeat\(\s*auto-fi[tl]\s*,/);
  if (auto) return null;
  const repeat = value.match(/^repeat\(\s*(\d+)\s*,\s*(.+)\)$/);
  return repeat
    ? Array.from({ length: Number(repeat[1]) }, () => repeat[2].trim())
    : [value];
};

const gridRulesIn = (css: string, minWidth: number): GridRule[] =>
  [...css.matchAll(/\.news-supporting-grid\s*\{([^}]*)\}/g)].flatMap(
    ([, body]) => {
      const declaration = body.match(/grid-template-columns:\s*([^;]+);/);
      if (!declaration) return [];
      const raw = declaration[1].trim();
      return [{ minWidth, tracks: parseTracks(raw), raw }];
    },
  );

/**
 * Every `.news-supporting-grid` rule in `news.css`, paired with the min-width
 * it applies from. A media query carrying such a rule that this cannot parse
 * THROWS rather than defaulting to 0 — filing a `48rem` breakpoint as the base
 * rule would silently turn "never narrows as the viewport widens" into "never
 * narrows in source order", which is a different and much weaker claim.
 */
const supportingGridRules = (css: string): GridRule[] => {
  const { blocks, base } = mediaBlocks(css);
  const rules = gridRulesIn(base, 0);
  for (const block of blocks) {
    if (!block.body.includes(".news-supporting-grid")) continue;
    const match = block.query.match(MIN_WIDTH);
    if (!match)
      throw new Error(
        `unparsed media query "${block.query}" carries a supporting-grid rule — ` +
          "the gate must not silently treat it as the base rule",
      );
    const px = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
    rules.push(...gridRulesIn(block.body, px));
  }
  return rules.sort((a, b) => a.minWidth - b.minWidth);
};

/**
 * A track whose minimum is a DEFINITE length. That is the property the old
 * literal `minmax(0, 1fr)` was standing in for; `auto`, `1fr` on its own
 * (which is `minmax(auto, 1fr)`) and `min-content` are the defect, because a
 * long image credit then sizes the column past the mobile viewport.
 *
 * `repeat(auto-fit, minmax(<len>, 1fr))` is admitted deliberately: v4 §4.3
 * requires auto-fit so a section shorter than its track count consumes the
 * width instead of reserving an empty track, and auto-fit needs a NON-zero
 * minimum to compute a repetition count — so it can never spell itself
 * `minmax(0, 1fr)`.
 */
const LENGTH = String.raw`\d+(?:\.\d+)?(?:px|rem|em|ch)`;
/**
 * A minimum is definite when it is 0, a length, or `min(<len>, 100%)` — the
 * idiom that keeps an auto-fit track from flooring itself above the viewport
 * and overflowing every phone.
 */
const MINIMUM = `(?:0|${LENGTH}|min\\(\\s*${LENGTH}\\s*,\\s*100%\\s*\\))`;
const SAFE_TRACK = new RegExp(
  `^(?:minmax\\(\\s*${MINIMUM}\\s*,\\s*1fr\\s*\\)` +
    `|repeat\\(\\s*auto-fi[tl]\\s*,\\s*minmax\\(\\s*${MINIMUM}\\s*,\\s*1fr\\s*\\)\\s*\\))$`,
);

describe("news home supporting-grid CSS contract", () => {
  // ⚠️ This block deliberately no longer pins a track count per breakpoint.
  // It used to require exactly `repeat(3, …)` at 1024px, which is the layout
  // `docs/plans/news-home-editorial-grid-v4.md` §4.3 replaces — so the gate
  // and the plan contradicted each other and `news:release:gate` would have
  // failed before the rewrite could land.
  //
  // What replaces it are the invariants those literals were standing in for,
  // and they hold on BOTH sides of that change: every track has a definite
  // minimum, the base is one column, the grid widens somewhere, and the count
  // never shrinks as the viewport widens.
  //
  // Runtime geometry — row voids, intra-card slack, section fill — is measured
  // against the rendered page by `tests/news/home-grid.spec.ts`. ⚠️ Most of
  // those checks are `test.fail()` today: they assert the layout is BROKEN,
  // and become enforced bounds only when Phase 1 removes the annotations. So
  // this file is currently the only *positive* gate on the grid's shape.
  const css = fs.readFileSync(path.resolve("newsapp/news.css"), "utf8");

  it("gives every supporting-grid track a definite minimum", () => {
    const rules = supportingGridRules(css);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules)
      for (const track of rule.tracks ?? [rule.raw])
        expect(track, `@${rule.minWidth}px`).toMatch(SAFE_TRACK);
  });

  it("starts at one column, widens somewhere, and never narrows", () => {
    const rules = supportingGridRules(css);
    const base = rules[0];
    expect(base.minWidth, "the base rule must be unwrapped").toBe(0);

    // An auto-fit rule is multi-column by construction and collapses to one
    // track on its own when the container cannot hold two — so it satisfies
    // "starts at one column" and "widens somewhere" together, PROVIDED its
    // minimum is capped at 100%. Without that cap it floors the track above
    // the viewport and overflows every phone, which is the one way an
    // auto-fit grid can fail the mobile contract.
    const usesAutoFit = rules.some((rule) => rule.tracks === null);
    if (base.tracks === null)
      expect(
        base.raw,
        "an auto-fit base must cap its minimum at 100% so it can collapse",
      ).toContain("100%");
    else expect(base.tracks).toHaveLength(1);

    const counts = rules
      .filter((rule) => rule.tracks !== null)
      .map((rule) => rule.tracks!.length);

    // Without this, deleting every media query — one column at 320px AND at
    // 1440px — passes the other assertions. The retired literals caught that;
    // nothing else does.
    expect(
      usesAutoFit || Math.max(...counts) >= 2,
      "the supporting grid must widen beyond one column at some breakpoint",
    ).toBe(true);

    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    // A ceiling, not a pin: a fourth column has never been intended.
    if (counts.length) expect(Math.max(...counts)).toBeLessThanOrEqual(3);

    // ⚠️ An auto-fit rule declares NO count, so without this its column count
    // is unbounded in both directions and the assertions above are satisfied
    // by anything. Demonstrated: `min(200rem, 100%)` gives one column at every
    // width (the collapse the widening check exists to catch) and
    // `min(1px, 100%)` gives as many columns as fit.
    //
    // The bound comes from the shell, not from taste. The content box is
    // ~82rem at the 84rem ceiling, so a minimum above 82/3 = 27.3rem can never
    // reach three columns, and one at or below 82/2 = 41rem always reaches
    // two. Anything inside that band is a valid two-column editorial grid.
    for (const rule of rules.filter((entry) => entry.tracks === null)) {
      const minimum = rule.raw.match(/minmax\(\s*min\(\s*([\d.]+)rem/);
      expect(
        minimum,
        `auto-fit minimum must be a rem length: ${rule.raw}`,
      ).not.toBeNull();
      const rem = Number(minimum![1]);
      expect(rem, `${rule.raw} can reach three columns`).toBeGreaterThan(27.3);
      expect(
        rem,
        `${rule.raw} can never reach two columns`,
      ).toBeLessThanOrEqual(41);
    }
  });

  it("keeps card interaction polish responsive and content-driven", () => {
    // The kicker accent is what makes a card without a cleared image read as a
    // deliberate text-first entry rather than an unfinished one (v3). The
    // SELECTOR is not pinned to one modifier: §4.4 widened it from text-only
    // cards to every standard card once the side thumbnail made the two
    // anatomies read as one kind, at which point a rule on only one of them
    // was an arbitrary distinction rather than a signal.
    const kicker = css.match(
      /\.news-shell\s+\.news-story-card(?:--[a-z]+)?::before\s*\{([^}]*)\}/,
    );
    expect(
      kicker,
      "a story card must carry the editorial kicker",
    ).not.toBeNull();
    expect(kicker![1]).toContain("--editorial-kicker");
    expect(css).toContain(".news-shell .news-story-card:focus-within");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    const cardBodyRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, selector]) =>
        selector.includes("news-story-card") &&
        selector.includes("news-card-body"),
    );
    expect(cardBodyRules.length).toBeGreaterThan(0);
    for (const [, selector, declarations] of cardBodyRules)
      expect(declarations, selector.trim()).not.toMatch(/\bmin-height\s*:/);
  });

  it("uses compact menu navigation and a wrapping shared-style footer", () => {
    const app = fs.readFileSync(path.resolve("newsapp/App.tsx"), "utf8");

    expect(app).not.toContain("news-mobile-nav");
    expect(app).toContain("DropdownMenuContent");
    expect(app).toContain('aria-label={tr("Отвори менюто", "Open menu")}');
    expect(app).toContain('to="/#news-search"');
    expect(app).toMatch(/news-footer-links[^\n]*flex[^\n]*flex-wrap/);
    expect(app).not.toMatch(/news-footer-links[^\n]*grid-cols-5/);
    expect(css).toMatch(/\.news-footer-link\s*{[^}]*min-height:\s*2\.75rem/);
  });
});
