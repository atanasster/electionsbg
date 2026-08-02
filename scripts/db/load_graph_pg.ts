// Build the unified connections graph (schema: 127_company_public_money.sql + 128_graph.sql) — the
// ONE PG store merging the two person↔company lineages that used to be computed twice:
//   • CO-OWNERSHIP (no money): person_role source 'tr'/'ngo', EIK-exact on person_id.
//   • PROCUREMENT (money):     company_politicians (008), person↔company↔contract.
// Money lives on the COMPANY node (127, the broad contracts∪subsidies∪funds basis); a person's
// money exposure is the sum over their DISTINCT linked companies. Reads the DB only; fetches nothing.
//
// Rebuilt-on-load. It APPLIES 127 (load_pg cannot — it does not create agri_subsidies) and 128, then
// TRUNCATE+rebuilds the three tables inside one tx. It runs LATE in db:refresh — after persons-browse,
// tr, and the agri/funds corpora exist (127's UNION reads all three).
//
// CLOUD STALENESS: nothing runs this on Cloud SQL. Run `npm run db:load:graph:pg:cloud` after EACH of:
// db:resolve:persons:cloud, db:load:persons-browse:pg:cloud, db:load:tr:pg:cloud, and any
// contracts/agri/funds reload (127's money basis) — else /connections + person_connections() serve the
// previous vintage. Documented in CLAUDE.md next to the other person-layer cloud loaders.
//
// Run: `npm run db:load:graph:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, execEach, allRows, withTx, end } from "./lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const MONEY = path.join(
  ROOT,
  "scripts/db/schema/pg/127_company_public_money.sql",
);
const GRAPH = path.join(ROOT, "scripts/db/schema/pg/128_graph.sql");

// Companies with more linked people than this are mass-membership orgs (chambers, umbrella NGOs,
// the state as "owner"), not real business ties — the same signal as 084's MAX_CO_OFFICERS. The
// serving layer suppresses co-officer hops through them; officer_count on the company node is what it
// reads. We do NOT drop their edges here (a person's OWN link to such a company is still real) — the
// guard is applied at traversal time, so the count must be stored, not filtered.
const MASS_MEMBERSHIP_OFFICERS = 6;

const main = async (): Promise<void> => {
  // 127 is DROP+CREATE MATERIALIZED VIEW (rebuilt fresh each load); 128 is CREATE TABLE/INDEX IF NOT
  // EXISTS. Statement-by-statement (execEach) so no lock spans the file.
  await execEach(readFileSync(MONEY, "utf8"));
  await execEach(readFileSync(GRAPH, "utf8"));

  await withTx(async (c) => {
    await c.query("TRUNCATE graph_edge, graph_company_node, graph_person_node");

    // ── EDGES 1/3: co-ownership — every tr/ngo role is a person↔company tie (ref IS the eik) ──────
    // kind: the ownership roles → tr_owner; management/membership/NGO-board → tr_role. is_current from
    // end_date. The PK (person_id, eik, kind, role) keeps a person who is BOTH owner and manager of one
    // company as two distinct edges.
    await c.query(
      `INSERT INTO graph_edge (person_id, eik, kind, role, is_current, confidence)
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

    // ── EDGES 2/3: procurement (mp arm) — company_politicians.ref '/candidate/mp-<id>' → person_id via
    // person_role source='mp' (ref = bare mp id). kind='procurement', role='' (no TR role). ──────────
    await c.query(
      `INSERT INTO graph_edge (person_id, eik, kind, role, is_current, confidence)
       SELECT DISTINCT pr.person_id, cp.eik, 'procurement', '', NULL::boolean, NULL::text
         FROM company_politicians cp
         JOIN person_role pr
           ON pr.source = 'mp'
          AND pr.ref = substring(cp.ref from '^/candidate/mp-(.*)$')
        WHERE cp.kind = 'mp' AND cp.eik <> ''
       ON CONFLICT DO NOTHING`,
    );

    // ── EDGES 3/3: procurement (official arm) — ref '/officials/<slug>' → person_id via person_role on
    // the officials slug (globally unique across sources, so the ref match alone is unambiguous). ─────
    await c.query(
      `INSERT INTO graph_edge (person_id, eik, kind, role, is_current, confidence)
       SELECT DISTINCT pr.person_id, cp.eik, 'procurement', '', NULL::boolean, NULL::text
         FROM company_politicians cp
         JOIN person_role pr
           ON pr.ref = substring(cp.ref from '^/officials/(.*)$')
        WHERE cp.kind = 'official' AND cp.eik <> ''
       ON CONFLICT DO NOTHING`,
    );

    // ── COMPANY NODES: one per company carrying an edge, with broad money (127) + officer_count. ────
    await c.query(
      `INSERT INTO graph_company_node (eik, name, public_money_eur, officer_count)
       WITH edge_eik AS (
         SELECT eik, count(DISTINCT person_id) AS officers FROM graph_edge GROUP BY eik
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
              e.officers
         FROM edge_eik e
         LEFT JOIN tr_companies       tc ON tc.uic = e.eik
         LEFT JOIN cname              cn ON cn.eik = e.eik
         LEFT JOIN company_public_money m ON m.eik = e.eik`,
    );

    // ── PERSON NODES: one per person with ≥1 edge, denormalized from person + person_browse. money =
    // Σ over DISTINCT linked company nodes (broad basis); degree = edge count. ───────────────────────
    await c.query(
      `INSERT INTO graph_person_node
         (person_id, slug, name, facet, position_type, identity_confidence,
          is_public_figure, public_money_eur, degree)
       WITH edge_person AS (
         SELECT person_id, count(*) AS degree FROM graph_edge GROUP BY person_id
       ),
       person_money AS (
         SELECT d.person_id, coalesce(sum(cn.public_money_eur), 0) AS money
           FROM (SELECT DISTINCT person_id, eik FROM graph_edge) d
           JOIN graph_company_node cn ON cn.eik = d.eik
          GROUP BY d.person_id
       ),
       pb AS (
         -- facet/position_type are DESCRIPTIVE only (not load-bearing for money or closure), so an
         -- arbitrary-but-stable pick is fine when a slug surfaces with >1 facet row; min() gives that.
         -- Joined on slug (not person_id) because person_browse_table exposes no person_id column.
         SELECT slug, min(primary_facet) AS facet, min(position_type) AS position_type
           FROM person_browse_table GROUP BY slug
       )
       SELECT ep.person_id, p.slug, p.display_name,
              pb.facet, pb.position_type, p.identity_confidence,
              p.is_public_figure,
              coalesce(pm.money, 0),
              ep.degree
         FROM edge_person ep
         JOIN person p        ON p.person_id = ep.person_id
         LEFT JOIN person_money pm ON pm.person_id = ep.person_id
         LEFT JOIN pb              ON pb.slug = p.slug`,
    );

    // BRIDGE PREFLIGHT — inside the tx so a broken bridge ROLLS BACK (the previous good tables
    // survive), not after commit where the half-graph is already served. company_politicians.ref →
    // person_id is the fragile join; a roster re-slug silently breaks it. It has TWO independent arms
    // (mp / official) and a re-slug typically breaks only the OFFICIAL arm — so a total-count guard
    // (mapped===0) passes on a half-missing lineage. Guard EACH arm proportionally: mapped counts
    // distinct (person_id, eik), cp counts raw rows, so the ratio is not exactly 1 even when healthy
    // (measured mp 57/57, official 447/454); a 0.5 floor is comfortably below that and well above a
    // one-broken-arm collapse. This is the ONLY bridge guard that runs on Cloud SQL.
    const { rows: bridge } = await c.query<{
      cp_mp: string;
      mapped_mp: string;
      cp_off: string;
      mapped_off: string;
    }>(
      `SELECT
         (SELECT count(*) FROM company_politicians WHERE kind='mp' AND eik<>'')       AS cp_mp,
         (SELECT count(DISTINCT (pr.person_id, cp.eik)) FROM company_politicians cp
            JOIN person_role pr ON pr.source='mp'
             AND pr.ref = substring(cp.ref from '^/candidate/mp-(.*)$')
           WHERE cp.kind='mp' AND cp.eik<>'')                                          AS mapped_mp,
         (SELECT count(*) FROM company_politicians WHERE kind='official' AND eik<>'')  AS cp_off,
         (SELECT count(DISTINCT (pr.person_id, cp.eik)) FROM company_politicians cp
            JOIN person_role pr ON pr.ref = substring(cp.ref from '^/officials/(.*)$')
           WHERE cp.kind='official' AND cp.eik<>'')                                    AS mapped_off`,
    );
    const b = bridge[0];
    for (const arm of [
      { name: "mp", cp: Number(b.cp_mp), mapped: Number(b.mapped_mp) },
      { name: "official", cp: Number(b.cp_off), mapped: Number(b.mapped_off) },
    ])
      if (arm.cp > 0 && arm.mapped < arm.cp * 0.5)
        throw new Error(
          `graph: procurement ${arm.name} arm mapped only ${arm.mapped}/${arm.cp} ` +
            `company_politicians → person_id — the ref→person_id bridge is broken ` +
            `(roster re-slug? run db:resolve:persons first). Rolled back.`,
        );
  });

  // Fresh tables have no stats; the ego/global serving queries pick bad plans otherwise.
  await exec("ANALYZE graph_edge, graph_company_node, graph_person_node");

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
  console.log(
    `graph: ${s.edges} edges (${s.owner} owner, ${s.tr} tr_role, ${s.procurement} procurement) · ` +
      `${s.companies} companies (${s.mass} mass-membership >${MASS_MEMBERSHIP_OFFICERS}) · ` +
      `${s.persons} persons`,
  );
};

// Guarded so a test can import without the loader firing against DATABASE_URL.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(end);
}
