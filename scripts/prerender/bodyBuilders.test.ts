// The prerendered /procurement/settlement/{ekatte} body must NAME ITS OWN SCOPE.
//
// The figures baked in here come from procurement_by_settlement(NULL, NULL) — the whole
// corpus — but the live page defaults to the selected parliament's window (?pscope). A
// static page cannot track a URL parameter, so the only honest option is to say which
// period it is quoting. Without that, the text Google indexes states a total that no
// default view of the page displays, and a reader arriving from search sees a smaller
// number and reads it as a contradiction.
//
// The instruction it gives ("pick X") names a real button, so the label is pinned against
// the locale bundle the button actually renders from — a rename there would otherwise
// leave the prerendered HTML telling readers to click something that no longer exists.

import { describe, it, expect } from "vitest";
import {
  buildProcurementSettlementBody,
  SCOPE_ALL_YEARS_LABEL,
} from "./bodyBuilders";
import bg from "../../src/locales/bg/translation.json";
import en from "../../src/locales/en/translation.json";

const varna = {
  name: "Варна",
  province: "Варна",
  contractCount: 15079,
  totalEur: 3622680723,
  awarderCount: 112,
};

describe("buildProcurementSettlementBody", () => {
  it("states that the figures cover all years, in both languages", () => {
    expect(buildProcurementSettlementBody("bg", varna)).toContain(
      "за целия период",
    );
    expect(buildProcurementSettlementBody("en", varna)).toContain(
      "across all years on record",
    );
  });

  it("says the page defaults to a NARROWER window", () => {
    // Naming the scope is only half of it: without this clause the reader has no reason
    // to expect the on-screen number to differ at all.
    expect(buildProcurementSettlementBody("bg", varna)).toContain(
      "текущия парламент",
    );
    expect(buildProcurementSettlementBody("en", varna)).toContain(
      "current parliament",
    );
  });

  it("quotes the EXACT label ScopeControl renders", () => {
    // The one assertion that couples this static string to the running UI. If
    // `procurement_scope_all_years` is ever reworded, this fails here rather than
    // shipping HTML that points at a button by the wrong name.
    expect(SCOPE_ALL_YEARS_LABEL.bg).toBe(
      (bg as Record<string, string>).procurement_scope_all_years,
    );
    expect(SCOPE_ALL_YEARS_LABEL.en).toBe(
      (en as Record<string, string>).procurement_scope_all_years,
    );
    expect(buildProcurementSettlementBody("bg", varna)).toContain(
      `„${SCOPE_ALL_YEARS_LABEL.bg}“`,
    );
    expect(buildProcurementSettlementBody("en", varna)).toContain(
      `“${SCOPE_ALL_YEARS_LABEL.en}”`,
    );
  });

  it("still carries the three figures the body is built from", () => {
    const out = buildProcurementSettlementBody("bg", varna);
    expect(out).toContain("15 079");
    expect(out).toContain("112");
    expect(out).toContain("Варна");
  });

  it("appends the province only when it differs from the settlement", () => {
    const sofia = { ...varna, name: "София", province: "София (столица)" };
    expect(buildProcurementSettlementBody("bg", sofia)).toContain(
      "София, София (столица)",
    );
    // Варна in Варна must not read "Варна, Варна".
    expect(buildProcurementSettlementBody("bg", varna)).not.toContain(
      "Варна, Варна",
    );
  });

  it("escapes the place name rather than interpolating it raw", () => {
    const evil = { ...varna, name: "<script>alert(1)</script>", province: "x" };
    const out = buildProcurementSettlementBody("bg", evil);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});
