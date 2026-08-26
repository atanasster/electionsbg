// The ЕТ's owner must actually reach `tr_person_roles` — the corpus half of the
// `PhysicalPersonTrader` fix.
//
// WHY: `PERSON_SECTION_TO_ROLE` (parse_daily_filing.ts) is an ALLOWLIST, so the section
// naming the natural person behind an ЕТ was not mis-parsed before 2026-08-26 — it was
// silently DROPPED. That is the worst shape of failure this repo keeps warning about: the
// ЕТ rows were present and complete on every count, they simply had no person, which is
// indistinguishable from the ordinary pre-2021 genesis gap the CR Deeds capture exists for.
// Nothing failed, nothing was empty, and /company/:eik rendered „Няма вписани лица." for
// 99.3% of sole traders.
//
// So the parser test alone is not enough: it proves the event is emitted, not that the row
// survives replay → SQLite → `db:load:tr:pg`. A regression anywhere along that chain puts
// the corpus back where it was, at a 200.
//
// ⚠️ SKIPS WITH A DISTINCT REASON on a corpus no post-fix `tr:daily-refresh` +
// `db:load:tr:pg` has rebuilt. That is not the same statement as „the rule is enforced" and
// must never read as one — the change is INERT until the corpus is re-derived, exactly like
// the `table_num` / `value_basis` / `held_scope` backfills in 089.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

// ⚠️ BOTH SPELLINGS, ALWAYS. `tr_companies.legal_form` stores ЕТ two ways — the deed
// header's code `ET` (23,384 rows) and the 00030 meta field's spelled-out
// „Едноличен търговец" (6,868) — because they arrive by different paths. Filtering on `ET`
// alone silently measures 77% of the population and reports a healthy ratio over the wrong
// denominator.
const ET_FORMS = "('ET', 'Едноличен търговец')";

const haveDb = await dbReachable();
const one = async (sql: string): Promise<number> =>
  Number(
    (await allRows<{ n: string }>(sql).catch(() => [{ n: "0" }]))[0]?.n ?? 0,
  );

const etCount = haveDb
  ? await one(
      `SELECT count(*) n FROM tr_companies WHERE legal_form IN ${ET_FORMS}`,
    )
  : 0;
const traderRows = haveDb
  ? await one(
      "SELECT count(*) n FROM tr_person_roles WHERE role = 'sole_trader'",
    )
  : 0;

const skip = !haveDb
  ? "Postgres unreachable"
  : etCount === 0
    ? "TR corpus not loaded (no ЕТ rows)"
    : traderRows === 0
      ? "corpus predates the PhysicalPersonTrader fix — re-derive with " +
        "`npm run tr:daily-refresh` then `npm run db:load:tr:pg`, or this gate is vacuous"
      : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the daily feed's ЕТ traders reach tr_person_roles",
  async () => {
    // Measured over all 1,686 daily files on 2026-08-26: 8,000 of 30,252 distinct ЕТ carry
    // a `PhysicalPersonTrader` record already on disk (7,999 Add + 1 Erase-only). The floor
    // is deliberately well under that rather than pinned to it — the feed grows, and an
    // exact ratchet would fail on the next ingest for no reason — but far enough above the
    // pre-fix state (200 ЕТ with any person at all) that a silent revert cannot pass.
    const withTrader = await one(
      `SELECT count(DISTINCT uic) n FROM tr_person_roles WHERE role = 'sole_trader'`,
    );
    assert.ok(
      withTrader >= 7_000,
      `only ${withTrader} ЕТ carry a sole_trader row, against ~8,000 available in the ` +
        `daily feed. Either the corpus predates a full re-derive, or PhysicalPersonTrader ` +
        `has stopped being parsed (parse_daily_filing.ts / PERSON_SECTION_TO_ROLE)`,
    );
  },
);

test.skipIf(skip)("every sole_trader row sits on an ЕТ", async () => {
  // The section is ЕТ-only in the source — measured, 0 `PhysicalPersonTrader` groups on any
  // other legal form. A row elsewhere means the section was matched on the wrong deed, and
  // it would publish „едноличен търговец" against a company that is not one.
  const stray = await one(
    `SELECT count(*) n
       FROM tr_person_roles r
       JOIN tr_companies c ON c.uic = r.uic
      WHERE r.role = 'sole_trader' AND c.legal_form NOT IN ${ET_FORMS}`,
  );
  assert.equal(stray, 0, `${stray} sole_trader rows sit on a non-ЕТ company`);
});

test.skipIf(skip)("a trader declares no capital share", async () => {
  // An ЕТ files no дял, because the trader and the firm are one legal subject. A stored
  // amount here would be a number nobody filed, and `tr_owner_share` — which deliberately
  // excludes the role — could not catch it, since it never reads these rows.
  const withShare = await one(
    `SELECT count(*) n FROM tr_person_roles
      WHERE role = 'sole_trader' AND share_amount IS NOT NULL`,
  );
  assert.equal(
    withShare,
    0,
    `${withShare} sole_trader rows carry a share_amount the register does not publish`,
  );
});

test.skipIf(skip)(
  "the role stays out of the ownership-share denominator",
  async () => {
    // `tr_owner_share` (003) apportions a declared капитал. An ЕТ has none, so admitting
    // the role there would hand it a NULL percentage AND put it in other companies'
    // denominators. The exclusion is asserted here rather than trusted because the view is
    // a different file from the parser and the two drift independently.
    const inView = await one(
      `SELECT count(*) n FROM tr_owner_share WHERE role = 'sole_trader'`,
    );
    assert.equal(
      inView,
      0,
      "tr_owner_share admitted `sole_trader` — see the role's comment in " +
        "scripts/declarations/tr/types.ts for why it must not",
    );
  },
);

test.skipIf(skip)("the role is labelled in both languages", async () => {
  // The token is copied VERBATIM to the UI (see TrRole's header). This is a corpus-side
  // gate rather than a UI one on purpose: it fires only once rows actually exist, which is
  // the moment an unlabelled role becomes visible to a reader.
  const { readFileSync } = await import("node:fs");
  for (const lang of ["bg", "en"]) {
    const corpus = JSON.parse(
      readFileSync(`src/locales/${lang}/translation.json`, "utf-8"),
    ) as Record<string, string>;
    for (const key of ["tr_role_sole_trader", "procurement_rel_sole_trader"]) {
      assert.ok(
        corpus[key],
        `${lang}/translation.json has no \`${key}\` — ${traderRows} rows carry this role, ` +
          `so every page showing one publishes the raw ASCII token to the reader`,
      );
    }
  }
});
