// The obshtina code on a municipal official's roster row and person_role (T0.2a).
// Plan: docs/plans/persons-pg-retirement-v1.md.
//
// WHY THIS IS CARRIED RATHER THAN DERIVED. The Court-of-Audit register names a
// municipality in prose ("Гоце Делчев"); the app keys municipal pages on an obshtina code
// ("BLG11"). The join between them lives in scripts/officials/municipality_join.ts and
// needs an alias file, four fallback strategies and synthetic codes for Sofia's 24
// district councils — it is not reproducible in SQL, and re-implementing it there would
// be a second source of truth. So the municipal shard build resolves it once, the roster
// loader reads the answer out of the emitted by_obshtina shards, and the resolver copies
// it to person_role.place_code (migration 115, place_kind='obshtina'). These tests pin that
// chain end to end, because every link in it fails silently: a missing code just leaves the
// typed place NULL and the municipal roster
// unservable from Postgres, which is the state this replaced.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const SHARD_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/officials/municipal/by_obshtina",
);
const INDEX_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/officials/municipal/index.json",
);
const MUNICIPALITIES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/municipalities.json",
);

/** ⚠ IT RETURNS A REASON, NOT A BOOLEAN. A probe answering `false` both when the server is down
 *  and when the table is empty forces ONE authored sentence onto two different worlds — and the
 *  half it gets wrong is always "Postgres unreachable", which `mp_arm_sql`'s header records as
 *  the string a real SQL bug hid behind for two days: "the one warning an operator is trained
 *  to ignore". The slash in the old message ("Postgres unreachable / official_roster empty")
 *  was that conflation written out rather than fixed, and the two need different remedies:
 *  `official_roster` is TRUNCATEd and reloaded only by `db:load:ngo-board-links`, which is not
 *  the command anybody reaches for when a container is down.
 *
 *  This file was on `report_skip_coverage`'s CONFLATED_PROBES ratchet; fixing it here is what
 *  removes the entry, and the ratchet's staleness arm fails if the two are not done together. */
const reachable = async (): Promise<string | false> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM official_roster WHERE tier = 'municipal'",
    );
    if (Number(c.n) === 0)
      return "official_roster holds no municipal row — run npm run db:load:ngo-board-links";
    return false;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01")
      return "the official_roster table does not exist — run npm run db:load:ngo-board-links against this database";
    if (code === "42501")
      return "no permission to read official_roster — check the role this DATABASE_URL connects as";
    // ⚠ CARRY THE CODE. 28P01 (auth) and 3D000 (no such database) are servers that answered.
    return `Postgres unreachable (${code ?? (e as Error).message})`;
  }
};

const skip = await reachable();
reportSkip(import.meta.url, skip);
/** The PERSON-LAYER gate, and it is separate for the reason the two siblings just learned.
 *
 *  ⚠⚠ A SECOND RELATION, WRITTEN BY A DIFFERENT LOADER. `person_role` is DELETEd and re-COPYd
 *  by `db:resolve:persons`; `official_roster` is TRUNCATEd only by `db:load:ngo-board-links`,
 *  25 steps earlier in `db:refresh` and independently runnable. "The roster is loaded" says
 *  nothing about the person layer, and the failure is silent in the worst direction: with an
 *  empty `official_muni` population the two counting tests below report `total=0 placed=0` and
 *  `0 distinct place_code`, both of which PASS — against a real 6,647/6,647. A corpus that was
 *  never asked, publishing "no defects".
 *
 *  Absent rather than empty is reachable too: `person_role` is created by
 *  `081_person_identity.sql`, whose appliers are the resolver, `add_override.ts` and the agri
 *  ingest — none of them this file's loader — so a cloud target filled in the documented
 *  per-loader order can hold the roster and no person layer, and every one of these tests then
 *  throws a bare 42P01 with no reason. */
const personRoleReachable = async (): Promise<string | false> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE source = 'official_muni'",
    );
    if (Number(c.n) === 0)
      return "person_role holds no official_muni role — run npm run db:resolve:persons";
    return false;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01")
      return "the person_role table does not exist — run npm run db:resolve:persons against this database";
    if (code === "42501")
      return "no permission to read person_role — check the role this DATABASE_URL connects as";
    return `Postgres unreachable (${code ?? (e as Error).message})`;
  }
};

// ⚠ NOT `skip || …` — see the shard gate below for what composing an unrelated reason costs.
const skipPerson = await personRoleReachable();
reportSkip(import.meta.url, skipPerson);

const haveShards = existsSync(SHARD_DIR);

// ⚠⚠ NOT `skip || …`, AND THAT LINE COST BOTH SHARD GATES EVERY CI RUN. The two tests below
// this read `data/municipalities.json` and `readdirSync(SHARD_DIR)` and open no connection —
// the file says so itself at „These two need no database" — but composing the database reason
// in stood them down whenever Postgres was absent, which is every hermetic CI run
// (`.github/workflows/test.yml` labels the unit step "no browser, emulator or database").
// Measured against a dead port: both reported „skipped — Postgres unreachable (ECONNREFUSED)".
//
// What was lost is not incidental. They were written on 2026-09-04 for a defect in COMMITTED
// DATA — VAR05 carrying no shard while RSE04 held two municipalities' rosters, two mayors and
// two council chairs — detectable with no database, and their detector was running only on a
// developer's machine that happened to have a container up.
const skipShards = !haveShards
  ? "data/officials/municipal/by_obshtina absent — it is committed, so this is a sparse checkout"
  : false;
reportSkip(import.meta.url, skipShards);
afterAll(async () => {
  await end();
});

// Every municipal official has a code. A partial fill is the dangerous state: the roster
// still loads, the resolver still runs, and only the officials in the un-coded obshtini
// quietly vanish from a code-scoped query.
// OUTSIDE any gate, deliberately — these are COMMITTED, so absence is a broken
// working copy rather than a supported state. See scripts/lib/assert_committed.ts.
// ⚠ `data/municipalities.json` IS THE THIRD ONE, and it was read without being asserted. It is
// the input to „every município in data/municipalities.json has a roster shard" — the gate that
// caught Бяла/Варна resolving onto Бяла (Русе)'s code, leaving VAR05 with no shard while RSE04
// carried two mayors and two council chairs. Absent, `readFileSync` threw a bare ENOENT inside
// a `skipIf`-gated test: loud, but unnamed, and not the "restore your working copy" diagnosis
// this helper exists to give.
assertCommitted(
  "data/officials/municipal/by_obshtina",
  "data/officials/municipal/index.json",
  "data/municipalities.json",
);

test.skipIf(skip)(
  "every municipal roster row carries an obshtina code",
  async () => {
    const [row] = await allRows<{ total: string; coded: string }>(
      `SELECT count(*) AS total,
            count(*) FILTER (WHERE obshtina IS NOT NULL) AS coded
       FROM official_roster WHERE tier = 'municipal'`,
    );
    assert.equal(
      row.coded,
      row.total,
      `${Number(row.total) - Number(row.coded)} municipal roster row(s) have no obshtina — the by_obshtina shards were missing or unreadable when db:load:ngo-board-links ran`,
    );
  },
);

// The resolver leg. official_roster having the code is useless if person_role does not,
// since that is what a served municipal roster would actually be keyed on.
test.skipIf(skipPerson)(
  "person_role carries a typed obshtina place for municipal roles",
  async () => {
    const [row] = await allRows<{ total: string; placed: string }>(
      `SELECT count(*) AS total,
            count(*) FILTER (
              WHERE place_kind = 'obshtina' AND place_code IS NOT NULL
            ) AS placed
       FROM person_role WHERE source = 'official_muni'`,
    );
    assert.equal(
      row.placed,
      row.total,
      `${Number(row.total) - Number(row.placed)} official_muni role(s) have no typed obshtina place — db:resolve:persons ran against a roster without obshtina codes, or the fill regressed`,
    );
  },
);

// ─── the direction the four assertions above cannot express (T4.2) ──────────────────────
//
// Every one of them is SHARD-RELATIVE: they ask whether a shard's rows reached Postgres, and
// whether a code in Postgres names a real shard. None asks whether the shard SET covers the
// catalogue — so a município with NO shard at all is invisible to all four, and a shard
// holding TWO municipalities' rosters merged is indistinguishable from a large município.
//
// That is not a hypothetical gap. From the day the officials roster was first sharded until
// 2026-09-04, "Бяла/Варна/" and "Бяла/Русе/" both resolved to RSE04: obshtina VAR05 was the
// ONE municipality of 288 with no shard, RSE04 carried 36 rows with TWO mayors and TWO
// council chairs, and all four assertions were green throughout. These two need no database.

test.skipIf(skipShards)(
  "every município in data/municipalities.json has a roster shard",
  () => {
    const municipalities = JSON.parse(
      readFileSync(MUNICIPALITIES_PATH, "utf8"),
    ) as { obshtina: string; name: string; oblast: string }[];
    const shards = new Set(
      readdirSync(SHARD_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "")),
    );
    // oblast "32" is the out-of-country pseudo-obshtini, which the register never names.
    const missingShard = municipalities
      .filter((m) => m.oblast !== "32" && !shards.has(m.obshtina))
      .map((m) => `${m.obshtina} (${m.name})`)
      .sort();
    assert.deepEqual(
      missingShard,
      [],
      `${missingShard.length} município(s) have no roster shard, so /governance and the ` +
        "my-area tiles serve them no officials at all. Usually a registry name the " +
        "obshtina join now refuses: `npx tsx scripts/officials/municipality_join.ts --dry-run`",
    );
  },
);

test.skipIf(skipShards)(
  "no shard merges two municipalities' rosters onto one obshtina code",
  () => {
    // The other side of the coverage test above, and the half that is a WRONG ATTRIBUTION of
    // named people rather than a gap: RSE04 published Бяла (Русе)'s roster AND Бяла (Варна)'s,
    // 36 rows with two mayors and two council chairs, and nothing could see it.
    //
    // ⚠️ THE PROPERTY IS "ONE REGISTRY NAME PER SHARD", NOT "ONE MAYOR PER SHARD". A count of
    // single-holder offices is the obvious test and it is wrong in both directions: Пловдив
    // legitimately carries SEVEN mayors (the city's plus six район mayors, folded under PDV22
    // by design and tagged with `district`), and 9 more shards carry two council chairs or two
    // mayors because the register names both a departing and an arriving officeholder in the
    // same year — Панагюрище's two 2026 `Кмет` rows are one município, not two. Measured
    // 2026-09-04: that rule reports 10 offenders, all of them legitimate, while THIS one
    // reports 0.
    const offenders: string[] = [];
    for (const f of readdirSync(SHARD_DIR)) {
      if (!f.endsWith(".json")) continue;
      const shard = JSON.parse(
        readFileSync(path.join(SHARD_DIR, f), "utf8"),
      ) as {
        entries?: { municipality?: string; district?: string }[];
      };
      // `district` rows are the sanctioned fold (rule 2 of the obshtina join), so they are
      // excluded — a Пловдив район SHOULD sit in the city's shard under its own label.
      const names = new Set(
        (shard.entries ?? [])
          .filter((e) => !e.district)
          .map((e) => e.municipality)
          .filter(Boolean) as string[],
      );
      if (names.size > 1)
        offenders.push(
          `${f.replace(/\.json$/, "")}: ${[...names].sort().join(" + ")}`,
        );
    }
    assert.deepEqual(
      offenders,
      [],
      "a shard carries officials from more than one registry institution — two " +
        "municipalities' rosters are merged onto one obshtina code, so one of them is " +
        "published under the other's name and the other has no page",
    );
  },
);

// Codes must be the app's own, not invented. Anything not matching a shard filename would
//404 the municipal page it keys.
test.skipIf(skipPerson || skipShards)(
  "every code in person_role matches a real obshtina shard",
  async () => {
    const known = new Set(
      readdirSync(SHARD_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "")),
    );
    const rows = await allRows<{ place_code: string }>(
      `SELECT DISTINCT place_code FROM person_role
        WHERE source = 'official_muni' AND place_kind = 'obshtina'`,
    );
    // ⚠ COLLECTED, NOT ASSERTED PER ROW. Every other assertion in this file reports a count
    // and a truncated sample; failing inside the loop names ONE code, so a systematic break —
    // every code shifted by a join change — reads as a single stray row.
    const unknown = rows.map((r) => r.place_code).filter((c) => !known.has(c));
    assert.deepEqual(
      unknown.slice(0, 5),
      [],
      `${unknown.length} person_role.place_code value(s) are not obshtina shards`,
    );
  },
);

// Set parity against the shards. This is the assertion that would have caught a name→code
// join regression: an official silently filed under the wrong municipality shows up here as
// one missing AND one extra, and both halves are still checked.
//
// ⚠️ IT IS NO LONGER SYMMETRIC, and the asymmetry is the point. The roster index accumulates
// while the shards carry only the sitting bench (scripts/officials/build_municipal_shards.ts
// `currentBench`), so `person_role` legitimately holds a municipal role for every official
// who has left since the register's first municipal year. Asserting equality would force the
// roster back to a snapshot — the state that, on the 2025→2026 rollover, dropped 334
// officials, orphaned 408 filings and 404'd their /person URLs.
//
// So: `missing` must still be EMPTY (a shard row absent from PG, or filed under another
// code, is the original defect), and every `extra` must be a departed official — present in
// the municipal index, absent from the bench. An extra that is in NO index at all is a real
// failure, and so is a count that drifts from the index's own retained figure.
test.skipIf(skipPerson || skipShards)(
  "every shard row is in Postgres under the same code, and the extras are exactly the departed",
  async () => {
    const rows = await allRows<{ place_code: string; ref: string }>(
      `SELECT place_code, ref FROM person_role
        WHERE source = 'official_muni' AND place_kind = 'obshtina'`,
    );
    const pg = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!pg.has(r.place_code)) pg.set(r.place_code, new Set());
      pg.get(r.place_code)!.add(r.ref);
    }

    let jsonSlugs = 0;
    const missing: string[] = [];
    const extra: string[] = [];
    for (const f of readdirSync(SHARD_DIR)) {
      if (!f.endsWith(".json")) continue;
      const shard = JSON.parse(
        readFileSync(path.join(SHARD_DIR, f), "utf8"),
      ) as { obshtina?: string; entries?: { slug?: string }[] };
      const code = shard.obshtina ?? f.replace(/\.json$/, "");
      const js = new Set(
        (shard.entries ?? []).map((e) => e.slug).filter(Boolean) as string[],
      );
      jsonSlugs += js.size;
      const ps = pg.get(code) ?? new Set<string>();
      for (const s of js) if (!ps.has(s)) missing.push(`${code}/${s}`);
      for (const s of ps) if (!js.has(s)) extra.push(`${code}/${s}`);
    }

    assert.ok(
      jsonSlugs > 5_000,
      `only ${jsonSlugs} shard slugs — shards look truncated`,
    );
    // ⚠️ THIS FAILURE HAS TWO OPPOSITE CAUSES AND THE ASSERTION CANNOT TELL THEM APART —
    // so it must not claim to. The message said "the name→code join regressed", which is one
    // of them; the other is a CORRECTED shard tree ahead of a database nobody has reloaded,
    // where the fix is a reload and touching the join would undo it.
    //
    // They are indistinguishable from inside this gate because both leave the shard's slug in
    // person_role under a different obshtina: a regression files it wrongly today, a stale
    // database still holds yesterday's wrong filing. Direction of time is the discriminator
    // and neither table records it. That is not hypothetical — on 2026-09-04 the Бяла join
    // was repaired, 14 VAR05 rows appeared on disk, and this assertion reported the repair
    // as the regression.
    //
    // What DOES decide it is scripts/officials/municipality_join.test.ts, which tests the
    // join against the catalogue with no database involved. Green there ⇒ stale database.
    // ⚠ ONE SET, NOT ONE PER MISSING ROW. `[...pg.values()]` inside the filter rebuilt the
    // whole 265-município structure per candidate.
    const anySlug = new Set<string>();
    for (const set of pg.values()) for (const slug of set) anySlug.add(slug);
    const elsewhere = missing.filter((m) => anySlug.has(m.split("/")[1]!));
    assert.deepEqual(
      missing.slice(0, 5),
      [],
      `${missing.length} shard row(s) are absent from person_role under their shard's obshtina ` +
        // ⚠ THE EXAMPLE COMES FROM `elsewhere`, NOT FROM `missing`. With none filed elsewhere —
        // the person-layer-never-resolved case — the old form read „0 of them filed under a
        // different one, e.g. RSE04/ivan-petrov", pointing the reader at a row that was not.
        `(${elsewhere.length} of them filed under a different one${
          elsewhere.length ? `, e.g. ${elsewhere[0]}` : ""
        }). ` +
        "Two causes, and this gate cannot separate them: (a) the name→code join regressed, " +
        "or (b) the shards are correct and the database is stale. Run " +
        "`npx vitest run scripts/officials/municipality_join.test.ts` — if it passes it is " +
        // ⚠ THE ORDER IS LOAD-BEARING AND THIS MESSAGE HAD IT INVERTED. `db:resolve:persons`
        // DELETEs and re-COPYs `person`, which NULLs `council_vote.person_id` table-wide, so
        // council must be re-attached AFTER the resolve — `refresh_coverage.test.ts`'s
        // ORDER_PAIRS asserts exactly that. Running council first, as this line used to say,
        // blanks every council-vote attribution and reports success. And the resolver is not
        // the end of the chain: CLAUDE.md calls stopping there "the wrong instruction and it
        // is the one people are given".
        "(b), and the fix is a reload, in this order: db:load:ngo-board-links → " +
        "db:resolve:persons → db:load:declarations:pg -- --resolve → db:load:council:pg " +
        "(see CLAUDE.md, 'A LOCAL db:resolve:persons is never one command')",
    );

    // Every extra must be an official the register's newest listing no longer names.
    const index = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as {
      total: number;
      current?: { total: number };
      entries: {
        slug: string;
        descriptorYear?: number;
        role?: string;
        municipality?: string;
      }[];
    };
    const benchYear = Math.max(
      0,
      ...index.entries.map((e) => e.descriptorYear ?? 0),
    );
    const departed = new Set(
      index.entries
        .filter((e) => (e.descriptorYear ?? 0) !== benchYear)
        .map((e) => e.slug),
    );
    const unexplained = extra.filter((s) => !departed.has(s.split("/")[1]));
    assert.deepEqual(
      unexplained.slice(0, 5),
      [],
      `${unexplained.length} person_role municipal row(s) are in no shard AND not a departed official — the roster gained someone from nowhere`,
    );
    // Pinned against the index's own figure so a roster that quietly stops accumulating —
    // or one that starts retaining people the index does not — fails here rather than
    // silently shrinking the person layer again.
    //
    // ⚠️ RETAINED IS NOT THE SAME AS DEPARTED, and the difference is the carried mayors.
    // `currentBench` keeps a município's mayor on the bench when the newest listing names none
    // — the office is never vacant, so an absence there is the register failing to re-list an
    // incumbent — and such a row is BOTH off the current year (retained) and in a shard
    // (serving). Counting it as departed made this assertion fail on the very row that fixed
    // Разлог. The bench year cannot be read off `current.year` here for the same reason the
    // set is computed from the shards: a carried row's own descriptorYear is deliberately left
    // behind the bench.
    // ⚠️ `carried` MUST BE DERIVED FROM THE RULE, NOT FROM THE SHARDS. Counting the off-bench
    // rows that happen to be IN a shard makes this an identity — `retained` and `extra` then
    // move together for any row the shard build decides to include, and the assertion passes
    // for every over-carry. Simulated by deleting `currentBench`'s `benchHasMayor` guard so
    // all 5 prior-year mayors are carried: 4 shards gain a second mayor and the shard-derived
    // form still reports 329 == 329, while this form reports 333 != 329. No sibling gate
    // covers it either — "no shard merges two registry names" deliberately does not count
    // mayors, and municipal_officials.data.test.ts is built from the same `currentBench`.
    //
    // So the licence is restated here from the index alone: a row may be carried only if it is
    // a MAYOR whose município names none on the bench. That is a second statement of
    // `currentBench`'s rule, which is normally the thing to avoid — but a gate that re-derives
    // its expectation from the artifact under test is not a gate at all.
    const benchMayorMunis = new Set(
      index.entries
        .filter(
          (e) => e.role === "mayor" && (e.descriptorYear ?? 0) === benchYear,
        )
        .map((e) => e.municipality),
    );
    const carried = index.entries.filter(
      (e) =>
        e.role === "mayor" &&
        (e.descriptorYear ?? 0) !== benchYear &&
        !benchMayorMunis.has(e.municipality),
    ).length;
    const retained =
      index.total - (index.current?.total ?? index.total) - carried;

    // ⚠️ MUTATION ARM. The previous form of this subtraction counted the off-bench rows that
    // were IN a shard, which made the assertion an identity — it passed for any over-carry.
    // This proves the licence-derived form still discriminates: relax it to "every off-bench
    // mayor is carried" (the shape a deleted `benchHasMayor` guard would produce) and the
    // expectation must MOVE. If it does not, the constraint has stopped constraining.
    const unconstrained = index.entries.filter(
      (e) => e.role === "mayor" && (e.descriptorYear ?? 0) !== benchYear,
    ).length;
    assert.notEqual(
      unconstrained,
      carried,
      "the carried-mayor licence no longer narrows anything — every off-bench mayor now " +
        "qualifies, so this assertion cannot detect an over-carrying bench",
    );
    assert.equal(
      extra.length,
      retained,
      `${extra.length} departed official(s) in person_role but ${retained} retained-and-not-serving in the index ` +
        `(${carried} carried onto the bench) — the two disagree about who has left`,
    );
  },
);
