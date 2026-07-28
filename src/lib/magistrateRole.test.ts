import { describe, it, expect } from "vitest";
import { magistrateRoleKey } from "./magistrateRole";

describe("magistrateRoleKey", () => {
  it("labels each judicial kind", () => {
    expect(magistrateRoleKey("court", "rs-plovdiv")).toBe("mag_role_judge");
    expect(magistrateRoleKey("prosecution", "op-burgas")).toBe(
      "mag_role_prosecutor",
    );
    expect(magistrateRoleKey("investigation", "nsls")).toBe(
      "mag_role_investigator",
    );
  });

  it("splits the two councils by body, since kind cannot", () => {
    // Both are kind='council', but a ВСС member is not an ИВСС inspector.
    expect(magistrateRoleKey("council", "vss")).toBe("mag_role_vss");
    expect(magistrateRoleKey("council", "ivss")).toBe("mag_role_inspector");
  });

  it("prefers the body over the kind", () => {
    expect(magistrateRoleKey("court", "vss")).toBe("mag_role_vss");
  });

  it("returns null rather than guessing", () => {
    // 394 magistrates name no institution and ~35 spellings stay unclassified; both
    // must fall through to the generic label instead of being assigned a role.
    expect(magistrateRoleKey(null, null)).toBeNull();
    expect(magistrateRoleKey(undefined, undefined)).toBeNull();
    expect(magistrateRoleKey("council", "unknown-body")).toBeNull();
  });
});
