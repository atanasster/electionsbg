// The My-Area alerts feed is a BUILD-TIME artifact over a corpus that moves
// weekly, and nothing asserted the two agree.
//
// The feed is `myarea_alerts.events` (migration 184), 289 rows upserted by
// `scripts/myarea/build_alerts.ts`; `council_resolution` is reloaded by
// `db:load:council:pg` on its own schedule. When a council reload outruns the
// alerts build, the stored feed keeps advertising decisions the corpus has
// re-keyed or dropped — at a 200, with every row count reconciling.
//
// ⚠️ IT USED TO READ `data/myarea/alerts/<obshtina>.json`, AND THAT MADE IT
// VACUOUS. json-retirement-v2 Tier 4b moved the feed into Postgres and deleted
// those 290 committed files, so the `existsSync(ALERTS_DIR)` arm of the skip
// predicate silently became permanently true — the whole file reported
// "skipped" and nobody read it as a failure. It was repointed at the table on
// 2026-08-22, the same day 84 phantom council resolutions were purged, which is
// precisely the event this gate exists to notice.
//
// Now that every council alert links to /council/resolution/:id, a stale event
// is also a dead internal link into a function-served family that 404s nowhere
// — it serves the SPA shell, so the failure is a page about nothing.

import { test } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const skip = !(await dbReachable())
  ? "Postgres unreachable"
  : (await allRows(`SELECT 1 FROM council_resolution LIMIT 1`).catch(
        () => null,
      )) === null
    ? "council_resolution is absent — run db:load:council:pg"
    : (await allRows(`SELECT 1 FROM myarea_alerts LIMIT 1`).catch(
          () => null,
        )) === null
      ? "myarea_alerts is absent — run npm run myarea:alerts"
      : false;
reportSkip(import.meta.url, skip);

type AlertEvent = {
  kind?: string;
  link?: string;
  date?: string;
  detail?: string;
};

/** Every council event across all 289 stored feeds. `file` is the obshtina code —
 *  the feed's key now that it is a row rather than a file. */
const councilEvents = async (): Promise<
  { file: string; id: string; date: string; detail: string }[]
> => {
  const rows = await allRows<{ obshtina: string; events: AlertEvent[] }>(
    `SELECT obshtina, events FROM myarea_alerts ORDER BY obshtina`,
  );
  const out: { file: string; id: string; date: string; detail: string }[] = [];
  for (const r of rows) {
    for (const e of r.events ?? []) {
      if (e.kind !== "council_resolution") continue;
      const m = /^\/council\/resolution\/(.+)$/.exec(e.link ?? "");
      // A council event with no resolution link is itself the regression:
      // before Tier 6 these linked out to the municipality's PDF, and the
      // internal link is what makes the resolution family reachable.
      assert.ok(
        m,
        `${r.obshtina}: council event has no /council/resolution link`,
      );
      out.push({
        file: r.obshtina,
        id: m![1],
        date: e.date ?? "",
        detail: e.detail ?? "",
      });
    }
  }
  return out;
};

test.skipIf(skip)(
  "every committed council alert resolves to a live resolution",
  async () => {
    const events = await councilEvents();
    assert.ok(
      events.length > 0,
      "no council alerts at all — the source has gone silent, which is the " +
        "failure this gate exists to catch",
    );
    const ids = [...new Set(events.map((e) => e.id))];
    const live = new Set(
      (
        await allRows<{ id: string }>(
          `SELECT id FROM council_resolution WHERE id = ANY($1::text[])`,
          [ids],
        )
      ).map((r) => r.id),
    );
    const orphans = events.filter((e) => !live.has(e.id));
    assert.deepEqual(
      orphans.map((o) => `${o.file}:${o.id}`),
      [],
      `${orphans.length} stored council alert(s) name a resolution that is ` +
        `no longer in the corpus. The alerts build has fallen behind a council ` +
        `reload — re-run \`npm run myarea:alerts\` (and \`:cloud\`)`,
    );
  },
);

test.skipIf(skip)(
  "no council alert is older than the window the builder declares",
  async () => {
    // COUNCIL_LOOKBACK_DAYS is 60. A committed event well outside it means the
    // artifact predates its own source rather than that the window changed —
    // the same staleness, visible from the other side and without needing the
    // corpus to have re-keyed anything.
    const events = await councilEvents();
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 120);
    const iso = cutoff.toISOString().slice(0, 10);
    const stale = events.filter((e) => e.date && e.date < iso);
    assert.deepEqual(
      stale.map((s) => `${s.file}:${s.date}`).slice(0, 10),
      [],
      `${stale.length} council alert(s) are more than 120 days old against a ` +
        `60-day build window — the stored feed is at least one build behind`,
    );
  },
);

test.skipIf(skip)(
  "a named-vote alert is only emitted for a council that publishes them",
  async () => {
    // The dissent list is gated on the resolution's own has_named_votes, never
    // on the list being non-empty: 11 of the 16 councils publish an aggregate
    // only, and a unanimous decision in a council that DOES publish names has
    // an empty list for a completely different reason.
    const withDissent = (await councilEvents())
      .filter((e) => e.detail.includes("против:"))
      .map((e) => e.id);
    if (withDissent.length === 0) return; // no dissent in the window; not a defect
    const rows = await allRows<{ id: string; has_named_votes: boolean }>(
      `SELECT id, has_named_votes FROM council_resolution WHERE id = ANY($1::text[])`,
      [withDissent],
    );
    const bad = rows.filter((r) => !r.has_named_votes).map((r) => r.id);
    assert.deepEqual(
      bad,
      [],
      `${bad.length} alert(s) name dissenters for a resolution with no named vote`,
    );
  },
);

test.skipIf(skip)(
  "the against-list excludes abstainers, corpus-wide",
  async () => {
    // The previous tier's CRITICAL finding, asserted directly against the
    // corpus rather than against whatever happens to be in the 60-day window.
    //
    // Two reasons this is not folded into the alert-file test above. That test
    // checks `has_named_votes`, which stays GREEN under an abstention fold — it
    // cannot see this defect at all. And it is driven by whatever the window
    // holds: both of today's qualifying events come from one 2026-07-21
    // protocol, so it goes vacuous within weeks while the invariant it is meant
    // to protect does not expire.
    //
    // „Въздържал се" is the explicit refusal to take a side. Naming an abstainer
    // as having voted against attributes a position to someone who declined to
    // take one — measured corpus-wide, folding the two together is 62-78%
    // abstentions, and on Бургас and Казанлък it was 100% of who got named.
    const [r] = await allRows<{ resolutions: string; abstainers: string }>(
      `WITH lists AS (
         SELECT r.id,
                (SELECT array_agg(v.councillor ORDER BY v.councillor)
                   FROM council_vote v
                  WHERE v.resolution_id = r.id AND v.vote = 'against') AS against_names
           FROM council_resolution r
          WHERE r.has_named_votes
       )
       SELECT count(*) FILTER (WHERE l.against_names IS NOT NULL)::text AS resolutions,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM council_vote v
                 WHERE v.resolution_id = l.id
                   AND v.vote <> 'against'
                   AND v.councillor = ANY(l.against_names)))::text AS abstainers
         FROM lists l`,
    );
    assert.ok(
      Number(r.resolutions) > 0,
      "no resolution carries an against-list — the gate would be vacuous",
    );
    assert.equal(
      Number(r.abstainers),
      0,
      `${r.abstainers} resolution(s) list a councillor as voting against who ` +
        `did not — the against-list has been widened to include abstentions`,
    );
  },
);

test.skipIf(skip)("cleanup", async () => {
  await end();
});
