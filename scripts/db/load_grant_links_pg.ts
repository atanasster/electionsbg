// Build grant_contract_link (migration 166) — the money spine: an EU grant to the
// procurement it paid for.
//
//   npm run db:load:grant-links:pg          (local)
//   npm run db:load:grant-links:pg:cloud    (Cloud SQL proxy)
//
// PURE DERIVATION, no external input: the ПИИ code is already written into
// `tenders.subject` and `contracts.title`, and `fund_projects.contract_number`
// already holds it. This extracts the join that has been sitting in the corpus
// unread.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ONE REGEX, ONE DEFINITION. `PII_CODE_RE` below is the only place the code's
// shape is written. It is deliberately ANCHORED to the full form —
// BG-RRP-<digits>.<digits>-<digits> — rather than a `BG-RRP` prefix: a prefix
// match would link a contract whose text merely mentions the programme, and
// „mentions the programme" is not „was paid for by this project".
//
// The three digit groups all matter. `BG-RRP-4.020-0003` is component 4,
// procedure 020, project 0003; truncating to the procedure would collapse every
// project under it into one spine and attribute one theatre's contractor to
// another's grant.
// ═══════════════════════════════════════════════════════════════════════════════
//
// ORDER: after db:load:tenders:pg AND db:load:pg. Both sides are read; with
// either missing the loader skips rather than writing half a spine.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withTx, vacuumAfterReload, end } from "./lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/166_grant_contract_link.sql",
);

/** The ПИИ code, in full and WIDTH-AWARE.
 *
 *  Every code ИСУН publishes is fixed-width — a 3-digit procedure and a 4-digit
 *  project, 14,180 of 14,180 — but procurement text is typed by hand and does not
 *  always pad: „BG-RRP-4.023-30" and „BG-RRP-1.012-002" are real, and mean 0030
 *  and 0002. So the pattern accepts 1–4 project digits and `canonicalise()` pads
 *  them, rather than the two obvious wrong answers: an unbounded `[0-9]+` (which
 *  stores the short form as if it were a distinct project, losing 5 real spine
 *  edges into „unknown to ИСУН"), or a strict `[0-9]{4}` (which drops them
 *  outright).
 *
 *  `(?![0-9])` rather than a word boundary. It is what stops a title truncated
 *  mid-code from yielding a short prefix of a longer code — and `\y` would
 *  additionally lose „BG-RRP-1.015-1911C01", where the suffix follows with no
 *  separator at all. */
const PII_CODE_RE = "BG-RRP-[0-9]+\\.[0-9]{3}-[0-9]{1,4}(?![0-9])";

/** Zero-pad the project ordinal to the four digits ИСУН publishes. Padding is a
 *  CANONICALISATION, not a guess: the segment is a fixed-width ordinal, so 30 and
 *  0030 are the same project and no other reading preserves the value.
 *
 *  A code that pads to something ИСУН does not have (a title cut off mid-code at
 *  the 200-char wall gives „BG-RRP-2.004-00" → „-0000") stays in the table and is
 *  counted by `unmatchedCodes` — visible, rather than silently attached to a
 *  neighbour. */

const main = async () => {
  const t0 = Date.now();
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  const [pre] = await allRows<{
    tenders: string;
    contracts: string;
    funds: string;
  }>(
    `SELECT (SELECT count(*) FROM tenders) tenders,
            (SELECT count(*) FROM contracts) contracts,
            (SELECT count(*) FROM fund_projects) funds`,
  );
  const missing = [
    !Number(pre.tenders) && "tenders (db:load:tenders:pg)",
    !Number(pre.contracts) && "contracts (db:load:pg)",
  ].filter(Boolean);
  if (missing.length) {
    console.warn(`  ⚠ grant-links: empty ${missing.join(", ")}.`);
    console.warn("    Leaving grant_contract_link untouched.");
    await end();
    process.exit(0);
  }

  const stats = await withTx(async (c) => {
    await c.query("DELETE FROM grant_contract_link");
    const t = await c.query(
      `INSERT INTO grant_contract_link
         (pii_code, link_kind, ref, confidence, basis)
       SELECT DISTINCT k.code, 'tender', t.unp, 'exact_code', 'tender_subject'
         FROM tenders t
         CROSS JOIN LATERAL (
           SELECT (regexp_matches(t.subject, $1, 'g'))[1] AS raw
         ) m
         CROSS JOIN LATERAL (SELECT regexp_replace(m.raw, '-[0-9]{1,4}$', '-' || lpad(regexp_replace(m.raw, '^.*-', ''), 4, '0')) AS code) k
        WHERE t.subject ~ $1 AND t.unp IS NOT NULL
       ON CONFLICT DO NOTHING`,
      [PII_CODE_RE],
    );
    const k = await c.query(
      `INSERT INTO grant_contract_link
         (pii_code, link_kind, ref, confidence, basis)
       SELECT DISTINCT k.code, 'contract', c2.key, 'exact_code', 'contract_title'
         FROM contracts c2
         CROSS JOIN LATERAL (
           SELECT (regexp_matches(c2.title, $1, 'g'))[1] AS raw
         ) m
         CROSS JOIN LATERAL (SELECT regexp_replace(m.raw, '-[0-9]{1,4}$', '-' || lpad(regexp_replace(m.raw, '^.*-', ''), 4, '0')) AS code) k
        WHERE c2.title ~ $1
       ON CONFLICT DO NOTHING`,
      [PII_CODE_RE],
    );
    return { tenders: t.rowCount ?? 0, contracts: k.rowCount ?? 0 };
  });

  await vacuumAfterReload("grant_contract_link");

  const [cov] = await allRows<{ r: Record<string, number> }>(
    `SELECT grant_contract_link_coverage() AS r`,
  );
  const c = cov.r;
  console.log(
    `grant-links: ${stats.tenders} tender + ${stats.contracts} contract link(s) · ` +
      `${c.linkedCodes} distinct ПИИ code(s), ${c.unmatchedCodes} of them unknown to ИСУН · ` +
      `RRF projects in ИСУН: ${c.rrfProjects} of ${c.fundProjects} in ${(
        (Date.now() - t0) /
        1000
      ).toFixed(1)}s`,
  );
  // Coverage is the number a spine surface must publish beside itself. Printing
  // it here is not decoration: it is the operator's only chance to notice that
  // the extraction found nothing before a page says „this grant bought nothing".
  if (!c.linkedCodes)
    console.warn(
      "  ⚠ grant-links: no ПИИ code was found in any tender or contract text. The corpus normally carries ~449 — check whether the subject/title columns changed shape.",
    );
  await end();
  process.exit(0);
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
