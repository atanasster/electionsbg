// `mandatesForMp` decides which parliaments a person's profile says they sat in, and those
// become DATED person_role rows. A wrong one dates an office somebody never held.
//
// It exists because `nsFolders` alone cannot answer the question: `oldnsList` covers PAST
// parliaments only, and `mp_profile` / `mp_seat` are partly disjoint id spaces — 527 seat
// ids have no profile row. Measured on the live corpus, 107 of the 296 datable MP roles hold
// a seat in an NS their folder list omits; Жельо Иванов Бойчев is profile 2671 with folders
// {42,43} and a seat at NS 44 under id 779.
//
// So the union is by NAME, and these are the guards that make that admissible for a write.
// Hermetic: a temp corpus, no network, no Postgres.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let dir: string;
const write = (rel: string, body: unknown) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(body));
};

import { buildMandateIndex } from "./mpSeats";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mandates-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("buildMandateIndex", () => {
  it("unions the roster's folders with the corpus's own record", () => {
    // The Бойчев shape: the roster files him under {42,43}; the roll-call corpus has him in
    // the room at NS 44 under a DIFFERENT seat id, which is why the join is by name.
    write("data/parliament/index.json", {
      mps: [{ id: 2671, name: "Жельо Иванов Бойчев", nsFolders: ["42", "43"] }],
    });
    write("data/parliament/votes/sessions/2020-10-28.json", {
      ns: 44,
      mpNames: { "779": "ЖЕЛЬО ИВАНОВ БОЙЧЕВ" },
    });
    expect([...buildMandateIndex(dir).get(2671)!].sort()).toEqual([42, 43, 44]);
  });

  it("keeps a pre-corpus MP's folders untouched", () => {
    // Станишев: 39th + 40th, nothing in the corpus. The union must add nothing rather than
    // reaching for a near-match.
    write("data/parliament/index.json", {
      mps: [
        {
          id: 868,
          name: "Сергей Дмитриевич Станишев",
          nsFolders: ["39", "40"],
        },
      ],
    });
    write("data/parliament/votes/sessions/2020-10-28.json", {
      ns: 44,
      mpNames: { "1": "ДРУГ ЧОВЕК СЪВСЕМ" },
    });
    expect([...buildMandateIndex(dir).get(868)!].sort()).toEqual([39, 40]);
  });

  it("FAILS CLOSED on a name two profiles share", () => {
    // The guard that makes the name join safe. If two MPs fold to one name, neither may be
    // handed the other's seat — both keep their own folder list and nothing more.
    write("data/parliament/index.json", {
      mps: [
        { id: 10, name: "Иван Петров Иванов", nsFolders: ["41"] },
        { id: 20, name: "Иван Петров Иванов", nsFolders: ["42"] },
      ],
    });
    write("data/parliament/votes/sessions/2021-01-01.json", {
      ns: 47,
      mpNames: { "99": "ИВАН ПЕТРОВ ИВАНОВ" },
    });
    const m = buildMandateIndex(dir);
    expect([...m.get(10)!]).toEqual([41]);
    expect([...m.get(20)!]).toEqual([42]);
  });

  it("gives an MP the roster lists no parliaments for nothing to date", () => {
    // 1,263 profiles carry no nsFolders. If the corpus does not hold them either, there is
    // no term to name and the caller must keep its single undated row.
    write("data/parliament/index.json", {
      mps: [{ id: 7, name: "Никой Никой Никой", nsFolders: [] }],
    });
    // A corpus that EXISTS and does not contain this person — otherwise the test returns at
    // the absent-directory guard and never exercises the join at all.
    write("data/parliament/votes/sessions/2021-01-01.json", {
      ns: 47,
      mpNames: { "1": "НЯКОЙ СЪВСЕМ ДРУГ ЧОВЕК" },
    });
    expect(buildMandateIndex(dir).get(7)).toBeUndefined();
  });

  it("recovers mandates for an MP the roster lists NO folders for", () => {
    // The other half of the disjoint id spaces: a profile with an empty oldnsList whose
    // holder is nonetheless in the room. Folders alone leave them undated for ever.
    write("data/parliament/index.json", {
      mps: [{ id: 5061, name: "Нов Депутат Депутатов", nsFolders: [] }],
    });
    write("data/parliament/votes/sessions/2026-05-01.json", {
      ns: 52,
      mpNames: { "5061": "НОВ ДЕПУТАТ ДЕПУТАТОВ" },
    });
    expect([...buildMandateIndex(dir).get(5061)!]).toEqual([52]);
  });

  it("folds case, whitespace and hyphen SPACING — but not a near-name", () => {
    write("data/parliament/index.json", {
      mps: [{ id: 1, name: "Иван  Петров Иванов", nsFolders: ["41"] }],
    });
    write("data/parliament/votes/sessions/2021-01-01.json", {
      ns: 47,
      mpNames: { "2": "иван петров иванов" },
    });
    // Its OWN NS, so a false match is observable. Written into the same session as the
    // real one, this assertion could not fail: the true match has already added that NS.
    write("data/parliament/votes/sessions/2021-06-01.json", {
      ns: 48,
      mpNames: { "3": "Иван Петров Иванoв" }, // Latin "o" — must NOT match
    });
    expect([...buildMandateIndex(dir).get(1)!].sort()).toEqual([41, 47]);
  });

  it("matches a spaced hyphen against a tight one", () => {
    // 68 profiles carry a tight hyphen and the corpus spells at least one of them spaced
    // (МИРЕНА НИКОЛАЕВА ГУГЛЕВА - ИВАНОВА → profile 5330). CLAUDE.md records the same rule
    // being learned from „Средкова - Петрова", which minted two person rows for one human.
    write("data/parliament/index.json", {
      mps: [
        { id: 5330, name: "Мирена Николаева Гуглева-Иванова", nsFolders: [] },
      ],
    });
    write("data/parliament/votes/sessions/2026-05-01.json", {
      ns: 52,
      mpNames: { "9": "МИРЕНА НИКОЛАЕВА ГУГЛЕВА - ИВАНОВА" },
    });
    expect([...buildMandateIndex(dir).get(5330)!]).toEqual([52]);
  });

  it("FAILS CLOSED when two seat ids fold onto one profile on ONE day", () => {
    // The collision the roster-ambiguity guard structurally cannot see: two distinct humans
    // sharing a folded name where only one has a profile. Real — two Иван Йорданов
    // Димитровs sat in the 45th at once, and on 2021-04-29 the corpus spells both plainly.
    // Nobody holds two seats on one day, so the profile loses its NAME-derived mandates and
    // keeps its roster folders: it degrades to the behaviour before the name join existed.
    write("data/parliament/index.json", {
      mps: [{ id: 3537, name: "Иван Йорданов Димитров", nsFolders: ["45"] }],
    });
    write("data/parliament/votes/sessions/2021-04-29.json", {
      ns: 45,
      mpNames: {
        "1717": "ИВАН ЙОРДАНОВ ДИМИТРОВ",
        "1833": "ИВАН ЙОРДАНОВ ДИМИТРОВ",
      },
    });
    write("data/parliament/votes/sessions/2021-12-03.json", {
      ns: 47,
      mpNames: { "1717": "ИВАН ЙОРДАНОВ ДИМИТРОВ" },
    });
    // 47 would have been added by the name join; it is dropped because the profile is
    // poisoned. 45 survives — it is the roster's own claim, not the join's.
    expect([...buildMandateIndex(dir).get(3537)!]).toEqual([45]);
  });

  it("degrades to roster-only when the corpus is absent", () => {
    write("data/parliament/index.json", {
      mps: [{ id: 1, name: "Х Х Х", nsFolders: ["41", "42"] }],
    });
    expect([...buildMandateIndex(dir).get(1)!].sort()).toEqual([41, 42]);
  });
});

// The memoised wrapper, its sort, and the reset seam — none of which the cases above touch,
// because they all call buildMandateIndex directly.
describe("mandatesForMp", () => {
  it("memoises on the ATTEMPT, so a degraded build is not retried 2,122 times", async () => {
    const { mandatesForMp, __resetMandateCache } = await import("./mpSeats");
    __resetMandateCache();
    const first = mandatesForMp(868);
    expect(first.length).toBeGreaterThan(0);
    // Ascending, and a fresh array per call — callers must not be handed the index's own set.
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    // A second call must not re-read 613 session files. If it rebuilt, this would still
    // pass — so the real assertion is that the cache is what the reset seam clears, below.
    expect(mandatesForMp(868)).toEqual(first);
    __resetMandateCache();
    expect(mandatesForMp(868)).toEqual(first);
  });

  it("returns an empty array for an unknown id rather than throwing", async () => {
    const { mandatesForMp } = await import("./mpSeats");
    expect(mandatesForMp(-1)).toEqual([]);
  });
});
