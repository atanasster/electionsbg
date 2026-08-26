// The МЗ second-level roster's PG-FREE invariants — structure, the three
// disjointness claims that keep it out of the health sector's EIK-set, and the
// search-key coverage the whole feature rests on.
//
// Split from scripts/db/tests/mz_second_level_bodies.data.test.ts on the
// educationReferenceData.test.ts pattern: everything here is decidable from the
// source alone, so it belongs in the fast unit suite where it fails in seconds on
// a machine with no database. That file keeps what genuinely needs the corpus —
// does every EIK still award contracts, and does the corpus hold an МЗ body this
// roster has not got.
//
// Plan: docs/plans/health-mz-bodies-search-v1.md (T4a).

import { describe, expect, it } from "vitest";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { HEALTH_SECTOR_EIKS } from "./healthReferenceData";
import { buildEntityIndex, searchIndex } from "./entitySearchIndex";
import { latinSkeleton } from "./translitSearch";
import {
  MZ_SECOND_LEVEL_BODIES,
  MZ_SECOND_LEVEL_INSTITUTION_COUNT,
  MZ_UNIVERSE_LABEL,
  MZ_UNIVERSE_SEARCH_KEYS,
  mzBodySearchKeys,
  type MzBodyUniverse,
} from "./mzSecondLevelBodies";

const EIKS = MZ_SECOND_LEVEL_BODIES.map((b) => b.eik);
const UNIVERSES: MzBodyUniverse[] = ["csmp", "rzi", "national"];
/** Derived, never pinned: T4b's corpus reconcile will move these the day a body
 *  is added, and a bare number diff tells a maintainer nothing about which. */
const sizeOf = (u: MzBodyUniverse) =>
  MZ_SECOND_LEVEL_BODIES.filter((b) => b.universe === u).length;
/** Keys the universe owns, i.e. beyond the set every universe shares. Asserted
 *  separately because the shared five alone satisfy any plain length floor. */
const ownKeys = (u: MzBodyUniverse) => {
  const shared = UNIVERSES.map((x) => MZ_UNIVERSE_SEARCH_KEYS[x]).reduce(
    (acc, keys) => acc.filter((k) => keys.includes(k)),
  );
  return MZ_UNIVERSE_SEARCH_KEYS[u].filter((k) => !shared.includes(k));
};

describe("MZ_SECOND_LEVEL_BODIES — structure", () => {
  it("is one row per distinct, well-formed EIK", () => {
    expect(new Set(EIKS).size).toBe(EIKS.length);
    for (const b of MZ_SECOND_LEVEL_BODIES) {
      expect(b.eik, `malformed EIK on ${b.name}`).toMatch(/^\d{9}$|^\d{13}$/);
      expect(b.name.trim(), `empty name on ${b.eik}`).not.toBe("");
      expect(
        MZ_UNIVERSE_LABEL[b.universe],
        `no label for universe "${b.universe}" (${b.eik})`,
      ).toBeTruthy();
    }
  });

  it("gives every universe a label and its OWN key set, in both languages", () => {
    for (const u of UNIVERSES) {
      expect(MZ_UNIVERSE_LABEL[u].bg.trim()).not.toBe("");
      expect(MZ_UNIVERSE_LABEL[u].en.trim()).not.toBe("");
      // ⚠ NOT `MZ_UNIVERSE_SEARCH_KEYS[u].length` — the five SHARED keys satisfy
      // any plain floor, so a universe whose own keys were all deleted passed.
      // Measured: removing all four of `national`'s left the suite 14/14 green,
      // and with it the both-numbers rule untested for НЦОЗА's own family.
      const own = ownKeys(u);
      expect(
        own.length,
        `universe "${u}" carries no keys of its own`,
      ).toBeGreaterThan(2);
      // BOTH GRAMMATICAL NUMBERS. latinSkeleton folds „център"→tsentar and
      // „центрове"→tsentrove and neither contains the other, so a plural-only set
      // misses the register's own singular — the defect this file exists to pin.
      const bgOwn = own.filter((k) => /[а-я]/i.test(k));
      const singular = bgOwn.filter((k) => !/[иy]\s*$|и\b/.test(k));
      expect(
        bgOwn.length,
        `universe "${u}" has no Bulgarian keys`,
      ).toBeGreaterThan(1);
      expect(
        singular.length,
        `universe "${u}" carries no singular form`,
      ).toBeGreaterThan(0);
      // TEST-002: and an English reader must reach the family too. Removing all
      // eight English keys also left the suite green.
      const enOwn = own.filter((k) => /^[a-z ]+$/i.test(k));
      expect(
        enOwn.length,
        `universe "${u}" has no English keys`,
      ).toBeGreaterThan(1);
    }
    // Every universe is populated. A universe with no members is a label and a
    // key set doing nothing, and — since the roster is the only enumeration of
    // this family — a sign the rows were dropped rather than the universe.
    for (const u of UNIVERSES)
      expect(
        MZ_SECOND_LEVEL_BODIES.filter((b) => b.universe === u).length,
        `universe "${u}" has no members`,
      ).toBeGreaterThan(0);
  });

  it("keeps the search keys out of the DISPLAY label", () => {
    // The two were ONE string once and merging them broke both halves: the label
    // grew to 66 characters repeating the group heading on every row, and before
    // that a clean label matched none of the queries below.
    //
    // ⚠ Only ONE direction is assertable, and it is not the obvious one. By the
    // fold search actually uses, „Центрове за спешна медицинска помощ" and its
    // lowercase key are the SAME string, so „the label is not among the keys" is
    // false by design and a string comparison only passed on a capital letter.
    // What must stay true is the direction that regressed: the label is a short
    // display string, and it does not carry the group heading the row already
    // sits under.
    for (const u of UNIVERSES) {
      for (const lang of ["bg", "en"] as const) {
        const label = MZ_UNIVERSE_LABEL[u][lang];
        expect(
          label.length,
          `${u}.${lang} label is long enough to be a key set, not a sub-line`,
        ).toBeLessThan(50);
        expect(
          latinSkeleton(label),
          `${u}.${lang} label repeats the group heading`,
        ).not.toContain(latinSkeleton("Ведомства на МЗ"));
      }
    }
  });
});

describe("MZ_SECOND_LEVEL_BODIES — retired EIKs and the institution count", () => {
  it("points every retired row at a live row in this same list", () => {
    const retired = MZ_SECOND_LEVEL_BODIES.filter((b) => b.retiredEikOf);
    expect(retired.length).toBe(2);
    for (const b of retired) {
      const successor = MZ_SECOND_LEVEL_BODIES.find(
        (x) => x.eik === b.retiredEikOf,
      );
      // Without this, MZ_SECOND_LEVEL_INSTITUTION_COUNT silently under-reports:
      // a retired row whose successor is absent subtracts an institution that
      // nothing else in the list represents. Five РЗИ are already omitted for
      // having no procurement, so this is a live possibility, not a hypothetical.
      expect(successor, `${b.eik} points at a missing EIK`).toBeTruthy();
      expect(
        successor?.retiredEikOf,
        `${b.eik} points at another retired row`,
      ).toBeUndefined();
      // „до YYYY" is the ONLY thing distinguishing a predecessor from its
      // successor in a dropdown; without it the two read as one institution
      // listed twice.
      expect(b.name, `${b.eik} carries no year`).toMatch(/до \d{4}/);
    }
  });

  it("counts institutions, not EIKs", () => {
    expect(MZ_SECOND_LEVEL_INSTITUTION_COUNT).toBe(53);
    expect(MZ_SECOND_LEVEL_BODIES.length).toBe(55);
    // The DERIVATION, not a `!==` between two numbers already pinned above —
    // that comparison cannot fail and so says nothing. This is what keeps the
    // count meaning "institutions" if the roster grows: the two must differ by
    // exactly the retired rows. Publishing 55 would name two institutions that
    // do not exist, and the numbers are close enough that nobody would notice.
    expect(
      MZ_SECOND_LEVEL_BODIES.length - MZ_SECOND_LEVEL_INSTITUTION_COUNT,
    ).toBe(MZ_SECOND_LEVEL_BODIES.filter((b) => b.retiredEikOf).length);
  });
});

describe("MZ_SECOND_LEVEL_BODIES — never a sector member", () => {
  // The roster exists so /sector/health can FIND these bodies. It must never
  // change what that sector COUNTS: the hub headline is НЗОК's payout on a
  // declared basis, and this family's €86.9m belongs to no total on that page.
  // Three copies of the sector's EIK-set, so all three are asserted.
  const overlaps = (other: readonly string[]) =>
    EIKS.filter((e) => other.includes(e));

  it("is disjoint from HEALTH_SECTOR_EIKS", () => {
    expect(overlaps(HEALTH_SECTOR_EIKS)).toEqual([]);
  });

  it("is disjoint from SECTOR_DASHBOARDS.health.members", () => {
    expect(
      overlaps(SECTOR_DASHBOARDS.health.members.map((m) => m.eik)),
    ).toEqual([]);
  });

  it("is disjoint from SECTOR_BROWSE_PACKS.nzok.eiks", () => {
    expect(overlaps(SECTOR_BROWSE_PACKS.nzok.eiks)).toEqual([]);
  });

  it("still discriminates — the check is not vacuous", () => {
    // Every assertion above passes trivially if the roster empties or the three
    // copies stop being read, which is the shape those assertions cannot see.
    expect(EIKS.length).toBeGreaterThan(50);
    expect(HEALTH_SECTOR_EIKS.length).toBe(2);
    expect(SECTOR_BROWSE_PACKS.nzok.eiks.length).toBeGreaterThan(0);
    // And the roster genuinely overlaps a set built the way a careless widening
    // would build one, so "disjoint" is a property of these lists rather than of
    // the comparison.
    expect(overlaps([...EIKS.slice(0, 3), ...HEALTH_SECTOR_EIKS])).toHaveLength(
      3,
    );
  });
});

describe("MZ_SECOND_LEVEL_BODIES — the queries a reader actually types", () => {
  // Built with the SAME `mzBodySearchKeys` the box passes, so the two cannot
  // DRIFT — it was a hand-copied second spread for a day, and a divergence there
  // would have reported 29 hits for a box that found fewer.
  //
  // ⚠ That closes drift, not OMISSION, and the difference is worth knowing before
  // trusting these numbers too far: this file imports the builder directly, so a
  // box that stopped CALLING it still leaves the suite green. Verified by
  // mutation — replacing the box's `mzBodySearchKeys` with `[b.name, b.eik]`
  // passes 14/14 here. Only NzokSearchBox.test.tsx, which renders the real
  // component, can catch that.
  const index = buildEntityIndex(
    MZ_SECOND_LEVEL_BODIES,
    (b) => ({
      id: b.eik,
      label: b.name,
      sub: MZ_UNIVERSE_LABEL[b.universe].bg,
      href: `/awarder/${b.eik}`,
    }),
    mzBodySearchKeys,
  );
  const hits = (q: string) => searchIndex(index, q, 200).length;

  it("finds every row it should for a family query", () => {
    // ⚠ THE SINGULAR IS THE LOAD-BEARING ONE. Every ЦСМП's awarder_name in the
    // corpus reads „Център за спешна медицинска помощ /ЦСМП/ - <place>", so this
    // is the string a reader pastes off a contract page — and with a plural-only
    // universe label it returned 0 of 29, reproducing the very „Няма съвпадения"
    // this roster exists to end. latinSkeleton folds „център"→tsentar and
    // „центрове"→tsentrove, and neither contains the other.
    expect(hits("център за спешна медицинска помощ")).toBe(sizeOf("csmp"));
    expect(hits("центрове за спешна медицинска помощ")).toBe(sizeOf("csmp"));
    expect(hits("инспекция")).toBe(sizeOf("rzi"));
    expect(hits("инспекции")).toBe(sizeOf("rzi"));
    // The ministry the group is named after; 1 of 55 before the shared keys.
    expect(hits("МЗ")).toBe(MZ_SECOND_LEVEL_BODIES.length);
    expect(hits("ведомства на МЗ")).toBe(MZ_SECOND_LEVEL_BODIES.length);
    // Non-vacuity: the two families are the bulk of the roster, so a reconcile
    // that emptied one would otherwise pass with both sides at 0.
    expect(sizeOf("csmp")).toBeGreaterThan(20);
    expect(sizeOf("rzi")).toBeGreaterThan(20);
  });

  it("finds the capital, whose fold is the one place transliteration fails", () => {
    // „София" folds to sofiya. СРЗИ — the family's largest РЗИ — carried no form
    // of the city's name and was unreachable by it.
    //
    // ⚠ THIS NUMBER ENCODES A NEGATIVE, so read the assertion before "fixing" a
    // failure at 3. „ЦСМП — Софийска област" folds to sofiyska and does NOT match
    // sofiya, which is a gap somebody may reasonably close one day — and when
    // they do, this goes to 3 and reads exactly like a regression. Name the rows
    // rather than the count, so the diff says which body appeared.
    expect(
      searchIndex(index, "София", 200)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["121292046", "176034554"]);
    expect(hits("РЗИ София")).toBe(1);
  });

  it("finds the body whose failed search motivated the roster", () => {
    const [row] = searchIndex(index, "обществено здраве", 10);
    expect(row?.href).toBe("/awarder/176094665");
    expect(searchIndex(index, "НЦОЗА", 10)[0]?.href).toBe("/awarder/176094665");
  });

  it("still discriminates — a plural-only key set fails the singular", () => {
    // Mutation check. Without it, every assertion above is satisfied by an
    // implementation that dropped the singular, since a reader typing the plural
    // still gets 29 and nothing in the numbers says which spelling was matched.
    const plod = buildEntityIndex(
      MZ_SECOND_LEVEL_BODIES,
      (b) => ({ id: b.eik, label: b.name, href: `/awarder/${b.eik}` }),
      (b) => [
        b.name,
        b.eik,
        ...MZ_UNIVERSE_SEARCH_KEYS[b.universe].filter(
          (k) => !k.startsWith("център за") && !k.startsWith("регионална"),
        ),
      ],
    );
    expect(searchIndex(plod, "център за спешна медицинска помощ", 200)).toEqual(
      [],
    );
    // Not 0 — 1. „Столична регионална здравна инспекция" carries the singular in
    // its OWN name, so СРЗИ survives the mutation on the name key while the other
    // 24 РЗИ vanish. That asymmetry is the point: 1 of 25 is what a reader saw
    // before the singular was added, and it is why „it returns something" was
    // never evidence the family was findable.
    expect(searchIndex(plod, "регионална здравна инспекция", 200)).toHaveLength(
      1,
    );
  });

  it("offers no row that cannot land", () => {
    // membersIndex RULE 1, restated where this index is actually built: a result
    // whose keys all fold to "" is dropped silently, so assert the drop is zero
    // rather than discovering a missing body by its absence from a dropdown.
    expect(index.dropped).toBe(0);
    expect(index.rows).toHaveLength(MZ_SECOND_LEVEL_BODIES.length);
    // Every roster EIK reaches the dropdown. Asserting the href SHAPE would only
    // re-check this test's own template literal; asserting the SET is what
    // catches a body silently folded away by buildEntityIndex.
    expect(new Set(index.rows.map((r) => r.href))).toEqual(
      new Set(MZ_SECOND_LEVEL_BODIES.map((b) => `/awarder/${b.eik}`)),
    );
  });
});
