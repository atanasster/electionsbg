import { describe, expect, it } from "vitest";
import { restoreTruncatedName } from "./restore_name";

describe("restoreTruncatedName", () => {
  it("restores a cut name from the registry name of the same EIK", () => {
    expect(
      restoreTruncatedName(
        "Фонд мениджър на финансови инструме",
        "Фонд мениджър на финансови инструменти в България",
      ),
    ).toBe("Фонд мениджър на финансови инструменти в България");
  });

  it("matches across dropped quotes, hyphens and case, decoding entities", () => {
    expect(
      restoreTruncatedName(
        "Народно читалище Отец Паисий - 1919",
        "НАРОДНО ЧИТАЛИЩЕ &quot;ОТЕЦ ПАИСИЙ - 1919&quot; - с. ЛОЗЕН",
      ),
    ).toBe('НАРОДНО ЧИТАЛИЩЕ "ОТЕЦ ПАИСИЙ - 1919" - с. ЛОЗЕН');
  });

  it("refuses a registry name worded differently", () => {
    expect(
      restoreTruncatedName(
        "Народно читалище Владимир Маяковски",
        "ВЛАДИМИР МАЯКОВСКИ - 1937",
      ),
    ).toBeNull();
  });

  it("leaves names under the source cap alone", () => {
    expect(
      restoreTruncatedName("АГРО ООД", "АГРО ООД - КЛОН ПЛОВДИВ"),
    ).toBeNull();
  });

  it("refuses when the registry adds nothing, or is missing", () => {
    const n = "Народно читалище Отец Паисий - 1919";
    expect(
      restoreTruncatedName(n, "НАРОДНО ЧИТАЛИЩЕ ОТЕЦ ПАИСИЙ 1919"),
    ).toBeNull();
    expect(restoreTruncatedName(n, null)).toBeNull();
  });
});
