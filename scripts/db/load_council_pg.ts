// Load the municipal-council corpus into council_muni / council_muni_code /
// council_resolution / council_vote (migration 160).
//
//   npm run db:load:council:pg
//   npm run db:load:council:pg:cloud
//
// THE INPUT IS THE DURABLE SHARD TREE — data/council/<code>/<YYYY>/<id>.json —
// and deliberately NOT index.json or votes/*.json. Both of those are lossy
// derivatives: index.json is capped at 200 rows per município (six of sixteen
// exceed it) and stripped of tally.perCouncillor, and the votes shard was
// rebuilt from that stripped index until 2026-08-16, which left 530
// resolutions and 10,754 named-vote rows on disk and unserved. The durable
// tree is committed to git (4,676 files), so this works on a fresh clone with
// no network and belongs in db:refresh proper — NOT in REFRESH_EXCLUSIONS.
//
// UPSERT-ONLY, never an anti-join delete. A council resolution is a permanent
// public record; a scrape that misses a protocol, or a parser regression on one
// município, must not erase history. Absence is recorded via last_seen_at.
// This is the one place the repo's standard stage-merge shape is wrong.
//
// ORDER. Run AFTER db:resolve:persons (the person_id bridge),
// db:load:place-dim:pg (ekatte) and db:load:official-candidate-links:pg (the
// slate label). ⚠️ db:resolve:persons does DELETE FROM person and re-COPYs with
// person_id as a positional ordinal, so council_vote.person_id is nulled
// table-wide on every re-resolve (ON DELETE SET NULL) and THIS loader is what
// re-attaches it — the declarations `--resolve` trap, one table over.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withTx, end, allRows, vacuumAfterReload } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  addStagePrimaryKey,
  createStageTable,
  stageUpsertSql,
  type StageMergeSpec,
} from "./lib/stage_merge";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  councilKeyForObshtina,
  rosterShardForObshtina,
} from "../../src/data/council/councilObshtinaMap";
import {
  councilNameKey,
  isPollutedKey,
  normaliseCouncillorName,
  COUNCIL_VOTING_ROLES,
  VOTE_LABEL_SOURCE,
} from "../council/lib/tally";
import type { CouncilResolution } from "../council/lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const COUNCIL_DIR = join(ROOT, "data/council");
const MUNIS_PATH = join(ROOT, "data/municipalities.json");
const SCHEMA = join(__dirname, "schema/pg/160_council_corpus.sql");
// "Applied, never loaded" — 161 carries no data, so nothing else would ship it
// and `deploy:db` (which deploys functions/ code) is a different thing from a
// Postgres function. Applying it here means a corpus reload always carries it.
const SERVING = join(__dirname, "schema/pg/161_council_serving.sql");

const VOTE_VALUES = new Set(["for", "against", "abstain"]);

type MuniRow = {
  obshtina_code: string;
  roster_code: string | null;
  name: string;
  last_ingest: string | null;
  resolution_count: number;
  named_vote_count: number;
  has_named_votes: boolean;
};

type IndexMeta = Record<
  string,
  { name?: string; lastIngest?: string } | undefined
>;

const readIndexMeta = (): IndexMeta => {
  const p = join(COUNCIL_DIR, "index.json");
  if (!existsSync(p)) return {};
  try {
    return (JSON.parse(readFileSync(p, "utf8")).meta ?? {}) as IndexMeta;
  } catch (err) {
    // Silently returning {} makes every município fall back to its code as its
    // NAME — `Столична община` renders as `SOF` — with nothing logged.
    console.warn(
      `[council] index.json unreadable, municipality names will fall back to codes: ${String(err)}`,
    );
    return {};
  }
};

/** Every durable resolution for one município, shape-checked. */
const readDurable = (code: string): CouncilResolution[] => {
  const dir = join(COUNCIL_DIR, code);
  const out: CouncilResolution[] = [];
  let years: string[];
  try {
    years = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const y of years) {
    let files: string[];
    try {
      files = readdirSync(join(dir, y));
    } catch (err) {
      // One unreadable year must not take the whole loader down mid-scan.
      console.warn(
        `[council] skipping unreadable year ${code}/${y}: ${String(err)}`,
      );
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(join(dir, y, f), "utf8"));
      } catch {
        console.warn(`[council] skipping unreadable shard ${code}/${y}/${f}`);
        continue;
      }
      const r = parsed as CouncilResolution;
      if (
        !r ||
        typeof r !== "object" ||
        typeof r.id !== "string" ||
        typeof r.date !== "string"
      ) {
        console.warn(`[council] skipping malformed shard ${code}/${y}/${f}`);
        continue;
      }
      // `date` lands in a `date NOT NULL` column and `vote` in a CHECK the
      // stage table does NOT inherit (LIKE ... INCLUDING GENERATED INCLUDING
      // DEFAULTS copies neither), so both would fail late — at the upsert,
      // after the whole COPY, naming no shard. Validate them here, beside the
      // two enumerations that are already coerced.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        console.warn(
          `[council] skipping shard with unparseable date ${code}/${y}/${f}: ${r.date}`,
        );
        continue;
      }
      const badVote = (r.tally?.perCouncillor ?? []).find(
        (v) => !VOTE_VALUES.has(v.vote),
      );
      if (badVote) {
        console.warn(
          `[council] skipping shard with out-of-domain vote ${code}/${y}/${f}: ${badVote.vote}`,
        );
        continue;
      }
      out.push(r);
    }
  }
  return out;
};

/** Municipality directories that actually hold a durable tree. */
const councilCodes = (): string[] =>
  readdirSync(COUNCIL_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "votes")
    .map((e) => e.name)
    .sort();

/**
 * Every frontend obshtina code, resolved through the ONE definition of the
 * mapping. `councilObshtinaMap.ts` stays authoritative; this materialises it so
 * SQL can join on it, rather than adding a fifth copy.
 */
const buildCodeBridge = (
  councils: Set<string>,
): { frontend_code: string; obshtina_code: string }[] => {
  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as {
    obshtina: string;
  }[];
  const frontendCodes = new Set<string>(munis.map((m) => m.obshtina));
  // Not settlement-derived: the council pipeline's own aliases for the Sofia
  // city-wide bundle, which no settlement row carries.
  for (const extra of ["SFO_CITY", "SOF00", "SOF"]) frontendCodes.add(extra);

  const rows: { frontend_code: string; obshtina_code: string }[] = [];
  for (const fc of [...frontendCodes].sort()) {
    const key = councilKeyForObshtina(fc);
    if (!key || !councils.has(key)) continue;
    rows.push({ frontend_code: fc, obshtina_code: key });
  }
  return rows;
};

/**
 * The roster shard a council's members live in.
 *
 * Derived from the council's non-S2 frontend codes and then CHECKED against the
 * roster codes that actually exist, rather than trusted. Two reasons, both
 * measured:
 *
 *   - `official_roster` holds a DIFFERENT município under `BGS01` (28
 *     councillors, disjoint names) while Burgas city — this corpus's `BGS01`
 *     council — is roster `BGS04`. Joining a council key straight to the roster
 *     credits votes to the wrong council.
 *   - `rosterShardForObshtina` folds the S2 districts, SFO_CITY and SOF00 to
 *     `SFO_CITY` but
 *     passes `SOF` (the council pipeline's own alias) through unchanged, so the
 *     Sofia candidate set is {SFO_CITY, SOF} and only the first is a roster.
 *
 * Returns null when no candidate exists in the roster — the município then
 * loads with votes and no person attribution, which is the right failure.
 */
const rosterCodeFor = (
  council: string,
  bridge: { frontend_code: string; obshtina_code: string }[],
  known: Set<string>,
): string | null => {
  const candidates = new Set(
    bridge
      .filter(
        (b) => b.obshtina_code === council && !b.frontend_code.startsWith("S2"),
      )
      .map((b) => rosterShardForObshtina(b.frontend_code))
      .filter((v): v is string => !!v)
      .filter((v) => known.has(v)),
  );
  if (candidates.size === 0) return null;
  if (candidates.size > 1) {
    throw new Error(
      `[council] ${council} resolves to ${candidates.size} roster shards ` +
        `(${[...candidates].sort().join(", ")}) — refusing to guess which ` +
        `council's members these votes belong to.`,
    );
  }
  return [...candidates][0];
};

const MUNI_SPEC: StageMergeSpec = {
  table: "council_muni",
  source: "council_muni_stage",
  keys: ["obshtina_code"],
  cols: [
    "obshtina_code",
    "roster_code",
    "name",
    "last_ingest",
    "resolution_count",
    "named_vote_count",
    "has_named_votes",
  ],
};

const CODE_SPEC: StageMergeSpec = {
  table: "council_muni_code",
  source: "council_muni_code_stage",
  keys: ["frontend_code"],
  cols: ["frontend_code", "obshtina_code"],
};

const RES_SPEC: StageMergeSpec = {
  table: "council_resolution",
  source: "council_resolution_stage",
  keys: ["id"],
  cols: [
    "id",
    "obshtina_code",
    "decided_on",
    "session",
    "number",
    "title",
    "summary_bg",
    "summary_en",
    "result",
    "tally_for",
    "tally_against",
    "tally_abstain",
    "tally_method",
    "has_named_votes",
    "source_url",
    "last_seen_at",
  ],
};

const VOTE_SPEC: StageMergeSpec = {
  table: "council_vote",
  source: "council_vote_stage",
  keys: ["resolution_id", "norm_key"],
  cols: ["resolution_id", "norm_key", "councillor", "vote", "person_id"],
};

const RESULTS = new Set(["adopted", "rejected", "returned", "unknown"]);
const METHODS = new Set(["open", "named", "secret", "none"]);

const main = async (): Promise<void> => {
  // DDL FIRST, before any "is there data?" check. With the guard in front, a
  // machine without the corpus printed "nothing to load", applied no DDL and
  // exited 0 — a deploy that looks successful and creates nothing. That is the
  // tender-dossier lesson (CLAUDE.md): the schema and the serving functions must
  // exist wherever this loader has run, EMPTY if there was nothing to fill them.
  await exec(readFileSync(SCHEMA, "utf8"));
  await exec(readFileSync(SERVING, "utf8"));

  if (!existsSync(COUNCIL_DIR)) {
    console.warn(
      "[council] data/council/ absent — schema applied, nothing to load.",
    );
    return;
  }

  const meta = readIndexMeta();
  const codes = councilCodes();
  const bridge = buildCodeBridge(new Set(codes));

  const knownRosterCodes = new Set(
    (
      await allRows<{ obshtina: string }>(
        `SELECT DISTINCT obshtina FROM official_roster
          WHERE obshtina IS NOT NULL AND role = ANY($1::text[])`,
        [COUNCIL_VOTING_ROLES],
      )
    ).map((r) => r.obshtina),
  );

  const munis: MuniRow[] = [];
  // Keyed by column name, projected through RES_SPEC.cols at COPY time, so the
  // column list is the single source of order. A 16-element positional array
  // let any two of the five nullable text columns be swapped with no error
  // anywhere — just wrong data.
  const resolutions: Record<string, unknown>[] = [];
  const votesRaw: {
    resolution_id: string;
    norm_key: string;
    councillor: string;
    vote: string;
    council: string;
  }[] = [];

  // In the DO UPDATE arm on purpose, per 160's header: DEFAULT now() fires on
  // INSERT only, so leaving it out turns "last seen" into "first seen" and
  // inverts the absence-tracking that replaces an anti-join delete. The cost is
  // that stageUpsertSql's IS DISTINCT FROM never short-circuits and all 4,676
  // rows are rewritten each run — cheap at this size, and NOT a reason to drop
  // the column from the arm.
  const now = new Date().toISOString();
  let polluted = 0;
  let dupKeys = 0;
  let conflicting = 0;
  let coerced = 0;
  // `returned` (чл.45 ЗМСМА governor veto) is a legal outcome, not a parse
  // failure, so it is admitted rather than folded into `unknown` — which the
  // schema header already flags as 43% of the corpus. Anything genuinely
  // out-of-domain is still coerced, but COUNTED: a silent coercion on this
  // column is indistinguishable from "we could not parse it".
  const resultOf = (r: CouncilResolution): string => {
    if (!r.result) return "unknown";
    if (RESULTS.has(r.result)) return r.result;
    coerced++;
    return "unknown";
  };

  for (const code of codes) {
    const rows = readDurable(code);
    if (rows.length === 0) continue;
    const rosterCode = rosterCodeFor(code, bridge, knownRosterCodes);
    let namedVotes = 0;
    let namedResolutions = 0;

    for (const r of rows) {
      const pc = r.tally?.perCouncillor ?? [];
      // Fold to first+last so one councillor written two ways is one identity.
      // A collision inside a single resolution is the parser emitting the same
      // person twice; keep the first and count it.
      const seen = new Map<string, (typeof pc)[number]>();
      for (const v of pc) {
        // Fold FIRST, then test — the purge below runs against the stored key,
        // so testing the raw normKey instead let "За Иванов" and "за." be
        // counted, stored and then deleted inside the same transaction while
        // the run reported no refusals.
        const key = councilNameKey(v.normKey || v.name || "");
        if (!key) continue;
        if (isPollutedKey(key)) {
          polluted++;
          continue;
        }
        const prev = seen.get(key);
        if (prev) {
          // Same fold twice in one resolution. If the two agree it is the
          // parser emitting a person twice; if they DISAGREE it is either two
          // real councillors sharing a first+last or a parse error, and
          // picking one by file order would publish a coin-flip as a vote.
          if (prev.vote !== v.vote) {
            conflicting++;
            seen.delete(key);
          } else {
            dupKeys++;
          }
          continue;
        }
        seen.set(key, v);
      }
      const hasNamed = seen.size > 0;
      if (hasNamed) {
        namedResolutions++;
        namedVotes += seen.size;
      }

      resolutions.push({
        id: r.id,
        obshtina_code: code,
        decided_on: r.date,
        session: r.session ?? null,
        number: r.number ?? null,
        title: r.title ?? "",
        summary_bg: r.summary_bg ?? null,
        summary_en: r.summary_en ?? null,
        result: resultOf(r),
        tally_for: r.tally?.for ?? null,
        tally_against: r.tally?.against ?? null,
        tally_abstain: r.tally?.abstain ?? null,
        tally_method:
          r.tally?.method && METHODS.has(r.tally.method)
            ? r.tally.method
            : null,
        has_named_votes: hasNamed,
        source_url: r.sourceUrl ?? null,
        last_seen_at: now,
      });

      for (const [key, v] of seen) {
        votesRaw.push({
          resolution_id: r.id,
          norm_key: key,
          councillor: v.name,
          vote: v.vote,
          council: code,
        });
      }
    }

    munis.push({
      obshtina_code: code,
      roster_code: rosterCode,
      name: meta[code]?.name ?? code,
      last_ingest: meta[code]?.lastIngest ?? null,
      resolution_count: rows.length,
      named_vote_count: namedVotes,
      has_named_votes: namedResolutions > 0,
    });
  }

  if (munis.length === 0) {
    console.warn("[council] no durable shards found — nothing to load.");
    return;
  }

  console.log(
    `[council] ${munis.length} municipalities, ${resolutions.length} resolutions, ` +
      `${votesRaw.length} named votes` +
      (polluted ? ` (refused ${polluted} vote-label-polluted rows)` : "") +
      (dupKeys ? ` (folded ${dupKeys} duplicate keys)` : "") +
      (conflicting
        ? ` (refused ${conflicting} conflicting duplicate keys)`
        : "") +
      (coerced ? ` (coerced ${coerced} out-of-domain result values)` : ""),
  );

  await withTx(async (c) => {
    for (const spec of [MUNI_SPEC, CODE_SPEC, RES_SPEC, VOTE_SPEC]) {
      await createStageTable(c, spec);
    }

    await copyRows(
      c,
      MUNI_SPEC.source,
      MUNI_SPEC.cols,
      munis.map((m) => [
        m.obshtina_code,
        m.roster_code,
        m.name,
        m.last_ingest,
        m.resolution_count,
        m.named_vote_count,
        m.has_named_votes,
      ]),
    );
    await copyRows(
      c,
      CODE_SPEC.source,
      CODE_SPEC.cols,
      bridge.map((b) => [b.frontend_code, b.obshtina_code]),
    );
    await copyRows(
      c,
      RES_SPEC.source,
      RES_SPEC.cols,
      resolutions.map((r) => RES_SPEC.cols.map((k) => r[k])),
    );
    await copyRows(
      c,
      VOTE_SPEC.source,
      VOTE_SPEC.cols,
      votesRaw.map((v) => [
        v.resolution_id,
        v.norm_key,
        v.councillor,
        v.vote,
        null,
      ]),
    );

    // Resolve person_id in TypeScript, with the SAME fold the vote side used.
    //
    // This used to fold the roster in SQL (`split_part`/`reverse`/`lower`),
    // which is a SECOND implementation of the rule and diverged from it in two
    // ways that both matter: it kept `й` where the parser's NFD strip turns it
    // into `и`, and it kept hyphens where the parser collapses them — costing
    // 4,899 of 28,214 votes their attribution. Worse, the "refuse a name held
    // by two people" guard was evaluated on the SQL fold while the join used
    // the TS one, so the guard could pass a pair it should refuse and attach a
    // vote to the WRONG person (the `…василев` / `…василев1` shape the officials
    // layer mints for exactly this case). One fold, one equivalence class.
    const rosterRows = await allRows<{
      obshtina: string;
      name: string;
      slug: string;
    }>(
      `SELECT obshtina, name, slug FROM official_roster
        WHERE obshtina IS NOT NULL AND role = ANY($1::text[])`,
      [COUNCIL_VOTING_ROLES],
    );

    // `${roster_code}\t${fold}` -> slugs. A fold held by more than one slug in
    // the SAME município is REFUSED, never resolved: municipality scoping is
    // the safety margin, and a coin-flip between two real people is the one
    // outcome this corpus must not publish.
    const rosterFold = new Map<string, Set<string>>();
    const rosterName = new Map<string, string>();
    for (const r of rosterRows) {
      const k = `${r.obshtina}\t${councilNameKey(r.name)}`;
      if (!rosterFold.has(k)) rosterFold.set(k, new Set());
      rosterFold.get(k)!.add(r.slug);
      rosterName.set(`${k}\t${r.slug}`, r.name);
    }

    const slugPerson = new Map<string, number>();
    for (const row of await allRows<{ ref: string; person_id: number }>(
      `SELECT ref, min(person_id) AS person_id FROM person_role
        WHERE source = 'official_muni' AND ref IS NOT NULL
        GROUP BY ref HAVING count(DISTINCT person_id) = 1`,
    )) {
      slugPerson.set(row.ref, Number(row.person_id));
    }

    const rosterByCouncil = new Map(
      munis.map((m) => [m.obshtina_code, m.roster_code]),
    );
    const resolvedVotes: [string, string, number][] = [];
    let refusedAmbiguous = 0;
    for (const v of votesRaw) {
      const rc = rosterByCouncil.get(v.council) ?? null;
      if (!rc) continue;
      const slugs = rosterFold.get(`${rc}\t${v.norm_key}`);
      if (!slugs) continue;
      if (slugs.size > 1) {
        refusedAmbiguous++;
        continue;
      }
      const slug = [...slugs][0];
      const pid = slugPerson.get(slug);
      if (pid === undefined) continue;

      // Temporal corroboration. official_roster is the CURRENT bench and carries
      // no mandate window, while the corpus spans mandates (SZR12 has votes from
      // 2020, i.e. the 2019-2023 council). So when the protocol spells all three
      // name parts, they must agree with the roster's — otherwise a seat that
      // changed hands between two people sharing a first+last publishes the
      // older votes under the wrong person's profile.
      const full = rosterName.get(`${rc}\t${v.norm_key}\t${slug}`) ?? "";
      const protocolParts = v.councillor.trim().split(/\s+/).filter(Boolean);
      if (
        protocolParts.length >= 3 &&
        normaliseCouncillorName(v.councillor) !== normaliseCouncillorName(full)
      ) {
        refusedAmbiguous++;
        continue;
      }
      resolvedVotes.push([v.resolution_id, v.norm_key, pid]);
    }

    console.log(
      `[council] roster ${rosterRows.length} rows -> ${rosterFold.size} folds; ` +
        `resolved ${resolvedVotes.length} votes` +
        (refusedAmbiguous
          ? `, refused ${refusedAmbiguous} on an ambiguous or non-corroborating match`
          : ""),
    );
    if (resolvedVotes.length > 0) {
      await c.query(
        `UPDATE council_vote_stage s SET person_id = u.pid
           FROM (SELECT * FROM unnest($1::text[], $2::text[], $3::bigint[])
                   AS t(rid, nk, pid)) u
          WHERE u.rid = s.resolution_id AND u.nk = s.norm_key`,
        [
          resolvedVotes.map((r) => r[0]),
          resolvedVotes.map((r) => r[1]),
          resolvedVotes.map((r) => r[2]),
        ],
      );
    }

    // ATTRIBUTION FLOOR. person_id is staged NULL and the upsert's
    // IS DISTINCT FROM writes that NULL, so a run against an empty or partial
    // official_roster silently wipes every attribution and exits 0. Its only
    // writer, db:load:ngo-board-links, degrades to NULL obshtina by design on a
    // clone with no municipal shards — the interreg lesson one table over, and
    // unlike interreg there was no floor here.
    const [prior] = await allRows<{ n: string }>(
      `SELECT count(person_id)::text AS n FROM council_vote`,
    );
    const priorN = Number(prior?.n ?? 0);
    if (
      !process.argv.includes("--allow-attribution-drop") &&
      priorN > 0 &&
      resolvedVotes.length < priorN * 0.9
    ) {
      throw new Error(
        `[council] person attribution collapsed: ${resolvedVotes.length} staged against ` +
          `${priorN} already published. official_roster is empty or partial — its only ` +
          `writer is db:load:ngo-board-links, which degrades to NULL obshtina on a clone ` +
          `with no municipal shards. Re-run that loader first, or pass ` +
          `--allow-attribution-drop if the loss is real.`,
      );
    }

    for (const spec of [MUNI_SPEC, CODE_SPEC, RES_SPEC, VOTE_SPEC]) {
      await addStagePrimaryKey(c, spec);
    }

    // UPSERT-ONLY. `mergeFromStage` is deliberately NOT used: it couples the
    // upsert to an unscoped anti-join DELETE and then asserts live === staged,
    // which is the correct shape for a derived table and a data-loss bug for
    // this one. A council resolution is a permanent public record — a scrape
    // that misses a protocol must leave it standing, and `last_seen_at` is what
    // records the absence instead. Parent -> child so an FK always has its
    // referent.
    const liveBefore = new Map<string, number>();
    for (const spec of [MUNI_SPEC, CODE_SPEC, RES_SPEC, VOTE_SPEC]) {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${spec.table}`,
      );
      liveBefore.set(spec.table, Number(rows[0].n));
    }
    for (const spec of [MUNI_SPEC, CODE_SPEC, RES_SPEC, VOTE_SPEC]) {
      await c.query(stageUpsertSql(spec));
    }

    // Two things that CAN go wrong, replacing a guard that could not fire.
    // (`live >= staged` after an upsert-only merge is a theorem, not a check —
    // and it read as though the merge had been verified.)
    for (const spec of [MUNI_SPEC, CODE_SPEC, RES_SPEC, VOTE_SPEC]) {
      const on = spec.keys.map((k) => `t.${k} = s.${k}`).join(" AND ");
      const { rows } = await c.query<{ live: string; missed: string }>(
        `SELECT (SELECT count(*) FROM ${spec.table}) AS live,
                (SELECT count(*) FROM ${spec.source} s
                  WHERE NOT EXISTS (SELECT 1 FROM ${spec.table} t WHERE ${on})) AS missed`,
      );
      if (Number(rows[0].missed) > 0) {
        throw new Error(
          `[council] ${spec.table}: ${rows[0].missed} staged rows did not land — ` +
            `the ON CONFLICT target has degraded to a skip`,
        );
      }
      if (Number(rows[0].live) < (liveBefore.get(spec.table) ?? 0)) {
        throw new Error(
          `[council] ${spec.table} SHRANK in an upsert-only merge: ` +
            `${liveBefore.get(spec.table)} -> ${rows[0].live}`,
        );
      }
    }

    // A RE-PARSED resolution's vote list is authoritative; an unseen one is
    // not. Upsert-only is right at the RESOLUTION grain — a scrape that misses
    // a protocol must leave it standing — but at the VOTE grain it means a
    // parser fix can never reach the database: the corrected rows are inserted
    // beside the rows they were meant to replace. Measured 2026-08-17, after
    // the Перник name fixes: 13,206 stored against 13,131 on disk, 75 orphans
    // under folds the parser no longer emits ('ладислав владимиров' for
    // Владислав Владимиров), each one a phantom councillor on /council/PER32.
    //
    // The scope is what keeps this from becoming the anti-join this loader must
    // never do: it deletes only within resolutions THIS RUN staged, so a
    // protocol the scrape did not reach is untouched. `council_vote_stage`
    // holds one run's parse, so "present in the stage" is exactly "re-parsed
    // just now".
    const stale = await c.query(
      `DELETE FROM council_vote v
        WHERE EXISTS (
                SELECT 1 FROM council_vote_stage s
                 WHERE s.resolution_id = v.resolution_id)
          AND NOT EXISTS (
                SELECT 1 FROM council_vote_stage s
                 WHERE s.resolution_id = v.resolution_id
                   AND s.norm_key = v.norm_key)`,
    );
    if (stale.rowCount) {
      console.log(
        `[council] retired ${stale.rowCount} vote row(s) whose resolution was re-parsed without them`,
      );
    }

    // Upsert-only means a reload cannot retire a bad row, so the refusal above
    // has to be paired with a targeted removal of anything a previous version
    // stored. This is scoped to a provable invariant violation — not "rows this
    // scrape did not mention", which is the anti-join this loader must never do.
    const purged = await c.query(
      `DELETE FROM council_vote WHERE norm_key ~ $1`,
      [VOTE_LABEL_SOURCE],
    );
    if (purged.rowCount) {
      console.log(
        `[council] purged ${purged.rowCount} previously-stored vote-label-polluted rows`,
      );
    }

    await recordIngestBatch(c, {
      source: "council_minutes",
      table: RES_SPEC.table,
      keyExpr: "t.id",
      nameExpr: "t.title",
      detailExpr: "t.obshtina_code",
      rowsTotal: resolutions.length,
    });
  });

  const [{ resolved, total }] = await allRows<{
    resolved: string;
    total: string;
  }>(
    `SELECT count(person_id)::text AS resolved, count(*)::text AS total FROM council_vote`,
  );
  console.log(
    `[council] person_id attached to ${resolved}/${total} named votes ` +
      `(${((Number(resolved) / Math.max(1, Number(total))) * 100).toFixed(1)}%)`,
  );

  for (const spec of [VOTE_SPEC, RES_SPEC, CODE_SPEC, MUNI_SPEC]) {
    await exec(`DROP TABLE IF EXISTS ${spec.source}`);
  }

  await vacuumAfterReload(
    "council_muni",
    "council_muni_code",
    "council_resolution",
    "council_vote",
  );
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void end());
