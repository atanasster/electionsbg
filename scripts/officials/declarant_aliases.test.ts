// The person-GUID name alias table, and the invariants that keep it from being
// the destructive half of the slug rule.
//
// ./_declarant_guid_aliases.json merges spellings, so a bad entry does the
// opposite of the fork it exists to heal: it publishes one official's property
// under another's name. These checks are about the table's shape and internal
// consistency; the corpus-level "does this merge two strangers" gate lives in
// ./officials_slug.data.test.ts, which reads the real declarations.

import fs from "fs";
import { describe, expect, it } from "vitest";
import { aliasedDeclarantName, ALIASES_FILE } from "./declarant_aliases";
import { canonicalDeclarantName } from "./shared";
import { personGuid } from "./slug_identity";

type AliasFile = {
  _notListed: Record<string, string>;
  aliases: Record<string, { name: string; folds: string[]; reason: string }>;
};
const doc = JSON.parse(fs.readFileSync(ALIASES_FILE, "utf-8")) as AliasFile;
const entries = Object.entries(doc.aliases);

const GUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

describe("_declarant_guid_aliases.json", () => {
  it("is keyed on well-formed upper-case register person-GUIDs", () => {
    expect(entries.map(([g]) => g).filter((g) => !GUID.test(g))).toEqual([]);
  });

  it("gives every entry a canonical name, the spellings it replaces, and a reason", () => {
    const bad = entries.filter(
      ([, a]) =>
        !a.name.trim() ||
        !a.reason.trim() ||
        a.reason === "TODO" ||
        a.folds.length === 0,
    );
    expect(bad.map(([g]) => g)).toEqual([]);
  });

  it("never lists the canonical name among the spellings it replaces", () => {
    // A fold that equals the canonical form is a no-op that makes the entry read
    // as if it were doing more than it does.
    const redundant = entries.filter(([, a]) =>
      a.folds.some(
        (f) => canonicalDeclarantName(f) === canonicalDeclarantName(a.name),
      ),
    );
    expect(redundant.map(([g]) => g)).toEqual([]);
  });

  it("keeps every folded spelling genuinely unreachable by canonicalisation", () => {
    // If a fold canonicalises to the same string as the target, the slug rule
    // already merged it and the alias is dead weight — which matters because a
    // table that accumulates no-ops stops being reviewable.
    for (const [, a] of entries)
      for (const fold of a.folds)
        expect(canonicalDeclarantName(fold)).not.toBe(
          canonicalDeclarantName(a.name),
        );
  });

  it("gives no two GUIDs the same canonical name", () => {
    // A table-only mirror of the corpus no-merge gate, fast and data-free: two
    // GUIDs sharing a canonical name under one disambiguator would collapse two
    // people onto one slug. Catches it on a fresh clone before the corpus test
    // can run.
    const byName = new Map<string, string[]>();
    for (const [g, a] of entries)
      byName.set(a.name, [...(byName.get(a.name) ?? []), g]);
    const clashes = [...byName].filter(([, gs]) => gs.length > 1);
    expect(clashes).toEqual([]);
  });

  it("does not alias a GUID it also documents as deliberately not listed", () => {
    for (const guid of Object.keys(doc._notListed))
      expect(doc.aliases[guid]).toBeUndefined();
  });

  it("explains every GUID it declines to alias", () => {
    for (const [guid, why] of Object.entries(doc._notListed)) {
      expect(GUID.test(guid)).toBe(true);
      expect(why.length).toBeGreaterThan(40);
    }
  });
});

describe("aliasedDeclarantName", () => {
  it("substitutes the canonical name for a listed GUID", () => {
    // Наталия Василева Илиева, Национално бюро за правна помощ — the register
    // typed "Натгалия" in the 2019 and 2020 folders.
    const guid = "7515A8D9-F3E5-476B-8979-41B288573F78";
    expect(aliasedDeclarantName(guid, "Натгалия Василева Илиева")).toBe(
      "Наталия Василева Илиева",
    );
  });

  it("is case-insensitive on the GUID", () => {
    // The register emits the id upper-case in some folders and lower-case in
    // others; the alias must not depend on which.
    const guid = "7515A8D9-F3E5-476B-8979-41B288573F78";
    expect(
      aliasedDeclarantName(guid.toLowerCase(), "Натгалия Василева Илиева"),
    ).toBe(aliasedDeclarantName(guid, "Натгалия Василева Илиева"));
  });

  it("keeps the register's name for an unlisted GUID", () => {
    expect(
      aliasedDeclarantName(
        "FABC4CD0-EE60-4532-8F5A-68404AE4F910",
        "Атанас Зафиров Зафиров",
      ),
    ).toBe("Атанас Зафиров Зафиров");
  });

  it("keeps the register's name when the filing proves no identity", () => {
    // A bare per-document guid — personGuid() returns null, and no alias can or
    // should apply.
    expect(personGuid("255f6c79-551f-4b67-87b4-77e8b1401ddb.xml")).toBeNull();
    expect(aliasedDeclarantName(null, "Диана Иванова Ковачева")).toBe(
      "Диана Иванова Ковачева",
    );
  });
});
