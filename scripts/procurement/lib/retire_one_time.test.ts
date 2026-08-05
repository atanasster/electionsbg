import { describe, expect, test } from "vitest";
import { oneTimeMarkers, stripOneTimeBlock } from "./retire_one_time";

const { start, end } = oneTimeMarkers("x");
const doc = (block: string): string =>
  `# Runbook\n\nbefore\n\n${block}\n\nafter\n`;

describe("stripOneTimeBlock", () => {
  test("removes the block and leaves one blank line behind", () => {
    const r = stripOneTimeBlock(doc(`${start}\nstep\n${end}`), "x");
    expect(r.removed).toBe(true);
    expect(r.text).toBe("# Runbook\n\nbefore\n\nafter\n");
  });

  test("is a no-op once already retired — a second --apply must not fail", () => {
    const once = stripOneTimeBlock(doc(`${start}\nstep\n${end}`), "x");
    const twice = stripOneTimeBlock(once.text, "x");
    expect(twice.removed).toBe(false);
    expect(twice.text).toBe(once.text);
  });

  test("leaves a DIFFERENT one-time block alone", () => {
    const other = oneTimeMarkers("y");
    const src = doc(`${other.start}\nkeep me\n${other.end}`);
    expect(stripOneTimeBlock(src, "x")).toEqual({ text: src, removed: false });
  });

  test("refuses rather than rewriting a runbook it mis-parsed", () => {
    // End before start, and a lone marker. Both must leave the file untouched: a bad rewrite of a
    // committed runbook is worse than leaving a stale step for a human to delete.
    const inverted = doc(`${end}\nstep\n${start}`);
    expect(stripOneTimeBlock(inverted, "x")).toEqual({
      text: inverted,
      removed: false,
    });
    const lone = doc(`${start}\nstep`);
    expect(stripOneTimeBlock(lone, "x")).toEqual({
      text: lone,
      removed: false,
    });
  });

  test("REFUSES when a marker appears more than once", () => {
    // The corruption case. A doc that documents this very mechanism, or a second one-time step
    // reusing the id, gives two STARTs — and a first-match strip would delete everything between
    // the first START and the first END, including whatever sits between the two blocks.
    const two = `# R\n\n${start}\na\n${end}\n\nkeep me\n\n${start}\nb\n${end}\n`;
    expect(stripOneTimeBlock(two, "x")).toEqual({ text: two, removed: false });
    const twoEnds = `# R\n\n${start}\na\n${end}\n\n${end}\n`;
    expect(stripOneTimeBlock(twoEnds, "x")).toEqual({
      text: twoEnds,
      removed: false,
    });
  });

  test("a fenced example ALONGSIDE the real block makes it refuse, not mis-strip", () => {
    // The realistic corruption path: a runbook that both carries the step and documents the
    // mechanism. First-match stripping would delete from the first START to the first END —
    // swallowing whatever sits between them. Counting turns that into a refusal.
    //
    // Note the honest limit: a file holding ONLY a fenced example, with no real block, still has
    // counts of 1/1 and is indistinguishable from a real step. That is acceptable — this only
    // ever runs against the one runbook it put its own block into.
    const src =
      `# R\n\n${start}\nreal step\n${end}\n\nSee:\n\n` +
      `\`\`\`markdown\n${start}\nexample\n${end}\n\`\`\`\n`;
    expect(stripOneTimeBlock(src, "x")).toEqual({ text: src, removed: false });
  });

  test("markers are HTML comments, so they never render in the runbook", () => {
    expect(start).toMatch(/^<!--.*-->$/);
    expect(end).toMatch(/^<!--.*-->$/);
  });
});
