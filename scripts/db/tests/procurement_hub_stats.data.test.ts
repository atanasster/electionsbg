// Does the COMMITTED /procurement hub blob still match the corpus it was generated from?
//
//   npm run test:data
//
// WHY THIS EXISTS. `data/procurement/derived/hub_stats.json` is committed, bucket-synced and
// downloaded by every visitor to /procurement — but its figures are derived from Postgres by
// `npm run db:gen-hub-stats`. Nothing regenerated it when an incremental ingest moved one of
// its inputs, so it went stale in the repo while serving 200s. Measured 2026-08-27, before
// this gate existed: `appeals` was 7,998 against a live 8,007 (a КЗК ingest on 08-24), and
// `connected` was short across 15 scopes (a `db:load:tr:pg` that rebuilt company_politicians).
//
// CLAUDE.md already records this failure class for this exact file — "committed and
// bucket-synced, but derived from Postgres … they go stale in the repo whenever the corpus
// reloads". The `db:refresh` half was closed in 2026-08 by putting the generator in the
// chain; `refresh_coverage.ts` holds that MEMBERSHIP, which is satisfied while the artifact
// itself is stale. This gate is the other half.
//
// ⚠️ NOT the parliament blob. `hub_stats_pg.data.test.ts` compares
// `data/parliament/votes/derived/hub_stats.json` — a different artifact, a different
// generator, and the reason this one went unwatched: a grep for "hub_stats" finds a gate and
// stops.
//
// ⚠️ FULL COMPARE — every scope, every scalar field — and the subset it replaced is the
// argument for it. The plan behind this gate proposed comparing three cheap fields for all
// scopes plus the heavy ones for `all` only, to save ~15 s. Its own pre-execution check WAS
// such a subset, and it missed `connected` entirely: six of the ten fields were never looked
// at, and no `ns:` scope was checked at all. A subset that fails on its first outing is not a
// design to keep. The whole compare is ~18 s, the same range as agri_hub_stats.data.test.ts.
//
// ⚠️ THE SQL IS NOT RESTATED HERE. `./gen_procurement/hub_stats_source` is imported by BOTH
// this gate and the generator, so a drift between them is impossible by construction. A gate
// with its own copy of the four function calls would assert that two implementations agree —
// and on disagreement could not say which half was wrong.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";
import {
  hubScopes,
  hubStatFor,
  HUB_SCALAR_FIELDS,
  HUB_STATS_PATH,
} from "../gen_procurement/hub_stats_source";
import type { HubStat } from "../../../src/data/procurement/useProcurementHubStats";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const BLOB = path.join(REPO, HUB_STATS_PATH);

const haveDb = await dbReachable();

/**
 * Every relation the four scoped functions touch — the generator's own `RELATIONS` list,
 * because this gate must stand down on exactly the states where the generator declines to
 * produce a comparison. Probing only `contracts` is NOT parity with it and was the first
 * version of this file: `procurement_overview` and `procurement_risk_feed` both read
 * `company_politicians` and `tr_companies`, whose only loader `db:load:tr:pg` is a
 * `REFRESH_EXCLUSIONS` member — so on a clone that has never run the multi-hour TR ingest
 * the comparison raises 42P01 and `db:refresh` ends RED at its final `test:data` step, for
 * a corpus nobody was expected to have.
 */
const REQUIRED_RELATIONS = [
  "contracts",
  "awarder_seats",
  "tenders",
  "kzk_appeals",
  "ngo_funding",
  "company_politicians",
  "tr_companies",
] as const;

/**
 * The skip reason, or `false` to run.
 *
 * ⚠️ TRI-STATE (`string | false`), AND ONE `to_regclass` QUERY RATHER THAN A try/catch PER
 * RELATION. A probe that answers the same falsy value from its `catch` and from its content
 * check forces one sentence onto two different worlds — and the half it gets wrong is always
 * "Postgres unreachable", the one warning an operator is trained to ignore. `skip_gate_scan`
 * has a rule for exactly that shape (`conflated-probe`); the `rowCount` helper this file
 * first copied from `culture_fund_sources.data.test.ts` is itself one of its recorded
 * offenders. `to_regclass` returns NULL for an absent relation instead of raising, so there
 * is no catch to conflate.
 */
const preflight = async (): Promise<string | false> => {
  if (!haveDb) return "Postgres unreachable";
  const [r] = await allRows<{ missing: string[] | null }>(
    `SELECT array_remove(array_agg(CASE WHEN to_regclass('public.'||t) IS NULL THEN t END), NULL) AS missing
       FROM unnest($1::text[]) AS t`,
    [[...REQUIRED_RELATIONS]],
  );
  const missing = r.missing ?? [];
  if (missing.length)
    return (
      `relation(s) absent: ${missing.join(", ")} — ` +
      (missing.every((m) => m === "company_politicians" || m === "tr_companies")
        ? "run `npm run db:load:tr:pg` (the TR ingest, the one dependency db:refresh excludes)"
        : "run `npm run db:refresh`, whose loaders fill these")
    );
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM contracts LIMIT 1",
  );
  if (Number(c.n) === 0)
    return "the contracts table is empty — run the procurement ingest, then db:load:pg";
  if (!existsSync(BLOB))
    return `${HUB_STATS_PATH} is absent — it is committed, so this is a sparse checkout`;
  return false;
};

const skip = await preflight();
reportSkip(import.meta.url, skip);

// OUTSIDE any gate: the blob is COMMITTED, so absence is a broken working copy rather than a
// supported state. Same reason as hub_stats_pg.data.test.ts.
assertCommitted(HUB_STATS_PATH);

afterAll(async () => {
  if (haveDb) await end();
});

const readBlob = (): Record<string, HubStat> =>
  JSON.parse(readFileSync(BLOB, "utf8")) as Record<string, HubStat>;

/** The one remedy sentence, so every failure below names it identically. */
const FIX =
  "The blob is COMMITTED and bucket-synced, so the repair is `npm run db:gen-hub-stats` " +
  "followed by a commit — NOT a loader run. Check nothing is writing to Postgres first: a " +
  "blob generated mid-chain is stale on arrival.";

test.skipIf(skip)(
  "the committed blob carries exactly the scopes the corpus implies",
  async () => {
    const blob = readBlob();
    const scopes = await hubScopes();
    // Non-vacuity, first: a gate that compares zero scopes passes.
    assert.ok(
      scopes.length > 10,
      `only ${scopes.length} scope(s) derived — the enumeration is not reaching the corpus, ` +
        "so every comparison below would be vacuous",
    );
    assert.deepEqual(
      Object.keys(blob).sort(),
      scopes.map((s) => s.key).sort(),
      `the blob's scope set disagrees with the corpus. A new election in elections.json or ` +
        `a new contract year adds a scope the hub's picker offers and the blob cannot ` +
        `answer. ${FIX}`,
    );
  },
);

test.skipIf(skip)(
  "the field list this gate compares covers every scalar the blob carries",
  () => {
    // Guards the gate itself, not the data. `HUB_SCALAR_FIELDS` is hand-written (a type
    // cannot be enumerated at runtime), so a field added to HubStat would otherwise be
    // compared by nothing — silently reintroducing exactly the partial coverage that let
    // `connected` drift unnoticed.
    const blob = readBlob();
    const inBlob = new Set<string>();
    for (const stat of Object.values(blob))
      for (const [k, v] of Object.entries(stat))
        if (typeof v === "number") inBlob.add(k);
    const uncovered = [...inBlob].filter(
      (k) => !(HUB_SCALAR_FIELDS as readonly string[]).includes(k),
    );
    assert.deepEqual(
      uncovered,
      [],
      `the blob carries scalar field(s) this gate does not compare: ${uncovered.join(", ")}. ` +
        "Add them to HUB_SCALAR_FIELDS in scripts/db/gen_procurement/hub_stats_source.ts — " +
        "an uncompared field is an unwatched one.",
    );
  },
);

test.skipIf(skip)(
  "Postgres reproduces every scope and every field of the committed blob",
  async () => {
    const blob = readBlob();
    const scopes = await hubScopes();
    const drift: string[] = [];
    let compared = 0;

    for (const { key, from, to } of scopes) {
      const want = blob[key];
      if (!want) continue; // the scope-set test above owns this failure
      const got = await hubStatFor(from, to);
      for (const f of HUB_SCALAR_FIELDS) {
        compared++;
        if (want[f] !== got[f])
          drift.push(`${key}.${f}: blob ${want[f]} vs corpus ${got[f]}`);
      }
      // topAwarders on eik + eur ONLY. `name` is deliberately excluded: the generator
      // overwrites it afterwards via commonestNames(), so hubStatFor returns the raw
      // procurement_overview alias and a name comparison would report a difference that is
      // not drift. eik and eur come straight through untouched.
      const wa = (want.topAwarders ?? []).map((a) => `${a.eik}:${a.eur}`);
      const ga = (got.topAwarders ?? []).map((a) => `${a.eik}:${a.eur}`);
      compared++;
      if (wa.join(",") !== ga.join(","))
        drift.push(`${key}.topAwarders: blob [${wa}] vs corpus [${ga}]`);
    }

    assert.ok(
      compared > 100,
      `only ${compared} comparison(s) made — this gate has gone vacuous`,
    );
    assert.deepEqual(
      drift,
      [],
      `the committed hub blob has drifted from the corpus in ${drift.length} place(s):\n  ` +
        `${drift.slice(0, 25).join("\n  ")}` +
        (drift.length > 25 ? `\n  … and ${drift.length - 25} more` : "") +
        `\n\n${FIX}`,
    );
  },
  // ⚠️ EXPLICIT, AND NOT PADDING. This runs 120 aggregate calls — the four scoped functions
  // across 30 scopes — and the project default is 120 s (vitest.config.ts). Measured: ~20 s
  // warm, and a COLD run on an idle local Postgres TIMED OUT at 120 s, which is the state a
  // fresh `db:refresh` machine or a CI box is in. A timeout here reads as "the gate is
  // broken" rather than "the cache was cold", so the ceiling is raised to a figure the cold
  // path fits inside. Do NOT read this as licence for the gate to get slower: the drift
  // assertion is what must stay, and if the cold time approaches this the fix is fewer
  // round trips, not a bigger number.
  300_000,
);

test.skipIf(skip)(
  "the scoped date predicates cannot silently drop a row from every window",
  async () => {
    // 062's arms are `publication_date >= COALESCE(p_from,'')` on TEXT columns, so a NULL
    // date makes the predicate NULL and the row is excluded from EVERY scope — including
    // `all`, which a reader takes to mean the whole corpus. There are none today; nothing
    // enforces that, and the symptom would be a tile quietly under-counting.
    const [r] = await allRows<{ t: string; a: string }>(
      `SELECT (SELECT count(*) FROM tenders
                WHERE publication_date IS NULL OR publication_date = '')::text AS t,
              (SELECT count(*) FROM kzk_appeals
                WHERE complaint_date IS NULL OR complaint_date = '')::text AS a`,
    );
    assert.equal(
      `${r.t}/${r.a}`,
      "0/0",
      `${r.t} tender(s) and ${r.a} appeal(s) carry no usable date, so procurement_hub_counts ` +
        "excludes them from every scope including `all` — the hub under-counts by that much " +
        "with nothing failing. Either backfill the dates or give 062 an explicit bucket for " +
        "them; do NOT widen this assertion.",
    );
  },
);
