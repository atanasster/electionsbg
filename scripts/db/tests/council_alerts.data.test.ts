// The My-Area alerts feed is a BUILD-TIME artifact over a corpus that moves
// weekly, and nothing asserted the two agree.
//
// `data/myarea/alerts/<obshtina>.json` is 289 committed files written by
// `scripts/myarea/build_alerts.ts`; `council_resolution` is reloaded by
// `db:load:council:pg` on its own schedule. When a council reload outruns the
// alerts build, the committed feed keeps advertising decisions the corpus has
// re-keyed or dropped — at a 200, with every row count reconciling. That is
// structural rather than a live drift: the artifacts were fresh when this was
// written (289 of 290 rebuilt the day after the index), which is exactly why it
// needs a gate rather than an observation.
//
// Now that every council alert links to /council/resolution/:id, a stale event
// is also a dead internal link into a function-served family that 404s nowhere
// — it serves the SPA shell, so the failure is a page about nothing.

import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";

const ALERTS_DIR = join(process.cwd(), "data", "myarea", "alerts");

const skip =
  !(await dbReachable()) ||
  !existsSync(ALERTS_DIR) ||
  (await allRows(`SELECT 1 FROM council_resolution LIMIT 1`).catch(
    () => null,
  )) === null;

type AlertEvent = { kind?: string; link?: string; date?: string };

const councilEvents = (): { file: string; id: string; date: string }[] => {
  const out: { file: string; id: string; date: string }[] = [];
  for (const f of readdirSync(ALERTS_DIR)) {
    if (!f.endsWith(".json")) continue;
    let parsed: { events?: AlertEvent[] };
    try {
      parsed = JSON.parse(readFileSync(join(ALERTS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    for (const e of parsed.events ?? []) {
      if (e.kind !== "council_resolution") continue;
      const m = /^\/council\/resolution\/(.+)$/.exec(e.link ?? "");
      // A council event with no resolution link is itself the regression:
      // before Tier 6 these linked out to the municipality's PDF, and the
      // internal link is what makes the resolution family reachable.
      assert.ok(m, `${f}: council event has no /council/resolution link`);
      out.push({ file: f, id: m![1], date: e.date ?? "" });
    }
  }
  return out;
};

test.skipIf(skip)(
  "every committed council alert resolves to a live resolution",
  async () => {
    const events = councilEvents();
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
      `${orphans.length} committed council alert(s) name a resolution that is ` +
        `no longer in the corpus. The alerts build has fallen behind a council ` +
        `reload — re-run \`npx tsx scripts/myarea/build_alerts.ts\``,
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
    const events = councilEvents();
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 120);
    const iso = cutoff.toISOString().slice(0, 10);
    const stale = events.filter((e) => e.date && e.date < iso);
    assert.deepEqual(
      stale.map((s) => `${s.file}:${s.date}`).slice(0, 10),
      [],
      `${stale.length} council alert(s) are more than 120 days old against a ` +
        `60-day build window — the committed feed is at least one build behind`,
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
    const withDissent: string[] = [];
    for (const f of readdirSync(ALERTS_DIR)) {
      if (!f.endsWith(".json")) continue;
      let parsed: { events?: (AlertEvent & { detail?: string })[] };
      try {
        parsed = JSON.parse(readFileSync(join(ALERTS_DIR, f), "utf8"));
      } catch {
        continue;
      }
      for (const e of parsed.events ?? []) {
        if (e.kind !== "council_resolution") continue;
        if (!e.detail?.includes("против:")) continue;
        const m = /^\/council\/resolution\/(.+)$/.exec(e.link ?? "");
        if (m) withDissent.push(m[1]);
      }
    }
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
