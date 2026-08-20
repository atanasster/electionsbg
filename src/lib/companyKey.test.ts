// Gate for `isLinkableCompanyKey` and for the rule it exists to enforce: a
// hand-rolled `/company/${eik}` link cannot come back.
//
// The defect: ~20 call sites rendered every supplier key as a live link, and for
// `ph-` (filler registration number), `np-` (natural person) and the 282 foreign /
// malformed ids the key names nothing a reader can look up.
//
// ⚠ `obed-` CARRIERS ARE LINKABLE, and the arms below are written to make an
// accidental re-collapse of the three namespaces fail. The first cut de-linked all
// of them on the premise that none had a page; `/company/:eik` had in fact grown a
// procurement-only body six weeks earlier (8c8b9a9654), and the carrier's page is
// the one that carries the „Обединение — участници" member block. See
// companyKey.ts's header for the branch condition and the measurement.
//
//   npx vitest run src/lib/companyKey.test.ts

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  isLinkableCompanyKey,
  isConsortiumCarrierKey,
  isConsortiumSupplier,
} from "./companyKey";

describe("isLinkableCompanyKey", () => {
  it("accepts the two Bulgarian EIK shapes", () => {
    expect(isLinkableCompanyKey("131468980")).toBe(true); // 9-digit legal entity
    expect(isLinkableCompanyKey("0006951140000")).toBe(true); // 13-digit branch
    expect(isLinkableCompanyKey("000695114")).toBe(true);
  });

  it("accepts an obed- consortium carrier", () => {
    // The carrier's page is the richest of the four kinds — it names the member
    // firms, which is the only route from a dominated leaderboard row to the
    // companies behind it. Measured on /sector/security: one carrier holds 38.5%
    // of the current parliament's window.
    expect(isLinkableCompanyKey("obed-e0d64b6674a1")).toBe(true);
    expect(isLinkableCompanyKey("obed-f58039ac056a")).toBe(true);
  });

  it("rejects the namespaces that name nothing checkable", () => {
    // Both pages load; neither key is an identifier. `ph-` stands for a
    // registration number the buyer made up (several hold €0) and `np-` is one
    // natural person, keyed by name so no ЕГН is stored. A link promises somewhere
    // to go. An unknown future namespace defaults to NOT linkable.
    for (const k of [
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

describe("isConsortiumCarrierKey", () => {
  it("accepts the obed- carrier namespace", () => {
    expect(isConsortiumCarrierKey("obed-369bc7450c81")).toBe(true);
    expect(isConsortiumCarrierKey("obed-f58039ac056a")).toBe(true);
  });

  // ⚠ THE MUTATION-RELEVANT HALF. The tempting simplification is
  // `!isLinkableCompanyKey(eik)`, which passes the arm above and every component
  // test — and is wrong here: `ph-` is a supplier whose registration number was
  // filler and `np-` is a NATURAL PERSON. Labelling either „this row is several
  // firms" is a false statement, and about an individual in the np- case.
  it("rejects the other synthetic namespaces", () => {
    expect(isConsortiumCarrierKey("ph-1a2b3c4d5e6f")).toBe(false);
    expect(isConsortiumCarrierKey("np-9f8e7d6c5b4a")).toBe(false);
  });

  it("rejects plain EIKs, foreign ids and empties", () => {
    for (const k of [
      "131468980",
      "0006951140000",
      "HRB 12345", // a foreign registry id
      "obed", // the prefix without its separator is not the namespace
      "",
      undefined,
    ])
      expect(isConsortiumCarrierKey(k), String(k)).toBe(false);
  });

  // ⚠ THE MUTATION GUARD FOR THE 2026-08-19 WIDENING. The two predicates now agree
  // on `obed-` and disagree on everything else, which makes two wrong refactors
  // look plausible: `isLinkable = !isConsortiumCarrier` (inverts the carrier), and
  // `isLinkable = isConsortiumCarrier || plainEik` collapsed into „any non-plain
  // key is a consortium" (labels a natural person as several firms). Pin all four
  // cells of the truth table so neither survives.
  it("agrees with isLinkableCompanyKey on obed- and nowhere else", () => {
    expect(isConsortiumCarrierKey("obed-369bc7450c81")).toBe(true);
    expect(isLinkableCompanyKey("obed-369bc7450c81")).toBe(true);

    // linkable, not a consortium
    expect(isLinkableCompanyKey("131468980")).toBe(true);
    expect(isConsortiumCarrierKey("131468980")).toBe(false);

    // neither
    for (const k of ["ph-1a2b3c4d5e6f", "np-9f8e7d6c5b4a"]) {
      expect(isLinkableCompanyKey(k), k).toBe(false);
      expect(isConsortiumCarrierKey(k), k).toBe(false);
    }
  });
});

describe("isConsortiumSupplier", () => {
  // The € wins when present — this is the whole point, since a REGISTERED ДЗЗД
  // carries an ordinary 9-digit EIK and the prefix cannot see it. Corpus-wide
  // that is 1,344 of 4,014 carrier rows and €5.63bn, 47.5% of consortium money.
  it("prefers consortiumEur over the key prefix", () => {
    // A plain EIK the prefix would call solo, marked by the €.
    expect(
      isConsortiumSupplier({ eik: "177424500", consortiumEur: 31_461_596 }),
    ).toBe(true);
    // …and an obed- key the prefix would call a consortium, un-marked by a 0 €.
    // (Not a state the corpus produces — 061 sums the carrier's own row — but it
    // is what „the € is authoritative" MEANS, and the assertion is what stops the
    // two being reordered.)
    expect(
      isConsortiumSupplier({ eik: "obed-369bc7450c81", consortiumEur: 0 }),
    ).toBe(false);
  });

  // ⚠ 0 IS AN ANSWER. `!= null`, never truthiness: 0 means „won nothing jointly"
  // and is the common case (27,247 of 29,615 suppliers). A `?` check here would
  // send every solo supplier to the prefix fallback — harmless for a plain EIK,
  // and wrong for the obed- case above.
  it("treats 0 as an answer, not as unknown", () => {
    expect(isConsortiumSupplier({ eik: "131468980", consortiumEur: 0 })).toBe(
      false,
    );
  });

  // ⚠ null/undefined = „this producer could not tell" — a serving database whose
  // 061 predates the projection, i.e. every one between a hosting deploy and the
  // apply_functions that follows. Degrading to the prefix keeps the note right
  // for the obed- half instead of making it vanish site-wide for that window.
  it("falls back to the key when the € is unknown", () => {
    for (const consortiumEur of [null, undefined]) {
      expect(
        isConsortiumSupplier({ eik: "obed-369bc7450c81", consortiumEur }),
      ).toBe(true);
      expect(isConsortiumSupplier({ eik: "131468980", consortiumEur })).toBe(
        false,
      );
      // ph-/np- are not consortia on the fallback path either.
      expect(
        isConsortiumSupplier({ eik: "np-9f8e7d6c5b4a", consortiumEur }),
      ).toBe(false);
    }
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
    // Found by review AFTER the token net passed: both name their key `p.eik` /
    // `a.topEik`, so no token matched while both rendered live dead links —
    // ProcurementSectors' CPV-45 rank 8 is `obed-f58039ac056a` at €337.7M, and 50
    // awarders have a synthetic top counterparty. `contractor_rank` holds 11,813
    // synthetic rows, so any surface reading it is a candidate.
    "screens/ProcurementSectorsScreen.tsx",
    "screens/ProcurementWatchlistScreen.tsx",
    // Found by review 2026-08-19, all on the bare-`eik` convention the comment
    // above already named as the known escape without ever widening the token to
    // catch it. VikContractorHhiTile is the sharpest: it renders on /sector/security
    // as well as /water, and was linking `ph-`/`np-` keys with full link affordance
    // while CompanyLink two sections up rendered the same kind as plain text.
    "screens/components/procurement/vik/VikContractorHhiTile.tsx",
    "screens/components/procurement/TopContractorsTile.tsx",
    "screens/components/procurement/CompanySectorsTile.tsx",
    "screens/components/procurement/roads/RoadTopContractorsTile.tsx",
    "screens/components/procurement/noi/NoiStrategicSuppliersTile.tsx",
    "screens/components/procurement/nzok/NzokProcurementLensTile.tsx",
    "screens/culture/CultureProcurementScreen.tsx",
  ];

  /** Field names a contractor key travels under. Used for the REPO-WIDE sweep, so
   *  it must stay narrow: a bare `.eik` is legitimate in the awarder domain. */
  const CONTRACTOR_TOKEN =
    /to=\{`\/company\/\$\{[^}]*\b(contractorEik|consortiumEik|leaderEik|topSupplier|topEik)\b/;

  /** The same, widened to the bare-`eik` convention that slipped the net twice.
   *  Applied to CONTRACTOR_SURFACES ONLY — scoping by file is what preserves the
   *  awarder carve-out. `SchoolProcurementTile`'s `to={`/company/${eik}`}` is the
   *  worked counter-example: it links the SCHOOL (a buyer, via
   *  `useAwarderProcurement`), whose key is validated by `isValidEik` (9–13
   *  digits), so routing it through CompanyLink would de-link a working page. */
  const CONTRACTOR_TOKEN_LOOSE = /to=\{`\/company\/\$\{[^}]*\beik\b/i;

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
      // On a KNOWN contractor surface the bare-`eik` convention counts too — this
      // is the arm the two prior escapes would have died on.
      expect(src).not.toMatch(CONTRACTOR_TOKEN_LOOSE);
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
    // The loose token must catch what the strict one misses…
    expect(CONTRACTOR_TOKEN_LOOSE.test("to={`/company/${s.eik}`}")).toBe(true);
    expect(CONTRACTOR_TOKEN_LOOSE.test("to={`/company/${eik}`}")).toBe(true);
    expect(CONTRACTOR_TOKEN.test("to={`/company/${s.eik}`}")).toBe(false);
    // …and still not fire on the awarder field, or it would be the blanket rule
    // the awarder carve-out exists to prevent.
    expect(CONTRACTOR_TOKEN_LOOSE.test("to={`/company/${c.awarderEik}`}")).toBe(
      false,
    );
    expect(CONTRACTOR_TOKEN_LOOSE.test("to={`/company/${row.uic}`}")).toBe(
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
