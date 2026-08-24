// Is the committed override map published to THIS database?
//
// The local half of this question is a data test
// (scripts/db/tests/awarder_seats_freshness.data.test.ts). This is the half that
// test deliberately cannot answer: **production**. A test that dialled Cloud SQL
// would skip whenever the proxy is down — most of the time, and always in CI —
// so it would be vacuous exactly when relied upon while LOOKING like production
// coverage. A command an operator runs is honest about being manual.
//
// Read-only: it issues one SELECT and writes nothing, so it is safe to run
// against the serving database at any time, including mid-incident.
//
//   npm run proc:verify-seats          # local docker Postgres
//   npm run proc:verify-seats:cloud    # Cloud SQL via the proxy on 5434
//
// Exits 1 on drift so it can gate a publish path; 0 when the two agree.
//
// Plan: docs/plans/awarder-seats-freshness-gate-v1.md.

import {
  allRows,
  connectionUrl,
  end,
  isServingDatabase,
  LOCAL_DATABASE_URL,
  redactUrl,
} from "../db/lib/pg";
import { compareSeatsToMap } from "./awarder_geo_merge";
import {
  loadMap,
  SEATS_SQL,
  toSeats,
  vacuityReason,
  type SeatRow,
} from "./awarder_seats_check";

/** The loader command that writes to the database we actually dialled.
 *
 *  ⚠ Three-valued, not two. `isServingDatabase()` matches the proxy at
 *  `127.0.0.1:5434` strictly, so `localhost:5434` (same proxy, other spelling),
 *  a second forwarded port or a staging proxy all fall outside it — and a bare
 *  `else → local` would print a command that writes to :5433 while the database
 *  just found stale stays stale. */
const loaderFor = (url: string): string =>
  isServingDatabase()
    ? "npm run db:load:awarder-seats:pg:cloud"
    : url === LOCAL_DATABASE_URL
      ? "npm run db:load:awarder-seats:pg"
      : `DATABASE_URL=${redactUrl(url)} npm run db:load:awarder-seats:pg`;

const main = async (): Promise<void> => {
  const map = loadMap();

  // ⚠ Report the URL the pool will ACTUALLY dial, via connectionUrl() — never
  // DATABASE_URL. lib/pg.ts documents that the two disagree whenever anything
  // called pinLocalDatabase(), and the whole value of this command is that its
  // answer is unambiguous about WHICH database it is about. Redacted, because a
  // password can live in the URL.
  const url = connectionUrl();
  console.log(
    `checking ${redactUrl(url)}` +
      (isServingDatabase() ? "  ⚠ THIS IS THE SERVING DATABASE" : ""),
  );

  const eiks = Object.keys(map);
  const rows = await allRows<SeatRow>(SEATS_SQL, [eiks]);
  const drift = compareSeatsToMap(map, toSeats(rows));

  console.log(
    `map ${eiks.length} entries (${drift.checked} comparable) · ` +
      `awarder_seats matched ${rows.length}`,
  );

  // ⚠ BEFORE the all-clear, never after. Both arms come back empty for a map
  // that failed to load, so without this the production half — the only thing
  // that ever checks prod — reports `✓ published` at exit 0 for a file it never
  // read. The local gate asserts the same floor; this is the copy that matters,
  // because it runs where CI does not.
  const vacuous = vacuityReason(drift, eiks.length);
  if (vacuous) {
    console.error(`\n✗ cannot conclude anything: ${vacuous}`);
    process.exitCode = 1;
    return;
  }

  if (!drift.missing.length && !drift.disagreeing.length) {
    console.log("✓ published — every buyer the map names sits where it says");
    return;
  }

  // Both arms in full. This is an equality invariant over ~2,174 buyers, not a
  // sample, so a truncated list would hide exactly the row someone needs.
  if (drift.disagreeing.length) {
    console.error(
      `\n✗ ${drift.disagreeing.length} buyer(s) published at a DIFFERENT place ` +
        `than the map says:`,
    );
    for (const d of drift.disagreeing)
      console.error(`   ${d.eik}  map ${d.map}  seats ${d.seats}`);
  }
  if (drift.missing.length) {
    console.error(`\n✗ ${drift.missing.length} buyer(s) not published at all:`);
    for (const eik of drift.missing) console.error(`   ${eik}`);
  }
  // Repeat the target on stderr: stdout and stderr are separately redirectable,
  // and a drift report that does not say WHICH database it is about is the one
  // shape this command exists to make impossible.
  console.error(
    `\non ${redactUrl(url)}` +
      (isServingDatabase() ? " (THE SERVING DATABASE)" : "") +
      `\nThe map has been rebuilt without publishing it, or vice versa. Rebuild:\n` +
      `  npx tsx scripts/procurement/awarder_geo_map.ts && npx tsx scripts/procurement/rebuild_from_cache.ts\n` +
      `then load into THIS database:\n  ${loaderFor(url)}`,
  );
  process.exitCode = 1;
};

main()
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    // The one error with a remediation the message itself never carries: the
    // table is absent because the loader has never run against this database.
    if (/relation "awarder_seats" does not exist/i.test(msg))
      console.error(
        `\nawarder_seats has never been built on ${redactUrl(connectionUrl())}.\n` +
          `  ${loaderFor(connectionUrl())}`,
      );
    process.exitCode = 1;
  })
  .finally(() => end());
