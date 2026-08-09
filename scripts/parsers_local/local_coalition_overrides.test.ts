// Every canonicalId a local-coalition override names must EXIST in
// canonical_parties.json.
//
// WHY this is a gate and not a spot check. An override that names an id the
// canonical table does not carry does not fail, and does not resolve to
// nothing either — it MINTS a second party. `local_coalitions.ts` writes the
// string straight into the bundle's `primaryCanonicalId`, the resolver copies
// it into `person_role.party`, and 120 folds it into `party_primary` /
// `party_codes`. Downstream, `displayNameForId` is a `byId` lookup
// (useCanonicalParties.tsx) and the ПАРТИЯ column falls through to
// `|| p.partyPrimary`, so the invented id renders as its own raw latin token
// with no colour dot — beside the real party, in the same facet dropdown, as a
// separate option for the same organisation.
//
// That is exactly what `{ fragment: "ВМРО", canonicalId: "vmro" }` did: ВМРО
// is a real parliamentary lineage generated as `p_51` (displayName "ВМРО",
// displayNameEn "VMRO", its own colour), so "vmro" was a duplicate of it that
// no lookup could resolve. Nothing was red — every row count reconciled and
// the pages returned 200.
//
// Reading canonical_parties.json from disk is deliberate: the bug is a
// disagreement between two files, so a fixture stand-in (as
// local_coalitions.test.ts correctly uses for the SPLITTER rules) could not
// see it.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  LocalCoalitionRawOverride,
  localCoalitionFragmentOverrides,
  localCoalitionRawOverrides,
} from "./local_coalition_overrides";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const canonical = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "data/canonical_parties.json"), "utf-8"),
) as CanonicalPartiesIndex;

const canonicalIds = new Set(canonical.parties.map((p) => p.id));

describe("local coalition overrides reference real canonical ids", () => {
  it("canonical_parties.json actually loaded", () => {
    // Floor first: an empty set would make every assertion below vacuous, and
    // this file's whole job is to compare against a populated table.
    expect(canonicalIds.size).toBeGreaterThan(100);
  });

  it.each(localCoalitionFragmentOverrides)(
    "fragment override $fragment -> $canonicalId exists",
    ({ fragment, canonicalId }) => {
      expect(
        canonicalIds.has(canonicalId),
        `fragment "${fragment}" names canonicalId "${canonicalId}", which is not in canonical_parties.json — ` +
          `that mints a duplicate party rather than resolving to one`,
      ).toBe(true);
    },
  );

  it("raw overrides name only real canonical ids", () => {
    // `localCoalitionRawOverrides` is empty today, so a bare loop over it would
    // assert nothing while presenting as a passing test — and an unexecuted path
    // is also an untypechecked one. The probe keeps the loop (and the optional
    // `memberCanonicalIds` handling) exercised until the real list fills up.
    const probe: LocalCoalitionRawOverride[] = [
      ...localCoalitionRawOverrides,
      {
        rawName: "__probe__",
        primaryCanonicalId: "p_51",
        memberCanonicalIds: ["p_51", "bsp"],
      },
    ];
    const bad: string[] = [];
    for (const ov of probe) {
      for (const id of [
        ov.primaryCanonicalId,
        ...(ov.memberCanonicalIds ?? []),
      ]) {
        if (id && !canonicalIds.has(id)) bad.push(`${ov.rawName} -> ${id}`);
      }
    }
    expect(
      bad,
      `raw overrides naming unknown canonical ids:\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  it("ВМРО resolves to the generated p_51 lineage, never a minted duplicate", () => {
    // The specific regression. Pinned by name because the fix is only correct
    // if it points at the SAME lineage the parliamentary cycles generated —
    // any other real id would pass the generic check above while still
    // splitting ВМРО in two.
    const vmro = localCoalitionFragmentOverrides.find(
      (o) => o.fragment === "ВМРО",
    );
    expect(vmro?.canonicalId).toBe("p_51");
    expect(canonical.byNickName["ВМРО"]).toBe("p_51");
    expect(canonicalIds.has("vmro")).toBe(false);
  });
});
