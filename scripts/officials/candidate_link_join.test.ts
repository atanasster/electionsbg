// Unit test for the officials candidateLink join (docs/plans/local-mp-photo-links-v1.md
// Part B): the slate row a roster name resolves to, and the MP photo it carries. Hand-built
// bundles and MP index; no fs, no DB.

import { describe, it, expect } from "vitest";
import {
  buildSlateIndex,
  resolveCandidateLink,
  resolveSlateRow,
} from "./candidate_link_join";
import { buildMpNameIndex } from "../parsers_local/mpNameMatch";

type Bundle = Parameters<typeof buildSlateIndex>[0];
type Cand = { name: string; isElected?: boolean; listPos?: number };

const bundle = (slates: Record<string, Cand[]>): Bundle => ({
  council: Object.fromEntries(
    Object.entries(slates).map(([party, cands]) => [
      party,
      {
        localPartyName: party,
        primaryCanonicalId: null,
        candidates: cands.map((c, i) => ({
          name: c.name,
          listPos: c.listPos ?? i + 1,
          prefVotes: 0,
          isElected: c.isElected ?? false,
        })),
      },
    ]),
  ),
});

const noMps = buildMpNameIndex([]);

describe("resolveSlateRow", () => {
  it("takes an exact full name held by one slate row", () => {
    const idx = buildSlateIndex(
      bundle({ А: [{ name: "Иван Петров Иванов" }] }),
    );
    expect(resolveSlateRow("ИВАН ПЕТРОВ ИВАНОВ", idx)?.partyName).toBe("А");
  });

  it("accepts a roster typo in the patronymic (≤2 edits)", () => {
    const idx = buildSlateIndex(
      bundle({ А: [{ name: "Борис Радославов Борисов" }] }),
    );
    expect(resolveSlateRow("Борис Радослваов Борисов", idx)?.name).toBe(
      "Борис Радославов Борисов",
    );
  });

  it("refuses a genuinely different patronymic — a different person", () => {
    const idx = buildSlateIndex(
      bundle({ А: [{ name: "Димитър Христов Петров" }] }),
    );
    expect(resolveSlateRow("Димитър Георгиев Петров", idx)).toBeUndefined();
  });

  it("holds the patronymic tolerance at exactly two edits", () => {
    const idx = buildSlateIndex(bundle({ А: [{ name: "Иван Петров Колев" }] }));
    // ПЕТРОВ → ПЕТКАВ is 2 substitutions; ПЕТРОВ → БЕЛЧОВ is 3.
    expect(resolveSlateRow("Иван Петкав Колев", idx)?.name).toBe(
      "Иван Петров Колев",
    );
    expect(resolveSlateRow("Иван Белчов Колев", idx)).toBeUndefined();
  });

  it("mutation check: with the edit-distance guard removed, the different patronymic matches", () => {
    const idx = buildSlateIndex(
      bundle({ А: [{ name: "Димитър Христов Петров" }] }),
    );
    expect(
      resolveSlateRow("Димитър Георгиев Петров", idx, Infinity)?.name,
    ).toBe("Димитър Христов Петров");
  });

  it("keeps a first+last match when one side has no patronymic", () => {
    const idx = buildSlateIndex(bundle({ А: [{ name: "Андрей Зографски" }] }));
    expect(resolveSlateRow("Андрей Златков Зографски", idx)?.name).toBe(
      "Андрей Зографски",
    );
  });

  it("compares only the patronymic of a 4-part name with a double surname", () => {
    const idx = buildSlateIndex(
      bundle({ А: [{ name: "Милена Иванова Желева" }] }),
    );
    expect(resolveSlateRow("Милена Иванова Стоянова Желева", idx)?.name).toBe(
      "Милена Иванова Желева",
    );
  });

  it("reads a hyphenated surname as a surname, not a patronymic", () => {
    const idx = buildSlateIndex(
      bundle({ А: [{ name: "Кони Петрова Иванова-Танева" }] }),
    );
    // Two-part roster name: no patronymic, so the unique first+last key is enough.
    expect(resolveSlateRow("Кони Иванова-Танева", idx)?.name).toBe(
      "Кони Петрова Иванова-Танева",
    );
  });

  it("refuses a first+last key held by two slate candidates", () => {
    const idx = buildSlateIndex(
      bundle({
        А: [{ name: "Иван Петров Иванов" }],
        Б: [{ name: "Иван Петков Иванов" }],
      }),
    );
    expect(resolveSlateRow("Иван Петрв Иванов", idx)).toBeUndefined();
  });

  it("resolves a duplicate full name to the single elected row", () => {
    const idx = buildSlateIndex(
      bundle({
        А: [{ name: "Георги Иванов Георгиев" }],
        Б: [{ name: "Георги Иванов Георгиев", isElected: true }],
      }),
    );
    expect(resolveSlateRow("Георги Иванов Георгиев", idx)?.partyName).toBe("Б");
  });

  it("refuses a duplicate full name with zero or two elected rows", () => {
    const none = buildSlateIndex(
      bundle({
        А: [{ name: "Георги Иванов Георгиев" }],
        Б: [{ name: "Георги Иванов Георгиев" }],
      }),
    );
    const both = buildSlateIndex(
      bundle({
        А: [{ name: "Георги Иванов Георгиев", isElected: true }],
        Б: [{ name: "Георги Иванов Георгиев", isElected: true }],
      }),
    );
    expect(resolveSlateRow("Георги Иванов Георгиев", none)).toBeUndefined();
    expect(resolveSlateRow("Георги Иванов Георгиев", both)).toBeUndefined();
  });
});

describe("resolveCandidateLink", () => {
  const mps = buildMpNameIndex([
    { id: 7, normalizedName: "ИВАН ПЕТРОВ ИВАНОВ", photoUrl: "/p/7.webp" },
    { id: 8, normalizedName: "ЛЮБИША БЛАЖЕВСКИ" },
  ]);

  it("attaches the MP photo on an exact full-name match", () => {
    const link = resolveCandidateLink("Иван Петров Иванов", null, mps);
    expect(link?.mpId).toBe(7);
    expect(link?.photoUrl).toBe("/p/7.webp");
    expect(link?.listPos).toBe(0);
  });

  it("attaches no MP on a first+last-only match", () => {
    expect(resolveCandidateLink("Иван Георгиев Иванов", null, mps)).toBeNull();
    expect(
      resolveCandidateLink("Любиша Блажевски Блажевски", null, mps),
    ).toBeNull();
  });

  it("returns null when neither the slate nor the MP join fires", () => {
    const idx = buildSlateIndex(bundle({ А: [{ name: "Петър Олег Петров" }] }));
    expect(resolveCandidateLink("Петър Борисов Петров", idx, noMps)).toBeNull();
  });
});
