// Category assignment for executive declarants.
//
// The register lumps the whole cabinet family into ONE category name, so the
// position title is the only thing that separates a minister from a deputy
// minister. Those titles were unavailable until the ingest started reading
// `Position > Name` instead of the non-existent `Position > Position`.
//
// Pure functions — `node` Vitest project, no network. Imported from
// ./categorise, NOT ./index: the latter runs its CLI at import time.

import { describe, expect, it } from "vitest";
import {
  categorise,
  isCaretakerTitle,
  isDeputyMinisterTitle,
  officeTitle,
} from "./categorise";

const CABINET_CATEGORY =
  "Министър-председател, заместник министър-председатели, министри и заместник-министри";
const GOVERNOR_CATEGORY = "Областни управители и заместник-областни управители";
const AGENCY_CATEGORY =
  "Председатели и зам. председатели на държавни агенции, председателите и членовете на държавни комисии, изпълнителните директори на изпълнителните агенции";

describe("isDeputyMinisterTitle", () => {
  it("recognises a deputy minister", () => {
    expect(isDeputyMinisterTitle("Заместник-министър")).toBe(true);
    expect(isDeputyMinisterTitle("заместник-министър")).toBe(true);
    expect(isDeputyMinisterTitle(" Заместник-министър ")).toBe(true);
    // The register is not perfectly consistent about the hyphen.
    expect(isDeputyMinisterTitle("Заместник министър")).toBe(true);
  });

  // The trap: a deputy PRIME minister is a cabinet member, and their title
  // starts with the same word.
  it("does not mistake a deputy prime minister for a deputy minister", () => {
    expect(isDeputyMinisterTitle("Заместник министър-председател")).toBe(false);
    expect(
      isDeputyMinisterTitle("Заместник министър-председател и министър"),
    ).toBe(false);
    expect(isDeputyMinisterTitle("Заместник-министър-председател")).toBe(false);
  });

  it("does not match the senior titles", () => {
    expect(isDeputyMinisterTitle("Министър")).toBe(false);
    expect(isDeputyMinisterTitle("Министър-председател")).toBe(false);
    expect(isDeputyMinisterTitle("Служебен министър-председател")).toBe(false);
    expect(isDeputyMinisterTitle(null)).toBe(false);
  });
});

describe("caretaker titles", () => {
  // Three consecutive caretaker cabinets served 2021-2024. Without this the
  // profile page said "Член на кабинета" for a caretaker minister and for a
  // regular one alike.
  it("recognises the Служебен modifier", () => {
    expect(isCaretakerTitle("Служебен министър")).toBe(true);
    expect(isCaretakerTitle("Служебен заместник-министър")).toBe(true);
    expect(isCaretakerTitle("Служебен министър-председател")).toBe(true);
    expect(isCaretakerTitle("Министър")).toBe(false);
    expect(isCaretakerTitle(null)).toBe(false);
  });

  it("strips the modifier to leave the office", () => {
    expect(officeTitle("Служебен заместник-министър")).toBe(
      "заместник-министър",
    );
    expect(officeTitle("Министър")).toBe("Министър");
    expect(officeTitle(null)).toBeNull();
  });

  // The miss this test exists for: a caretaker deputy minister used to fall
  // through to "cabinet" because the title starts with "Служебен", not
  // "Заместник".
  it("classifies a caretaker deputy minister as a deputy minister", () => {
    expect(isDeputyMinisterTitle("Служебен заместник-министър")).toBe(true);
    expect(categorise(CABINET_CATEGORY, "Служебен заместник-министър")).toBe(
      "deputy_minister",
    );
  });

  it("keeps a caretaker minister and caretaker PM in the cabinet bucket", () => {
    expect(categorise(CABINET_CATEGORY, "Служебен министър")).toBe("cabinet");
    expect(categorise(CABINET_CATEGORY, "Служебен министър-председател")).toBe(
      "cabinet",
    );
  });
});

describe("categorise", () => {
  it("splits deputy ministers out of the cabinet bucket", () => {
    expect(categorise(CABINET_CATEGORY, "Заместник-министър")).toBe(
      "deputy_minister",
    );
    expect(categorise(CABINET_CATEGORY, "Министър")).toBe("cabinet");
    expect(categorise(CABINET_CATEGORY, "Министър-председател")).toBe(
      "cabinet",
    );
    expect(categorise(CABINET_CATEGORY, "Служебен министър-председател")).toBe(
      "cabinet",
    );
    expect(categorise(CABINET_CATEGORY, "Заместник министър-председател")).toBe(
      "cabinet",
    );
  });

  // Until the position title is populated everywhere, an untitled cabinet row
  // must stay in the broader bucket rather than be guessed into a narrower one.
  it("keeps an untitled cabinet declarant in the cabinet bucket", () => {
    expect(categorise(CABINET_CATEGORY, null)).toBe("cabinet");
  });

  it("leaves non-cabinet categories alone regardless of title", () => {
    expect(categorise(GOVERNOR_CATEGORY, "Заместник-министър")).toBe(
      "regional_governor",
    );
    expect(categorise(AGENCY_CATEGORY, "Заместник-министър")).toBe(
      "agency_head",
    );
  });

  it("returns null for a category the executive ingest does not own", () => {
    expect(
      categorise("Народни представители", "Народен представител"),
    ).toBeNull();
    expect(
      categorise(
        "Кметове, и зам.-кметове на общини, кметовете и зам.-кметовете на райони",
        "Кмет",
      ),
    ).toBeNull();
  });

  // The register files budget-funded public institutions under the same ЗПФ
  // чл.13 ал.4 bucket as genuine state enterprises; the institution name is what
  // separates a school director from a state-enterprise manager.
  describe("budget-org institution split", () => {
    const ENTERPRISE_CATEGORY =
      "Членовете на управителните органи на икономически обособените лица и структурни единици по чл. 13, ал. 4 от ЗПФ, както и управителите и членовете на ОУ или контрол на ОП или ДП";

    it("routes public institutions to their own category by institution", () => {
      expect(categorise(ENTERPRISE_CATEGORY, "Директор", "Училища")).toBe(
        "school",
      );
      expect(
        categorise(
          ENTERPRISE_CATEGORY,
          "Директор",
          "Детски градини, ясли, детка кухня",
        ),
      ).toBe("kindergarten");
      expect(
        categorise(
          ENTERPRISE_CATEGORY,
          "Директор",
          "Социални домове и центрове",
        ),
      ).toBe("social_care");
      expect(categorise(ENTERPRISE_CATEGORY, "Управител", "ДКЦ, МЦ, ЦТХ")).toBe(
        "medical_center",
      );
      expect(
        categorise(
          ENTERPRISE_CATEGORY,
          "Директор",
          "Културни институти и институции",
        ),
      ).toBe("cultural_institute");
      expect(
        categorise(
          ENTERPRISE_CATEGORY,
          "Член на УС",
          "Селскостопанска академия",
        ),
      ).toBe("agri_academy");
    });

    it("leaves a genuine state enterprise as state_enterprise", () => {
      expect(
        categorise(ENTERPRISE_CATEGORY, "Директор", "Държавни предприятия"),
      ).toBe("state_enterprise");
      expect(
        categorise(ENTERPRISE_CATEGORY, "Управител", "Общински предприятия"),
      ).toBe("state_enterprise");
      // No institution to split on → stays in the enterprise bucket.
      expect(categorise(ENTERPRISE_CATEGORY, "Директор", null)).toBe(
        "state_enterprise",
      );
      expect(categorise(ENTERPRISE_CATEGORY, "Директор")).toBe(
        "state_enterprise",
      );
    });
  });
});
