// The two writers of `MunicipalIndexEntry.role`, held to the same answer (T2 / TEST-004).
//
// `scripts/officials/municipal.ts` computes the published role as it parses each filing;
// `scripts/officials/restamp_roles.ts` re-derives it offline from Postgres. They are two code
// paths writing one published field — the shape this repo gates with a recompute
// (declaration_filed_position.data.test.ts, tr_owner_share.data.test.ts) rather than with a
// comment — and the field says which office a named person holds, so a disagreement is a false
// statement about an individual rather than a drifted statistic.
//
// The assertion is that a dry-run restamp over the COMMITTED index reports zero pending
// changes. It goes red in both useful directions: the ingest stopped applying the rule (rows
// the restamp would now promote), and the corpus was restamped under a rule that has since
// been narrowed (rows it would now put back).
//
// Auto-skips when Postgres is down or the declarations are unloaded, like its neighbours.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { restampRoles } from "../../officials/restamp_roles";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration WHERE tier = 'muni' AND subject_ref IS NOT NULL",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / no muni declarations loaded — `npm run db:load:declarations:pg`";
reportSkip(import.meta.url, skip);
afterAll(async () => {
  if (haveDb) await end();
});

test.skipIf(skip)(
  "the committed roster's published roles agree with the declarants' own filings",
  async () => {
    // Dry run: reads only. `--allow-partial` is deliberately NOT passed — a corpus whose
    // declarations are a different vintage from its shard tree cannot answer this question,
    // and the restamp's own 95% floor throws with that diagnosis rather than letting the
    // assertion pass on rows nobody checked.
    const pending = await restampRoles(false);
    assert.equal(
      pending,
      0,
      `${pending} municipal official(s) have a published role that disagrees with their own ` +
        "filed position. Either the ingest stopped applying scripts/officials/role_reconcile.ts, " +
        "or the rule changed since the corpus was stamped. Re-derive with " +
        "`npx tsx scripts/officials/restamp_roles.ts --apply`, then re-emit the shards and " +
        "reload — the command list is in that file's header.",
    );
  },
);
