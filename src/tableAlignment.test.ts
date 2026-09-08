// Every visible row header declares its alignment.
//
// ⚠⚠ THE RULE IS „NAMES AND TEXT LEFT, NUMBERS RIGHT", AND THE HALF THAT FAILS SILENTLY IS THE
// ROW HEADER. A `<th>` defaults to `text-align: center` — so a `<th scope="row">` holding a
// place or a person's name renders CENTRED unless something says otherwise, which is neither
// side of the rule. It is invisible in review (the JSX looks like every other cell), invisible
// to a snapshot of text content, and invisible on any table whose names happen to be the same
// length.
//
// A `<thead>` carrying `text-left` does NOT reach it: that inherits into the header row's own
// cells and stops there, because `<tbody>` is a different subtree. Both shipped tables that were
// reported had exactly that shape — a left-aligned head over centred names, with the counts
// beside them left-aligned, i.e. the rule inverted in both columns at once.
//
// ⚠ THIS GATE CANNOT CHECK THE OTHER HALF. Whether a `<td>` holds a number is not decidable from
// the source — `{formatInt(x)}` and `{p.listName}` are both expressions — so „numbers are
// right-aligned" stays a review rule. What is decidable is that a ROW HEADER never falls through
// to the browser's centre default, which is the defect that actually shipped.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Row headers that may stay unaligned, with the reason.
 *
 * ⚠ ONLY FOR CELLS NOBODY SEES. `BudgetPersonnelChart`'s table is the `sr-only` text equivalent
 * of a chart — it exists so a screen-reader user gets the series as data, and text-align has no
 * meaning in that rendering. Anything a sighted reader can see belongs in the rule, not here.
 */
const EXCEPTIONS: Record<string, string> = {
  "screens/budget/BudgetPersonnelChart.tsx":
    "sr-only text equivalent of a chart — never painted, so alignment says nothing",
};

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && e.name.endsWith(".tsx") && !e.name.includes(".test.")
      ? [full]
      : [];
  });

/** `<th …>` opening tags, across newlines — the formatter breaks a long one over five lines. */
const TH_TAG = /<th\b[^>]*?>/gs;
const ALIGNED = /text-(left|right|center|start|end)/;

describe("table row headers", () => {
  it("never fall through to the browser's centre default", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (EXCEPTIONS[rel]) continue;
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(TH_TAG)) {
        const tag = m[0];
        if (!tag.includes('scope="row"')) continue;
        if (ALIGNED.test(tag)) continue;
        offenders.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(
      offenders,
      `these row headers render CENTRED — a <th> defaults to text-align:center, and a ` +
        `text-left on <thead> does not reach <tbody>. Add "text-left" (or "text-right" if the ` +
        `cell holds a number):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("still finds row headers at all", () => {
    // ⚠ THE MUTATION CHECK. A regex that stopped matching — the formatter changing how it
    // breaks a long `<th>`, or `scope="row"` moving onto its own line — would make the
    // assertion above pass over an empty set for ever.
    //
    // ⚠ THE FLOOR IS DELIBERATELY LOW. Measured 2026-09-08: NINE row headers repo-wide, in nine
    // files, eight of them presidential — `scope="row"` is that family's habit, and every other
    // table names its rows with a `<td>`, which defaults to LEFT and so cannot carry this
    // defect. The floor exists to catch a regex that has stopped matching, not to ratchet a
    // count that legitimately moves with every table added or removed.
    let rowHeaders = 0;
    for (const file of walk(SRC)) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(TH_TAG))
        if (m[0].includes('scope="row"')) rowHeaders += 1;
    }
    expect(rowHeaders).toBeGreaterThan(5);
  });

  it("names a live exception, so a stale one cannot sit here unnoticed", () => {
    for (const rel of Object.keys(EXCEPTIONS))
      expect(fs.existsSync(path.join(SRC, rel)), rel).toBe(true);
  });
});
