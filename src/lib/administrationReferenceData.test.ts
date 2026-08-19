// Guards the two hand-maintained facts in administrationReferenceData.ts that
// have no other net: WHO is in the e-gov group, and whether the ministry
// display-name map actually resolves.
//
// The `context.json` arm is the one that earns its place. MINISTRY_NAMES shipped
// with all NINE of its keys carrying an extra definite article
// (`admin-ministerstvoto-na-…` against the artifact's `admin-ministerstvo-na-…`),
// so not one ever fired: `ministryName()` fell through to the slug prettifier and
// the „Разход за персонал на щат" tile rendered transliterated Latin on a
// Bulgarian page („ministerstvo na turizma") for every row. Nothing failed — a
// lookup table that always misses degrades instead of erroring, which is exactly
// the shape no type or lint check can see.

import { describe, it, expect } from "vitest";
import context from "../../data/administration/context.json";
import { SOCIAL_STATE_BODY_CONTRACTORS } from "./socialReferenceData";
import {
  ADMIN_ENTITIES,
  ADMIN_STATE_BODY_CONTRACTORS,
  ADMIN_SECTOR_EIKS,
  ADMIN_GROUP_EIK,
  ESMIS_EIK,
  MEU_EIK,
  MINISTRY_NAMES,
  ministryName,
} from "./administrationReferenceData";

/** The prettifier `ministryName` falls back to. Written out rather than imported
 *  so a change to the fallback cannot make the assertions below vacuous. */
const prettified = (id: string) => id.replace(/^admin-/, "").replace(/-/g, " ");

const adminIdsInContext = (): string[] => {
  const ids = new Set<string>();
  for (const rows of Object.values(
    context.costByYear as Record<string, Array<{ adminId: string }>>,
  ))
    for (const r of rows) ids.add(r.adminId);
  return [...ids].sort();
};

describe("administrationReferenceData — the e-gov member set", () => {
  it("ADMIN_SECTOR_EIKS is derived from ADMIN_ENTITIES, so the two cannot drift", () => {
    expect(ADMIN_SECTOR_EIKS).toEqual(ADMIN_ENTITIES.map((e) => e.eik));
    expect(new Set(ADMIN_SECTOR_EIKS).size).toBe(ADMIN_SECTOR_EIKS.length);
  });

  it("the lead is first and is the group anchor", () => {
    expect(ADMIN_SECTOR_EIKS[0]).toBe(ADMIN_GROUP_EIK);
    expect(ADMIN_GROUP_EIK).toBe(MEU_EIK);
  });

  // ЕСМИС was missing until 2026-08-19 and nothing reported it: the hub headline
  // is headcount so it could not move, and every other figure reconciled. The
  // only symptom was the spend chart starting at 2017. A later "cleanup" that
  // drops the predecessor must fail here rather than silently restore that.
  it("keeps the ЕСМИС predecessor in the group", () => {
    expect(ADMIN_SECTOR_EIKS).toContain(ESMIS_EIK);
  });

  it("every member is a plain 9/13-digit EIK — no synthetic carrier", () => {
    for (const eik of ADMIN_SECTOR_EIKS) expect(eik).toMatch(/^\d{9}(\d{4})?$/);
  });

  // A chip is rendered verbatim to readers, so an empty one is a blank pill.
  it("every entity carries both languages for name and role", () => {
    for (const e of ADMIN_ENTITIES)
      for (const v of [e.name.bg, e.name.en, e.role.bg, e.role.en])
        expect(v.trim().length).toBeGreaterThan(0);
  });

  // The corpus floor is 2011 for every awarder, so a span is "years we hold a
  // contract for" and never a tenure. Saying so is the header's job; what this
  // pins is that no chip states a bare range, which is what reads as one.
  it("no role chip states a bare year range", () => {
    for (const e of ADMIN_ENTITIES)
      for (const role of [e.role.bg, e.role.en])
        if (/\d{4}\s*[–-]\s*\d{4}/.test(role))
          expect(role).toMatch(/поръчки|contracts/);
  });
});

describe("administrationReferenceData — ministry display names", () => {
  it("every MINISTRY_NAMES key resolves to a real name, not the prettifier", () => {
    const dead = Object.keys(MINISTRY_NAMES).filter(
      (k) => ministryName(k, true) === prettified(k),
    );
    expect(dead).toEqual([]);
  });

  // The tripwire: the map is keyed on slugs produced by build_context.ts, and
  // nothing else checks that the two agree.
  it("every adminId in the committed context.json is mapped", () => {
    const unmapped = adminIdsInContext().filter(
      (id) => !(id in MINISTRY_NAMES),
    );
    expect(unmapped).toEqual([]);
  });

  it("the artifact is non-empty, so the tripwire cannot pass vacuously", () => {
    expect(adminIdsInContext().length).toBeGreaterThan(0);
  });

  it("falls back to a prettified slug for an id it does not know", () => {
    expect(ministryName("admin-ministerstvo-na-nesashtestvuvashto", true)).toBe(
      "ministerstvo na nesashtestvuvashto",
    );
  });
});

describe("administrationReferenceData — public-body contractors", () => {
  it("carries „Информационно обслужване“ АД, the group's #1 contractor", () => {
    expect(ADMIN_STATE_BODY_CONTRACTORS).toContain("831641791");
  });

  // The same company is a top contractor to BOTH sectors, and a reader must not
  // meet it chipped „държавно" on /sector/social and bare on
  // /sector/administration. The header claims the two lists are kept in step;
  // this is what makes that an invariant rather than an intention.
  it("agrees with the social list on every EIK the two share", () => {
    const social = new Set(SOCIAL_STATE_BODY_CONTRACTORS);
    const shared = ADMIN_STATE_BODY_CONTRACTORS.filter((e) => social.has(e));
    expect(shared).toContain("831641791");
  });

  it("is curated by EIK, never by name — every entry is a plain EIK", () => {
    for (const eik of ADMIN_STATE_BODY_CONTRACTORS)
      expect(eik).toMatch(/^\d{9}(\d{4})?$/);
  });

  // The „is this contractor an awarder somewhere" probe returns these two
  // private gas distributors alongside ИО, because ЗОП's utilities regime makes
  // regulated private companies contracting authorities. Curating from that
  // probe would label them „държавно" — the anti-allowlist, pinned by EIK.
  it("excludes the private regulated utilities that probe over-captures", () => {
    for (const eik of ["130203228", "107063552"])
      expect(ADMIN_STATE_BODY_CONTRACTORS).not.toContain(eik);
  });

  it("never labels a member as an outside public body", () => {
    for (const eik of ADMIN_STATE_BODY_CONTRACTORS)
      expect(ADMIN_SECTOR_EIKS).not.toContain(eik);
  });
});
