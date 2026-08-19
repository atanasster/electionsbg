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
  it("returns unknown — naming what was unreachable — rather than 'none'", () => {
    expect(companyPoliticalVerdict(null)).toEqual({
      state: "unknown",
      unavailable: "no-payload",
    });
    expect(
      companyPoliticalVerdict(withArms({ personLayer: "unavailable" })),
    ).toEqual({ state: "unknown", unavailable: ["person_layer"] });
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

  // ⚠️ THE MIRROR IMAGE OF THE ORIGINAL DEFECT. Testing "is any arm unavailable" BEFORE testing
  // for rows looks like the cautious order, and it throws away links that were actually found —
  // printing «could not run» over real office-holders. Suppressing a true finding is not the safe
  // direction; it is the same failure pointed the other way.
  it("publishes links that WERE found even when another arm is down", () => {
    const direct = [
      {
        arm: "person_layer" as const,
        slug: "mp-2829",
        href: "/person/mp-2829",
        name: "К",
        kind: "mp" as const,
      },
    ];
    const v = companyPoliticalVerdict(
      payload({
        direct,
        arms: { pg: "unavailable", funds: "ok", personLayer: "ok" },
      }),
    );
    expect(v.state).toBe("links");
    expect(v).toMatchObject({ direct, unavailable: ["pg"] });
  });

  it("reports every unavailable arm, so a partial answer can say how partial", () => {
    expect(
      companyPoliticalVerdict(
        withArms({ pg: "unavailable", funds: "unavailable" }),
      ),
    ).toEqual({ state: "unknown", unavailable: ["pg", "funds"] });
  });

  it("returns 'none' only when every arm answered and found nobody", () => {
    const v = companyPoliticalVerdict(
      withArms({ pg: "ok", funds: "absent", personLayer: "absent" }),
    );
    expect(v).toEqual({ state: "none", bridgeComplete: true });
  });

  it("reports an incomplete bridge, so a refusal is not published as an absence", () => {
    const v = companyPoliticalVerdict(payload({ bridgeFoldsSuppressed: 3 }));
    expect(v).toEqual({ state: "none", bridgeComplete: false });
  });

  // ⚠️ THESE TWO ASSERT AGAINST THE SHIPPED FUNCTION, NOT THE SCALAR PREDICATE. The armless case
  // was covered only through `hasUnavailableArm`, which nothing ships — so deleting the guard in
  // `unavailableArms` flipped an armless payload from `unknown` to `none` (the printed denial)
  // and still passed 11/11. A test on the wrong function is not coverage.
  it("treats an arms-less payload as unknown, not as 'none'", () => {
    const armless = {
      ...payload(),
      arms: undefined,
    } as unknown as CompanyPolitical;
    expect(companyPoliticalVerdict(armless)).toEqual({
      state: "unknown",
      unavailable: ["pg", "funds", "person_layer"],
    });
  });

  it("keeps hasUnavailableArm and the verdict agreeing about a missing arms object", () => {
    const armless = {
      ...payload(),
      arms: undefined,
    } as unknown as CompanyPolitical;
    expect(hasUnavailableArm(armless)).toBe(true);
    expect(companyPoliticalVerdict(armless).state).toBe("unknown");
  });

  // Hard-coding `bridgeComplete: true` on the links branch passed the whole suite while claiming
  // a complete bridge for a payload with four suppressed folds.
  it("reports an incomplete bridge on the links state too, not only on none", () => {
    const direct = [
      {
        arm: "person_layer" as const,
        slug: "mp-1",
        href: "/person/mp-1",
        name: "К",
        kind: "mp" as const,
      },
    ];
    const v = companyPoliticalVerdict(
      payload({ direct, bridgeFoldsSuppressed: 4 }),
    );
    expect(v).toMatchObject({ state: "links", bridgeComplete: false });

    const clean = companyPoliticalVerdict(
      payload({ direct, bridgeFoldsSuppressed: 0 }),
    );
    expect(clean).toMatchObject({ state: "links", bridgeComplete: true });
  });

  it("reports no unavailable arms on a fully healthy payload", () => {
    const v = companyPoliticalVerdict(
      payload({
        direct: [
          {
            arm: "pg" as const,
            slug: "mp-1",
            href: "/candidate/mp-1",
            name: "Х",
            kind: "mp" as const,
          },
        ],
        arms: { pg: "ok", funds: "ok", personLayer: "ok" },
      }),
    );
    expect(v).toMatchObject({ state: "links", unavailable: [] });
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

    // Bridged-only must still be "links" — a real answer, just a second-degree one.
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
