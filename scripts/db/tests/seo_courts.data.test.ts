// readSeoCourts() catches everything and returns [], which is the right
// contract for a build-time reader — and the reason a SQL regression is
// invisible without this gate.
//
// On a machine WITH Postgres, a column renamed in 116, a dropped
// judicial_body_source_name, or a migration that was never applied all produce
// the same outcome as an unplugged database: zero /court pages, one warning line
// in a build log nobody greps, and exit 0. The sitemap omits the same URLs, so
// nothing even looks inconsistent. That is the "green locally, missing on prod"
// shape — nothing red anywhere, a whole page family gone.
//
// The unit test beside the module (seo_courts.test.ts) mocks `pg`, so it can
// never see a SQL fault. This one executes the real QUERY.
//
// Auto-skips when Postgres is down or the dimension is absent.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { isCrawlableCourt, readSeoCourts } from "../lib/seo_courts";

const haveDb = await dbReachable();

const count = async (sql: string): Promise<number> =>
  Number(
    (await allRows<{ n: string }>(sql).catch(() => [{ n: "0" }]))[0]?.n ?? 0,
  );

const bodies = haveDb ? await count("SELECT count(*) n FROM judicial_body") : 0;

afterAll(async () => {
  if (haveDb) await end();
});

test("enumerates every judicial body — the QUERY runs and returns all of them", async (t) => {
  if (!bodies) return t.skip();
  const rows = await readSeoCourts();
  assert.equal(
    rows.length,
    bodies,
    `readSeoCourts() returned ${rows.length} of ${bodies} bodies — a [] or a partial set means the query failed, not that Postgres is absent`,
  );
  assert.ok(
    rows.every((r) => r.bodyCode && r.name && r.kind),
    "a row is missing the identity fields the page title is built from",
  );
  assert.ok(
    rows.every((r) => isCrawlableCourt(r)),
    "a body_code is not URL-safe — its page and its sitemap <loc> would both vanish",
  );
});

test("numeric fields are numbers, not node-postgres numeric strings", async (t) => {
  if (!bodies) return t.skip();
  // `filed_per_month` / `resolved_per_month` are PG numeric, which
  // node-postgres serializes as a STRING. Without the ::float8 casts the prose
  // would interpolate "5.6800000" and toFixed() would be a type error the
  // builder never sees, because the field is typed number here.
  const withLoad = (await readSeoCourts()).filter((r) => r.year != null);
  assert.ok(withLoad.length > 0, "no body carries a court_load year");
  for (const r of withLoad) {
    for (const k of [
      "year",
      "judges",
      "filedPerMonth",
      "resolvedPerMonth",
      "firstYear",
      "lastYear",
    ] as const) {
      if (r[k] != null)
        assert.equal(typeof r[k], "number", `${r.bodyCode}.${k}`);
    }
  }
});

test("sourcesBuilt is true on a loaded database, and the workload split is real", async (t) => {
  if (!bodies) return t.skip();
  const rows = await readSeoCourts();
  // False here means the prerender must NOT write "the ВСС publishes no
  // workload for this body" onto 284 static pages. On a db:refresh'd database
  // it is true, so a false is the signal that db:load:judicial-bodies:pg has
  // not run — the same distinction judicial_body_detail() carries.
  assert.ok(
    rows.every((r) => r.sourcesBuilt),
    "the workload bridge is not loaded here — run `npm run db:load:judicial-bodies:pg`",
  );
  const withLoad = rows.filter((r) => r.year != null);
  assert.ok(
    withLoad.length > 0 && withLoad.length < rows.length,
    `expected a mix of bodies with and without published workload, got ${withLoad.length}/${rows.length}`,
  );
});

test("the latest year matches the series end it is reported alongside", async (t) => {
  if (!bodies) return t.skip();
  // `year` (this row's vintage) and `lastYear` (max over the same set) are
  // equal only because `latest`'s ORDER BY leads with `c.year DESC`. They are
  // rendered side by side — "X дела на месец през {year}, серия от {firstYear}
  // до {lastYear}" — so a desync reads as a data error on the page.
  for (const r of (await readSeoCourts()).filter((r) => r.year != null)) {
    assert.equal(r.year, r.lastYear, `${r.bodyCode}: year !== lastYear`);
    assert.ok(
      r.firstYear != null && r.firstYear <= r.lastYear!,
      `${r.bodyCode}: firstYear ${r.firstYear} is not before lastYear ${r.lastYear}`,
    );
  }
});

test("magistrate counts agree with judicial_body_detail()", async (t) => {
  if (!bodies) return t.skip();
  // The prerendered number and the live page's number come from two different
  // queries over the same join. If they drift, a crawler and a reader see
  // different figures for the same court.
  const rows = await readSeoCourts();
  const live = await allRows<{ body_code: string; n: number }>(`
    SELECT body_code,
           (judicial_body_detail(body_code) ->> 'magistrates')::int AS n
    FROM judicial_body`);
  const byCode = new Map(live.map((r) => [r.body_code, r.n]));
  for (const r of rows) {
    assert.equal(
      r.magistrates,
      byCode.get(r.bodyCode) ?? 0,
      `${r.bodyCode}: prerender says ${r.magistrates} magistrates, the page says ${byCode.get(r.bodyCode)}`,
    );
  }
});
