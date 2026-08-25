// Gate for the three EVIDENCE-BASIS lines in the „Връзки" section of `/person/:name`
// (dev/PersonScreen.tsx + PersonAssociatesTile.tsx). Those lines are PROSE THAT ASSERTS
// A PROPERTY OF THE CORPUS — "mass nominees are excluded", "declared holdings are not in
// the registry", "this pair does not appear together". No component test can check any of
// them: the fixtures are hand-written, so a claim about 1M registry rows passes against
// three objects in a test file.
//
// Both of the section's shipped defects were exactly this shape, and both were found by
// running the claim against Postgres rather than by reading the code:
//
//   • The partners line said mass nominees / registered agents were excluded. Measured,
//     the `company_count <= 300` join drops ONE name-fold corpus-wide and it is not a
//     person — „Заличено обстоятелство.", the registry's deleted-fact placeholder. Every
//     actual nominee passes and renders as somebody's business partner. (024's OWN
//     comment makes the same wrong claim, which is why it was copied in good faith and
//     why this file asserts against the DATA and never against that comment.)
//
//   • The connection check reported a miss as „не са вписани заедно … в Търговския
//     регистър" — a claim about the register — when what was searched is our copy of it,
//     which carries officers for a minority of companies.
//
// So the assertions here are deliberately INVERTED from the usual shape: they do not
// check that the copy is present, they check that the PREMISES the copy rests on still
// hold. Each one fails when the corpus moves in the direction that would make a
// currently-true sentence false — which is the only moment anyone would otherwise have
// to notice, and nobody re-reads shipped prose.
//
// Auto-skips ONLY when Postgres is down.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { stripComments } from "../../lib/strip_comments";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const here = dirname(fileURLToPath(import.meta.url));

const src = (rel: string): string =>
  stripComments(readFileSync(resolve(here, "../../../src", rel), "utf8"));

/** The text of every `<EvidenceBasis>` element in a file — i.e. the basis lines a reader
 *  actually sees, and nothing else.
 *
 *  Scoping to the ELEMENT rather than the file is load-bearing, and it bit on the first
 *  run of this gate. Each of these components carries a ⚠️ comment explaining WHY the
 *  copy may not make a given claim, and such a comment must quote the forbidden wording
 *  to be useful. A file-wide scan fails on the very warning that keeps the defect from
 *  coming back — punishing the documentation and teaching the next author to delete it.
 *  `stripComments` alone does not save us: these are JSX brace-wrapped block comments,
 *  which its anchored form deliberately leaves (an unanchored strip swallows code from
 *  any slash-star inside a string). Reading only what is RENDERED sidesteps the question
 *  entirely, and is the more precise check anyway — the claim under test is one a reader
 *  sees, not one the file happens to contain. */
const basisText = (rel: string): string => {
  const code = src(rel);
  const found = [
    ...code.matchAll(/<EvidenceBasis>([\s\S]*?)<\/EvidenceBasis>/g),
  ].map((m) => m[1]);
  assert.ok(
    found.length > 0,
    `${rel} renders no <EvidenceBasis> — the basis line this gate exists to check is ` +
      "gone, or the element was renamed.",
  );
  return found.join("\n");
};

/** The mega-hub cut in `person_associates` (024). Kept in one place so the two tests
 *  below cannot come to disagree about which threshold the copy is being judged against. */
const MEGA_HUB_CUT = 300;

test.skipIf(skip)(
  "the mega-hub cut still removes only registry bookkeeping, so the copy must not promise a nominee filter",
  async () => {
    const rows = await allRows<{ name_fold: string; company_count: number }>(
      `SELECT name_fold, company_count FROM officer_name_counts
        WHERE company_count > $1 ORDER BY company_count DESC`,
      [MEGA_HUB_CUT],
    ).catch(() => null);
    assert.ok(rows, "officer_name_counts is absent — run db:load:tr:pg");
    assert.ok(
      rows.length > 0,
      `nothing exceeds ${MEGA_HUB_CUT} companies — the cut has become a no-op entirely`,
    );

    // Whether the cut removes any actual PERSON. Today: no — the sole entry is the
    // deleted-fact placeholder, which is why the copy may not claim a nominee filter.
    const people = rows.filter(
      (r) => !/zalicheno|obstoyatelstvo/.test(r.name_fold),
    );
    const tile = basisText(
      "screens/components/procurement/PersonAssociatesTile.tsx",
    );

    if (people.length === 0) {
      assert.ok(
        !/масови пълномощници|mass nominees/.test(tile),
        "PersonAssociatesTile promises mass nominees are excluded, but the >" +
          `${MEGA_HUB_CUT} cut removes only ${rows.map((r) => r.name_fold).join(", ")} ` +
          "— the registry's own bookkeeping entry, not a person. Every real nominee " +
          "passes and renders as a partner. Fix the COPY, never the filter: the " +
          "entity-name regexes below it do not match the placeholder, so this cut is " +
          "the only thing keeping it out of every associates list.",
      );
    } else {
      // The corpus moved: real nominees are now being cut. That would make the OLD
      // wording true again and the current wording an understatement — a decision for a
      // human, not a silent pass.
      assert.fail(
        `${people.length} non-placeholder name-fold(s) now exceed ${MEGA_HUB_CUT} ` +
          `(${people
            .slice(0, 5)
            .map((r) => `${r.name_fold}=${r.company_count}`)
            .join(
              ", ",
            )}). PersonAssociatesTile's basis line says only the registry's ` +
          "bookkeeping entries are excluded, which is now too narrow — re-measure and " +
          "rewrite it.",
      );
    }
  },
);

test.skipIf(skip)(
  "tr_officers coverage is still partial, so a connection miss may not be phrased as a fact about the register",
  async () => {
    const [row] = await allRows<{ with_officers: string; total: string }>(
      `SELECT (SELECT count(DISTINCT uic) FROM tr_officers)::text AS with_officers,
              (SELECT count(*) FROM tr_companies)::text          AS total`,
    ).catch(() => [] as { with_officers: string; total: string }[]);
    assert.ok(row, "tr_officers / tr_companies absent — run db:load:tr:pg");

    const total = Number(row.total);
    assert.ok(total > 0, "tr_companies is empty");
    const coverage = Number(row.with_officers) / total;

    // The whole (comment-stripped) file: unlike the basis lines, the miss message is
    // rendered in the result branch, not inside an <EvidenceBasis>.
    const screen = src("screens/dev/PersonScreen.tsx");
    // Below near-complete coverage, `connection_between` cannot support a claim about
    // the Commerce Registry — only about our extract of it. Measured 2026-08-25: 41%.
    if (coverage < 0.95) {
      assert.ok(
        /В нашите данни/.test(screen),
        `tr_officers covers ${(coverage * 100).toFixed(1)}% of companies, so the ` +
          "connection check's miss message must scope its claim to our data " +
          '("В нашите данни от Търговския регистър …"). It does not — as written it ' +
          "publishes an unqualified negative about two named individuals.",
      );
      assert.ok(
        !/не са вписани заедно в нито една\s+фирма в Търговския регистър/.test(
          screen,
        ),
        "The miss message asserts the pair is absent from the Commerce Registry " +
          `itself, over a store covering ${(coverage * 100).toFixed(1)}% of companies.`,
      );
    }
  },
);

test.skipIf(skip)(
  "the political basis line names every kind the declaration arm can emit",
  async () => {
    // `company_politicians.role` carries two DECLARATION codes (load_tr_pg.ts's
    // `stake_kind` CASE) and the card renders both, so a basis naming only stakes
    // leaves „декларирана длъжност" rows unexplained. A third code arriving must fail
    // here rather than reach the page unlabelled.
    const rows = await allRows<{ role: string; n: string }>(
      `SELECT role, count(*)::text AS n FROM company_politicians
        WHERE role IN ('stake', 'declared_role') GROUP BY role`,
    ).catch(() => null);
    assert.ok(rows, "company_politicians is absent — run db:load:tr:pg");

    const screen = src("screens/dev/PersonScreen.tsx");
    const basis = basisText("screens/dev/PersonScreen.tsx");
    const kinds = new Set(rows.map((r) => r.role));
    if (kinds.has("stake")) {
      assert.ok(
        /декларирани дялове/.test(basis),
        "declared stakes exist but the political basis line does not mention them",
      );
    }
    if (kinds.has("declared_role")) {
      assert.ok(
        /декларирани дялове и длъжности/.test(basis),
        `${rows.find((r) => r.role === "declared_role")?.n} declared_role rows exist ` +
          "and render as „декларирана длъжност“, but the political basis " +
          "line names only stakes — add „и длъжности“.",
      );
    }
    // Both labels must exist in the renderer for whichever kinds the corpus holds.
    for (const kind of kinds) {
      assert.ok(
        screen.includes(`role === "${kind}"`),
        `company_politicians holds role='${kind}' with no branch in ` +
          "politicianRoleLabel — it would render as a raw English token.",
      );
    }
  },
);
