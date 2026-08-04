// Tier 3 (Postgres-native) — no single contract may carry rows from BOTH procurement feeds.
//
// WHY THIS IS A GATE AND NOT A FIX. Each feed splits a contract's value across its OWN view
// of the supplier set, so summing rows from both always over-states. The obvious remedy —
// "OCDS is authoritative, delete the EOP rows" — was implemented, measured, and abandoned:
// across the 25 key-divergent contracts NEITHER feed's supplier set is a superset of the
// other (0 supersets in either direction), so deletion loses real counterparties.
// `00031-2022-0002`/53831 carries "Консорциум „Малко Тъ…"" ONLY on the EOP side. Two
// deletion attempts destroyed legitimate rows before being reverted — one pooled six
// distinct procedures that shared the contract number "1" and removed 46 rows / €5.15m.
// See docs/plans/procurement-foreign-consortium-members-v1.md §9.
//
// So this file only DETECTS. A genuine disagreement between two public sources is not
// something a script should silently resolve.
//
// WHAT THE 47 PRODUCTION CASES ACTUALLY ARE (measured 2026-08-04, €9,273,007.58 total):
//
//   22  identical supplier sets — the row-level content eviction should have caught these,
//       but its keys embed the rounded amount (9 contracts differ, because the feeds split
//       by different denominators) and `date_signed` (9 differ). Only 6 had both equal and
//       still escaped. Addressed by the amount-free content net (Tier B).
//   20  the SAME suppliers under DIFFERENT keys: one feed published a natural person's ЕГН
//       (now encoded `np-<name-hash>`), the other their real BULSTAT — e.g.
//       00373-2022-0009/48251 is `np-9ca38126f076`/"Здравко Георгиев Иванов" from EOP and
//       `180055903`/"ЗДРАВКО ГЕОРГИЕВ ИВАНОВ" from OCDS. Addressed by the identity bridge
//       (Tier A).
//    5  genuinely different supplier sets — a real source conflict, for a human.
//
// The key is (УНП, contract_id, tag). Verified complete on the affected population: of the
// 95 rows across all 47 contracts, ZERO lack either field. The УНП is mandatory — dropping
// it for (buyer, contract_id) is what pooled the six "1" procedures.
//
//   npm run test:data
//
// Requires the Postgres store; auto-skips when Postgres is unreachable or the contracts
// table is absent, like invariants_pg.data.test.ts.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

afterAll(async () => {
  await end();
});

interface MixedRow {
  unp: string;
  contract_id: string;
  eop_rows: number;
  ocds_rows: number;
  eur: number;
  relation: string;
}

// TRIAGED GENUINE CONFLICTS — `${unp}/${contract_id}`.
//
// An entry here means a human looked at the two feeds, found they name genuinely different
// counterparties, and accepted that neither can be mechanically preferred. It is NOT a
// suppression for "we haven't got round to it": everything resolvable by the amount-free
// content net or the identity bridge must be resolved there, not listed here. The list is
// asserted to be exhaustive AND minimal below, so a stale entry fails just as loudly as a new
// conflict.
const ACCEPTED_CONFLICTS = new Map<string, string>([
  [
    "05962-2026-0001/240319",
    // Corrected: this is NOT "different entities". Same contract number, same signing date, and
    // €14,050.00 is exactly half of €28,100.00 — the multi-supplier value-split signature. ЦАИС
    // saw two suppliers (Aleksandar Mladenov plus a second, identity-less party) where OCDS saw
    // one (Lion Helicopters srl) taking the whole award.
    //
    // Unfixable for a STRUCTURAL reason, which is why it is accepted rather than resolved: the
    // ЦАИС row's `contractor_eik` is empty, and all four content nets require a contractor id, so
    // no key can ever pair it. 620 identity-less EOP rows exist corpus-wide; exactly one has a
    // cross-source twin, and this is it.
    "ЦАИС row has an empty contractor_eik, so no content net can pair it with the OCDS row",
  ],
  [
    "05397-2020-0009/81",
    // Same procedure, lot 81. ЦАИС says „Сикюрити глобъл“ ЕООД at €1,400,390; OCDS says
    // Контракс АД at €1,345,464. Both are real companies on this procedure — see lot 82,
    // where the two feeds swap them round. The feeds disagree about which supplier won which
    // lot, which no key can reconcile.
    "feeds disagree which supplier won lot 81 (Сикюрити глобъл vs Контракс)",
  ],
  [
    "05397-2020-0009/82",
    // The mirror of lot 81: ЦАИС says „АСО Панема“ ООД at €711,485, OCDS says
    // „СИКЮРИТИ ГЛОБЪЛ“ ЕООД at €684,273. Cross-assigned lots within one procedure.
    "feeds cross-assign lots 81/82 between АСО Панема and Сикюрити глобъл",
  ],
  [
    "00031-2022-0002/53831",
    // A feed-MODELLING difference rather than a data conflict, and the reason it cannot be
    // auto-resolved: ЦАИС emits two rows — "Иван Станков Калудов" (€0) and
    // "Консорциум „Малко Търново“" (€240,233) — while OCDS emits ONE row whose contractor_name
    // concatenates both parties ("ИВАН СТАНКОВ КАЛУДОВ; Конс…") at the same €240,233. The money
    // agrees; the party model does not, so there is no supplier-level correspondence to match.
    // The two feeds also give the consortium DIFFERENT EIKs (177509406 vs 177834150), so even the
    // named ДЗЗД cannot be matched across them.
    "OCDS collapses the consortium into one row whose name concatenates both members",
  ],
  [
    "00267-2020-0066/20ДГ890",
    // Identical amount (€10,194) under different suppliers: ЦАИС "Д & д ООД" vs OCDS
    // ЕТ "МОНИ-8 - МЕТОДИ ГЕОРГИЕВ". Not a casing or trade-descriptor variant of each other.
    "same €10,194 attributed to Д & д ООД (ЦАИС) vs ЕТ МОНИ-8 (OCDS)",
  ],
  [
    "00060-2020-0013/486",
    // Different supplier AND different amount by three orders of magnitude: ЦАИС
    // "Гранд енерджи дистрибюшън" at €24, OCDS "Енерджи Маркет Глобал ООД" at €90,045. Both are
    // real electricity traders. Nothing here indicates which feed is wrong.
    "Гранд енерджи €24 (ЦАИС) vs Енерджи Маркет Глобал €90,045 (OCDS)",
  ],
]);

const idOf = (r: MixedRow): string => `${r.unp}/${r.contract_id}`;

// Synthetic `obed-` consortium carriers are excluded: 087 mints them inside Postgres from
// whichever feed's rows are present, so they inherit a mix rather than cause one.
const MIXED_SQL = `
  WITH g AS (
    SELECT unp, contract_id, tag,
           count(*) FILTER (WHERE release_id LIKE 'eop-%')     AS eop_rows,
           count(*) FILTER (WHERE release_id NOT LIKE 'eop-%') AS ocds_rows,
           sum(CASE WHEN release_id LIKE 'eop-%' THEN amount_eur ELSE 0 END) AS eur,
           array_agg(DISTINCT contractor_eik) FILTER (WHERE release_id LIKE 'eop-%')     AS e,
           array_agg(DISTINCT contractor_eik) FILTER (WHERE release_id NOT LIKE 'eop-%') AS o
      FROM contracts
     WHERE contractor_eik NOT LIKE 'obed-%'
       AND COALESCE(unp, '') <> '' AND COALESCE(contract_id, '') <> ''
     GROUP BY 1, 2, 3
    HAVING count(*) FILTER (WHERE release_id LIKE 'eop-%') > 0
       AND count(*) FILTER (WHERE release_id NOT LIKE 'eop-%') > 0
  )
  SELECT unp, contract_id, eop_rows::int, ocds_rows::int, COALESCE(eur, 0)::float8 AS eur,
         CASE WHEN e <@ o AND o <@ e THEN 'identical-suppliers'
              WHEN e <@ o            THEN 'ocds-superset'
              WHEN o <@ e            THEN 'eop-superset'
              ELSE 'divergent-suppliers' END AS relation
    FROM g
   ORDER BY eur DESC NULLS LAST`;

test.skipIf(skip)("no contract carries rows from both feeds", async () => {
  const all = await allRows<MixedRow>(MIXED_SQL);
  const rows = all.filter((r) => !ACCEPTED_CONFLICTS.has(idOf(r)));
  const total = rows.reduce((s, r) => s + Number(r.eur ?? 0), 0);
  const byRelation = rows.reduce<Record<string, number>>((a, r) => {
    a[r.relation] = (a[r.relation] ?? 0) + 1;
    return a;
  }, {});
  assert.equal(
    rows.length,
    0,
    `${rows.length} contract(s) mix the ЦАИС ЕОП and OCDS feeds, over-stating by ` +
      `€${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}. Each feed splits the ` +
      `contract value across its own supplier set, so the two can never be summed.\n` +
      `  by supplier-set relation: ${JSON.stringify(byRelation)}\n` +
      `  worst: ${rows
        .slice(0, 5)
        .map(
          (r) =>
            `${r.unp}/${r.contract_id} (${r.eop_rows} eop + ${r.ocds_rows} ocds, ${r.relation})`,
        )
        .join(", ")}\n` +
      `  'identical-suppliers' should be resolved by the amount-free content net; ` +
      `'divergent-suppliers' needs the identity bridge, or is a genuine source conflict to ` +
      `triage by hand. Do NOT resolve this by deleting rows — see ` +
      `docs/plans/procurement-foreign-consortium-members-v1.md §9.`,
  );
});

test.skipIf(skip)("every accepted conflict still exists", async () => {
  // Keeps the allowlist minimal. Once a conflict is resolved upstream — the identity bridge
  // reconciles the keys, or a feed corrects itself — its entry must go, or it silently
  // licenses a future regression on the same contract.
  //
  // This deliberately ties the allowlist to the CURRENT corpus, which means it also fires on a
  // database whose corpus predates the entry. That is the intended trade (an exhaustive list
  // beats a permissive one), but it makes the failure easy to misread, so the message says so:
  // on a lagging database the fix is to load the corpus, not to edit this list.
  const live = new Set((await allRows<MixedRow>(MIXED_SQL)).map(idOf));
  const stale = [...ACCEPTED_CONFLICTS.keys()].filter((k) => !live.has(k));
  assert.deepEqual(
    stale,
    [],
    `ACCEPTED_CONFLICTS lists ${stale.length} contract(s) that do not mix feeds in THIS ` +
      `database: ${stale.join(", ")}.\n` +
      `  If this database is behind (its corpus predates the entry), load the current corpus — ` +
      `do not edit the list.\n` +
      `  If it is current, the conflict is resolved: remove the entry, because a stale one ` +
      `licenses a future regression on that contract.`,
  );
});

test.skipIf(skip)(
  "the detector's key is complete on the affected population",
  async () => {
    // Guards the gate itself. The key requires a non-empty УНП and contract_id, so a row
    // missing either is invisible to it. That is safe only while no such row participates in
    // a cross-source pair — assert it rather than assume it, since a future ingest that stops
    // populating `unp` would silently blind this gate instead of failing it.
    const [r] = await allRows<{ blind: string }>(
      `SELECT count(*)::text AS blind
         FROM contracts a
        WHERE a.contractor_eik NOT LIKE 'obed-%'
          AND (COALESCE(a.unp, '') = '' OR COALESCE(a.contract_id, '') = '')
          AND EXISTS (
            SELECT 1 FROM contracts b
             WHERE b.ocid = a.ocid
               AND COALESCE(b.contract_id, '') = COALESCE(a.contract_id, '')
               AND b.tag = a.tag
               AND (b.release_id LIKE 'eop-%') <> (a.release_id LIKE 'eop-%')
          )`,
    );
    assert.equal(
      Number(r.blind),
      0,
      `${r.blind} cross-source row(s) lack a УНП or contract_id and are therefore invisible ` +
        `to the mixed-feed detector. Run scripts/procurement/backfill_unp.ts --apply, or widen ` +
        `the detector's key.`,
    );
  },
);
