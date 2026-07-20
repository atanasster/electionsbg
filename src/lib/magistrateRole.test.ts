import { describe, it, expect } from "vitest";
import { magistrateRoleKey } from "./magistrateRole";

describe("magistrateRoleKey", () => {
  it("maps courts → judge", () => {
    expect(magistrateRoleKey("Апелативен съд Велико Търново")).toBe(
      "mag_role_judge",
    );
    expect(magistrateRoleKey("Районен съд - Пловдив")).toBe("mag_role_judge");
    expect(magistrateRoleKey("РС Пловдив")).toBe("mag_role_judge");
    expect(magistrateRoleKey("АССГ")).toBe("mag_role_judge");
    expect(magistrateRoleKey("ВКС")).toBe("mag_role_judge");
  });

  it("maps prosecutor's offices → prosecutor", () => {
    expect(magistrateRoleKey("Окръжна прокуратура Бургас")).toBe(
      "mag_role_prosecutor",
    );
    expect(magistrateRoleKey("СГП")).toBe("mag_role_prosecutor");
    expect(magistrateRoleKey("ВОП-София")).toBe("mag_role_prosecutor");
    expect(magistrateRoleKey("РП–Сливен")).toBe("mag_role_prosecutor");
  });

  it("maps investigation offices → investigator (even when under a prosecutor's office)", () => {
    expect(magistrateRoleKey("НСлС")).toBe("mag_role_investigator");
    expect(magistrateRoleKey("ОСлО при ОП-Видин")).toBe(
      "mag_role_investigator",
    );
    expect(magistrateRoleKey("СО-СГП")).toBe("mag_role_investigator");
  });

  it("disambiguates the SJC / inspectorate (they contain 'съд' but aren't a court seat)", () => {
    expect(magistrateRoleKey("Висш съдебен съвет")).toBe("mag_role_vss");
    expect(magistrateRoleKey("ВСС")).toBe("mag_role_vss");
    expect(magistrateRoleKey("Инспекторат към ВСС")).toBe("mag_role_inspector");
  });

  it("returns null for empty / unclassifiable input (→ generic label)", () => {
    expect(magistrateRoleKey("")).toBe(null);
    expect(magistrateRoleKey(null)).toBe(null);
    expect(magistrateRoleKey(undefined)).toBe(null);
  });
});
