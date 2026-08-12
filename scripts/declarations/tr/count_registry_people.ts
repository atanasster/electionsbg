// Count how many DISTINCT people the Commerce Registry records under each name fold, and
// persist ONLY the count. Plan: docs/plans/tr-attribution-basis-v1.md §2.3.
//
//   npm run tr:count-people            → data/person/tr_name_fold_people.tsv
//   npm run tr:count-people -- --check  read-only; prints the summary, writes nothing
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS READS, AND WHAT IT REFUSES TO KEEP.
//
// Every `Subject` in the TR daily feed carries an `Indent` element holding a hash+salt of the
// person's EGN. This repo treats that hash exactly as the EGN — never extracted, never stored,
// never displayed — and says so in three places (parse_daily_filing.ts, types.ts,
// sqlite_writer.ts). Nothing here changes that policy.
//
// What it does instead: replace each hash with a truncated SHA-256 digest AT READ TIME, count
// DISTINCT digests per name fold in memory, and write out the INTEGER. No hash, no cluster id,
// nothing reversible reaches disk. The digest is a local dedup key with a per-run salt, so it
// is not even stable between runs.
//
// A count is all the guard needs. An identifier would additionally let us SPLIT a footprint,
// and nothing in this corpus can say WHICH half is the public figure — the registry→person
// bridge stays a name match either way. So the extra capability buys no extra truth and costs
// the whole privacy posture.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A SEPARATE SCRIPT rather than a hook in parse_daily_filing.ts: that parser carries three
// test-asserted guards that `Indent` must never reach its output, and this must not weaken
// them. It is also not a pipeline step — it reads a 15 GB gitignored cache, so it runs on a
// machine that has one and commits the ~14 MB result for everyone else.
//
// Cost is not a reason to hesitate: the whole feed scans in about 6 seconds.

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../../db/lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const FEED_DIR = path.join(ROOT, "raw_data/tr/daily");
const OUT = path.join(ROOT, "data/person/tr_name_fold_people.tsv");

// Per-RUN salt. The digests never leave this process, and salting them means an intermediate
// heap dump is not a lookup table for the source hashes either.
const SALT = randomBytes(16);
const digest = (hash: string): string =>
  createHash("sha256").update(SALT).update(hash).digest("hex").slice(0, 16);

// `"Indent":…,"Name":…,"IndentType":…` — the xml2js shape the feed is parsed into.
//
// ⚠️ THE `IndentType` CLAUSE IS NOT OPTIONAL. A party in this feed is a person OR a legal
// entity, and both carry a hashed `Indent`: measured over the corpus, 1,484,303 are EGN,
// 21,355 ЛНЧ (a foreign national's number — a person) and 154,995 UIC (a company). Matching
// on the Indent alone counted all three, so the artifact's first cut listed rows like
// `"doverie obedinen holding" ad publichno druzhestvo eik 121575489` as a PERSON — 155k
// company records in a table whose whole claim is "distinct registry PEOPLE per name fold".
//
// Anchored on the whole triple, so a Name with no Indent (a free-text field, an unidentified
// party) contributes nothing rather than counting as an unidentified person.
// Exported (and built fresh per call, since /g regexes carry `lastIndex`) so the rule can be
// asserted on BEHAVIOUR rather than on the source text. The IndentType clause is the line that
// already cost 154,995 false people; a test that only greps for the word would not have caught
// it, and this module runs main() on import, so there is nothing else to drive.
export const pairPattern = (): RegExp =>
  /"Indent":\[\{"_":"([0-9a-f]{64})"\}\],"Name":\[\{"_":"([^"]{3,120})"\}\],"IndentType":\[\{"_":"(EGN|LNCH)"\}\]/g;

/** Every identified PERSON in a chunk of feed JSON, as (name, opaque per-run key).
 *
 *  The raw `Indent` never leaves this function: it is digested inside the map, so no caller —
 *  including a test — can hold one. An earlier cut returned `{name, hash}` and let the caller
 *  digest, which is the same behaviour and a strictly worse shape: it puts the EGN-derived
 *  value in a returned object, one careless `console.log` away from a log file. */
export const parties = (text: string): { name: string; key: string }[] =>
  [...text.matchAll(pairPattern())].map((m) => ({
    name: m[2],
    key: digest(m[1]),
  }));

/** The floor a rewrite must clear, as a fraction of the committed artifact's line count.
 *
 *  ⚠️ AN UNDER-COUNT FAILS OPEN, which is why this is a refusal and not a warning. Bridge B
 *  mints on `people_n = 1`, so a fold that really holds two people but counts one passes the
 *  guard and puts a namesake's companies on a public figure's page — precisely the defect this
 *  whole plan exists to remove, reintroduced by a partial feed, an interrupted crawl or a
 *  regex that stopped matching. A truncated run must abort with the previous artifact intact.
 *  Same shape as kzk_decisions' shrink refusal and the interreg completeness guard. */
const SHRINK_FLOOR = 0.95;

// ⚠️ MANY FOLDS HERE ARE NOT NAME-SHAPED, and that is the source, not a parse bug. The feed's
// `Name` for a person is frequently a whole sentence — "ЖЕЛЬО ВАСИЛЕВ ВАРДУНСКИ, в качеството
// му на представител на Община Камено ЕИК 000057001 - Председател и член на УС" — carrying an
// EGN-typed Indent, i.e. a real person described by their role. They are kept rather than
// filtered: they cost rows and nothing else, because every consumer looks a fold UP by
// `person.name_fold`, which is always a clean 2- or 3-part fold. A row nobody can reach is
// inert; a filter that guessed wrong would silently remove a fold the guard needed.

/** Why a rewrite must be refused, or null to proceed. A pure function so the rule is testable
 *  without a 15 GB feed — the same reason load_persons_browse_pg exports `preflightError`.
 *
 *  Both refusals exist because an UNDER-count fails OPEN: Bridge B mints on `people_n = 1`, so
 *  a fold holding two real people that counts one passes the guard and puts a namesake's
 *  companies on a public figure's page. A partial feed, an interrupted crawl or a regex that
 *  stopped matching must abort with the previous artifact intact, never overwrite it with a
 *  smaller one. */
export const writeRefusal = (
  next: number,
  prev: number,
  allowShrink = false,
): string | null => {
  if (!next)
    return "REFUSING to write an empty artifact — nothing matched the feed.";
  if (!allowShrink && prev && next < prev * SHRINK_FLOOR)
    return (
      `REFUSING to write: ${next.toLocaleString()} folds against ` +
      `${prev.toLocaleString()} in the committed artifact — a shrink past ` +
      `${Math.round((1 - SHRINK_FLOOR) * 100)}%. An under-count fails OPEN (a fold with two ` +
      `real people counting 1 passes Bridge B's guard), so a partial feed must abort with ` +
      `the previous artifact intact. Re-run a full tr:daily-refresh, or pass --allow-shrink ` +
      `if the corpus genuinely shrank.`
    );
  return null;
};

const collapseWs = (s: string): string => s.replace(/\s+/g, " ").trim();

const main = async (): Promise<void> => {
  const check = process.argv.includes("--check");
  const allowShrink = process.argv.includes("--allow-shrink");
  if (!fs.existsSync(FEED_DIR)) {
    console.error(
      `no TR feed at ${FEED_DIR} — this script reads the gitignored daily cache. ` +
        `The committed artifact it produces (${path.relative(ROOT, OUT)}) is what every ` +
        `other machine uses; nothing else needs the feed.`,
    );
    process.exitCode = 1;
    return;
  }

  // ── Pass 1: (raw name → distinct digests) ────────────────────────────────
  const files = fs
    .readdirSync(FEED_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const byName = new Map<string, Set<string>>();
  let pairs = 0;
  for (const f of files) {
    // Read whole-file: the largest daily file is ~45 MB and they are single-line JSON, so a
    // line reader would buffer the same bytes with more machinery.
    const text = fs.readFileSync(path.join(FEED_DIR, f), "utf8");
    for (const m of parties(text)) {
      pairs++;
      const key = collapseWs(m.name).toUpperCase();
      let s = byName.get(key);
      if (!s) byName.set(key, (s = new Set()));
      // UNCAPPED, deliberately. An earlier cut capped each set at 24 to bound memory and
      // described that as affecting "only the printed histogram" — it does not: s.size IS the
      // integer written out, carried into person.fold_people_n and rendered as "the registry
      // shows N people with this name". 119 folds sat at exactly 24, i.e. silently "≥24".
      // Uncapped is also memory-safe by construction: the sum of all set sizes cannot exceed
      // the number of matched parties (~1.49M), so the whole structure is tens of MB.
      s.add(m.key);
    }
  }
  console.log(
    `scanned ${files.length} files · ${pairs.toLocaleString()} identified parties · ` +
      `${byName.size.toLocaleString()} distinct names`,
  );

  // ── Pass 2: fold the names ───────────────────────────────────────────────
  // Through Postgres, because `translit_bg_latin` is SQL-only and inventing a TypeScript twin
  // would make this the FOURTH normalizer in a repo whose person layer exists to have one.
  // The fold is the key both mints use, and folding matters: two spellings of one person must
  // count as one person, which grouping by raw name cannot do.
  const names = [...byName.keys()];
  const foldOf = new Map<string, string>();
  const BATCH = 20_000;
  for (let i = 0; i < names.length; i += BATCH) {
    const slice = names.slice(i, i + BATCH);
    for (const r of await allRows<{ s: string; f: string }>(
      `SELECT s, translit_bg_latin(s) AS f FROM unnest($1::text[]) AS s`,
      [slice],
    ))
      foldOf.set(r.s, r.f);
  }

  const byFold = new Map<string, Set<string>>();
  for (const [name, digests] of byName) {
    const fold = foldOf.get(name);
    if (!fold) continue;
    let s = byFold.get(fold);
    if (!s) byFold.set(fold, (s = new Set()));
    for (const d of digests) s.add(d);
  }

  const shared = [...byFold.values()].filter((s) => s.size > 1).length;
  console.log(
    `${byFold.size.toLocaleString()} folds · ${shared.toLocaleString()} shared by 2+ people ` +
      `(${((shared / byFold.size) * 100).toFixed(1)}%)`,
  );

  if (check) {
    console.log("--check: nothing written");
    return;
  }

  // ── Write ────────────────────────────────────────────────────────────────
  // The FULL table, not just the shared folds. A shared-only artifact cannot distinguish
  // "one person" from "never observed", so every guard built on it fails OPEN in silence —
  // see 148's three-state note. Sorted so the committed file has a stable diff.
  const prev = fs.existsSync(OUT)
    ? fs.readFileSync(OUT, "utf8").trimEnd().split("\n").length
    : 0;
  const refusal = writeRefusal(byFold.size, prev, allowShrink);
  if (refusal) {
    console.error(refusal);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const lines = [...byFold.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fold, s]) => `${fold}\t${s.size}`);
  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log(`wrote ${path.relative(ROOT, OUT)} (${lines.length} folds)`);
};

// Only when RUN, not when imported. Without this guard, a test importing `parties` to assert
// the IndentType rule would kick off a 15 GB scan and open a Postgres pool as a side effect of
// the import — which is why that rule was previously only assertable by grepping this file's
// own source text.
const invokedDirectly =
  process.argv[1] != null &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly)
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => end());
