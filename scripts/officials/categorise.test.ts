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
});
