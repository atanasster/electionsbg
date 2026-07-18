import { describe, it, expect } from "vitest";
import { parseName } from "./nameParts";

// §7a pure-matcher tests: the name split is where a 2-part vs 3-part mistake becomes
// a wrong blocking key (and downstream a wrong public claim). Hermetic — no DB.

describe("parseName", () => {
  it("splits a canonical 3-part name (given / patronymic / family)", () => {
    expect(parseName("Бойко Методиев Борисов")).toEqual({
      displayName: "Бойко Методиев Борисов",
      given: "Бойко",
      patronymic: "Методиев",
      family: "Борисов",
      nameParts: 3,
      ambiguous: false,
    });
  });

  it("splits a 2-part name with a null patronymic (the ЕРИК-donor shape)", () => {
    expect(parseName("Георги Бакалов")).toEqual({
      displayName: "Георги Бакалов",
      given: "Георги",
      patronymic: null,
      family: "Бакалов",
      nameParts: 2,
      ambiguous: false,
    });
  });

  it("collapses ragged whitespace but preserves source casing", () => {
    const r = parseName("  ИВАН   Петров  ");
    expect(r?.displayName).toBe("ИВАН Петров");
    expect(r?.nameParts).toBe(2);
    expect(r?.given).toBe("ИВАН");
    expect(r?.family).toBe("Петров");
  });

  it("keeps a compound (multi-word) family as one family, flagged ambiguous (4+ tokens)", () => {
    expect(parseName("Мария Ана Стоянова Иванова")).toEqual({
      displayName: "Мария Ана Стоянова Иванова",
      given: "Мария",
      patronymic: "Ана",
      family: "Стоянова Иванова",
      nameParts: 3,
      ambiguous: true, // §2a rule 1: 4+ tokens → route to review/override
    });
  });

  it("treats a hyphenated given name as a single token (3 tokens, not ambiguous)", () => {
    const r = parseName("Ана-Мария Иванова Петрова");
    expect(r?.given).toBe("Ана-Мария");
    expect(r?.patronymic).toBe("Иванова");
    expect(r?.family).toBe("Петрова");
    expect(r?.nameParts).toBe(3);
    expect(r?.ambiguous).toBe(false);
  });

  it("handles a Latin-spelled name identically (folding happens later, in SQL)", () => {
    expect(parseName("Ivan Petrov")).toMatchObject({
      given: "Ivan",
      family: "Petrov",
      nameParts: 2,
    });
  });

  it("returns null for input that cannot form a (given, family) key", () => {
    expect(parseName("")).toBeNull();
    expect(parseName("   ")).toBeNull();
    expect(parseName("Иван")).toBeNull(); // a lone token — skip-and-log, never persist
    expect(parseName(null as unknown as string)).toBeNull();
  });
});
