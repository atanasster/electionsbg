// Gate for `isLinkableCompanyKey` and for the rule it exists to enforce: a
// hand-rolled `/company/${eik}` link cannot come back.
//
// The defect: ~20 call sites rendered every supplier key as a live link, but 2,084
// of them — 1,803 synthetic carriers (`obed-` / `ph-` / `np-`) and 281 foreign
// registry ids — have no company page at all. `institution_identity()` returns
// NULL for every one, so the link landed on „Няма фирма с ЕИК … в базата.".
//
//   npx vitest run src/lib/companyKey.test.ts

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isLinkableCompanyKey } from "./companyKey";

describe("isLinkableCompanyKey", () => {
  it("accepts the two Bulgarian EIK shapes", () => {
    expect(isLinkableCompanyKey("131468980")).toBe(true); // 9-digit legal entity
    expect(isLinkableCompanyKey("0006951140000")).toBe(true); // 13-digit branch
    expect(isLinkableCompanyKey("000695114")).toBe(true);
  });

  it("rejects every synthetic namespace", () => {
    // Each is minted because the source id could NOT become a key — a consortium
    // is not one legal entity, filler is not an identifier, and an ЕГН must never
    // be stored. None has a page.
    for (const k of [
      "obed-e0d64b6674a1",
      "ph-2475f7344022",
      "np-9906396c39ba",
      "future-namespace-abc",
    ])
      expect(isLinkableCompanyKey(k), k).toBe(false);
  });

  it("rejects foreign registry ids and malformed keys", () => {
    for (const k of [
      "ATU14715405",
      "B87434312",
      "5210084655NTRPL000005852",
      "140639Y",
      "12345678", // 8 digits — not an EIK shape
      "1234567890", // 10 digits — ditto
      "",
      undefined,
    ])
      expect(isLinkableCompanyKey(k), String(k)).toBe(false);
  });

  it("keeps a plain EIK linkable regardless of registry coverage", () => {
    // The measured boundary: 8,850 plain EIKs have no `tr_companies` row, yet 297
    // still resolve through `institution_identity`. A "has a registry row" rule
    // would delete those 297 working links, so the predicate is deliberately
    // syntactic. Nothing here can express that at unit level — this test pins the
    // INTENT so a future tightening has to argue with it.
    expect(isLinkableCompanyKey("000000210")).toBe(true); // ДГС Гърмен
    expect(isLinkableCompanyKey("000000491")).toBe(true); // ТПК, lowest real uic
  });
});

describe("contractor surfaces route through CompanyLink", () => {
  // ⚠ THIS IS A NET, NOT A PROOF — and the first two cuts each looked like a proof
  // and were not. Cut 1 hand-listed five screens and missed twelve files. Cut 2
  // derived the set from files naming `contractorEik`, which still missed
  // ProjectFileScreen's `r.eik` (a `foldByContractor()` key) — and that one was
  // live, rendering `obed-f58039ac056a` at €337.7M, 41% of a dossier, as a dead
  // coloured link.
  //
  // Why not "no file may hand-roll a /company link at all": 83 files link there,
  // and most render an AWARDER, a funds beneficiary, a person's company or an NGO.
  // Those keys are validated by `isValidEik` (9-13 digits) and two live awarders
  // sit OUTSIDE the contractor predicate — ЕСО `1752013040`, АДФИ `175076479999`,
  // both of which resolve — so routing them through CompanyLink de-links working
  // pages. The two domains genuinely differ and one rule cannot serve both.
  //
  // So: two nets. A file list for the surfaces known to render contractor rollups,
  // and a token net for the field names those rollups expose. Neither is complete;
  // a new contractor surface that invents a third naming convention slips both, and
  // the cost is one dead link. Add it here when you find it.
  const SRC = path.resolve(import.meta.dirname, "..");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  /** Surfaces that render a CONTRACTOR rollup, whatever they call the field. */
  const CONTRACTOR_SURFACES = [
    "screens/TopContractorsScreen.tsx",
    "screens/sector/SectorCharts.tsx",
    "screens/ContractDetailScreen.tsx",
    "screens/ProcurementFlagsScreen.tsx",
    "screens/AwarderContractorsScreen.tsx",
    "screens/procurement/ProjectFileScreen.tsx",
    "screens/procurement/TenderDetailScreen.tsx",
    "screens/sector/tourism/TourismThematicTiles.tsx",
    "screens/components/procurement/contractColumns.tsx",
    "screens/components/procurement/ConcentrationSection.tsx",
    "screens/components/procurement/RiskSignalsTile.tsx",
    "screens/components/procurement/CompanyTopContractsTile.tsx",
    "screens/components/procurement/transport/TransportTopContractsTile.tsx",
    "screens/components/procurement/security/MvrTopContractsTile.tsx",
    "screens/components/procurement/roads/RoadRepeatWinnersTile.tsx",
    "screens/components/candidates/MpConnectedContractsTile.tsx",
    "screens/components/candidates/procurement/ConnectedContractorCard.tsx",
  ];

  /** Field names a contractor key travels under. */
  const CONTRACTOR_TOKEN =
    /to=\{`\/company\/\$\{[^}]*\b(contractorEik|consortiumEik|leaderEik|topSupplier)\b/;

  it.each(CONTRACTOR_SURFACES)(
    "%s routes contractors through CompanyLink",
    (rel) => {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      // Uses the component…
      expect(src).toContain("CompanyLink");
      // …and hand-rolls no CONTRACTOR link. Deliberately not "no /company link at
      // all": ContractDetailScreen keeps a plain <Link> for the AWARDER row (whose
      // keys run 9-13 digits, outside the contractor predicate), and
      // ProjectFileScreen keeps them for funds beneficiaries and person companies.
      // Both are validated-EIK domains where the page works.
      expect(src).not.toMatch(CONTRACTOR_TOKEN);
    },
  );

  it("no file anywhere links straight off a contractor-key field", () => {
    const offenders = walk(SRC)
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => CONTRACTOR_TOKEN.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the nets are non-vacuous", () => {
    // Each net must actually be looking at something: the file list must resolve,
    // and the token net must match when a violation is synthesised.
    expect(CONTRACTOR_SURFACES.length).toBeGreaterThan(15);
    for (const rel of CONTRACTOR_SURFACES)
      expect(() => readFileSync(path.join(SRC, rel), "utf8")).not.toThrow();
    expect(CONTRACTOR_TOKEN.test("to={`/company/${row.contractorEik}`}")).toBe(
      true,
    );
    expect(CONTRACTOR_TOKEN.test("to={`/company/${c.awarderEik}`}")).toBe(
      false,
    );
  });

  it("CompanyLink gates on the predicate and carries the scope", () => {
    const comp = readFileSync(
      path.join(SRC, "screens/components/procurement/CompanyLink.tsx"),
      "utf8",
    );
    // An inverted implementation would satisfy a bare substring check, so assert
    // the early-return SHAPE: not-linkable must return the span branch.
    expect(comp).toMatch(
      /if \(!isLinkableCompanyKey\(eik\)\)[\s\S]{0,200}<span/,
    );
    // /company/:eik reads useScope(), so a bare pathname resets ?pscope.
    expect(comp).toContain("useScopedHref");
    // Affordance must be stripped whole-token, never by substring.
    expect(comp).toContain("AFFORDANCE.has");
  });
});
