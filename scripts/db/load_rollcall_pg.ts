// Load the National Assembly roll-call corpus into Postgres — schema 134_rollcall.sql.
//
// Source: data/parliament/votes/sessions/*.json (613 files, 288 MB), the same tree the
// derived pipeline reads. This is the LOAD half only; 135 builds the matviews on top and
// nothing serves from these tables yet.
//
// Run: `npm run db:load:rollcall:pg` (local) / `:cloud` (Cloud SQL proxy).
//
// ---------------------------------------------------------------------------
// STAGE-MERGE, NOT TRUNCATE+COPY. vote_cast will be on a serving path, and a
// TRUNCATE-and-rebuild on a served table holds an AccessExclusiveLock for the whole load
// and 500s the routes at the pool's lock_timeout (reference_contracts_reload_lock,
// reference_stage_merge_reload). The corpus is append-only per plenary day, so the merge
// is genuinely incremental: one day is ~250 items × 240 MPs ≈ 60,000 rows, not 4M.
//
// ---------------------------------------------------------------------------
// TWO PREFLIGHTS THAT REPORT RATHER THAN THROW.
//
// Both describe defects that exist in the SOURCE and that this load is the first thing
// ever to notice. Throwing on them would mean the corpus can never be loaded at all, which
// helps nobody; the point is that they stop being invisible.
//
//   • DUPLICATE CASTS. 84 (item, mp) pairs appear twice — always an identical `absent`,
//     always on a parliament's opening sitting. The JSON `votes` array is keyed by
//     POSITION, not by MP, so nothing upstream dedupes it and every attendance denominator
//     counts those members twice. The primary key here is the first thing that has ever
//     objected.
//   • RECYCLED MP IDS. 26 ids carry two genuinely different people across parliaments.
//     (ns, mp_id) makes them safe here; the preflight names them so the person layer's
//     ambiguous bridge (person_role.ref = mp_id, no NS) stays visible.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end, vacuumAfterReload } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
} from "./lib/stage_merge";
import { recordIngestBatch } from "./lib/ingest_changelog";
import { dedupeRevotes, normalizeTitle } from "../parliament/derived/dedupe";
// ONE stem rule, shared with the hub's bill count. A second copy here would be a copy that
// does not learn the next trap — and the rule already has one in it (a title carrying
// „второ гласуване" in a procedural position is a FIRST reading).
import {
  secondReadingStem,
  firstReadingStem,
} from "../parliament/derived/hub_stats";
import { classifyTitle } from "../parliament/derived/topics";
import type { SessionFile } from "../parliament/derived/types";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SESSIONS_DIR = path.join(ROOT, "data/parliament/votes/sessions");
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/134_rollcall.sql");
const BILL_SCHEMA = path.join(ROOT, "scripts/db/schema/pg/136_bill.sql");
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);

const VOTE_CHAR: Record<string, string> = {
  yes: "y",
  no: "n",
  abstain: "a",
  absent: "x",
};

/** Reading-stage off the title. NULL when the title says neither, which is most items. */
const readingOf = (title: string): number | null => {
  if (/първо\s+(гласуване|четене)/i.test(title)) return 1;
  if (/второ\s+(гласуване|четене)/i.test(title)) return 2;
  return null;
};

interface LoadedBill {
  /** Assigned by the loader against what the database already holds, so a re-run does not
   *  renumber every bill and churn vote_item.bill_id. */
  billId: number;
  ns: number;
  stem: string;
  /** Resolved in a second pass, because bill.first_reading_item references vote_item and
   *  vote_item.bill_id references bill — the cycle has to be filled from both ends. */
  firstReadingItem: number | null;
}

interface LoadedItem {
  itemId: number;
  ns: number;
  date: string;
  itemNo: number;
  slug: string | null;
  title: string | null;
  topic: string;
  reading: number | null;
  /** Set for first- and second-reading items of a bill that REACHED a second reading. */
  billId: number | null;
  supersededBy: number | null;
  yes: number;
  no: number;
  abstain: number;
  absent: number;
}

interface LoadedCast {
  itemId: number;
  mpId: number;
  ns: number;
  vote: string;
  party: string | null;
}

const readSessions = (): SessionFile[] => {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map(
      (f) =>
        JSON.parse(
          readFileSync(path.join(SESSIONS_DIR, f), "utf8"),
        ) as SessionFile,
    );
};

export interface RollcallBuild {
  items: LoadedItem[];
  casts: LoadedCast[];
  seats: Map<
    string,
    { ns: number; mpId: number; name: string; party: string | null }
  >;
  parties: Set<string>;
  /** (item, mp) pairs the source lists twice. Reported, then collapsed. */
  duplicateCasts: number;
  /** mp_ids that name more than one person across parliaments. */
  recycledIds: Array<{ mpId: number; names: string[] }>;
  rawItems: number;
  dedupedItems: number;
  /** Rows carrying superseded_by — must equal rawItems - dedupedItems. */
  superseded: number;
  bills: LoadedBill[];
}

/** Pure, so the dedupe/keying decisions are testable without a database.
 *
 *  EVERY raw item becomes a row; the 1,645 collapsed by `dedupeRevotes` carry
 *  `superseded_by` pointing at the cast that stands. The plan asked for both "vote_item
 *  holds the deduped set" and "the collapsed casts stay reachable", which cannot both be
 *  literally true — a row you deleted is not reachable. This satisfies the reasoning
 *  behind them: the raw roll is evidence (a motion put to the floor twice IS a fact about
 *  the chamber, and /votes/<date> should be able to say so), while every derivation filters
 *  `superseded_by IS NULL` and therefore sees exactly the 15,096 the JSON artifacts were
 *  computed from. Loading only the survivors would have thrown away 1,645 real votes to
 *  make one COUNT(*) match a number in a document. */
export const buildRollcall = (
  raw: SessionFile[],
  /** (ns|stem) → bill_id already in the database. Passed in so a re-run REUSES ids rather
   *  than renumbering: bill_id is a foreign key on 15,096 vote_item rows, and renumbering it
   *  every night would rewrite them all and make the merge's changed-row count meaningless. */
  existingBillIds: Map<string, number> = new Map(),
): RollcallBuild => {
  const rawItems = raw.reduce((n, s) => n + s.sessions.length, 0);
  const dedupedItems = dedupeRevotes(raw).reduce(
    (n, s) => n + s.sessions.length,
    0,
  );

  const items: LoadedItem[] = [];
  const casts: LoadedCast[] = [];
  const seats = new Map<
    string,
    { ns: number; mpId: number; name: string; party: string | null }
  >();
  const parties = new Set<string>();
  const namesById = new Map<number, Set<string>>();
  const seen = new Set<string>();
  let duplicateCasts = 0;
  let itemId = 0;
  let superseded = 0;

  // (date, itemNo) → item_id, so the second pass can resolve survivors by number.
  const idByKey = new Map<string, number>();

  for (const session of raw) {
    const ns = Number(session.ns);
    const titles = session.itemTitles ?? {};
    // Per-day index, so the superseded pass is a lookup rather than a linear scan of
    // every item loaded so far.
    const rowByItemNo = new Map<number, LoadedItem>();

    // The survivor of each re-vote group, by the same rule dedupeRevotes applies: within
    // a day, group on the title with trailing "прегласуване" markers stripped and keep the
    // HIGHEST item number. Recomputed here rather than diffed against dedupeRevotes'
    // output, because the diff would tell us WHICH items were dropped but not what they
    // were dropped in favour of.
    const survivorOf = new Map<number, number>();
    const lastByKey = new Map<string, number>();
    for (const it of session.sessions) {
      const title = titles[String(it.item)];
      if (!title) continue;
      const key = normalizeTitle(title);
      const prev = lastByKey.get(key);
      if (prev === undefined || it.item > prev) lastByKey.set(key, it.item);
    }
    for (const it of session.sessions) {
      const title = titles[String(it.item)];
      if (!title) continue;
      const last = lastByKey.get(normalizeTitle(title));
      if (last !== undefined && last !== it.item) survivorOf.set(it.item, last);
    }

    for (const it of session.sessions) {
      itemId++;
      idByKey.set(`${session.date}|${it.item}`, itemId);
      const title = titles[String(it.item)] ?? null;
      const row: LoadedItem = {
        itemId,
        ns,
        date: session.date,
        itemNo: it.item,
        slug: session.itemSlugs?.[String(it.item)] ?? null,
        title,
        topic:
          session.itemTopics?.[String(it.item)] ?? classifyTitle(title ?? ""),
        reading: title ? readingOf(title) : null,
        // Filled by the bill pass below, once every stem in the corpus is known.
        billId: null,
        // Resolved in the second pass, once every item on the day has an id.
        supersededBy: null,
        yes: it.tallies.yes,
        no: it.tallies.no,
        abstain: it.tallies.abstain,
        absent: it.tallies.absent ?? 0,
      };
      items.push(row);
      rowByItemNo.set(it.item, row);

      for (const v of it.votes ?? []) {
        const key = `${itemId}|${v.mpId}`;
        if (seen.has(key)) {
          // The 84. Identical rows, so keeping the first loses nothing — but it is
          // counted, because "0.004% of the corpus" is a conclusion, not an excuse.
          duplicateCasts++;
          continue;
        }
        seen.add(key);
        const party = session.mpParty?.[String(v.mpId)] ?? null;
        if (party) parties.add(`${ns}|${party}`);
        casts.push({
          itemId,
          mpId: v.mpId,
          ns,
          vote: VOTE_CHAR[v.vote] ?? "x",
          party,
        });

        const name = session.mpNames?.[String(v.mpId)] ?? `MP ${v.mpId}`;
        // Last write wins: `raw` is date-sorted, so a seat's stored party is its last-seen
        // one. Display only — 8% of seats change party mid-term (see 134's comment).
        seats.set(`${ns}|${v.mpId}`, { ns, mpId: v.mpId, name, party });
        const norm = name
          .replace(/[.\s-]+/g, " ")
          .trim()
          .toUpperCase();
        if (!namesById.has(v.mpId)) namesById.set(v.mpId, new Set());
        namesById.get(v.mpId)!.add(norm);
      }
    }

    for (const [dropped, survivor] of survivorOf) {
      const row = rowByItemNo.get(dropped);
      const survivorId = idByKey.get(`${session.date}|${survivor}`);
      // THROW rather than skip. A missed resolution silently promotes a re-voted item
      // into the standing set, where every aggregate counts one decision twice — the
      // exact 9.8% error this column exists to prevent, arriving as a plausible number.
      if (!row || survivorId === undefined) {
        throw new Error(
          `rollcall: ${session.date} item ${dropped} should be superseded by ${survivor}, ` +
            `but the survivor could not be resolved`,
        );
      }
      row.supersededBy = survivorId;
      superseded++;
    }
  }

  // ---------------------------------------------------------------------------
  // THE BILL PASS (migration 136). Runs after every item has an id, because it keys on the
  // whole corpus rather than on one day: a bill's first reading and its article votes are
  // usually weeks apart.
  //
  // A BILL IS A STEM THAT REACHED A SECOND READING — not every bill the chamber saw. That
  // is the same set the /parliament tile counts, and the point of matching it exactly is
  // that `SELECT count(*) FROM bill WHERE ns = 52` and the number on the page cannot drift.
  // A first reading that never came back gets no row.
  const secondByStem = new Map<string, LoadedItem[]>();
  const firstByStem = new Map<string, LoadedItem[]>();
  for (const row of items) {
    if (!row.title) continue;
    const second = secondReadingStem(row.title);
    if (second) {
      const key = `${row.ns}|${second}`;
      (secondByStem.get(key) ?? secondByStem.set(key, []).get(key)!).push(row);
      continue;
    }
    const first = firstReadingStem(row.title);
    if (first) {
      const key = `${row.ns}|${first}`;
      (firstByStem.get(key) ?? firstByStem.set(key, []).get(key)!).push(row);
    }
  }
  // Ids continue above whatever the database already holds, and existing (ns, stem) pairs
  // keep theirs.
  let nextBillId = Math.max(0, ...existingBillIds.values()) + 1;
  const bills: LoadedBill[] = [];
  for (const key of [...secondByStem.keys()].sort()) {
    const billId = existingBillIds.get(key) ?? nextBillId++;
    const [ns, stem] = [
      Number(key.slice(0, key.indexOf("|"))),
      key.slice(key.indexOf("|") + 1),
    ];
    for (const row of secondByStem.get(key)!) row.billId = billId;
    // The bill's own first reading, when the corpus carries one under the same stem — 401
    // of 504 do. The earliest STANDING one: „първо гласуване" can appear twice when a motion
    // to take both readings in one sitting is put and then the reading itself is held, and
    // a re-voted first reading leaves an ANNULLED row behind that sorts first.
    //
    // Filtering superseded_by is what makes this right, and it was measurably wrong without
    // it: 66 of the 504 bills stored the annulled reading rather than the one that stands —
    // deterministically, since dedupeRevotes keeps the HIGHEST item number and this sorts
    // ascending. A /votes link to a vote the chamber took back, on every one of them.
    const firstItems = (firstByStem.get(key) ?? [])
      .filter((row) => row.supersededBy === null)
      .sort((a, b) =>
        a.date === b.date ? a.itemNo - b.itemNo : a.date.localeCompare(b.date),
      );
    for (const row of firstItems) row.billId = billId;
    bills.push({
      billId,
      ns,
      stem,
      firstReadingItem: firstItems[0]?.itemId ?? null,
    });
  }

  const recycledIds = [...namesById.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([mpId, names]) => ({ mpId, names: [...names] }))
    .sort((a, b) => a.mpId - b.mpId);

  // The whole point of the column, asserted rather than assumed: the rows that carry
  // superseded_by must be exactly the ones dedupeRevotes drops.
  if (superseded !== rawItems - dedupedItems) {
    throw new Error(
      `rollcall: marked ${superseded} items superseded but dedupeRevotes drops ` +
        `${rawItems - dedupedItems} — the survivor rule has drifted from dedupe.ts`,
    );
  }

  return {
    items,
    casts,
    seats,
    parties,
    duplicateCasts,
    recycledIds,
    rawItems,
    dedupedItems,
    superseded,
    bills,
  };
};

const run = async (): Promise<void> => {
  const raw = readSessions();
  if (raw.length === 0) {
    console.warn(
      "rollcall: data/parliament/votes/sessions/ is empty — nothing to load. " +
        "Run the update-rollcall skill first.",
    );
    await end();
    return;
  }

  // Bill ids are read from the database first — see buildRollcall's parameter. On a cold
  // database this is empty and the loader numbers from 1.
  const existingBillIds = new Map<string, number>();
  await exec(readFileSync(INGEST_TRACKING, "utf8"));
  await exec(readFileSync(SCHEMA, "utf8"));
  // 136 after 134: it adds the FK from vote_item.bill_id, which 134 declares without one
  // because `bill` does not exist at that point.
  await exec(readFileSync(BILL_SCHEMA, "utf8"));
  await withClient(async (c) => {
    for (const r of (
      await c.query<{ bill_id: number; ns: number; stem: string }>(
        "SELECT bill_id, ns, stem FROM bill",
      )
    ).rows) {
      existingBillIds.set(`${r.ns}|${r.stem}`, r.bill_id);
    }
  });

  const build = buildRollcall(raw, existingBillIds);

  console.log(
    `rollcall: ${raw.length} plenary days · ${build.rawItems} raw items → ` +
      `${build.dedupedItems} stand after dedupeRevotes (${build.superseded} marked superseded) · ` +
      `${build.casts.length} casts · ${build.seats.size} seats · ${build.parties.size} party rows · ` +
      `${build.bills.length} bills (${build.bills.filter((b) => b.firstReadingItem !== null).length} with a first reading)`,
  );
  if (build.duplicateCasts > 0) {
    console.warn(
      `rollcall: ${build.duplicateCasts} duplicate (item, MP) cast(s) in the source, collapsed on load. ` +
        `The JSON votes array is keyed by position rather than by MP, so nothing upstream ` +
        `dedupes them and every attendance denominator counts those members twice.`,
    );
  }
  if (build.recycledIds.length > 0) {
    console.warn(
      `rollcall: ${build.recycledIds.length} mp_id(s) name more than one person across parliaments — ` +
        `(ns, mp_id) keeps them apart here, but person_role.ref = mp_id has no NS column, ` +
        `so the person→votes bridge stays ambiguous for them. e.g. ` +
        build.recycledIds
          .slice(0, 3)
          .map((r) => `${r.mpId}: ${r.names.join(" || ")}`)
          .join("; "),
    );
  }

  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      // party_dim and mp_seat are small and referenced by FKs, so they go first and are
      // upserted rather than merged.
      // Read first, insert only what is genuinely missing. `ON CONFLICT DO NOTHING`
      // reads naturally but BURNS an identity value on every no-op attempt, and party_id
      // is a smallint: 71 attempts per run against a 32,767 ceiling exhausts the sequence
      // in ~461 loads. On a loader that runs with every ingest that is about fifteen
      // months to a hard failure with no prior symptom.
      const partyIds = new Map<string, number>();
      const loadParties = async (): Promise<void> => {
        partyIds.clear();
        for (const r of (
          await c.query<{ party_id: number; ns: number; short: string }>(
            "SELECT party_id, ns, short FROM party_dim",
          )
        ).rows) {
          partyIds.set(`${r.ns}|${r.short}`, r.party_id);
        }
      };
      await loadParties();
      const missing = [...build.parties].filter((k) => !partyIds.has(k));
      for (const key of missing) {
        const [ns, short] = key.split("|");
        await c.query(
          "INSERT INTO party_dim (ns, short) VALUES ($1, $2) ON CONFLICT (ns, short) DO NOTHING",
          [Number(ns), short],
        );
      }
      if (missing.length) await loadParties();

      for (const seat of build.seats.values()) {
        await c.query(
          `INSERT INTO mp_seat (ns, mp_id, name, party_id) VALUES ($1, $2, $3, $4)
             ON CONFLICT (ns, mp_id) DO UPDATE SET name = EXCLUDED.name, party_id = EXCLUDED.party_id`,
          [
            seat.ns,
            seat.mpId,
            seat.name,
            seat.party
              ? (partyIds.get(`${seat.ns}|${seat.party}`) ?? null)
              : null,
          ],
        );
      }

      // BILLS BEFORE ITEMS, first_reading_item AFTER. bill.first_reading_item references
      // vote_item and vote_item.bill_id references bill, so the cycle is filled from both
      // ends: the row goes in with a NULL first reading, the items merge against it, then
      // the reference is set.
      for (const b of build.bills) {
        await c.query(
          `INSERT INTO bill (bill_id, ns, stem) VALUES ($1, $2, $3)
             ON CONFLICT (bill_id) DO UPDATE
               SET ns = EXCLUDED.ns, stem = EXCLUDED.stem,
                   -- CLEARED, not left in place. mergeFromStage ends with an anti-join
                   -- DELETE of vote_item rows the fresh build no longer produces, and
                   -- item_id is a positional counter — so any corpus SHRINK deletes the
                   -- tail while a stale first_reading_item still points into it, raising
                   -- 23503 and rolling back the entire load. It is re-set from the fresh
                   -- build a few lines below, so this window is the merge and nothing else.
                   first_reading_item = NULL`,
          [b.billId, b.ns, b.stem],
        );
      }

      const itemSpec = {
        table: "vote_item",
        source: "vote_item_stage",
        keys: ["item_id"],
        cols: [
          "item_id",
          "ns",
          "date",
          "item_no",
          "slug",
          "title",
          "topic",
          "reading",
          "bill_id",
          "superseded_by",
          "yes",
          "no",
          "abstain",
          "absent",
        ],
      };
      await createStageTable(c, itemSpec);
      await copyRows(
        c,
        itemSpec.source,
        itemSpec.cols,
        build.items.map((i) => [
          i.itemId,
          i.ns,
          i.date,
          i.itemNo,
          i.slug,
          i.title,
          i.topic,
          i.reading,
          i.billId,
          i.supersededBy,
          i.yes,
          i.no,
          i.abstain,
          i.absent,
        ]),
      );
      await addStagePrimaryKey(c, itemSpec);
      await mergeFromStage(c, itemSpec);

      for (const b of build.bills) {
        await c.query(
          "UPDATE bill SET first_reading_item = $2 WHERE bill_id = $1",
          [b.billId, b.firstReadingItem],
        );
      }

      const castSpec = {
        table: "vote_cast",
        source: "vote_cast_stage",
        keys: ["item_id", "mp_id"],
        cols: ["item_id", "mp_id", "ns", "vote", "party_id"],
      };
      await createStageTable(c, castSpec);
      await copyRows(
        c,
        castSpec.source,
        castSpec.cols,
        build.casts.map((v) => [
          v.itemId,
          v.mpId,
          v.ns,
          v.vote,
          v.party ? (partyIds.get(`${v.ns}|${v.party}`) ?? null) : null,
        ]),
      );
      await addStagePrimaryKey(c, castSpec);
      await mergeFromStage(c, castSpec);

      // The changelog keys on (ns, date, item_no) rather than item_id: item_id is assigned
      // by iteration order, so inserting a newly-ingested day in the middle of the corpus
      // would renumber everything after it and the feed would report the whole archive as
      // new. The natural key survives that.
      // Stage twins must not outlive the transaction that used them. stage_merge.ts's own
      // contract says so and five of its six other callers drop explicitly: left behind,
      // vote_cast_stage is a 256 MB table that pg_dump carries and db:sync:cloud pushes.
      await c.query("DROP TABLE IF EXISTS vote_item_stage, vote_cast_stage");

      await recordIngestBatch(c, {
        source: "rollcall_vote",
        table: "vote_item",
        keyExpr: "t.ns || '/' || t.date || '/' || t.item_no",
        nameExpr: "t.title",
        detailExpr:
          "t.yes || ' за, ' || t.no || ' против, ' || t.abstain || ' въздържали се'",
        rowsTotal: build.items.length,
      });

      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });

  // vacuumAfterReload, NOT the bare ANALYZE this used to be. The two look interchangeable
  // and are not: ANALYZE stamps `last_analyze` and never touches the VISIBILITY MAP, so the
  // table reads as freshly maintained while Postgres can no longer plan an index-only scan
  // on it. That is the disguise CLAUDE.md's visibility-map section is about, and ANALYZE
  // *running* is what makes it a disguise rather than an obvious gap.
  //
  // ⚠️ NOT for the reason the canonical case gives. This loader is STAGE-MERGE, not
  // TRUNCATE+COPY (see the capitalised header at the top of this file) — no new relfilenode,
  // no empty map minted. The merge still leaves dead tuples behind that neither autovacuum
  // threshold reaches: the dead-tuple one is a 20% fraction a few thousand changed rows out
  // of 4M never cross, and the insert-threshold one fires mid-chain under a held-back xmin
  // horizon, marks nothing, resets the counter and never returns. Same end state, different
  // mechanism — the interreg tables document the identical trap, which is why "stage-merged
  // tables are safe" is the one inference to refuse here.
  //
  // What actually depends on the map: `vote_cast`'s two covering indexes,
  // idx_vote_cast_ns_mp and idx_vote_cast_mp_item, both `INCLUDE (vote, …)` precisely so a
  // per-MP read never touches the heap — verified Index Only Scan. The day route over
  // vote_item is NOT an example: it selects 12 columns off idx_vote_item_date and is a
  // Bitmap Heap Scan at 21 buffers no matter what the map says.
  //
  // The four names are ALSO in reload_visibility_map.data.test.ts's RELOADED list, and the
  // literals below are what that gate's scan reads — it matches string literals inside a
  // `vacuumAfterReload(...)` argument list, so a loader calling only ANALYZE contributes no
  // names and is invisible to it. That is exactly how these four went unnoticed. Keep the
  // two lists in step, and do not replace these literals with a variable.
  await vacuumAfterReload("vote_item", "vote_cast", "mp_seat", "party_dim");

  console.log(
    `rollcall: loaded ${build.items.length} items and ${build.casts.length} casts`,
  );
  await end();
};

// Only when this module is the entry point. `buildRollcall` is imported by
// bill_and_topics.data.test.ts to exercise id stability, and an unguarded call ran the whole
// 4M-row load — against the developer's database — as a side effect of the import.
if (process.argv[1] && process.argv[1].includes("load_rollcall_pg")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
