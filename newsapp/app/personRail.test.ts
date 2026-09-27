import { describe, expect, it } from "vitest";
import type { JevArticleSentiment, JevScore, JevSubject } from "./data";
import {
  baselineFor,
  groupPeople,
  hasPage,
  officeText,
  onRail,
  railNames,
} from "./personRail";

const score = (value: number, over: Partial<JevScore> = {}): JevScore => ({
  value,
  normalized: value / 2,
  spread: 0.3,
  confidence: 0.9,
  levels: 5,
  both_directions: false,
  bucket_index: value <= -0.5 ? 1 : value >= 0.5 ? 3 : 2,
  ...over,
});

const person = (
  name: string,
  over: Partial<JevSubject> = {},
  id: string | null = name.toLowerCase().replace(/\s+/g, "-"),
): JevSubject => ({
  name,
  kind: "person",
  subject_role: "secondary",
  mentions: 2,
  tone: score(-0.8),
  identity: id
    ? { kind: "person", id, basis: "exact", canonical: `${name} Канон` }
    : null,
  ...over,
});

const JEV = {
  rubric_version: "r",
  model: "m",
  assessed_at: null,
  axes: {},
  text_scope: { kind: "full" },
} as Extract<JevArticleSentiment, { withheld?: undefined }>;

describe("groupPeople", () => {
  it("one row per identity, main subjects first, a profile only breaks ties", () => {
    const g = groupPeople([
      person("Тръмп", { subject_role: "primary" }, null),
      person("Иван Иванов"),
      person("Иван Иванов", { name: "Иванов" }, "иван-иванов"),
      person("Мария Петрова", { subject_role: "primary" }),
    ]);
    // §5: a foreign main subject never sinks below an identified participant.
    expect(g.rows.map((r) => r.subject.name)).toEqual([
      "Мария Петрова",
      "Тръмп",
      "Иван Иванов",
    ]);
  });

  it("sorts the four kinds of name apart", () => {
    const g = groupPeople([
      person("Костадин Костадинов", { refused_reason: "ambiguous" }, null),
      person("Бойко Борисов", { subject_role: "incidental", tone: undefined }),
      person("Пенка Пенева", { tone: undefined }),
      { name: "ГЕРБ", kind: "party", subject_role: "primary", mentions: 3 },
    ]);
    expect(g.rows).toEqual([]);
    expect(g.unresolved.map((s) => s.name)).toEqual(["Костадин Костадинов"]);
    expect(g.passing.map((s) => s.name)).toEqual(["Бойко Борисов"]);
    expect(g.unrated.map((s) => s.name)).toEqual(["Пенка Пенева"]);
  });

  it("a name the registry simply does not hold still gets a full row", () => {
    // Foreign people and Bulgarians outside the gazetteer: shown with their
    // tone, labelled „без профил".
    const g = groupPeople([
      person("Доналд Тръмп", { refused_reason: "no_match" }, null),
    ]);
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0].identity).toBeNull();
    expect(g.rows[0].bucket).toBe("unfavorable");
  });
});

describe("baselineFor", () => {
  const base = {
    generated_at: "t",
    persons: { "иван-иванов": { n: 5, sum: 2, levels: 5 } },
  };

  it("during a freeze, subtracts only an article that is in the snapshot", () => {
    const row = groupPeople([person("Иван Иванов", { tone: score(2) })])
      .rows[0];
    const frozen = {
      ...base,
      frozen: { id: "f", as_of: "2026-11-06T22:00:00Z", until: "x" },
    };
    const before = { ...JEV, assessed_at: "2026-11-06T10:00:00Z" };
    const after = { ...JEV, assessed_at: "2026-11-07T10:00:00Z" };
    expect(baselineFor(row, before, frozen)?.n).toBe(4);
    // Scored after the snapshot: never in its sum, so nothing to remove.
    expect(baselineFor(row, after, frozen)?.n).toBe(5);
  });

  it("removes THIS article before bucketing", () => {
    const row = groupPeople([person("Иван Иванов", { tone: score(2) })])
      .rows[0];
    // (2 − 2) / 4 = 0 → neutral, over the OTHER four articles.
    expect(baselineFor(row, JEV, base)).toEqual({ n: 4, bucket: "neutral" });
  });

  it("does not subtract a pair the archive did not count", () => {
    const row = groupPeople([
      person("Иван Иванов", { tone: score(2), conflict: true }),
    ]).rows[0];
    expect(baselineFor(row, JEV, base)).toEqual({ n: 5, bucket: "neutral" });
    const truncated = {
      ...JEV,
      text_scope: { kind: "prefix" },
    } as typeof JEV;
    const plain = groupPeople([person("Иван Иванов", { tone: score(2) })])
      .rows[0];
    expect(baselineFor(plain, truncated, base)?.n).toBe(5);
  });

  it("is absent when the baseline names no scale", () => {
    const row = groupPeople([person("Иван Иванов")]).rows[0];
    expect(
      baselineFor(row, JEV, {
        generated_at: "t",
        persons: { "иван-иванов": { n: 5, sum: 2, levels: null } },
      }),
    ).toBeNull();
  });

  it("railNames covers every spelling the rail folded in", () => {
    const names = railNames([
      person("Иванов", { merged_surfaces: ["Иван Иванов"] }),
      { name: "ГЕРБ", kind: "party", subject_role: "primary", mentions: 1 },
    ]);
    expect([...names].sort()).toEqual(["Иван Иванов", "Иванов"]);
  });

  it("is absent without a page, and when nothing else is left", () => {
    const row = groupPeople([person("Иван Иванов")]).rows[0];
    expect(baselineFor(row, JEV, null)).toBeNull();
    expect(
      baselineFor(row, JEV, {
        generated_at: "t",
        persons: { "иван-иванов": { n: 1, sum: -0.8, levels: 5 } },
      }),
    ).toBeNull();
    expect(hasPage(row.identity, base)).toBe(true);
    expect(hasPage(null, base)).toBe(false);
  });
});

describe("officeText", () => {
  const tr = (bg: string) => bg;
  it("dates current, open and former offices differently", () => {
    expect(
      officeText(
        "Кмет",
        { role_current: true, role_start: "2023-11-06" } as never,
        tr,
      ),
    ).toBe("Кмет (от 2023)");
    // No exit filing: neither current nor „бивш".
    expect(
      officeText(
        "Изпълнителен директор",
        {
          role_current: false,
          role_open: true,
          role_start: "2018-03-01",
        } as never,
        tr,
      ),
    ).toBe("Изпълнителен директор (по декларация от 2018)");
    expect(
      officeText(
        "Министър",
        {
          role_current: false,
          role_start: "2021-05-12",
          role_end: "2021-12-13",
        } as never,
        tr,
      ),
    ).toBe("бивш: Министър (2021–2021)");
  });
});

describe("onRail", () => {
  it("drops a chip naming a rail identity under another spelling", () => {
    const links = { "Румен Радев": { kind: "person", id: "mp-5142" } };
    expect(
      onRail("Румен Радев", new Set(["Радев"]), new Set(["mp-5142"]), links),
    ).toBe(true);
    expect(
      onRail("Иван Иванов", new Set(["Радев"]), new Set(["mp-5142"]), links),
    ).toBe(false);
    expect(onRail("Радев", new Set(["Радев"]), new Set(), undefined)).toBe(
      true,
    );
  });
});
