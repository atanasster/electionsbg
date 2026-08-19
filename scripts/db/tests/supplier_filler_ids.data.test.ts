// The corpus stays free of FILLER supplier ids.
//
//   npm run test:data
//
// WHY A DATA TEST AND NOT JUST THE UNIT ONES. `isPlaceholderId` is covered by
// hand-written inputs in scripts/procurement/supplier_identity.test.ts, which
// proves the rules do what they say. It cannot prove the CORPUS is clean, and the
// two come apart in one specific way: the structural rules (all-same-digit, an
// ascending run) self-maintain, but the low-number fillers are an evidence-based
// DENYLIST of exactly `000000001` / `000000002` / `000000003`. A buyer typing
// `000000007` tomorrow pools unrelated suppliers under one key again, silently,
// and every unit test stays green.
//
// That is not hypothetical — it is how the original defect looked. `000000001`
// pooled NINE unrelated suppliers, Elsevier's EUR 32.8M and Clarivate's EUR 11.2M
// rendering as one contractor on every leaderboard, and `1234567899` pooled 22
// distinct natural persons. Nothing failed; the rows simply summed.
//
// ⚠ THIS GATE CANNOT BE WIDENED INTO A HEURISTIC. The obvious generalisation —
// "flag any id shared by many unrelated names" — is the discriminator this corpus
// has already defeated: real suppliers legitimately carry 20+ name spellings
// (103267194 has 21 across 8,483 rows). The equally obvious "flag small numbers"
// is worse: `000000210` is ДГС Гърмен, a live awarder, and 29 Commerce-Registry
// cooperatives sit below 10000 starting at `000000491`. See the header of
// scripts/procurement/eik.ts for the four discriminators that misfired before.
// What this gate does is narrow and safe: it re-applies the SHIPPED predicate to
// the live corpus, so the only thing it can catch is a filler the current rules
// already recognise — plus, via the second test, a NEW shape for a human to look at.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { isPlaceholderId } from "../../procurement/eik";

// ⚠ THE SKIP MUST COVER `tr_companies`, NOT JUST `contracts`. Test 2 reads it, and
// `db:load:tr:pg` is a REFRESH_EXCLUSIONS member — CLAUDE.md says the table "can be
// legitimately ABSENT". Probing only `contracts` meant a fresh clone that ran
// `db:refresh` did not skip here: it FAILED with 42P01.
const reachable = async (): Promise<boolean> => {
  if (!(await dbReachable())) return false;
  try {
    const [t] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.contracts') IS NOT NULL
          AND to_regclass('public.tr_companies') IS NOT NULL AS ok`,
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / contracts or tr_companies absent";

afterAll(async () => {
  await end();
});

describe("supplier ids — no filler in the corpus", () => {
  test.skipIf(skip)(
    "no contractor key is one the shipped rules call filler",
    async () => {
      // Pulled as DISTINCT keys and filtered in TS rather than re-expressed as
      // SQL: the predicate has one home (scripts/procurement/eik.ts) and a SQL
      // twin would be a second implementation free to drift from it — the exact
      // failure `shlyo_query_fold` and `declared_label` exist to prevent.
      const rows = await allRows<{ eik: string; rows: number; eur: number }>(
        `SELECT contractor_eik AS eik, COUNT(*)::int AS rows,
                COALESCE(SUM(amount_eur), 0)::float8 AS eur
           FROM contracts
          WHERE tag = 'contract' AND contractor_eik IS NOT NULL AND contractor_eik <> ''
          GROUP BY 1`,
      );
      assert.ok(rows.length > 20_000, `only ${rows.length} contractor keys — corpus looks empty`); // prettier-ignore

      const filler = rows
        .filter((r) => isPlaceholderId(r.eik))
        .sort((a, b) => b.eur - a.eur)
        .map((r) => `${r.eik} — ${r.rows} row(s), €${Math.round(r.eur).toLocaleString()}`); // prettier-ignore

      assert.deepEqual(
        filler,
        [],
        "filler supplier ids are back in the corpus. The parser fix only applies " +
          "at PARSE time, and neither re-ingest mode can re-key rows already on " +
          "disk (see scripts/procurement/rekey_placeholder_suppliers.ts). Re-run " +
          "that one-off, then the usual chain.",
      );
    },
  );

  test.skipIf(skip)(
    "no NEW filler shape is hiding as a plain EIK",
    async () => {
      // The denylist's blind spot, surfaced rather than guessed at. A filler that is
      // neither all-same-digit nor an ascending run — `000000007`, say — looks like an
      // ordinary EIK to every rule we have.
      //
      // ⚠ WHAT ACTUALLY HOLDS THIS GATE IS `tr_companies`, NOT THE NAME THRESHOLD.
      // Four ids match the regex today and three are REAL cooperatives — `000003338`,
      // `000003361`, `000003577` — excluded solely by being in the registry. So the
      // regex on its own IS the "small numbers are filler" rule that was rejected
      // during the fix (`000000210` is ДГС Гърмен, a live awarder). It is safe here
      // only because this gate re-keys nothing and because the registry filter runs.
      // Do not "simplify" by dropping the tr_companies clause or by loosening the
      // regex: one leading zero fewer admits 27 ids, nearly all real, including
      // `013092995` ХАБАУ — the foreign-id example supplier_identity.ts's own header
      // warns about.
      const [reg] = await allRows<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM tr_companies",
      );
      assert.ok(
        (reg?.n ?? 0) > 500_000,
        `tr_companies holds ${reg?.n ?? 0} rows — the clause that excludes the real ` +
          `cooperatives is not doing its job, so this gate would fire on them.`,
      );

      const rows = await allRows<{ eik: string; names: number; rows: number }>(
        `SELECT c.contractor_eik AS eik,
              COUNT(DISTINCT c.contractor_name)::int AS names,
              COUNT(*)::int AS rows
         FROM contracts c
        WHERE c.tag = 'contract'
          AND c.contractor_eik ~ '^0{5,}[0-9]{1,4}$'
          AND NOT EXISTS (SELECT 1 FROM tr_companies t WHERE t.uic = c.contractor_eik)
          AND NOT EXISTS (SELECT 1 FROM contracts a WHERE a.awarder_eik = c.contractor_eik)
        GROUP BY 1`,
      );

      // ⚠ KNOWN AND DELIBERATELY NOT FAILED ON. `000001111` is „Прокуест Ел Ел Си"
      // (ProQuest LLC) — a foreign publisher with no Bulgarian registration, 1 row,
      // €27,925. It IS filler, and the gate sees it. It is not failed on because a
      // filler's harm is POOLING — one row pools nothing — and adding it to
      // PLACEHOLDER_IDS without re-keying the corpus would simply move the failure to
      // test 1. Re-key it when something else forces a reload; until then it is
      // recorded here rather than silently missed.
      const KNOWN_SINGLE_ROW = new Set(["000001111"]);

      const pooling = rows
        .filter((r) => r.names >= 2 && !KNOWN_SINGLE_ROW.has(r.eik))
        .map((r) => `${r.eik} — ${r.names} names across ${r.rows} row(s)`);

      assert.deepEqual(
        pooling,
        [],
        "a heavily zero-padded contractor id sits in no register, is no one's " +
          "awarder, and already carries more than one supplier name — the shape of " +
          "a filler the denylist has not been told about. Inspect it; if it is " +
          "filler, add it to PLACEHOLDER_IDS in scripts/procurement/eik.ts AND " +
          "re-run scripts/procurement/rekey_placeholder_suppliers.ts, or test 1 " +
          "will fail next.",
      );
    },
  );
});
