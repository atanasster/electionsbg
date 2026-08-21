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
// ═══════════════════════════════════════════════════════════════════════════════
// AND ONE REGEX IS NOT ENOUGH — A CODE MATCH IS NOT AN ATTRIBUTION.
//
// The first cut of this loader stored every row as `exact_code`, which read as
// „this grant paid for this contract". It does not follow, and 22 of 2,616 rows
// were the counter-example. Two independent corroborations are now derived per
// row, stored beside the verdict, and the verdict itself is CHECK-enforced in 166
// so this loader cannot label a row against its own evidence:
//
//   code_verbatim — the full 4-digit code appeared in the text, rather than being
//                   padded there by `canonicalise()`. See that function's header:
//                   a padded code can land on a REAL project belonging to someone
//                   else, which is not a hypothetical.
//   buyer_basis   — the procuring buyer (`contracts.awarder_eik` /
//                   `tenders.buyer_eik`) against `fund_projects.beneficiary_eik`.
//
// Both must hold for `code_and_buyer`, the only tier a surface may cite. Anything
// else is `code_only`: the code appears, and we are not claiming more. The rule
// itself lives ONCE, as `grant_link_confidence(boolean, text)` in 166; this loader
// CALLS it rather than reproducing it, so the INSERT and the CHECK cannot drift.
//
// ⚠️ A MISMATCHED BUYER IS NOT A REJECTED ROW. ИСУН publishes the LEAD
// beneficiary only — no partner list exists anywhere in the corpus — so a project
// partner procuring under the project's own code is indistinguishable from a
// buyer citing somebody else's. BG-RRP-8.013-0015 is titled „Устойчива градска
// мобилност в общините Шумен и Търговище", ИСУН names Шумен, and Търговище is the
// buyer: dropping that row would delete a link the project's own title asserts.
// So the rows are kept, downgraded, and counted in
// `grant_contract_link_coverage()`; the refusal is visible rather than silent.
// ═══════════════════════════════════════════════════════════════════════════════
//
// ORDER: after db:load:tenders:pg AND db:load:pg. Both sides are read; with
// either missing the loader skips rather than writing half a spine. `fund_projects`
// is read too, for the buyer corroboration — an empty funds corpus does NOT skip
// the load, it makes every row `buyer_basis = 'unknown'`, which is the honest
// answer and is reported.

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
 *  ⚠️ AND IT IS ONLY A CANONICALISATION WHILE THE SHORT SPELLING REALLY WAS THE
 *  SHORT SPELLING. This note used to say a bad pad „stays in the table and is
 *  counted by `unmatchedCodes` — visible, rather than silently attached to a
 *  neighbour". That is not guaranteed, and two live rows disprove it:
 *
 *    · Столична община's publicity contract is TRUNCATED at 367 characters
 *      mid-code — „…, № BG-RRP-1.007-0207-СО1, № BG-RRP-1.007-017" — and `017`
 *      pads to `0017`, which is a REAL project belonging to Община Добрич.
 *    · Район „Искър" writes „по проект № BG-RRP-4.023-30" untruncated; `-0030`
 *      is Община Свищов's project, in another town.
 *
 *  Measured 2026-08-21: padded spellings are 9 of 2,616 links but carry 2 of the
 *  15 buyer mismatches — 22% against 0.5% for verbatim ones, a 45× rate. So the
 *  padding is kept (it recovers 6 links that are otherwise lost) and RECORDED:
 *  `code_verbatim = false` bars the row from the citable tier however plausible
 *  the buyer looks. Recovering a link and vouching for it are different acts. */

/** The two arms. Written once as a template rather than twice as SQL, because the
 *  corroboration derivation must be IDENTICAL on both sides and identical to
 *  166's CHECK — three copies of a CASE expression is how they drift. */
const ARMS = [
  {
    label: "tender",
    kind: "tender",
    basis: "tender_subject",
    from: "tenders t",
    ref: "t.unp",
    buyer: "t.buyer_eik",
    text: "t.subject",
    where: "t.unp IS NOT NULL",
  },
  {
    label: "contract",
    kind: "contract",
    basis: "contract_title",
    from: "contracts c",
    ref: "c.key",
    buyer: "c.awarder_eik",
    text: "c.title",
    where: "TRUE",
  },
] as const;

/** One arm's INSERT. $1 is PII_CODE_RE.
 *
 *  The `bool_or` fold is what keeps the row DETERMINISTIC. One text can name the
 *  same canonical code twice — once verbatim and once padded from a short
 *  spelling — which is two `hit` rows that differ only in `code_verbatim`. The
 *  old `SELECT DISTINCT` could not collapse those, so `ON CONFLICT DO NOTHING`
 *  would keep whichever the planner emitted first. A verbatim occurrence anywhere
 *  in the text corroborates the code, so OR is also the right reading. */
const armSql = (a: (typeof ARMS)[number]) => `
WITH hit AS (
  SELECT ${a.ref} AS ref, ${a.buyer} AS buyer, m.raw, k.code
    FROM ${a.from}
    CROSS JOIN LATERAL (
      SELECT (regexp_matches(${a.text}, $1, 'g'))[1] AS raw
    ) m
    CROSS JOIN LATERAL (
      SELECT regexp_replace(
               m.raw, '-[0-9]{1,4}$',
               '-' || lpad(regexp_replace(m.raw, '^.*-', ''), 4, '0')
             ) AS code
    ) k
   WHERE ${a.text} ~ $1 AND ${a.where}
),
folded AS (
  SELECT code, ref, buyer, bool_or(raw = code) AS code_verbatim
    FROM hit GROUP BY code, ref, buyer
),
judged AS (
  SELECT h.code, h.ref, h.code_verbatim,
         CASE
           WHEN h.buyer IS NULL OR f.beneficiary_eik IS NULL THEN 'unknown'
           WHEN f.beneficiary_eik = h.buyer                  THEN 'beneficiary'
           ELSE 'other_buyer'
         END AS buyer_basis
    FROM folded h
    LEFT JOIN fund_projects f ON f.contract_number = h.code
)
INSERT INTO grant_contract_link
  (pii_code, link_kind, ref, confidence, basis, code_verbatim, buyer_basis)
SELECT j.code, '${a.kind}', j.ref,
       -- ⚠️ CALL the rule, never restate it. grant_link_confidence() in 166 is
       -- the ONE definition of this verdict and is what 166's CHECK enforces, so
       -- a hand-written CASE here could only ever agree with it by luck — and
       -- would abort the load the moment it did not.
       grant_link_confidence(j.code_verbatim, j.buyer_basis),
       '${a.basis}', j.code_verbatim, j.buyer_basis
  FROM judged j
ON CONFLICT DO NOTHING`;

/** Does a public relation exist? A separate round trip on purpose: Postgres
 *  resolves every relation in a statement at PARSE time, so `to_regclass(...)`
 *  and `SELECT count(*) FROM that_table` cannot share a query — the second half
 *  raises 42P01 before the first half can answer. */
const relationExists = async (name: string) =>
  Boolean(
    (
      await allRows<{ r: string | null }>(
        `SELECT to_regclass('public.' || $1)::text r`,
        [name],
      )
    )[0]?.r,
  );

const linkRowCount = async () =>
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*)::text n FROM grant_contract_link`,
      )
    )[0]?.n ?? 0,
  );

/** The two labels `ARMS` declares, as a literal union. Typing the accumulator
 *  with this rather than `Record<string, number>` is what makes `stats.tender`
 *  and `stats.contract` below checked: with the wide type, renaming an arm's
 *  label compiles fine and prints „undefined tender + undefined contract". */
type ArmLabel = (typeof ARMS)[number]["label"];

const main = async () => {
  const t0 = Date.now();

  // ⚠️ 166's reconcile DELETE runs inside this exec(), BEFORE any preflight, and
  // clears every row that cannot satisfy the derived-confidence shape (legacy
  // rows with NULL provenance; any row whose stored verdict disagrees with
  // grant_link_confidence). That is the REPAIR path and it has to stay ahead of
  // the preflight — the alternative, preflighting first, is the failure
  // db:load:tender-dossier:pg was written for, where a skip leaves a database
  // with no schema at all. So the deletion is REPORTED rather than prevented,
  // and the skip message below can no longer claim nothing happened.
  const before = (await relationExists("grant_contract_link"))
    ? await linkRowCount()
    : 0;
  await exec(fs.readFileSync(SCHEMA, "utf8"));
  const after = await linkRowCount();
  const cleared = before - after;
  if (cleared > 0)
    console.warn(
      `  ⚠ grant-links: 166's reconcile dropped ${cleared} row(s) that could ` +
        `not satisfy the derived-confidence shape. They are rebuilt below.`,
    );

  // ⚠️ ABSENT is not EMPTY, and only one of them is survivable. armSql LEFT JOINs
  // fund_projects, so an absent table raises 42P01 mid-INSERT — reported here by
  // name instead, beside the two corpora that already got a named skip.
  const fundsPresent = await relationExists("fund_projects");
  const [pre] = await allRows<{
    tenders: string;
    contracts: string;
  }>(
    `SELECT (SELECT count(*) FROM tenders) tenders,
            (SELECT count(*) FROM contracts) contracts`,
  );
  const funds = fundsPresent
    ? Number(
        (
          await allRows<{ n: string }>(
            `SELECT count(*)::text n FROM fund_projects`,
          )
        )[0]?.n ?? 0,
      )
    : 0;
  const missing = [
    !Number(pre.tenders) && "tenders (db:load:tenders:pg)",
    !Number(pre.contracts) && "contracts (db:load:pg)",
    !fundsPresent && "fund_projects — table absent (db:load:funds:pg)",
  ].filter(Boolean);
  if (missing.length) {
    console.warn(`  ⚠ grant-links: empty ${missing.join(", ")}.`);
    // The whole point of FINDING-001: after a reconcile that emptied the table,
    // „untouched" is the one thing that stops an operator re-running this.
    console.warn(
      cleared > 0
        ? `    grant_contract_link is now EMPTY — ${cleared} row(s) were cleared ` +
            `by the migration and NOT rebuilt. Re-run once the corpora load.`
        : "    Leaving grant_contract_link untouched.",
    );
    await end();
    process.exit(0);
  }
  // NOT a skip: a database whose funds corpus has never been loaded (a fresh
  // clone) is a legitimate state, and the honest result is a spine every row of
  // which is `code_only` because nothing could corroborate it.
  //
  // ⚠️ This is NOT a licence to run the two in either order. In db:refresh funds
  // ALWAYS precedes this loader, and refresh_coverage.test.ts's ORDER_PAIRS
  // enforces it — a STALE beneficiary is worse than an absent one, because it can
  // PROMOTE a link to authoritative rather than merely withhold the verdict.
  // Warn, so an empty corpus is never read as „the buyer check found 2,616
  // problems".
  if (!funds)
    console.warn(
      "  ⚠ grant-links: fund_projects is empty — every link will be 'code_only' " +
        "(buyer_basis='unknown'). Run db:load:funds:pg, then re-run this loader.",
    );

  const stats = await withTx(async (c) => {
    await c.query("DELETE FROM grant_contract_link");
    const out = {} as Record<ArmLabel, number>;
    for (const a of ARMS) {
      const r = await c.query(armSql(a), [PII_CODE_RE]);
      out[a.label] = r.rowCount ?? 0;
    }
    return out;
  });

  await vacuumAfterReload("grant_contract_link");

  const [cov] = await allRows<{ r: Record<string, number> }>(
    `SELECT grant_contract_link_coverage() AS r`,
  );
  const c = cov.r;
  console.log(
    `grant-links: ${stats.tender} tender + ${stats.contract} contract link(s) · ` +
      `${c.linkedCodes} distinct ПИИ code(s), ${c.unmatchedCodes} of them unknown to ИСУН · ` +
      `RRF projects in ИСУН: ${c.rrfProjects} of ${c.fundProjects} in ${(
        (Date.now() - t0) /
        1000
      ).toFixed(1)}s`,
  );
  // The corroboration split, printed every run. A spine surface may cite only the
  // first number; an operator who never sees the second will quote the first as
  // if it were an attribution, which is the defect this loader was rebuilt for.
  console.log(
    `  citable (code_and_buyer): ${c.citableEdges} link(s) over ${c.citableCodes} code(s) · ` +
      `code_only: ${c.codeOnlyEdges} — ${c.buyerMismatchEdges} buyer mismatch(es) ` +
      `over ${c.buyerMismatchCodes} code(s), ${c.paddedCodeEdges} padded code(s) · ` +
      `${c.codesWithoutCitableLink} code(s) have NO citable link`,
  );
  // Coverage is the number a spine surface must publish beside itself. Printing
  // it here is not decoration: it is the operator's only chance to notice that
  // the extraction found nothing before a page says „this grant bought nothing".
  if (!c.linkedCodes)
    console.warn(
      "  ⚠ grant-links: no ПИИ code was found in any tender or contract text. The corpus normally carries ~449 — check whether the subject/title columns changed shape.",
    );
  else if (!c.citableEdges)
    console.warn(
      "  ⚠ grant-links: codes were found but NOT ONE is citable — every link failed " +
        "buyer corroboration. Check that fund_projects is loaded and that " +
        "contracts.awarder_eik / tenders.buyer_eik are populated.",
    );
  await end();
  process.exit(0);
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
