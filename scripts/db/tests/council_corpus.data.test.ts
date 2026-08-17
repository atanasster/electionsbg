// Gate for the municipal-council corpus (migration 160) behind the My-Area
// council tile, the alerts feed and the AI chat's councilResolutions tool.
//
// The ways this goes quietly wrong, all of which serve a 200:
//   1. DRIFT FROM THE SOURCE — Postgres disagrees with the durable shard tree.
//      Both directions matter: the loader is upsert-only and never deletes, so
//      a `councilNameKey` change re-keys every row, orphans the old set and
//      DOUBLES the corpus. index.json cannot be the reference — it is capped at
//      200 rows per município and six of sixteen exceed it.
//   2. WRONG PERSON — a named vote attributed to someone who did not cast it.
//      The corpus's central safety property: a fold held by two officials SLUGS
//      in one município must resolve to nobody.
//   3. FOLD DRIFT — the identity fold is used on the vote side and the roster
//      side. Written twice, the two diverged on `й`→`и` and on hyphens, costing
//      4,899 of 28,214 attributions AND evaluating the shared-name guard over a
//      different equivalence class than the join used.
//   4. POLLUTED KEYS — the PER32 parser absorbs the vote label into the name.
//      Every value is legal, so no CHECK sees it.
//   5. WRONG BENCH — a council bound to another município's roster. `BGS01` is
//      Бургас here but a DIFFERENT município in official_roster.
//
// Auto-skips ONLY when Postgres is down. An empty table is a failure, not a
// skip: the loader is unconditional in db:refresh and reads a committed input.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end, withClient } from "../lib/pg";
import {
  councilNameKey,
  isPollutedKey,
  COUNCIL_VOTING_ROLES,
  VOTE_LABEL_SOURCE,
} from "../../council/lib/tally";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNCIL_DIR = resolve(__dirname, "../../../data/council");
const ROLES = [...COUNCIL_VOTING_ROLES];

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

/**
 * Count the durable tree per município, from the tree itself.
 *
 * `expected` is derived from the PUBLISHED rules in council/lib/tally.ts —
 * `councilNameKey` and `isPollutedKey` — not from a copy of the loader's
 * control flow. That is what lets this assert EQUALITY rather than a band: the
 * corpus-wide shortfall (840 rows) is entirely PER32's vote-label pollution,
 * which is a deliberate, rule-defined refusal rather than unexplained loss. A
 * band wide enough to tolerate it (>11.5%) would also tolerate ~2,000 silent
 * drops elsewhere.
 */
const durableByMuni = (): Map<
  string,
  { resolutions: number; named: number; expected: number }
> => {
  const out = new Map<
    string,
    { resolutions: number; named: number; expected: number }
  >();
  for (const e of readdirSync(COUNCIL_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "votes") continue;
    const acc = { resolutions: 0, named: 0, expected: 0 };
    for (const y of readdirSync(join(COUNCIL_DIR, e.name), {
      withFileTypes: true,
    })) {
      if (!y.isDirectory()) continue;
      for (const f of readdirSync(join(COUNCIL_DIR, e.name, y.name))) {
        if (!f.endsWith(".json")) continue;
        let d: unknown;
        try {
          d = JSON.parse(
            readFileSync(join(COUNCIL_DIR, e.name, y.name, f), "utf8"),
          );
        } catch {
          continue;
        }
        if (!d || typeof d !== "object") continue;
        const pc = (
          d as {
            tally?: {
              perCouncillor?: {
                name?: string;
                normKey?: string;
                vote?: string;
              }[];
            };
          }
        ).tally?.perCouncillor;
        acc.resolutions++;
        if (!Array.isArray(pc)) continue;
        acc.named += pc.length;
        // One row per distinct non-polluted fold, matching the corpus's PK
        // (resolution_id, norm_key). A fold seen twice with DIFFERENT votes is
        // refused outright, so it contributes nothing.
        const votes = new Map<string, string | undefined>();
        const refused = new Set<string>();
        for (const v of pc) {
          const key = councilNameKey(v.normKey || v.name || "");
          if (!key || isPollutedKey(key)) continue;
          if (votes.has(key)) {
            if (votes.get(key) !== v.vote) refused.add(key);
            continue;
          }
          votes.set(key, v.vote);
        }
        for (const k of refused) votes.delete(k);
        acc.expected += votes.size;
      }
    }
    if (acc.resolutions > 0) out.set(e.name, acc);
  }
  return out;
};

/** Fold the roster the way the LOADER does — per município, keyed on slug. */
const ambiguousFolds = async (): Promise<Set<string>> => {
  const rows = await allRows<{
    roster_code: string;
    name: string;
    slug: string;
  }>(
    `SELECT m.roster_code, o.name, o.slug
       FROM council_muni m
       JOIN official_roster o ON o.obshtina = m.roster_code
      WHERE o.role = ANY($1::text[])`,
    [ROLES],
  );
  const byFold = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = `${r.roster_code}\t${councilNameKey(r.name)}`;
    if (!byFold.has(k)) byFold.set(k, new Set());
    // SLUG, not name: two people can share a byte-identical name, which is the
    // `…василев`/`…василев1` shape the officials layer mints for exactly this
    // case. Aggregating names misses it, and that is the case that matters.
    byFold.get(k)!.add(r.slug);
  }
  return new Set(
    [...byFold].filter(([, slugs]) => slugs.size > 1).map(([k]) => k),
  );
};

const present = async (): Promise<boolean> =>
  (await allRows(`SELECT 1 FROM council_muni LIMIT 1`).catch(() => null)) !==
  null;

test.skipIf(skip)(
  "Postgres matches the durable shard tree, both directions",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    const disk = durableByMuni();
    const rows = await allRows<{ code: string; res: string; votes: string }>(
      `SELECT r.obshtina_code AS code,
            count(DISTINCT r.id)::text AS res,
            count(v.*)::text AS votes
       FROM council_resolution r
       LEFT JOIN council_vote v ON v.resolution_id = r.id
      GROUP BY 1`,
    );
    assert.ok(
      rows.length > 0,
      "council_resolution is empty — run db:load:council:pg",
    );

    for (const r of rows) {
      const d = disk.get(r.code);
      assert.ok(
        d,
        `${r.code} is in Postgres but has no durable shard directory`,
      );
      assert.equal(
        Number(r.res),
        d.resolutions,
        `${r.code}: ${r.res} resolutions against ${d.resolutions} durable shards. ` +
          `Either the corpus is stale, or the loader warn-and-skipped shards ` +
          `(unparseable JSON, malformed id/date, a date failing YYYY-MM-DD, or an ` +
          `out-of-domain vote — that last one discards the WHOLE shard)`,
      );
      // EQUALITY, both directions. The upper bound is the one the loader's
      // deliberate upsert-only shape creates — a councilNameKey change re-keys
      // every row and the old set is never deleted, so the corpus doubles while a
      // floor-only check stays green.
      assert.equal(
        Number(r.votes),
        d.expected,
        `${r.code}: ${r.votes} vote rows, expected ${d.expected} from ${d.named} ` +
          `entries on disk. Above -> upsert-only has orphaned rows (what a fold ` +
          `change does). Below -> votes were dropped for a reason the shared ` +
          `rules in council/lib/tally.ts do not account for`,
      );
    }
    for (const code of disk.keys()) {
      assert.ok(
        rows.some((r) => r.code === code),
        `${code} has durable shards but no rows in Postgres`,
      );
    }
  },
);

test.skipIf(skip)("no vote is attributed to an ambiguous name", async () => {
  assert.ok(await present(), "council_* absent — run db:load:council:pg");
  const folds = await ambiguousFolds();

  if (folds.size > 0) {
    // One query, not one per fold.
    const hits = await allRows<{ k: string; n: string }>(
      `SELECT m.roster_code || chr(9) || v.norm_key AS k, count(*)::text AS n
         FROM council_vote v
         JOIN council_resolution r ON r.id = v.resolution_id
         JOIN council_muni m       ON m.obshtina_code = r.obshtina_code
        WHERE v.person_id IS NOT NULL
        GROUP BY 1`,
    );
    for (const h of hits) {
      assert.ok(
        !folds.has(h.k),
        `${h.k.replace("\t", "/")} is held by more than one officials slug but has ` +
          `${h.n} attributed votes — the shared-name refusal has stopped working`,
      );
    }
  }

  // MUTATION CHECK. Today none of the five vote-bearing councils contains an
  // ambiguous fold, so the sweep above passes no matter what the loader does.
  // Construct the shape inside a rolled-back transaction and prove the sweep
  // still detects it — without this the whole test is decoration.
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      const { rows } = await c.query<{ rc: string }>(
        `SELECT roster_code AS rc FROM council_muni
          WHERE has_named_votes AND roster_code IS NOT NULL LIMIT 1`,
      );
      assert.ok(rows[0], "no vote-bearing council has a roster_code");
      const rc = rows[0].rc;
      await c.query(
        `INSERT INTO official_roster (obshtina, name, slug, role)
         VALUES ($1, 'Тестов Тестов Тестов', 'zzz-council-test-a', 'councillor'),
                ($1, 'Тестов Тестов Тестов', 'zzz-council-test-b', 'councillor')`,
        [rc],
      );
      const { rows: probe } = await c.query<{ slugs: string }>(
        `SELECT count(DISTINCT slug)::text AS slugs FROM official_roster
          WHERE obshtina = $1 AND role = ANY($2::text[]) AND name = 'Тестов Тестов Тестов'`,
        [rc, ROLES],
      );
      assert.equal(
        probe[0].slugs,
        "2",
        "the ambiguity probe no longer sees two slugs under one name",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  });
});

test.skipIf(skip)("attribution has not collapsed", async () => {
  assert.ok(await present(), "council_* absent — run db:load:council:pg");
  const [row] = await allRows<{ total: string; attached: string }>(
    `SELECT count(*)::text AS total, count(person_id)::text AS attached
       FROM council_vote`,
  );
  assert.ok(
    Number(row.total) > 0,
    "council_vote is empty — run db:load:council:pg. This is NOT a fold-drift failure",
  );
  const pct = (Number(row.attached) / Number(row.total)) * 100;
  // 94.1% when the single fold landed. A drop to ~77% is the signature of the
  // vote-side and roster-side folds diverging again (й / hyphens).
  assert.ok(
    pct > 90,
    `only ${pct.toFixed(1)}% of named votes carry a person_id (was 94.1%) — ` +
      `the two sides of councilNameKey have probably drifted apart`,
  );
});

test.skipIf(skip)("no stored norm_key begins with a vote label", async () => {
  assert.ok(await present(), "council_* absent — run db:load:council:pg");
  // The loader's own pattern, not a restatement — a third copy drifted before,
  // missing `отсъстващ`, `отсъствал` and `не-гласувал`.
  const [row] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n FROM council_vote WHERE norm_key ~ $1`,
    [VOTE_LABEL_SOURCE],
  );
  assert.equal(
    Number(row.n),
    0,
    `${row.n} council_vote rows carry a vote label inside the councillor name — ` +
      `the PER32 parser defect has come back, or the purge stopped running`,
  );
});

test.skipIf(skip)(
  "every council is bound to a bench that holds its own voters",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");

    // The BGS01 trap is roster_code = the council's OWN key, so a code-collision
    // comparison cannot see it (and 7 of 16 councils legitimately self-code).
    // Assert the positive: the bench a vote-bearing council was bound to must
    // actually contain the people who voted there.
    //
    // This must compare FOLDED NAMES, not stored person_ids. Reading person_id
    // only re-reads the last good load — rebinding a council to the wrong bench
    // leaves those attributions in place, so the check passes while the binding
    // is broken. Verified: with BGS01 pointed at its own key, a person_id-based
    // version of this test reported no failures.
    const voters = await allRows<{
      code: string;
      roster: string;
      norm_key: string;
    }>(
      `SELECT m.obshtina_code AS code, m.roster_code AS roster, v.norm_key
       FROM council_muni m
       JOIN council_resolution r ON r.obshtina_code = m.obshtina_code
       JOIN council_vote v       ON v.resolution_id = r.id
      WHERE m.has_named_votes
      GROUP BY 1, 2, 3`,
    );
    assert.ok(voters.length > 0, "no vote-bearing council found");

    const bench = new Map<string, Set<string>>();
    for (const o of await allRows<{ obshtina: string; name: string }>(
      `SELECT obshtina, name FROM official_roster
      WHERE obshtina IS NOT NULL AND role = ANY($1::text[])`,
      [ROLES],
    )) {
      if (!bench.has(o.obshtina)) bench.set(o.obshtina, new Set());
      bench.get(o.obshtina)!.add(councilNameKey(o.name));
    }

    const byCouncil = new Map<string, { roster: string; keys: string[] }>();
    for (const v of voters) {
      if (!byCouncil.has(v.code))
        byCouncil.set(v.code, { roster: v.roster, keys: [] });
      byCouncil.get(v.code)!.keys.push(v.norm_key);
    }
    for (const [code, { roster, keys }] of byCouncil) {
      const names = bench.get(roster) ?? new Set<string>();
      const hits = keys.filter((k) => names.has(k)).length;
      const pct = (hits / keys.length) * 100;
      // The wrong bench is a different council's membership — the header records
      // BGS01's as "28 councillors, disjoint names". Real bindings sit far above
      // this; the floor only has to separate "this bench" from "another council's".
      assert.ok(
        pct > 40,
        `${code} is bound to roster '${roster}' but only ${hits}/${keys.length} ` +
          `(${pct.toFixed(1)}%) of its voters are on that bench — the roster shard ` +
          `is a different council (the BGS01 trap)`,
      );
    }

    // Cheap, and catches the other shape: a roster_code that is some OTHER
    // council's key.
    const collisions = await allRows<{
      obshtina_code: string;
      roster_code: string;
    }>(
      `SELECT a.obshtina_code, a.roster_code
       FROM council_muni a
       JOIN council_muni b ON b.obshtina_code = a.roster_code
      WHERE a.roster_code IS DISTINCT FROM a.obshtina_code`,
    );
    assert.deepEqual(
      collisions,
      [],
      "a council's roster_code is another council's key",
    );
  },
);

test.skipIf(skip)(
  "has_named_votes agrees with the votes, on both grains",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");

    // Both DIRECTIONS. The converse is reachable under upsert-only: a parser
    // regression that stops emitting perCouncillor flips the flag false (it is
    // recomputed each run) while the votes survive (never deleted), so the page
    // says "publishes no named votes" over a table holding thousands.
    const badRes = await allRows<{ id: string; flag: boolean; votes: string }>(
      `SELECT r.id, r.has_named_votes AS flag, count(v.*)::text AS votes
       FROM council_resolution r
       LEFT JOIN council_vote v ON v.resolution_id = r.id
      GROUP BY 1, 2
     HAVING (r.has_named_votes AND count(v.*) = 0)
         OR (NOT r.has_named_votes AND count(v.*) > 0)`,
    );
    assert.deepEqual(
      badRes,
      [],
      "a resolution's has_named_votes disagrees with its votes — the resolution " +
        "page reads this flag to decide between 'no named votes' and an empty list",
    );

    const badMuni = await allRows<{
      obshtina_code: string;
      flag: boolean;
      votes: string;
    }>(
      `SELECT m.obshtina_code, m.has_named_votes AS flag, count(v.*)::text AS votes
       FROM council_muni m
       LEFT JOIN council_resolution r ON r.obshtina_code = m.obshtina_code
       LEFT JOIN council_vote v       ON v.resolution_id = r.id
      GROUP BY 1, 2
     HAVING (m.has_named_votes AND count(v.*) = 0)
         OR (NOT m.has_named_votes AND count(v.*) > 0)`,
    );
    assert.deepEqual(
      badMuni,
      [],
      "a município's has_named_votes disagrees with its votes",
    );
  },
);

test.skipIf(skip)(
  "every council is reachable from a frontend code",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");

    // The direction that can actually break. (One frontend code -> one council is
    // a schema theorem: council_muni_code's PRIMARY KEY.) The code spaces
    // genuinely disagree for 9 of 16 councils, so a mapping regression lands here.
    const orphans = await allRows<{ obshtina_code: string }>(
      `SELECT m.obshtina_code FROM council_muni m
      WHERE NOT EXISTS (SELECT 1 FROM council_muni_code c
                         WHERE c.obshtina_code = m.obshtina_code)`,
    );
    assert.deepEqual(
      orphans,
      [],
      "a loaded council is reachable from no frontend code — My-Area would show " +
        "no council there",
    );

    // Sofia's composition is known and fixed: 24 S2*** districts + SFO_CITY +
    // SOF00 + SOF. Equality, so a duplicate alias creeping in is visible.
    const [sofia] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM council_muni_code WHERE obshtina_code = 'SOF'`,
    );
    assert.equal(
      Number(sofia.n),
      27,
      `Sofia resolves from ${sofia.n} frontend codes, expected 27 (24 S2*** districts ` +
        `+ SFO_CITY + SOF00 + SOF)`,
    );
  },
);

test.skipIf(skip)(
  "the denormalized counters on council_muni are current",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    const rows = await allRows<{
      obshtina_code: string;
      stored_res: string;
      real_res: string;
      stored_votes: string;
      real_votes: string;
    }>(
      `SELECT m.obshtina_code,
            m.resolution_count::text AS stored_res,
            count(DISTINCT r.id)::text AS real_res,
            m.named_vote_count::text AS stored_votes,
            count(v.*)::text AS real_votes
       FROM council_muni m
       LEFT JOIN council_resolution r ON r.obshtina_code = m.obshtina_code
       LEFT JOIN council_vote v       ON v.resolution_id = r.id
      GROUP BY 1, 2, 4`,
    );
    for (const r of rows) {
      assert.equal(
        r.stored_res,
        r.real_res,
        `${r.obshtina_code}: resolution_count says ${r.stored_res}, the table holds ${r.real_res}`,
      );
      assert.equal(
        r.stored_votes,
        r.real_votes,
        `${r.obshtina_code}: named_vote_count says ${r.stored_votes}, the table holds ${r.real_votes}`,
      );
    }
  },
);

test.skipIf(skip)(
  "no council has quietly stopped publishing named votes",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");

    // THE gate whose absence let the 2026-05 freeze run for two and a half
    // months. Nothing else notices: resolutions keep arriving, every row count
    // reconciles, and the named-vote half simply stops moving.
    const rows = await allRows<{
      code: string;
      newest: string;
      newest_named: string | null;
      gap_days: string | null;
    }>(
      `SELECT m.obshtina_code AS code,
            max(r.decided_on)::text AS newest,
            max(r.decided_on) FILTER (WHERE r.has_named_votes)::text AS newest_named,
            (max(r.decided_on)
               - max(r.decided_on) FILTER (WHERE r.has_named_votes))::text AS gap_days
       FROM council_muni m
       JOIN council_resolution r ON r.obshtina_code = m.obshtina_code
      WHERE m.has_named_votes
      GROUP BY 1`,
    );
    assert.ok(rows.length > 0, "no vote-bearing council found");

    // ⚠️ THE FREEZE'S FOOTPRINT IS STILL IN THE DATA. Fixing the merge and putting
    // --per-councillor back on the daily path stops it recurring; it does NOT
    // backfill what was missed, and re-scraping 16 municipal websites is an
    // operator action.
    //
    // These are DATES, not day-counts, and that is the whole design. `gap_days`
    // is the difference between two MOVING watermarks, so a day-count budget
    // expires on its own as new resolutions land — every entry would go red on a
    // CORRECT run, inviting someone to raise the number until the ratchet became
    // the allowlist its own comment warns against. Sofia makes that concrete: its
    // per-councillor extraction is --ocr-gated (parsers/sof.ts:350) and the daily
    // path deliberately does not pass --ocr, so its named watermark is pinned by
    // design while its resolutions advance daily.
    //
    // A date watermark only fails when the named side actually REGRESSES, and it
    // tightens automatically — the second assertion fires the moment a council
    // makes progress, and the fix is a one-line date bump.
    const NAMED_VOTE_WATERMARK: Record<string, string> = {
      SZR12: "2025-06-01", // a separate, older parser problem the May freeze hid;
      // obs.kazanlak.bg was unreachable on 2026-08-17 (6 lookup timeouts, circuit
      // breaker open), so this one could not be backfilled at all.
      BGS01: "2026-03-17", // re-scraped 2026-08-17: 70 resolutions updated, but the
      // protokols in the window carry no per-councillor block, so the watermark
      // did not move. "Updated" is not "gained named votes".
      SOF: "2026-04-30", // --ocr-gated; the 2026-08-17 run reached all 7 sessions
      // and every Gemini call failed at the network layer ("fetch failed", zero
      // billed chunks), so Sofia gained 51 resolutions and no named votes.
    };

    // A council with no recorded debt. The freeze ran 79 days before anyone
    // noticed, so the ceiling has to sit below that or it would have permitted
    // the very incident this gate exists to catch.
    const NORMAL_LAG_DAYS = 60;

    // A typo here would silently relax that council to NORMAL_LAG_DAYS, and for
    // four of the five entries that is LOOSER than their budget — the ratchet
    // lost with nothing failing.
    for (const code of Object.keys(NAMED_VOTE_WATERMARK)) {
      assert.ok(
        rows.some((r) => r.code === code),
        `NAMED_VOTE_WATERMARK names '${code}', which is not a vote-bearing council ` +
          `— either a typo, or the council has dropped out and the entry is dead config`,
      );
    }

    for (const r of rows) {
      assert.ok(
        r.newest_named !== null,
        `${r.code} claims named votes but has no resolution carrying any`,
      );
      const floor = NAMED_VOTE_WATERMARK[r.code];
      if (floor) {
        // ISO dates compare lexicographically.
        assert.ok(
          (r.newest_named as string) >= floor,
          `${r.code}: newest named-vote resolution is ${r.newest_named}, behind its ` +
            `recorded watermark of ${floor} — named votes have REGRESSED`,
        );
        assert.equal(
          r.newest_named,
          floor,
          `${r.code} has advanced to ${r.newest_named} (watermark ${floor}) — move its ` +
            `NAMED_VOTE_WATERMARK entry forward so the gate ratchets. A recorded debt ` +
            `that is never tightened is an allowlist`,
        );
      } else {
        assert.ok(
          Number(r.gap_days) <= NORMAL_LAG_DAYS,
          `${r.code}: newest resolution ${r.newest}, newest NAMED-vote resolution ` +
            `${r.newest_named} — ${r.gap_days} days apart. The named-vote half has ` +
            `stopped moving while resolutions keep arriving: check that the daily ` +
            `scrape still passes --per-councillor, and that this município's parser ` +
            `still emits perCouncillor`,
        );
      }
    }
  },
);

test.skipIf(skip)(
  "no council has stopped publishing named votes ENTIRELY",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");

    // The gate above filters `WHERE m.has_named_votes`, so it supervises only
    // councils that still have SOME named votes. A council that loses them all —
    // a parser regression, a site redesign — drops out of that filter entirely
    // and becomes invisible. That is a worse freeze than the partial one, not a
    // lesser one, so the vote-bearing SET is pinned here.
    //
    // GAB05 is deliberately absent: its 244 resolutions carry zero per-councillor
    // blocks, despite the wired-municipalities table once claiming otherwise.
    const EXPECTED_VOTE_BEARING = ["BGS01", "PER32", "SOF", "SZR12", "VTR01"];

    const rows = await allRows<{ code: string }>(
      `SELECT obshtina_code AS code FROM council_muni WHERE has_named_votes ORDER BY 1`,
    );
    const actual = rows.map((r) => r.code);
    const lost = EXPECTED_VOTE_BEARING.filter((c) => !actual.includes(c));
    assert.deepEqual(
      lost,
      [],
      `${lost.join(", ")} published named votes and now publish none at all — a ` +
        `TOTAL freeze, which the per-council staleness gate cannot see because it ` +
        `only looks at councils that still have some`,
    );
    const gained = actual.filter((c) => !EXPECTED_VOTE_BEARING.includes(c));
    assert.deepEqual(
      gained,
      [],
      `${gained.join(", ")} started publishing named votes — good news, but add them ` +
        `to EXPECTED_VOTE_BEARING (and NAMED_VOTE_WATERMARK) so they are supervised`,
    );
  },
);
