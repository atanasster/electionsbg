// A sector's EIK set is a claim about BUYERS. Using it on a corpus where those
// bodies appear as RECIPIENTS is only valid where they actually appear — and
// when they do not, the failure is silent and inverted: the page renders an
// empty table, which a reader takes as „this sector received nothing".
//
// Measured on culture, the sector that forced the distinction:
//
//   fund_projects  ∩ CULTURE_GROUP_EIKS →  40 rows / €94,075,904   ✅ usable
//   agri_subsidies ∩ CULTURE_GROUP_EIKS →   0 rows                 ❌ empty page
//
// and the ДФЗ truth is €18.3m — paid to народни читалища, which are a NAME
// population (~3,000 bodies, high turnover) and deliberately in no EIK list. So
// „culture got no farm subsidies" would be false by €18.3m, produced by a filter
// that looked like it worked.
//
// This gate holds the rule for every pack that declares a beneficiary role: the
// set must reach SOMETHING, and the corpora it reaches are recorded here rather
// than assumed.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  SECTOR_BROWSE_PACKS,
  sectorBeneficiaryEiks,
  type BeneficiaryCorpus,
} from "@/screens/components/procurement/sectorPacks";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

/** Every beneficiary corpus a sector filter could be pointed at, with the column
 *  that holds the recipient's EIK. */
const BENEFICIARY_CORPORA: { table: BeneficiaryCorpus; col: string }[] = [
  { table: "fund_projects", col: "beneficiary_eik" },
  { table: "agri_subsidies", col: "eik" },
  { table: "interreg_partners", col: "eik" },
];

test("sectorBeneficiaryEiks gates PER CORPUS, not per pack", () => {
  // A buyer-only pack must never hand its EIKs to any beneficiary corpus.
  for (const c of BENEFICIARY_CORPORA)
    assert.equal(
      sectorBeneficiaryEiks(SECTOR_BROWSE_PACKS.roads, c.table),
      null,
      `a pack declaring no beneficiary corpora leaked its buyer set to ${c.table}`,
    );
  const culture = SECTOR_BROWSE_PACKS.culture;
  assert.ok(culture, "the culture pack is missing");
  // The whole point of the per-corpus shape: culture is a recipient, and still
  // must be refused on two of the three corpora.
  assert.ok(
    sectorBeneficiaryEiks(culture, "fund_projects")?.length,
    "culture no longer reaches ИСУН — the funds arm has gone dead",
  );
  for (const c of ["agri_subsidies", "interreg_partners"] as const)
    assert.equal(
      sectorBeneficiaryEiks(culture, c),
      null,
      `culture must be refused on ${c}: its EIKs match nothing there, and an ` +
        `empty result would read as „this sector received nothing"`,
    );
  assert.equal(sectorBeneficiaryEiks(null, "fund_projects"), null);
});

test.skipIf(skip)(
  "every pack claiming a beneficiary role reaches at least one corpus",
  async () => {
    const claiming = Object.values(SECTOR_BROWSE_PACKS).filter(
      (p) => p.beneficiaryCorpora?.length,
    );
    assert.ok(
      claiming.length > 0,
      "no pack declares a beneficiary corpus — the gate proves nothing",
    );
    // BOTH directions, per corpus. A declared corpus that matches nothing is the
    // empty-page defect; an UNDECLARED corpus that matches plenty is a filter
    // silently refusing an answer it could give.
    for (const pack of claiming)
      for (const { table, col } of BENEFICIARY_CORPORA) {
        const [r] = await allRows<{ n: string }>(
          `SELECT count(*) n FROM ${table} WHERE ${col} = ANY($1)`,
          [[...pack.eiks]],
        );
        const rows = Number(r?.n ?? 0);
        const declared = pack.beneficiaryCorpora?.includes(table) ?? false;
        if (declared)
          assert.ok(
            rows > 0,
            `sector „${pack.id}" declares ${table} but its EIK set matches NOTHING ` +
              `there — a filter using it renders an empty page that reads as ` +
              `„this sector received no money"`,
          );
        else
          assert.equal(
            rows,
            0,
            `sector „${pack.id}" does NOT declare ${table}, yet its EIK set matches ` +
              `${rows} row(s) there. Either add it to beneficiaryCorpora, or say ` +
              `in the pack why an answerable corpus is being withheld`,
          );
      }
  },
);

test.skipIf(skip)(
  "culture reaches ИСУН and NOT ДФЗ — the case that produced this gate",
  async () => {
    const eiks = [...SECTOR_BROWSE_PACKS.culture.eiks];
    const [isun] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
      [eiks],
    );
    assert.ok(
      Number(isun.n) > 0,
      "the culture roll-up no longer matches any ИСУН project — the funds arm " +
        "of the sector filter has gone dead",
    );
    const [agri] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM agri_subsidies WHERE eik = ANY($1)`,
      [eiks],
    );
    assert.equal(
      Number(agri.n),
      0,
      `${agri.n} ДФЗ rows now match the culture roll-up. That inverts open ` +
        `question 6: if a state cultural institution has started receiving farm ` +
        `subsidies, the ДФЗ arm can become EIK-keyed instead of читалища-by-name — ` +
        `but the decision has to be re-made, not inherited`,
    );
  },
);
