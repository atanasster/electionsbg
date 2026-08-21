// Build the unified connections graph (schema: 127_company_public_money.sql + 128_graph.sql) — the
// ONE PG store merging the two person↔company lineages that used to be computed twice:
//   • CO-OWNERSHIP (no money): person_role source 'tr'/'ngo', EIK-exact on person_id.
//   • PROCUREMENT (money):     company_politicians (008), person↔company↔contract.
// Money lives on the COMPANY node (127, the broad contracts∪subsidies∪funds basis); a person's
// money exposure is the sum over their DISTINCT linked companies. Reads the DB only; fetches nothing.
//
// Rebuilt-on-load. It APPLIES 127 (load_pg cannot — it does not create agri_subsidies) and 128, then
// rebuilds the three tables + the blob via a NON-BLOCKING stage merge (scripts/db/lib/stage_merge.ts).
// It runs LATE in db:refresh — after persons-browse, tr, and the agri/funds corpora exist (127's UNION
// reads all three).
//
// WHY A STAGE MERGE AND NOT `TRUNCATE + INSERT`. All four tables sit on a serving path: 084's
// person_connections() / person_graph_ego() read the three graph_* tables (so /api/db/person-connections
// and /api/db/person-graph-ego serve from them), and /api/db/connections-graph reads graph_payloads.
// TRUNCATE holds an AccessExclusiveLock until COMMIT — i.e. for the whole multi-minute rebuild — and
// AccessExclusive conflicts with the AccessShare every SELECT needs, so each reader arriving during a
// load would stall and 500 at the serving pool's `lock_timeout: 2000`. That is the exact defect
// load_person_elections_pg was fixed for (measured on prod 2026-07-31); person_reload_locks.data.test.ts
// is the gate. So: build into UNLOGGED stage twins nothing reads, then upsert + delete-absent under
// RowExclusiveLock only — readers keep serving the previous vintage until the merge commits.
//
// CLOUD STALENESS: nothing runs this on Cloud SQL. Run `npm run db:load:graph:pg:cloud` after EACH of:
// db:resolve:persons:cloud, db:load:persons-browse:pg:cloud, db:load:person-elections:pg:cloud (the
// party/party_color source, person_election_stats), db:load:tr:pg:cloud, and any contracts/agri/funds
// reload (127's money basis) — else /connections + person_connections() serve the previous vintage.
// Documented in CLAUDE.md next to the other person-layer cloud loaders, and wired into the
// update-persons + update-procurement watch skills (the migrated-family reload contract) so an
// orchestrated re-ingest re-derives the graph on prod, not just locally.
//
// CHANGELOG: this is a DERIVED serving layer (co-ownership ∪ procurement re-projected from tr / persons
// / procurement), NOT a source ingest — so, exactly like person_search / contractor_search, it takes NO
// recent_updates row (recordIngestBatch records ARRIVING source data, which this never introduces) and
// no standalone data/data-changes.json entry: the /data/updates feed is stamped per-skill by the
// process-watch-report orchestrator, and the source skills that trigger this reload already stamp it.
//
// Run: `npm run db:load:graph:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  exec,
  execEach,
  allRows,
  withClient,
  withTx,
  vacuumAfterReload,
  end,
} from "./lib/pg";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const MONEY = path.join(
  ROOT,
  "scripts/db/schema/pg/127_company_public_money.sql",
);
// 127 reads interreg_partners as its fourth (Interreg) money arm, and a matview
// body is resolved at CREATE time — so on a database that has never run
// db:load:interreg:pg, 127 would fail to create at all and take /connections
// down with it. Applying 137's DDL first (CREATE TABLE IF NOT EXISTS, idempotent,
// no data) guarantees the table exists and lets 127 stay a plain static
// statement. The alternative — branching 127 on to_regclass — bakes the branch
// into the STORED definition, so a database that built it Interreg-blind stays
// blind through every REFRESH and only a re-apply fixes it. That is the worse
// failure: invisible, and not repaired by the thing an operator would try.
const INTERREG_DDL = path.join(ROOT, "scripts/db/schema/pg/137_interreg.sql");
const GRAPH = path.join(ROOT, "scripts/db/schema/pg/128_graph.sql");
const PAYLOADS = path.join(ROOT, "scripts/db/schema/pg/129_graph_payloads.sql");

// The global /connections overview ships the TOP-N bridge companies by public money (see 129). N is
// bounded so the blob stays small and drawable; ~1.8k bridge companies exist, we sample the richest.
const GLOBAL_COMPANY_CAP = 150;

// Companies with more linked people than this are mass-membership orgs (chambers, umbrella NGOs,
// the state as "owner"), not real business ties — the same signal as 084's MAX_CO_OFFICERS. The
// serving layer suppresses co-officer hops through them; officer_count on the company node is what it
// reads. We do NOT drop their edges here (a person's OWN link to such a company is still real) — the
// guard is applied at traversal time, so the count must be stored, not filtered.
const MASS_MEMBERSHIP_OFFICERS = 6;

// The four served tables and their stage twins. Every key is the table's own natural PK, so the merge
// key IS the row's identity — no surrogate to reconcile.
const EDGE: StageMergeSpec = {
  table: "graph_edge",
  source: "graph_edge_stage",
  keys: ["person_id", "eik", "kind", "role"],
  cols: ["person_id", "eik", "kind", "role", "is_current", "confidence"],
};
const COMPANY: StageMergeSpec = {
  table: "graph_company_node",
  source: "graph_company_node_stage",
  keys: ["eik"],
  cols: [
    "eik",
    "name",
    "public_money_eur",
    "officer_count",
    "public_officer_count",
    "coowner_count",
  ],
};
const PERSON: StageMergeSpec = {
  table: "graph_person_node",
  source: "graph_person_node_stage",
  keys: ["person_id"],
  cols: [
    "person_id",
    "slug",
    "name",
    "facet",
    "position_type",
    "identity_confidence",
    "is_public_figure",
    "public_money_eur",
    "degree",
    "party",
    "party_color",
  ],
};
const BLOB: StageMergeSpec = {
  table: "graph_payloads",
  source: "graph_payloads_stage",
  keys: ["scope"],
  cols: ["scope", "payload"],
};
const ALL_MERGES = [EDGE, COMPANY, PERSON, BLOB];

// The twins are UNLOGGED scratch — dropped on the way out (and on failure) so none of them ever
// reaches a pg_dump or db:sync:cloud. createStageTable drops first anyway, so a crash between the
// two is self-healing on the next run.
const dropStages = async (): Promise<void> => {
  for (const s of ALL_MERGES) await exec(`DROP TABLE IF EXISTS ${s.source}`);
};

const main = async (): Promise<void> => {
  // 127 is DROP+CREATE MATERIALIZED VIEW (rebuilt fresh each load); 128 is CREATE TABLE/INDEX IF NOT
  // EXISTS. Statement-by-statement (execEach) so no lock spans the file.
  await execEach(readFileSync(INTERREG_DDL, "utf8"));
  await execEach(readFileSync(MONEY, "utf8"));
  await execEach(readFileSync(GRAPH, "utf8"));
  await execEach(readFileSync(PAYLOADS, "utf8"));

  // ── BUILD PHASE ────────────────────────────────────────────────────────────────────────────────
  // Everything below writes ONLY to the stage twins, so all of the wall clock (the edge inserts, the
  // two node aggregates, the blob) locks nothing a route reads and needs no transaction: the live
  // tables keep answering the previous vintage throughout. Both guards (bridge preflight, non-empty
  // blob) therefore fail BEFORE anything is published — stronger than the rollback they used to rely
  // on, which only undid writes the live tables had already taken locks for.
  await withClient(async (c) => {
    await createStageTable(c, EDGE);
    // The edge PK goes on BEFORE the inserts, unlike the node stages below: the three arms dedupe
    // against each other through `ON CONFLICT DO NOTHING`, which needs the unique index to exist.
    await c.query(
      `ALTER TABLE ${EDGE.source} ADD PRIMARY KEY (${EDGE.keys.join(", ")})`,
    );

    // ── EDGES 1/3: co-ownership — every tr/ngo role is a person↔company tie (ref IS the eik) ──────
    // kind: the ownership roles → tr_owner; management/membership/NGO-board → tr_role. is_current from
    // end_date. The PK (person_id, eik, kind, role) keeps a person who is BOTH owner and manager of one
    // company as two distinct edges.
    await c.query(
      `INSERT INTO ${EDGE.source} (person_id, eik, kind, role, is_current, confidence)
       SELECT person_id, ref,
              CASE WHEN role IN ('sole_owner','partner','actual_owner')
                   THEN 'tr_owner' ELSE 'tr_role' END,
              role,
              end_date IS NULL,
              confidence
         FROM person_role
        WHERE source IN ('tr','ngo') AND ref <> ''
       ON CONFLICT DO NOTHING`,
    );

    // ── EDGES 2/3: procurement, BOTH arms, on company_politicians.person_id ──────────────────────────
    //
    // ⚠️ WAS TWO REGEX BRIDGES OVER THE URL STRING — `substring(cp.ref from
    // '^/candidate/mp-(.*)$')` and the /officials/ twin — which is a join on an app ROUTE.
    // Two things were wrong with it. A roster RE-SLUG silently drops that person's edges,
    // which is what the per-arm preflight below exists to catch after the fact rather than
    // prevent. And the officials arm's join carried no source filter, so it also resolved
    // refs minted from sources whose person_role.ref is NOT a slug — the accident its own
    // comment assumed away.
    //
    // 008's `person_id` is the identity those regexes were approximating, so the two arms
    // collapse into one insert with no string parsing at all. NULL is skipped rather than
    // guessed: on a database whose company_politicians predates the column it means „not
    // resolved here", and the preflight below reports the shortfall.
    await c.query(
      `INSERT INTO ${EDGE.source} (person_id, eik, kind, role, is_current, confidence)
       SELECT DISTINCT cp.person_id, cp.eik, 'procurement', '', NULL::boolean, NULL::text
         FROM company_politicians cp
        WHERE cp.person_id IS NOT NULL AND cp.eik <> ''
       ON CONFLICT DO NOTHING`,
    );
    // Fresh stage, no stats — the two node aggregates below read it, so plan it on real numbers.
    await c.query(`ANALYZE ${EDGE.source}`);
    await createStageTable(c, COMPANY);

    // ── COMPANY NODES: one per company carrying an edge, with broad money (127) + officer_count +
    // public_officer_count (the connections guard: distinct PUBLIC-figure CO-OWNERSHIP officers). ────
    await c.query(
      `INSERT INTO ${COMPANY.source}
         (eik, name, public_money_eur, officer_count, public_officer_count, coowner_count)
       WITH edge_eik AS (
         SELECT e.eik,
                count(DISTINCT e.person_id)                                       AS officers,
                count(DISTINCT e.person_id) FILTER (
                  WHERE e.kind IN ('tr_role','tr_owner') AND pf.is_public_figure) AS pub_officers,
                -- coowner_count = ALL co-ownership officers (public ∪ verified — the whole eligible
                -- universe; every graph person is one or the other). The toggle guard keys on this.
                count(DISTINCT e.person_id) FILTER (
                  WHERE e.kind IN ('tr_role','tr_owner'))                         AS coowners
           FROM ${EDGE.source} e
           LEFT JOIN person pf ON pf.person_id = e.person_id
          GROUP BY e.eik
       ),
       cname AS (
         -- Fallback name for eiks absent from tr_companies. ORDER BY makes the pick deterministic
         -- across loads (alphabetical), not an arbitrary row.
         SELECT DISTINCT ON (contractor_eik) contractor_eik AS eik, contractor_name AS name
           FROM contracts WHERE contractor_eik <> ''
          ORDER BY contractor_eik, contractor_name
       )
       SELECT e.eik,
              coalesce(tc.name, cn.name),
              coalesce(m.public_money_eur, 0),
              e.officers,
              e.pub_officers,
              e.coowners
         FROM edge_eik e
         LEFT JOIN tr_companies       tc ON tc.uic = e.eik
         LEFT JOIN cname              cn ON cn.eik = e.eik
         LEFT JOIN company_public_money m ON m.eik = e.eik`,
    );
    // Fails loudly on a duplicate eik before anything touches the live table — TRUNCATE+INSERT used
    // to get that from the live PK. ANALYZEs too (the person build + the blob read this stage).
    await addStagePrimaryKey(c, COMPANY);
    await createStageTable(c, PERSON);

    // ── PERSON NODES: one per person with ≥1 edge, denormalized from person + person_browse. money =
    // Σ over DISTINCT linked company nodes (broad basis); degree = edge count. ───────────────────────
    await c.query(
      `INSERT INTO ${PERSON.source}
         (person_id, slug, name, facet, position_type, identity_confidence,
          is_public_figure, public_money_eur, degree, party, party_color)
       WITH edge_person AS (
         SELECT person_id, count(*) AS degree FROM ${EDGE.source} GROUP BY person_id
       ),
       person_money AS (
         SELECT d.person_id, coalesce(sum(cn.public_money_eur), 0) AS money
           FROM (SELECT DISTINCT person_id, eik FROM ${EDGE.source}) d
           JOIN ${COMPANY.source} cn ON cn.eik = d.eik
          GROUP BY d.person_id
       ),
       pb AS (
         -- facet/position_type are DESCRIPTIVE only (not load-bearing for money or closure), so an
         -- arbitrary-but-stable pick is fine when a slug surfaces with >1 facet row; min() gives that.
         -- Joined on slug (not person_id) because person_browse_table exposes no person_id column.
         SELECT slug, min(primary_facet) AS facet, min(position_type) AS position_type
           FROM person_browse_table GROUP BY slug
       ),
       party AS (  -- the person's LATEST electoral affiliation (newest election carrying a party)
         SELECT DISTINCT ON (person_id) person_id, party_nick, party_color
           FROM person_election_stats WHERE party_nick IS NOT NULL
          ORDER BY person_id, election_date DESC
       )
       SELECT ep.person_id, p.slug, p.display_name,
              pb.facet, pb.position_type, p.identity_confidence,
              p.is_public_figure,
              coalesce(pm.money, 0),
              ep.degree,
              pty.party_nick, pty.party_color
         FROM edge_person ep
         JOIN person p        ON p.person_id = ep.person_id
         LEFT JOIN person_money pm ON pm.person_id = ep.person_id
         LEFT JOIN pb              ON pb.slug = p.slug
         LEFT JOIN party           pty ON pty.person_id = ep.person_id`,
    );
    await addStagePrimaryKey(c, PERSON);

    // BRIDGE PREFLIGHT — before the merge, so a broken bridge leaves the previous good tables in
    // place and never serves a half-graph. company_politicians.ref →
    // person_id is the fragile join; a roster re-slug silently breaks it. It has TWO independent arms
    // (mp / official) and a re-slug typically breaks only the OFFICIAL arm — so a total-count guard
    // (mapped===0) passes on a half-missing lineage. Guard EACH arm proportionally: mapped counts
    // ⚠️ SINCE TIER 4c THIS IS A NULL DETECTOR, not a ratio check, and the old description
    // („the ratio is not exactly 1 even when healthy — measured mp 57/57, official 447/454")
    // no longer holds: each arm row IS a distinct (eik, person_id) pair by its own GROUP BY,
    // and the column is written all-or-nothing by one COPY, so the ratio is exactly 1 or
    // exactly 0. The 0.5 floor therefore fires only on „this company_politicians predates
    // person_id" — which 008's one-off backfill closes for existing databases, leaving this
    // as the guard for a future load that somehow writes the column empty. It is still the
    // ONLY bridge guard that runs on Cloud SQL.
    //
    // ⚠️ WHAT IT GUARDS CHANGED IN TIER 4c, and it is still worth keeping. It used to catch a
    // roster re-slug breaking the ref→person_id REGEX; person_id is now a stored column, so
    // there is no regex to break. What it catches instead is a company_politicians written by
    // a TR load that predates the column — every row NULL, every procurement edge silently
    // absent — which is the same failure with a different cause.
    const { rows: bridge } = await c.query<{
      cp_mp: string;
      mapped_mp: string;
      cp_off: string;
      mapped_off: string;
    }>(
      `SELECT
         (SELECT count(*) FROM company_politicians WHERE kind='mp' AND eik<>'')       AS cp_mp,
         (SELECT count(DISTINCT (cp.person_id, cp.eik)) FROM company_politicians cp
           WHERE cp.kind='mp' AND cp.eik<>'' AND cp.person_id IS NOT NULL)             AS mapped_mp,
         (SELECT count(*) FROM company_politicians WHERE kind='official' AND eik<>'')  AS cp_off,
         (SELECT count(DISTINCT (cp.person_id, cp.eik)) FROM company_politicians cp
           WHERE cp.kind='official' AND cp.eik<>'' AND cp.person_id IS NOT NULL)       AS mapped_off`,
    );
    const b = bridge[0];
    for (const arm of [
      { name: "mp", cp: Number(b.cp_mp), mapped: Number(b.mapped_mp) },
      { name: "official", cp: Number(b.cp_off), mapped: Number(b.mapped_off) },
    ])
      if (arm.cp > 0 && arm.mapped < arm.cp * 0.5)
        throw new Error(
          `graph: procurement ${arm.name} arm mapped only ${arm.mapped}/${arm.cp} ` +
            `company_politicians rows carry a person_id. Since Tier 4c that column is ` +
            `written by db:load:tr:pg directly, so a shortfall means the TR load predates ` +
            `it (re-run db:load:tr:pg) — it is no longer a re-slug breaking a regex. ` +
            `Nothing merged.`,
        );

    // ── GLOBAL BLOB (129): the down-sampled PUBLIC-figure bridge graph for /connections' overview.
    // Nodes = top-N bridge companies by public money (companies linking ≥2 public figures via a real,
    // ≤6-officer tie) + every public figure on them + the edges between. The facet×facet matrix is a
    // GLOBAL public aggregate — how many ≤6-officer companies bridge each facet pair across ALL public
    // bridges (same-facet needs ≥2 people), deliberately BROADER than the drawn top-N node set (you can
    // draw 150 companies but summarise 1,827). It is public-ONLY, same as the nodes (co_facet filters
    // is_public_figure) — the one population it must never mix in is the private Tier-V owners. A plain
    // SELECT over the just-built STAGE tables, so it inherits their money basis and mass-membership
    // guard — and so the blob is derived from exactly the vintage the same merge publishes.
    await createStageTable(c, BLOB);
    await c.query(
      `INSERT INTO ${BLOB.source} (scope, payload)
     WITH bridge AS (
       SELECT e.eik
         FROM ${EDGE.source} e
         JOIN ${PERSON.source}  p  ON p.person_id = e.person_id AND p.is_public_figure
         JOIN ${COMPANY.source} cn ON cn.eik = e.eik AND cn.officer_count <= 6
        GROUP BY e.eik HAVING count(DISTINCT e.person_id) >= 2
     ),
     top_co AS (
       SELECT cn.eik, cn.name, cn.public_money_eur AS money, cn.officer_count AS officers
         FROM bridge b JOIN ${COMPANY.source} cn ON cn.eik = b.eik
        ORDER BY cn.public_money_eur DESC, cn.eik
        LIMIT ${GLOBAL_COMPANY_CAP}
     ),
     blob_edges AS (
       SELECT DISTINCT e.person_id, e.eik, e.kind
         FROM ${EDGE.source} e
         JOIN top_co t ON t.eik = e.eik
         JOIN ${PERSON.source} p ON p.person_id = e.person_id AND p.is_public_figure
     ),
     blob_persons AS (
       SELECT p.person_id, p.slug, p.name, p.facet, p.public_money_eur AS money, p.degree,
              p.party, p.party_color
         FROM ${PERSON.source} p
        WHERE p.person_id IN (SELECT person_id FROM blob_edges)
     ),
     co_facet AS (  -- per ≤6-officer company, distinct PUBLIC people of each facet
       -- is_public_figure is MANDATORY here — same as bridge/blob_edges. Without it the matrix pulls in
       -- the private-only 'company' facet (the 53k Tier-V owners), which the node set excludes and
       -- meta.audience='public' promises: the matrix would then count a population the drawn graph
       -- never shows ("one window, count another"). The facet subset test pins this.
       SELECT e.eik, p.facet, count(DISTINCT e.person_id) AS n
         FROM ${EDGE.source} e
         JOIN ${PERSON.source}  p  ON p.person_id = e.person_id AND p.is_public_figure
         JOIN ${COMPANY.source} cn ON cn.eik = e.eik AND cn.officer_count <= 6
        WHERE p.facet IS NOT NULL
        GROUP BY e.eik, p.facet
     ),
     matrix AS (  -- companies bridging facet a↔b (a<b: both present; a=b: ≥2 of that facet)
       SELECT a.facet AS a, b.facet AS b, count(*) AS companies
         FROM co_facet a
         JOIN co_facet b ON b.eik = a.eik
          AND (a.facet < b.facet OR (a.facet = b.facet AND a.n >= 2))
        GROUP BY a.facet, b.facet
     ),
     co_party AS (  -- the party×party slice WITHIN the politician facet: per ≤6-officer company,
       -- distinct POLITICIAN persons of each party. Same public/global-aggregate contract as co_facet,
       -- narrowed to facet='politician' AND party IS NOT NULL (private owners / partyless carry none).
       SELECT e.eik, p.party, count(DISTINCT e.person_id) AS n
         FROM ${EDGE.source} e
         JOIN ${PERSON.source}  p  ON p.person_id = e.person_id AND p.is_public_figure
          AND p.facet = 'politician' AND p.party IS NOT NULL
         JOIN ${COMPANY.source} cn ON cn.eik = e.eik AND cn.officer_count <= 6
        GROUP BY e.eik, p.party
     ),
     party_matrix AS (  -- companies bridging party a↔b (a<b: both present; a=b: ≥2 of that party)
       SELECT a.party AS a, b.party AS b, count(*) AS companies
         FROM co_party a
         JOIN co_party b ON b.eik = a.eik
          AND (a.party < b.party OR (a.party = b.party AND a.n >= 2))
        GROUP BY a.party, b.party
     ),
     party_palette AS (  -- party → colour for EVERY public politician party (not just the drawn set),
       -- so the party×party matrix can colour an axis whose party appears on no drawn person (the
       -- matrix is a global aggregate, broader than the top-N persons). One colour per party.
       SELECT DISTINCT ON (party) party, party_color
         FROM ${PERSON.source}
        WHERE facet = 'politician' AND party IS NOT NULL AND party_color IS NOT NULL
        ORDER BY party, party_color
     )
     SELECT 'global', jsonb_build_object(
       'meta', jsonb_build_object(
          'audience', 'public',
          'companyCap', ${GLOBAL_COMPANY_CAP},
          'bridgeCompaniesTotal', (SELECT count(*) FROM bridge)),
       'companies', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'eik', eik, 'name', name, 'money', round(money::numeric, 2), 'officers', officers)
          ORDER BY money DESC, eik) FROM top_co), '[]'::jsonb),
       'persons', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', person_id, 'slug', slug, 'name', name, 'facet', facet,
          'money', round(money::numeric, 2), 'degree', degree,
          'party', party, 'partyColor', party_color)
          ORDER BY money DESC, person_id) FROM blob_persons), '[]'::jsonb),
       'edges', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'p', person_id, 'c', eik, 'kind', kind)
          ORDER BY person_id, eik, kind) FROM blob_edges), '[]'::jsonb),
       'matrix', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'a', a, 'b', b, 'companies', companies)
          ORDER BY a, b) FROM matrix), '[]'::jsonb),
       'partyMatrix', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'a', a, 'b', b, 'companies', companies)
          ORDER BY a, b) FROM party_matrix), '[]'::jsonb),
       'partyColors', coalesce(
          (SELECT jsonb_object_agg(party, party_color) FROM party_palette), '{}'::jsonb))`,
    );

    // Non-empty guard, on the STAGE and before the merge, so a degenerate build never reaches the live
    // blob (the previous good one keeps serving) rather than shipping a blank /connections overview.
    // Nothing runs this loader on Cloud SQL, so an empty blob from a half-built upstream
    // (graph_person_node unpopulated, or is_public_figure all false after a bad persons-browse) would
    // otherwise publish silently at exit 0. Mirrors the bridge preflight above.
    const { rows: gr } = await c.query<{ companies: string; persons: string }>(
      `SELECT jsonb_array_length(payload->'companies') AS companies,
              jsonb_array_length(payload->'persons')   AS persons
         FROM ${BLOB.source} WHERE scope='global'`,
    );
    if (Number(gr[0].companies) === 0 || Number(gr[0].persons) === 0)
      throw new Error(
        `graph_payloads[global]: empty blob (${gr[0].companies} companies, ${gr[0].persons} ` +
          `persons) — graph_person_node/is_public_figure may be unbuilt. ` +
          `Refusing to ship a blank overview. Nothing merged.`,
      );
    await addStagePrimaryKey(c, BLOB);
  });

  // ── FLIP ───────────────────────────────────────────────────────────────────────────────────────
  // Upsert-changed + delete-absent take RowExclusiveLock, which does NOT conflict with the AccessShare
  // a SELECT needs, so readers never block. ONE transaction over all four so the blob can never
  // disagree with the tables it was derived from, and an ego query can never see edges whose nodes
  // are still the previous vintage. Order is the FK-free dependency order the blob assumes.
  await withTx(async (c) => {
    for (const spec of ALL_MERGES) await mergeFromStage(c, spec);
  });

  // The merge rewrote a large fraction of every table; the ego/global serving queries pick bad plans
  // on stale stats. VACUUM (ANALYZE) rather than the bare ANALYZE this used to be: the stats were
  // only half of what the rewrite destroyed, and the half that was missing is invisible.
  //
  // A bare ANALYZE never touches the visibility map, so `graph_company_node` sat at 20 of 1,174
  // pages (1.7%) with 6,087 dead tuples and `last_autovacuum` NULL — while `last_analyze` was
  // stamped by this very line, which is precisely why it read as healthy. Its two siblings were
  // fine (3,770/3,770 and 3,592/3,665) because autovacuum had happened to reach them, so the
  // table that needed it most was the one that looked least suspicious. Measured 2026-08-15 on
  // the top-N by money — the GLOBAL_COMPANY_CAP query this loader itself issues:
  //
  //   Index Only Scan using idx_graph_company_money … Heap Fetches: 208 … 170 buffers   (before)
  //   Index Only Scan using idx_graph_company_money … Heap Fetches: 0   …   5 buffers   (after)
  //
  // i.e. the plan was named an Index Only Scan and read every tuple from the heap, which is the
  // whole signature `reload_visibility_map.data.test.ts` exists to catch. Being STAGE-MERGED buys
  // nothing here — see the same finding in load_interreg_pg.ts.
  //
  // `graph_payloads` joins the list even though the other three were the ones being analyzed: it
  // is on a serving path (/api/db/connections-graph) and Postgres believed it had 0 pages and 0
  // live rows against 4 dead ones, having never been vacuumed or analyzed at all. One row and a
  // toasted blob, so it costs nothing to include and stops the planner working from that.
  //
  // Outside every transaction above, since VACUUM cannot run in one, and after dropStages() so the
  // UNLOGGED twins are gone rather than being vacuumed on the way out.
  await dropStages();
  await vacuumAfterReload(
    "graph_edge",
    "graph_company_node",
    "graph_person_node",
    "graph_payloads",
  );

  const [s] = await allRows<{
    edges: string;
    owner: string;
    tr: string;
    procurement: string;
    companies: string;
    persons: string;
    mass: string;
  }>(
    `SELECT (SELECT count(*) FROM graph_edge)                                     AS edges,
            (SELECT count(*) FROM graph_edge WHERE kind='tr_owner')               AS owner,
            (SELECT count(*) FROM graph_edge WHERE kind='tr_role')                AS tr,
            (SELECT count(*) FROM graph_edge WHERE kind='procurement')            AS procurement,
            (SELECT count(*) FROM graph_company_node)                             AS companies,
            (SELECT count(*) FROM graph_person_node)                              AS persons,
            (SELECT count(*) FROM graph_company_node WHERE officer_count > ${MASS_MEMBERSHIP_OFFICERS}) AS mass`,
  );
  const [g] = await allRows<{
    companies: string;
    persons: string;
    edges: string;
  }>(
    `SELECT jsonb_array_length(payload->'companies') AS companies,
            jsonb_array_length(payload->'persons')   AS persons,
            jsonb_array_length(payload->'edges')      AS edges
       FROM graph_payloads WHERE scope='global'`,
  );
  console.log(
    `graph: ${s.edges} edges (${s.owner} owner, ${s.tr} tr_role, ${s.procurement} procurement) · ` +
      `${s.companies} companies (${s.mass} mass-membership >${MASS_MEMBERSHIP_OFFICERS}) · ` +
      `${s.persons} persons`,
  );
  console.log(
    `graph_payloads[global]: ${g.companies} bridge companies · ${g.persons} public figures · ` +
      `${g.edges} edges`,
  );
};

// Guarded so a test can import without the loader firing against DATABASE_URL.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch(async (err) => {
      console.error(err);
      process.exitCode = 1;
      // A guard that fired left the live tables untouched — clear the twins too, so a failed run
      // leaves nothing behind for pg_dump.
      await dropStages().catch(() => {});
    })
    .finally(end);
}
