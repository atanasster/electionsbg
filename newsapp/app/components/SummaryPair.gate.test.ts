// Every full-summary surface goes through SummaryPair.
//
// ⚠️ A STATIC SOURCE GATE, the same shape as `imageCredit.test.ts` and the
// mention-link sweep — because the failure it prevents lives in a file that
// does not exist yet. The rubric produces `summary_en` for all 365 analysed
// records; two places read a summary today, and a third written by hand
// would render `summary_bg` and quietly drop the English.
//
// The app now has distinct Bulgarian and English URL trees. The gate protects
// the selected-language-only contract: both translations remain wired, while
// no page renders them together.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../../scripts/lib/strip_comments";

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const sources = (): { file: string; text: string }[] => {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
        out.push({
          file: path.relative(APP, full),
          // ⚠️ COMMENTS STRIPPED, through the repo's own primitive. Prose
          // that MENTIONS a pattern is not an occurrence of it: without
          // this, a comment merely naming `SummaryPair` — like the one at
          // the top of this file — disables the gate for that module. Two
          // other gates here were burned by naive versions in opposite
          // directions, which is why there is one primitive rather than a
          // third hand-rolled copy.
          text: stripComments(fs.readFileSync(full, "utf-8")),
        });
    }
  };
  walk(APP);
  return out;
};

/**
 * Does the summary render inside a clamped preview?
 *
 * ⚠️ Scoped to the JSX element that CONTAINS the summary — a `line-clamp`
 * elsewhere in the file says nothing about this rendering. The window is the
 * enclosing tag, found by walking back to the nearest `<` and forward to the
 * matching `>`; crude, and deliberately so: anything cleverer would need a
 * parser, and a parser here would be a second implementation of what the
 * bundler already does.
 */
const RENDERS_RE =
  // ⚠️ NO `?` OR `&&` INSIDE. `{story.summary_bg ? (` is a GUARD, not a
  // rendering — it decides whether to render and its enclosing tag is the
  // wrapper above the clamped one. Counting it as a render made StoryCard
  // look like an unclamped full rendering of its own teaser.
  //
  // ⚠️ And the negative lookbehind: a template literal's
  // `${story.summary_bg ?? ""}` has the same braces as a JSX expression, so
  // without it HomeScreen's search haystack reads as a rendering.
  /(?<!\$)\{[^}?&]*\bsummary_bg\b[^}?&]*\}/g;

const clampedTeaser = (text: string): boolean => {
  const re = new RegExp(RENDERS_RE.source, "g");
  for (const m of text.matchAll(re)) {
    const open = text.lastIndexOf("<", m.index);
    if (open < 0) return false;
    const close = text.indexOf(">", open);
    const tag = text.slice(open, close < 0 ? m.index : close);
    if (!/line-clamp/.test(tag)) return false;
  }
  return true;
};

describe("the English summary has one path", () => {
  it("has no module that renders summary_bg without SummaryPair", () => {
    // ⚠️ TWO EXEMPTIONS, both measured against real code rather than
    // guessed, and both narrow:
    //
    //   • a SEARCH HAYSTACK reads the summary without rendering it —
    //     HomeScreen concatenates it into a filter string, where an English
    //     disclosure is meaningless.
    //   • a CLAMPED TEASER (`line-clamp`) is a two-line preview on a card,
    //     not the place a reader gets the summary. A <details> inside one
    //     would be a disclosure the card has no room to open.
    //
    // Anything else that renders the Bulgarian summary is a full rendering
    // and owes the reader the English beside it.
    const offenders = sources()
      .filter((s) => {
        if (!/\bsummary_bg\b/.test(s.text)) return false;
        if (s.file.startsWith("components/SummaryPair")) return false;
        if (s.file === "data.ts") return false;
        if (s.text.includes("SummaryPair")) return false;
        // Read for filtering or guarded, never rendered — see RENDERS_RE.
        const renders = new RegExp(RENDERS_RE.source).test(s.text);
        if (!renders) return false;
        // ⚠️ A clamped teaser, checked IN THE SAME ELEMENT as the summary
        // rather than anywhere in the file. As a whole-file substring test
        // this pre-exempted `ArticleCard.tsx`, which already carries an
        // unrelated `line-clamp-3` — so the most likely third summary
        // surface in the app was exempt before the code existed.
        return !clampedTeaser(s.text);
      })
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("the offender predicate still DISCRIMINATES", () => {
    // ⚠️ Every other assertion here is „nothing is wrong", which is exactly
    // what a predicate that has stopped matching also reports. This drives
    // the same predicate over four synthetic modules whose answers are
    // known — two that must be flagged, two that must not.
    const cases: [string, string, boolean][] = [
      ["plain render", '<p className="x">{a.summary_bg}</p>', true],
      // The unrelated clamp that pre-exempted ArticleCard as a whole file.
      [
        "clamp elsewhere in the file",
        '<span className="line-clamp-3">{a.x}</span><p>{a.summary_bg}</p>',
        true,
      ],
      [
        "clamped teaser",
        '<p className="line-clamp-2">{a.summary_bg}</p>',
        false,
      ],
      ["search haystack", 'const h = `${a.summary_bg ?? ""}`;', false],
    ];
    for (const [name, body, shouldFlag] of cases) {
      const renders = new RegExp(RENDERS_RE.source).test(body);
      const flagged = renders && !clampedTeaser(body);
      expect(flagged, name).toBe(shouldFlag);
    }
  });

  it("still finds the component, so the sweep is not vacuous", () => {
    // ⚠️ Without this the gate passes for ever if `sources()` silently
    // returns nothing — a renamed directory, a changed extension filter.
    const all = sources();
    expect(all.length).toBeGreaterThan(5);
    expect(all.some((s) => s.text.includes("SummaryPair"))).toBe(true);
    expect(
      all.filter((s) => /\bsummary_bg\b/.test(s.text)).length,
    ).toBeGreaterThan(1);
  });

  it("selects one locale instead of rendering a translation disclosure", () => {
    const src = stripComments(
      fs.readFileSync(path.join(APP, "components", "SummaryPair.tsx"), "utf-8"),
    );
    expect(src).toContain('language === "en" ? en : bg');
    expect(src).toMatch(/\{\s*selected\s*\}/);
    expect(src).not.toContain("<details");
    expect(src).not.toContain("<summary");
  });
});
