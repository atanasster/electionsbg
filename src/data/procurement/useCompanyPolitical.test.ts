// Unit tests for the political-links hook's two pure predicates.
//
// `hasUnavailableArm` / `companyPoliticalVerdict` are the whole defence against the defect the
// plan exists to delete: /company/175155542 printed «Няма установени връзки с политици.» about
// an NGO chaired by a former Deputy PM, because the tile asked `links.length === 0` — a question
// that cannot tell "every arm answered and found nobody" from "we could not look". These are
// pure functions of one argument, so the invariant is cheap to pin exactly.

import { describe, it, expect } from "vitest";
import {
  hasUnavailableArm,
  companyPoliticalVerdict,
  type CompanyPolitical,
  type ArmState,
} from "./useCompanyPolitical";

const payload = (over: Partial<CompanyPolitical> = {}): CompanyPolitical => ({
  eik: "831192122",
  name: null,
  direct: [],
  bridged: [],
  directCount: 0,
  bridgedCount: 0,
  directTruncated: false,
  bridgedTruncated: false,
  bridgedSuppressedAsDirect: 0,
  bridgeMaxCompanies: 25,
  bridgeFoldsSuppressed: 0,
  arms: { pg: "absent", funds: "absent", personLayer: "absent" },
  ...over,
});

const withArms = (
  arms: Partial<Record<keyof CompanyPolitical["arms"], ArmState>>,
) =>
  payload({
    arms: { pg: "absent", funds: "absent", personLayer: "absent", ...arms },
  });

describe("hasUnavailableArm", () => {
  it("treats an absent payload as unknown, not as empty", () => {
    // Covers React Query's loading AND error states, a disabled query, a 404 from a route that
    // is not deployed yet, and a malformed EIK (the route answers 200 with a null body).
    expect(hasUnavailableArm(null)).toBe(true);
    expect(hasUnavailableArm(undefined)).toBe(true);
  });

  it("treats a body with no arms as unknown", () => {
    const noArms = {
      ...payload(),
      arms: undefined,
    } as unknown as CompanyPolitical;
    expect(hasUnavailableArm(noArms)).toBe(true);
  });

  it("is false only when every arm actually answered", () => {
    expect(hasUnavailableArm(payload())).toBe(false);
    expect(
      hasUnavailableArm(withArms({ pg: "ok", funds: "ok", personLayer: "ok" })),
    ).toBe(false);
  });

  it("fires for ANY unavailable arm, not just the person layer", () => {
    // One arm per assertion: an implementation that checked only `personLayer` would still pass
    // a test that flipped all three at once.
    expect(hasUnavailableArm(withArms({ pg: "unavailable" }))).toBe(true);
    expect(hasUnavailableArm(withArms({ funds: "unavailable" }))).toBe(true);
    expect(hasUnavailableArm(withArms({ personLayer: "unavailable" }))).toBe(
      true,
    );
  });
});

describe("companyPoliticalVerdict", () => {
  it("returns unknown — with the reason — rather than 'none' when we could not look", () => {
    expect(companyPoliticalVerdict(null)).toEqual({
      state: "unknown",
      reason: "no-payload",
    });
    expect(
      companyPoliticalVerdict(withArms({ personLayer: "unavailable" })),
    ).toEqual({
      state: "unknown",
      reason: "arm-unavailable",
    });
  });

  it("NEVER returns 'none' while an arm is unavailable, even with zero links", () => {
    // The exact shape of the shipped defect: no rows AND no working corpus. `none` here would
    // license the denial.
    const v = companyPoliticalVerdict(
      withArms({
        pg: "unavailable",
        funds: "unavailable",
        personLayer: "unavailable",
      }),
    );
    expect(v.state).toBe("unknown");
  });

  it("returns 'none' only when every arm answered and found nobody", () => {
    const v = companyPoliticalVerdict(
      withArms({ pg: "ok", funds: "absent", personLayer: "absent" }),
    );
    expect(v).toEqual({
      state: "none",
      searched: { registryRoles: true, bridgeComplete: true },
    });
  });

  it("reports an incomplete bridge, so a refusal is not published as an absence", () => {
    const v = companyPoliticalVerdict(payload({ bridgeFoldsSuppressed: 3 }));
    expect(v).toEqual({
      state: "none",
      searched: { registryRoles: true, bridgeComplete: false },
    });
  });

  it("returns 'links' when either array has rows", () => {
    const direct = [
      {
        arm: "person_layer" as const,
        slug: "mp-2829",
        href: "/person/mp-2829",
        name: "К",
        kind: "mp" as const,
      },
    ];
    expect(companyPoliticalVerdict(payload({ direct }))).toMatchObject({
      state: "links",
      direct,
    });

    // Bridged-only must still be "links" — it is a real answer, just a second-degree one.
    const bridged = [
      {
        slug: "mp-1",
        name: "Х",
        office: null,
        officeSource: null,
        officeRole: null,
        bridgeName: null,
        bridgeCompanies: 2,
        viaEik: "1",
        viaCompany: null,
        pathCount: 1,
      },
    ];
    expect(companyPoliticalVerdict(payload({ bridged }))).toMatchObject({
      state: "links",
      bridged,
    });
  });
});
