// Gate for `declaration_asset.is_spouse` — WHOSE the declared thing is.
//
// THE RULE. Each asset row names its holder („Собственик или титуляр на правото"), and that
// person is frequently NOT the declarant. `isSpouseHolder` (src/lib/declarations.ts) is the
// one definition of „this row is somebody else's", and it is read from TWO sides that cannot
// share a query: the PARSER stores it here at parse time, while the /person stake renderer
// derives it live from `holderName` + `declarantName`, because `declaration_stake` has no
// such column.
//
// WHY THIS TEST. That split is the whole exposure. The rule is a pure function of two fields
// this table already carries, so the stored column is reproducible EXACTLY — which means any
// disagreement is a real defect and never an ambiguity, unlike the parse-time provenance in
// `held_scope` / `value_basis` / `table_num`, where SQL cannot check the parser's work at all.
// Concretely, the failure this catches is: someone changes the fold (a live example — the
// separator-only second pass added 2026-08-19, which cleared 563 rows), the renderer picks it
// up on the next build because it computes live, and the stored column keeps the OLD answer
// until `scripts/declarations/backfill_asset_is_spouse.ts` and a reload. Between those two the
// same corpus says two different things about whose company a named individual holds — a claim
// about a real person, on their own page.
//
// It is deliberately a FULL-CORPUS recompute rather than a sample: the rows that move are the
// register's hand-typing accidents (a lost space, a hyphen for a space, a stray comma or
// digit), which are by definition rare and unevenly spread, so a sample can miss all of them.
// 335,676 rows recompute in well under a second.
//
// Auto-skips when Postgres is down or the corpus is empty.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { isSpouseHolder, normHolderName } from "../../../src/lib/declarations";

const n = (v: unknown): number => Number(v ?? 0);

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_asset') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_asset",
    );
    return n(c.n) > 0;
  } catch {
    return false;
  }
};

type Row = {
  holder_name: string | null;
  declarant_name: string;
  is_spouse: boolean;
  source_url: string;
  seq: number;
};

const corpus = (): Promise<Row[]> =>
  allRows<Row>(
    `SELECT a.holder_name, d.declarant_name, a.is_spouse, d.source_url, a.seq
       FROM declaration_asset a JOIN declaration d USING (declaration_id)`,
  );

test("every stored is_spouse re-derives from the row's own holder and declarant", async () => {
  if (!(await reachable())) return;
  const rows = await corpus();
  const bad = rows.filter(
    (r) => r.is_spouse !== isSpouseHolder(r.holder_name, r.declarant_name),
  );
  const sample = bad
    .slice(0, 10)
    .map(
      (r) =>
        `  stored=${r.is_spouse} holder=${JSON.stringify(r.holder_name)} declarant=${JSON.stringify(r.declarant_name)}\n    ${r.source_url} seq=${r.seq}`,
    )
    .join("\n");
  assert.equal(
    bad.length,
    0,
    `${bad.length} of ${rows.length} asset row(s) disagree with isSpouseHolder — the fold changed and the corpus was not restamped. Run:\n` +
      `  npx tsx scripts/declarations/backfill_asset_is_spouse.ts --apply\n` +
      `  npm run db:load:declarations:pg\n` +
      `  npm run db:load:declarations:pg -- --resolve\n${sample}`,
  );
});

// An assertion that only ever compares the column to a function is satisfied by an inverted
// implementation both sides agree on, and by a corpus where nothing is marked at all. Pin the
// shape independently: the column must discriminate, and it must be the MINORITY answer.
test("the column discriminates and stays the minority answer", async () => {
  if (!(await reachable())) return;
  const [c] = await allRows<{ total: string; spouse: string; named: string }>(
    `SELECT count(*) total,
            count(*) FILTER (WHERE is_spouse) spouse,
            count(*) FILTER (WHERE holder_name IS NOT NULL AND btrim(holder_name) <> '') named
       FROM declaration_asset`,
  );
  const total = n(c.total);
  const spouse = n(c.spouse);
  assert.ok(
    spouse > 0,
    "no asset row is marked as somebody else's — the rule is not firing",
  );
  assert.ok(
    spouse < n(c.named),
    "every named holder is somebody other than the declarant — the fold has stopped matching",
  );
  // Measured 2026-08-19: 110,272 of 335,676 (32.9%). A band wide enough to survive a corpus
  // refresh and narrow enough to fail if the fold degenerates in either direction.
  const pct = (spouse / total) * 100;
  assert.ok(
    pct > 20 && pct < 50,
    `${spouse} of ${total} rows (${pct.toFixed(1)}%) marked as somebody else's — outside the 20-50% band`,
  );
});

// The separator-only second pass is the current fold's distinguishing property, and it is the
// half that a future "simplification" back to a bare `h !== d` would silently undo. Prove it is
// live against the corpus's own worst spellings rather than against a fixture: if any of these
// is stored as somebody else's holding, the running corpus predates the fold.
test("a declarant's own name survives the register's mangled spellings", async () => {
  if (!(await reachable())) return;
  const rows = await corpus();
  // The discriminator has to be the SECOND pass's own contribution, not „the folds differ" —
  // `normHolderName` alone already rescues a hyphen respaced („Димитриева - Николова"), so a
  // looser filter stays non-empty with the second pass deleted and the test proves nothing.
  // These are exactly the rows the first pass calls somebody else and the second reclaims.
  const selfMangled = rows.filter((r) => {
    const h = normHolderName(r.holder_name);
    const d = normHolderName(r.declarant_name);
    return (
      h !== "" &&
      d !== "" &&
      h !== d &&
      !isSpouseHolder(r.holder_name, r.declarant_name)
    );
  });
  assert.ok(
    selfMangled.length > 0,
    "no row is rescued by the separator fold — either the corpus changed or isSpouseHolder lost its second pass",
  );
  assert.ok(
    selfMangled.every((r) => r.is_spouse === false),
    "a row the fold rescues is still stored as somebody else's — the corpus needs restamping",
  );
});

afterAll(async () => {
  await end();
});
