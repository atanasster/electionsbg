// The CR deed's седалище must actually reach `tr_companies.seat` — and in the shape the
// place resolver can read.
//
// WHY: the arcs on `/` are drawn buyer→contractor by OBLAST, and a contractor's oblast comes
// from `tr_company_place`, which resolves `tr_companies.seat`. 693,932 of 1,023,673 companies
// (67.8%, measured 2026-09-06) carry no seat at all, because the daily feed only re-states
// the field when a company files — so a firm that has not filed since 2021 is invisible to
// every place surface on the site. The CR Deeds captures carry the answer for 29,417 of them
// and it reached nothing: the parser read it and no writer stored it, exactly as
// `subject_of_activity` did before 2026-08-26.
//
// ⚠️ THE SHAPE IS THE WHOLE GATE, NOT THE PRESENCE. A raw CR seat is a labelled block
// („Държава: … Област: … Населено място: гр. Разлог, п.к. 2760 …"), and `parseSeat`
// (`load_tr_company_place_pg.ts`) splits the FEED's string on commas and takes field 1 — so
// on a raw block it reads „Община: Разлог Населено място: гр. Разлог", resolves nothing, and
// leaves the company unplaced with its seat column full and every row count reconciling.
// That is the failure this file exists for, and a `seat IS NOT NULL` assertion cannot see it.
//
// ⚠️ SKIPS WITH A DISTINCT REASON on a corpus no post-projection `tr:daily-refresh` +
// `db:load:tr:pg` has rebuilt. That is not the same statement as „the rule is enforced" and
// must never read as one — the change is INERT until the corpus is re-derived, exactly like
// the `table_num` / `value_basis` / `held_scope` backfills in 089.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { parseSeat } from "../load_tr_company_place_pg";
import { getResolver } from "../../procurement/resolve_ekatte";

const haveDb = await dbReachable();
const one = async (sql: string): Promise<number> =>
  Number(
    (await allRows<{ n: string }>(sql).catch(() => [{ n: "0" }]))[0]?.n ?? 0,
  );

const companies = haveDb ? await one("SELECT count(*) n FROM tr_companies") : 0;
// The labelled block, as CR renders it. A single row in this shape means the projection ran
// without canonicalising — the one outcome that is worse than not running at all, because it
// fills the column and places nobody.
const rawBlocks = haveDb
  ? await one(
      "SELECT count(*) n FROM tr_companies WHERE seat LIKE 'Държава:%' OR seat LIKE '%Населено място:%'",
    )
  : 0;
const seated = haveDb
  ? await one(
      "SELECT count(*) n FROM tr_companies WHERE seat IS NOT NULL AND seat <> ''",
    )
  : 0;

// The projection's own contribution is not separable in SQL — `seat` carries no provenance
// column, by design (it is one field with one meaning, and the feed wins any contest). So the
// corpus is dated by the TOTAL, against the pre-projection reading.
//
// ⚠️ BOTH ARE SNAPSHOTS, NOT FLOORS, AND THEY DECAY. The daily feed seats companies every day
// and the corpus itself grows, so `seated` will pass 329,741 on feed traffic alone — after
// which the skip guard stops firing and this file declares itself active while proving nothing
// about the projection, which is the vacuous-green state its header warns about in the other
// direction. The margin is not large: the projection contributed 26,152 seats. Re-baseline both
// together, from one measurement, when that happens — and prefer replacing them with a
// discriminator that cannot go vacuous (seats in the shape the canonicaliser emits, present AND
// resolving) over widening them.
const PRE_PROJECTION_SEATED = 329_741; // measured 2026-09-06, before this change
const PRE_PROJECTION_PLACED = 327_161; // ditto — tr_company_place before the re-resolve

const skip = !haveDb
  ? "Postgres unreachable"
  : companies === 0
    ? "TR corpus not loaded"
    : seated <= PRE_PROJECTION_SEATED
      ? `corpus predates the CR seat projection (${seated} seated, ` +
        `${PRE_PROJECTION_SEATED} before it) — re-derive with ` +
        "`npm run tr:daily-refresh` then `npm run db:load:tr:pg`, or this gate is vacuous"
      : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)("no seat is stored as a raw CR block", async () => {
  assert.equal(
    rawBlocks,
    0,
    `${rawBlocks} seats are raw CR labelled blocks rather than the feed's ` +
      `"<country>, <locality>, <postcode>" — parseSeat cannot read those, so those ` +
      `companies are unplaced with a full column. See crSeatToFeedForm in parse_cr_deeds.ts`,
  );
});

test.skipIf(skip)(
  "the projected seats are readable by the place resolver",
  async () => {
    // A sample rather than the corpus: this drives the same resolver the loader does, and the
    // point is the SHAPE of what was written, which is uniform by construction.
    //
    // ⚠️ `md5(uic)`, NOT `uic`. Both are deterministic — the sample is the same on every run
    // and a failure is reproducible — but plain `uic` order is the 3,000 OLDEST registrations,
    // since Bulgarian EIKs are issued roughly chronologically: measured, that stratum holds
    // 1,439 leading-zero EIKs (48% of the sample against 0.4% of the corpus) and NOT ONE
    // modern 2xxxxxxxx EIK, i.e. it excludes by construction the range the contractor-first CR
    // crawl is concentrated in. The skew is small today (it resolves at 99.27% against 99.63%
    // corpus-wide), so this is about the sample meaning what the comment says it means.
    const rows = await allRows<{ uic: string; seat: string }>(
      `SELECT uic, seat FROM tr_companies
      WHERE seat IS NOT NULL AND seat <> '' ORDER BY md5(uic) LIMIT 3000`,
    );
    assert.ok(
      rows.length > 1000,
      `only ${rows.length} seated companies sampled`,
    );
    const resolver = getResolver();
    let resolved = 0;
    for (const r of rows) {
      const addr = parseSeat(r.seat);
      if (!addr) continue;
      const hit = resolver.resolve(addr);
      if (hit.ekatte && hit.matched) resolved++;
    }
    const pct = (resolved / rows.length) * 100;
    // Measured over the 26,152 gap-fillable captures: 26,065 resolve (99.67%). The feed's own
    // seats resolve at a similar rate, so a mixed sample well under 95% means either the
    // canonicaliser regressed or the EKATTE index moved underneath it.
    assert.ok(
      pct >= 95,
      `only ${resolved}/${rows.length} (${pct.toFixed(1)}%) of sampled seats resolve to an ` +
        `EKATTE — the seat column is being filled with something the resolver cannot read`,
    );
  },
);

test.skipIf(skip)(
  "the projection widened placement rather than merely the column",
  async () => {
    // ⚠️ THE ONE THAT MATTERS. Filling `seat` is not the deliverable — a placed company is.
    // `tr_company_place` is written by a DIFFERENT loader, so a run of `db:load:tr:pg` alone
    // leaves this red, which is correct: the chain is not finished until
    // `db:load:tr-company-place:pg` has re-resolved.
    const placed = await one("SELECT count(*) n FROM tr_company_place");
    assert.ok(
      placed > PRE_PROJECTION_PLACED,
      `tr_company_place holds ${placed} rows, against ${PRE_PROJECTION_PLACED} before the ` +
        `CR seat ` +
        `projection — run \`npm run db:load:tr-company-place:pg\` to re-resolve, or the ` +
        `seats reached the column and no place surface`,
    );
  },
);
