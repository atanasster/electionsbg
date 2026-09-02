// Gates for the kind × level composition matrix (Phase 0, §6).
//
// The type system already enforces exhaustiveness — the matrix is a `Record<ElectionKind,
// Record<ElectionPlaceLevel, …>>`, so a new kind or level fails `tsc`. What these gates hold
// is everything `tsc` cannot see: that the §6.3 card diff stays a recorded decision, that
// abroad never acquires a turnout fact, that no key is built by template, and that a
// multi-ballot level's maps can say which ballot they colour.
//
// ⚠ TWO WAYS A GATE HERE GOES VACUOUS, both of which it has:
//
//   1. `toContain` is typed `<E>(item: E) => void` — completely unconstrained by the array's
//      element type. `not.toContain("top_loser")` passes whatever the union holds, so the
//      recorded DROP decisions need a typed home or a future "unused enum member" cleanup
//      removes the code and nothing goes red.
//   2. A hand-written `LEVELS` array is an ANNOTATION, not a completeness constraint. A 7th
//      level type-checks against a 6-element array, so it would be exempt from every rule
//      below while the matrix itself correctly failed to compile. Both are derived.

import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../../scripts/lib/strip_comments";
import {
  ELECTION_SURFACE_DESCRIPTORS,
  descriptorCopyKeys,
  descriptorFor,
  FACT_LABEL_KEYS,
  MAP_MODE_LABEL_KEYS,
  RANKED_COLUMN_LABEL_KEYS,
  type ElectionLevelDescriptor,
  type ElectionRankedColumn,
} from "./electionSurfaceDescriptors";
import {
  MAX_SURFACE_FACTS,
  type ElectionFactCode,
  type ElectionKind,
  type ElectionPlaceLevel,
} from "@/data/elections/surfaceTypes";

// Derived from the matrix's own keys, so a new kind or level joins every gate below
// automatically. A hand-written array type-checks while covering fewer levels than exist.
const KINDS = Object.keys(ELECTION_SURFACE_DESCRIPTORS) as ElectionKind[];
const LEVELS = Object.keys(
  ELECTION_SURFACE_DESCRIPTORS.parliamentary,
) as ElectionPlaceLevel[];

/** §6.3's recorded drops, TYPED — so deleting or renaming a code fails `tsc` here rather than
 *  making the gate below trivially true. */
const DROPPED_EVERYWHERE = [
  "top_loser",
] as const satisfies readonly ElectionFactCode[];
const PARLIAMENTARY_ONLY = [
  "paper_machine",
] as const satisfies readonly ElectionFactCode[];
const NO_PREFERENCE_COLUMN = [
  "round",
  "elected",
] as const satisfies readonly ElectionRankedColumn[];

const available = (
  kind: ElectionKind,
  level: ElectionPlaceLevel,
): ElectionLevelDescriptor | null => {
  const d = descriptorFor(kind, level);
  return d.available ? d : null;
};

const eachAvailable = (
  fn: (d: ElectionLevelDescriptor, label: string) => void,
) => {
  for (const kind of KINDS)
    for (const level of LEVELS) {
      const d = available(kind, level);
      if (d) fn(d, `${kind}/${level}`);
    }
};

describe("descriptor matrix — exhaustive and explicit", () => {
  it("covers every kind × level the unions admit", () => {
    // Derived keys, so this is a real check that the record was not built with a hole.
    expect(KINDS.length).toBe(2);
    expect(LEVELS.length).toBe(6);
    for (const kind of KINDS)
      for (const level of LEVELS)
        expect(descriptorFor(kind, level), `${kind}/${level}`).toBeDefined();
  });

  it("records the one impossible combination rather than omitting it", () => {
    // Local elections are not held abroad. An `available: false` entry says somebody decided;
    // a missing key would be indistinguishable from an oversight.
    const d = descriptorFor("local", "abroad");
    expect(d.available).toBe(false);
    expect(d.available === false && d.reasonKey).toBeTruthy();

    const unavailable: string[] = [];
    for (const kind of KINDS)
      for (const level of LEVELS)
        if (!descriptorFor(kind, level).available)
          unavailable.push(`${kind}/${level}`);
    expect(unavailable).toEqual(["local/abroad"]);
  });

  it("keeps every level's fact declaration coherent", () => {
    eachAvailable((d, label) => {
      expect(d.maxFacts, label).toBeGreaterThanOrEqual(1);
      expect(d.maxFacts, label).toBeLessThanOrEqual(MAX_SURFACE_FACTS);
      // A level may PRIORITISE more than it shows — the renderer takes the first N the
      // surface can fill — but never fewer than it intends to show.
      expect(
        d.factPriority.length,
        `${label} priority < maxFacts`,
      ).toBeGreaterThanOrEqual(d.maxFacts);
      // A duplicate renders the same card twice inside `maxFacts`.
      expect(new Set(d.factPriority).size, `${label} duplicate fact`).toBe(
        d.factPriority.length,
      );
    });
  });

  it("gives every level at least one ballot, with distinct kinds", () => {
    eachAvailable((d, label) => {
      expect(d.ballots.length, label).toBeGreaterThanOrEqual(1);
      const kinds = d.ballots.map((b) => b.kind);
      expect(new Set(kinds).size, `${label} duplicate ballot`).toBe(
        kinds.length,
      );
    });
  });
});

describe("descriptor matrix — abroad publishes no turnout", () => {
  it("omits the turnout fact at parliamentary/abroad", () => {
    // §2 decision 10. Note this CODIFIES an existing suppression rather than removing a card:
    // `RegionDashboardCards` already hides TurnoutCard when `isDiasporaRegion`.
    const abroad = available("parliamentary", "abroad");
    expect(abroad).not.toBeNull();
    expect(abroad!.factPriority).not.toContain("turnout" as ElectionFactCode);
    // …and it still says how many people voted, which is the honest substitute.
    expect(abroad!.factPriority).toContain("votes_cast" as ElectionFactCode);
  });

  it("keeps turnout at every other parliamentary level", () => {
    // Non-vacuity: if the assertion above passed because NO level has turnout, it would be
    // asserting nothing.
    for (const level of LEVELS.filter((l) => l !== "abroad")) {
      const d = available("parliamentary", level);
      if (!d) continue;
      expect(d.factPriority, `parliamentary/${level}`).toContain(
        "turnout" as ElectionFactCode,
      );
    }
  });
});

describe("descriptor matrix — the §6.3 card diff stays a recorded decision", () => {
  it("drops top_loser at EVERY level", () => {
    eachAvailable((d, label) => {
      for (const code of DROPPED_EVERYWHERE)
        expect(d.factPriority, label).not.toContain(code);
    });
  });

  it("retains top_gainer everywhere it renders today, except country and abroad", () => {
    // `SectionDashboardCards` renders it, so section KEEPS it — dropping it there would be
    // the unrecorded removal §6.3 forbids.
    for (const level of [
      "region",
      "municipality",
      "settlement",
      "section",
    ] as const)
      expect(
        available("parliamentary", level)!.factPriority,
        `parliamentary/${level}`,
      ).toContain("top_gainer" as ElectionFactCode);

    for (const level of ["country", "abroad"] as const)
      expect(
        available("parliamentary", level)!.factPriority,
        `parliamentary/${level}`,
      ).not.toContain("top_gainer" as ElectionFactCode);
  });

  it("retains paper_machine on every parliamentary level", () => {
    for (const level of LEVELS) {
      const d = available("parliamentary", level);
      if (!d) continue;
      for (const code of PARLIAMENTARY_ONLY)
        expect(d.factPriority, `parliamentary/${level}`).toContain(code);
    }
  });

  it("does not leak parliamentary-only facts into the local matrix", () => {
    for (const level of LEVELS) {
      const d = available("local", level);
      if (!d) continue;
      for (const code of PARLIAMENTARY_ONLY)
        expect(d.factPriority, `local/${level}`).not.toContain(code);
    }
  });

  it("declares no ranked column the entry type cannot supply", () => {
    // `preferences` was such a column: per-CANDIDATE data on a per-list entry, and §2
    // decision 6 keeps candidate lists out of the surface entirely. The union no longer has
    // it; this pins that the survivors are the ones with a producer.
    eachAvailable((d, label) => {
      expect(d.rankedColumns.length, label).toBeGreaterThanOrEqual(2);
      for (const c of d.rankedColumns)
        expect(
          ["votes", "pct", "seats", "margin", ...NO_PREFERENCE_COLUMN],
          `${label} unknown column ${c}`,
        ).toContain(c);
    });
  });
});

describe("descriptor matrix — ballots and maps", () => {
  it("keeps mayor and council as SEPARATE ballots wherever both are elected", () => {
    const muni = available("local", "municipality")!;
    const kinds = muni.ballots.map((b) => b.kind);
    expect(kinds).toContain("municipality_mayor");
    expect(kinds).toContain("municipal_council");
  });

  it("gives a settlement only its OWN mayoral ballot", () => {
    // A settlement surface must never attribute the parent council as a settlement office.
    const s = available("local", "settlement")!;
    expect(s.ballots.map((b) => b.kind)).toEqual(["settlement_mayor"]);
  });

  it("renders local country and region as separate mayor/council maps", () => {
    // §2 decision 9 and §8: separate modes with independent legends. A single per-level slot
    // could not say which of the two ballots it coloured.
    for (const level of ["country", "region"] as const) {
      const d = available("local", level)!;
      expect(d.maps.length, `local/${level}`).toBe(2);
      expect(d.maps.map((m) => m.ballot)).toEqual([
        "municipality_mayor",
        "municipal_council",
      ]);
    }
  });

  it("names the ballot on every map of a multi-ballot level", () => {
    eachAvailable((d, label) => {
      if (d.ballots.length <= 1) return;
      for (const m of d.maps)
        expect(m.ballot, `${label} map without a ballot`).toBeTruthy();
      // …and two maps never colour the same ballot.
      const named = d.maps.map((m) => m.ballot);
      expect(new Set(named).size, `${label} duplicate map ballot`).toBe(
        named.length,
      );
    });
  });

  it("only ever names a ballot the level actually declares", () => {
    eachAvailable((d, label) => {
      const kinds = new Set(d.ballots.map((b) => b.kind));
      for (const m of d.maps)
        if (m.ballot)
          expect(kinds.has(m.ballot), `${label} map names absent ballot`).toBe(
            true,
          );
    });
  });

  it("draws no map at a single polling section, in either kind", () => {
    // §8 makes the section result-and-evidence-first, and it is what makes that route the
    // repo's canonical chart-free/map-free page (§10.1).
    expect(available("parliamentary", "section")!.maps).toEqual([]);
    expect(available("local", "section")!.maps).toEqual([]);
  });

  it("declares an allowed default mode on every map slot", () => {
    // ⚠ The posture VALUE is guaranteed by the type, so asserting it is in its own union
    // proves nothing. §6's actual requirement — that an `interactive` adapter passes both
    // `ariaLabel` and `onClick` for every selectable feature (`FeatureMap`:
    // `const keyboard = !!ariaLabel && !!onClick`) — is an ADAPTER assertion and lives with
    // Phase 2. It is NOT covered here.
    eachAvailable((d, label) => {
      for (const m of d.maps)
        expect(m.allowedModes, `${label} default not allowed`).toContain(
          m.defaultMode,
        );
    });
  });

  it("draws every map at a grain finer than its own level", () => {
    // A grain equal to the level draws a one-feature map. Abroad is allowlisted: its `grain`
    // is the DATA grain and its features are foreign countries, which the level union has no
    // member for.
    const finer: Record<string, ElectionPlaceLevel[]> = {
      country: ["region", "municipality", "settlement", "section"],
      region: ["municipality", "settlement", "section"],
      municipality: ["settlement", "section"],
      settlement: ["section"],
    };
    for (const kind of KINDS)
      for (const level of LEVELS) {
        if (level === "abroad" || level === "section") continue;
        const d = available(kind, level);
        if (!d) continue;
        for (const m of d.maps)
          expect(finer[level], `${kind}/${level} grain ${m.grain}`).toContain(
            m.grain,
          );
      }
  });

  it("offers a turnout map mode only where the level carries a turnout fact", () => {
    // Turnout is the ONE mode whose denominator can be absent (§2 decision 10), so it is
    // gated on the fact. Other modes — `change`, `review_signal` — may be offered without a
    // matching strip fact: the strip is a priority list, not the map's capability set.
    eachAvailable((d, label) => {
      if (!d.maps.some((m) => m.allowedModes.includes("turnout"))) return;
      expect(d.factPriority, label).toContain("turnout" as ElectionFactCode);
    });
  });

  it("offers an official protocol only at section level", () => {
    for (const kind of KINDS)
      for (const level of LEVELS) {
        const d = available(kind, level);
        if (!d) continue;
        expect(d.hasOfficialProtocol, `${kind}/${level}`).toBe(
          level === "section",
        );
      }
  });
});

describe("descriptor matrix — no i18n key is built", () => {
  it("names every key as a literal", () => {
    // §5.2 / §6.1: a template defeats `bundle_reachability.test.ts` and makes the copy
    // coverage gate impossible to write honestly, because the key set stops being statically
    // enumerable.
    //
    // ⚠ STRIP COMMENTS. This file's own header DISCUSSES built keys in prose, and CLAUDE.md's
    // rule is that "prose that MENTIONS a pattern is not an occurrence of it".
    const src = stripComments(
      readFileSync(
        path.resolve(__dirname, "electionSurfaceDescriptors.ts"),
        "utf8",
      ),
    );
    // ANY *Key field, not a fixed list — a new key-bearing field joins the gate automatically.
    expect(src, "a key is built by template").not.toMatch(/\w*Key:\s*`/);
    expect(src, "a key is built by concatenation").not.toMatch(
      /\w*Key:\s*[^,\n]*\+/,
    );
  });

  it("writes a label key out for every member of all three vocabularies", () => {
    // The `Record<Union, string>` shape means a missing member is a compile error; this pins
    // that no VALUE is empty and none collides.
    const all = [
      ...Object.values(FACT_LABEL_KEYS),
      ...Object.values(MAP_MODE_LABEL_KEYS),
      ...Object.values(RANKED_COLUMN_LABEL_KEYS),
    ];
    for (const k of all)
      expect(k, "empty label key").toMatch(/^[a-z][a-z0-9_]+$/);
    expect(new Set(all).size, "colliding label keys").toBe(all.length);
  });

  it("exposes every key it can name, for the copy-coverage gate", () => {
    const keys = descriptorCopyKeys();
    expect(new Set(keys).size, "duplicates").toBe(keys.length);
    for (const k of keys)
      expect(k, `${k} is not a literal key`).toMatch(/^[a-z][a-z0-9_]+$/);

    // ⚠ THE FACT STRIP IS THE MOST-READ COMPONENT ON THE PAGE and was once the part this
    // list did not cover. All three vocabularies must be in here, not just the ballot,
    // empty-state, question and reason keys.
    for (const k of Object.values(FACT_LABEL_KEYS)) expect(keys).toContain(k);
    for (const k of Object.values(MAP_MODE_LABEL_KEYS))
      expect(keys).toContain(k);
    for (const k of Object.values(RANKED_COLUMN_LABEL_KEYS))
      expect(keys).toContain(k);

    // …and the one key reachable only through the `available: false` arm.
    expect(keys).toContain("election_unavailable_local_abroad");
  });
});
