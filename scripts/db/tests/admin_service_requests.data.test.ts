// Gate for the еФорми request volumes (migration 201). The property worth protecting is that a
// MISSING month stays missing: the publisher skips months, and a consumer that reads the table
// without the month register would render an unpublished month as a month with no requests.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEformsSnapshot } from "../../administration/eforms";
import { allRows, dbReachable } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const SNAPSHOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/administration/eforms_requests.json",
);

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM admin_service_requests",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "admin_service_requests is empty — run npm run db:load:admin-service-requests:pg"
    : null;
const d = skip ? describe.skip : describe;
reportSkip(import.meta.url, skip);

d("admin_service_requests (201)", () => {
  const snap = parseEformsSnapshot(readFileSync(SNAPSHOT, "utf8"));

  it("holds exactly the committed snapshot's months, and no month the publisher skipped", async () => {
    const rows = await allRows<{ p: string }>(
      "SELECT to_char(period, 'YYYY-MM') p FROM admin_service_requests_month ORDER BY 1",
    );
    expect(rows.map((r) => r.p)).toEqual(snap.months.map((m) => m.period));
  });

  it("each month's register row agrees with its own facts", async () => {
    const bad = await allRows<{ p: string }>(
      `SELECT to_char(m.period, 'YYYY-MM') p
         FROM admin_service_requests_month m
         LEFT JOIN (SELECT period, count(*) n, sum(requests) s
                      FROM admin_service_requests GROUP BY period) f USING (period)
        WHERE f.n IS DISTINCT FROM m.service_count
           OR f.s IS DISTINCT FROM m.request_total`,
    );
    expect(bad).toEqual([]);
  });

  it("matches the snapshot to the request", async () => {
    const [r] = await allRows<{ s: string }>(
      "SELECT sum(requests)::text s FROM admin_service_requests",
    );
    const want = snap.months.reduce(
      (s, m) => s + m.rows.reduce((t, x) => t + x.requests, 0),
      0,
    );
    expect(Number(r.s)).toBe(want);
  });
});
