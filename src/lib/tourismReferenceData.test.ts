// Invariants of the МТ roster and of the curated state-body list beside it — the
// network-free half of the 2026-08-20 audit's regression net
// (docs/plans/tourism-sector-audit-v1.md). The corpus arms live in
// scripts/db/tests/sector_stats_tourism.data.test.ts; everything here needs no
// database, so it runs in the ordinary unit suite and guards the list from the
// moment it ships rather than from the moment Postgres is up.
//
//   npx vitest run src/lib/tourismReferenceData.test.ts
//
// The last test is the one with reach beyond this sector. There is no shared
// ownership registry behind the four *_STATE_BODY_CONTRACTORS lists — 20 entries
// over 16 distinct EIKs, four of them in more than one list — so their agreement
// on a shared EIK is maintained by hand. `administrationReferenceData.test.ts`
// holds that for its own overlap with social; this generalises it to all four, so
// a sector cannot start describing a company the other three already describe.

import { describe, it, expect } from "vitest";
import {
  TOURISM_MINISTRY_EIK,
  TOURISM_SECTOR_EIKS,
  TOURISM_STATE_BODY_CONTRACTORS,
  TOURISM_AWARDER_PATH,
} from "./tourismReferenceData";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { SOCIAL_STATE_BODY_CONTRACTORS } from "./socialReferenceData";
import { SECURITY_STATE_BODY_CONTRACTORS } from "./securityReferenceData";
import { ADMIN_STATE_BODY_CONTRACTORS } from "./administrationReferenceData";

describe("МТ roster", () => {
  it("is the ministry alone, as a plain 9- or 13-digit EIK", () => {
    expect(TOURISM_SECTOR_EIKS).toEqual([TOURISM_MINISTRY_EIK]);
    expect(TOURISM_MINISTRY_EIK).toMatch(/^(\d{9}|\d{13})$/);
    expect(TOURISM_AWARDER_PATH).toBe(`/awarder/${TOURISM_MINISTRY_EIK}`);
  });

  it("keeps the three EIK-set copies in lockstep", () => {
    // The drift tripwire. All three derive from this file today; the assertion is
    // what stops a future edit re-hardcoding one of them.
    const members = SECTOR_DASHBOARDS.tourism.members.map((m) => m.eik);
    const pack = SECTOR_BROWSE_PACKS.tourism.eiks;
    expect(new Set(members)).toEqual(new Set(TOURISM_SECTOR_EIKS));
    expect(new Set(pack)).toEqual(new Set(TOURISM_SECTOR_EIKS));
  });

  it("covers every roster EIK in the dashboard members list", () => {
    // `members` is built from the SCALAR TOURISM_MINISTRY_EIK because it carries
    // per-EIK display names, so widening TOURISM_SECTOR_EIKS does NOT widen it.
    // At one member the copies agree and the lockstep test above passes either
    // way; this is the arm that fails when a second roster member is added here
    // and not there.
    const members = new Set(
      SECTOR_DASHBOARDS.tourism.members.map((m) => m.eik),
    );
    for (const e of TOURISM_SECTOR_EIKS)
      expect(
        members.has(e),
        `${e} is in TOURISM_SECTOR_EIKS but not in SECTOR_DASHBOARDS.tourism.members`,
      ).toBe(true);
  });
});

describe("TOURISM_STATE_BODY_CONTRACTORS", () => {
  it("holds plain, deduped 9- or 13-digit EIKs", () => {
    // Curated by hand, so a typo is the failure mode — and a typo'd digit is
    // still a well-formed EIK, which is why the corpus-side gate exists too.
    const list = TOURISM_STATE_BODY_CONTRACTORS;
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list).size).toBe(list.length);
    for (const e of list) expect(e, e).toMatch(/^(\d{9}|\d{13})$/);
  });

  it("names no roster member — a member is a buyer, not a supplier", () => {
    // The tile drops a listed EIK from `stateBodies` when it is also a member, in
    // favour of the more specific „в групата" badge, so an entry in both places
    // is a silently unused one.
    for (const e of TOURISM_STATE_BODY_CONTRACTORS)
      expect(TOURISM_SECTOR_EIKS, e).not.toContain(e);
  });

  it("carries the two entries admitted below the rank bar", () => {
    // Both are invisible on this page's own leaderboard (best ranks 10 and 14),
    // so nothing about the rendered output would notice their removal. They are
    // here for cross-page consistency — Топлофикация София because security and
    // social already badge it, БНР because its twin БНТ is badged on this very
    // list — and that is only enforceable by naming them.
    expect(TOURISM_STATE_BODY_CONTRACTORS).toContain("831609046");
    expect(TOURISM_STATE_BODY_CONTRACTORS).toContain("000672343");
  });

  it("agrees with every sibling state-body list on each shared EIK", () => {
    // Not vacuous by accident: assert the overlap exists before asserting over it.
    const siblings: Record<string, readonly string[]> = {
      social: SOCIAL_STATE_BODY_CONTRACTORS,
      security: SECURITY_STATE_BODY_CONTRACTORS,
      administration: ADMIN_STATE_BODY_CONTRACTORS,
    };
    const shared = new Set<string>();
    for (const list of Object.values(siblings))
      for (const e of list)
        if (TOURISM_STATE_BODY_CONTRACTORS.includes(e)) shared.add(e);
    // БНТ (social) and Топлофикация София (security + social) are the two МТ
    // contractors that any sibling page badges. If this shrinks, either a sibling
    // dropped an entry or this list did — both worth a look.
    expect([...shared].sort()).toEqual(["000672350", "831609046"]);
  });
});
