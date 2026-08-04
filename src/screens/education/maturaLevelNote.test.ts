import { describe, it, expect } from "vitest";
import {
  maturaLevelNote,
  maturaLevelNoteText,
  MATURA_FLOOR,
} from "./maturaLevelNote";

const bgText = (score: number | null, n: number | null, pct: number | null) => {
  const note = maturaLevelNote(score, n, pct);
  return {
    floor: maturaLevelNoteText(note.floor, true),
    rank: maturaLevelNoteText(note.rank, true),
  };
};

describe("maturaLevelNote", () => {
  it("never says 'По-добре от 0%' at the floor of the scale", () => {
    // The regression: Слаб 2 is the minimum grade, so percentileOf() counts
    // zero schools strictly below and the old ternary printed a 0% ranking.
    const { rank } = bgText(2, 12, 0);
    expect(rank).not.toMatch(/По-добре от 0%/);
    expect(rank).toBe(
      "Сред най-ниските в страната по успех на матурата по БЕЛ.",
    );
  });

  it("states the exact meaning of a 2.00 mean, with the cohort size", () => {
    const { floor } = bgText(MATURA_FLOOR, 12, 0);
    expect(floor).toContain("Всички 12 зрелостници са с оценка Слаб 2");
    // The МОН table is the май-юни session only; the retake is not in it.
    expect(floor).toContain("сесия май–юни");
  });

  it("states the floor even for a cohort too small to rank", () => {
    // Arithmetic, not a small-sample inference: it holds at any n.
    const { floor, rank } = bgText(2, 3, null);
    expect(floor).toContain("Всички 3 зрелостници");
    expect(rank).toContain("Малка група (3 зрелостници)");
  });

  it("says nothing about the floor above it", () => {
    expect(bgText(2.18, 8, 4).floor).toBeNull();
    expect(bgText(4.27, 60, 52).floor).toBeNull();
  });

  it("keeps the percentile sentence in the middle of the range", () => {
    expect(bgText(4.27, 60, 52).rank).toBe(
      "По-добре от 52% от училищата с матура по БЕЛ.",
    );
  });

  it("keeps the top branch", () => {
    expect(bgText(5.9, 120, 99).rank).toBe(
      "Сред най-добрите в страната по успех на матурата по БЕЛ.",
    );
  });

  it("has an English form for every branch", () => {
    for (const [score, n, pct] of [
      [2, 12, 0],
      [2.18, 3, null],
      [4.27, 60, 52],
      [5.9, 120, 99],
    ] as const) {
      const note = maturaLevelNote(score, n, pct);
      const en = [note.floor, note.rank]
        .map((x) => maturaLevelNoteText(x, false))
        .filter(Boolean)
        .join(" ");
      expect(en).not.toBe("");
      expect(en).not.toMatch(/[а-яА-Я]/);
    }
  });

  it("returns nothing at all for a school with no matura score", () => {
    const note = maturaLevelNote(null, null, null);
    expect(note.floor).toBeNull();
    expect(note.rank).toBeNull();
  });
});
