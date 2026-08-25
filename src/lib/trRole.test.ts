// `trRoleList` names in one place a pattern that was hand-copied across several call
// sites, and the two shapes it accepts come from different Postgres functions — a comma
// STRING (`tr_officers.roles`, `connection_between`'s `a_roles`/`b_roles`) and an ARRAY
// (`person_by_slug` in 082, `place_mp_companies` in 151). Those are not interchangeable
// in JS, so a helper that silently mishandled one would leave the surfaces reading that
// shape rendering raw English codes to a Bulgarian reader — the defect it was written to
// end. The array branch has no production caller yet, which is exactly why it is tested:
// nothing else would notice if it broke before its first consumer migrated onto it.
//
// The empty-input asymmetry with `trRoleLabel` ("" vs "—") is deliberate and pinned here,
// because it looks like an inconsistency and reverting it would put an em dash inside a
// joined list, where it reads as a role rather than as "no value".

import { describe, it, expect } from "vitest";
import { trRoleLabel, trRoleList } from "./trRole";

/** Stands in for i18next: translates the two codes we "have keys for", echoes the key
 *  back for everything else — exactly what i18next does on a miss, which is what the
 *  raw-code fallback keys off. */
const t = (k: string): string =>
  ({ tr_role_manager: "управител", tr_role_partner: "съдружник" })[k] ?? k;

describe("trRoleLabel", () => {
  it("translates a known code", () => {
    expect(trRoleLabel("manager", t)).toBe("управител");
  });

  it("falls back to the raw code when no key exists", () => {
    // The fallback is why an untranslated code reaches a reader at all — it is a
    // deliberate degrade, not a bug, but it means adding a code without a key is silent.
    expect(trRoleLabel("liquidator", t)).toBe("liquidator");
  });

  it("renders an em dash for no role", () => {
    expect(trRoleLabel(null, t)).toBe("—");
    expect(trRoleLabel("", t)).toBe("—");
  });
});

describe("trRoleList", () => {
  it("splits and translates a comma STRING", () => {
    expect(trRoleList("manager,partner", t)).toBe("управител, съдружник");
  });

  it("translates an ARRAY", () => {
    expect(trRoleList(["manager", "partner"], t)).toBe("управител, съдружник");
  });

  it("trims whitespace around each code", () => {
    // Postgres string_agg output is not guaranteed tight, and `tr_role_ manager` is a
    // miss — which degrades to the raw code, i.e. an English word on the page.
    expect(trRoleList("manager, partner", t)).toBe("управител, съдружник");
  });

  it("keeps untranslated codes rather than dropping them", () => {
    expect(trRoleList("manager,liquidator", t)).toBe("управител, liquidator");
  });

  it("drops empty segments from a trailing or doubled comma", () => {
    expect(trRoleList("manager,", t)).toBe("управител");
    expect(trRoleList("manager,,partner", t)).toBe("управител, съдружник");
  });

  it("returns an EMPTY STRING for no roles, never an em dash", () => {
    // Not `trRoleLabel`'s "—": this value is joined into a sentence, where a dash would
    // read as a role. The caller decides whether to render the field at all.
    expect(trRoleList(null, t)).toBe("");
    expect(trRoleList(undefined, t)).toBe("");
    expect(trRoleList("", t)).toBe("");
    expect(trRoleList([], t)).toBe("");
    expect(trRoleList(",", t)).toBe("");
  });
});
