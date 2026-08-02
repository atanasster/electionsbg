-- 128_graph.sql — the unified connections graph (Phase 3). ONE PG store merging the two lineages
-- that used to be computed twice, from different places:
--   • CO-OWNERSHIP (no money): person_role source 'tr'/'ngo', EIK-exact on person_id — the spine of
--     person_connections() (084) AND the SQLite→JSON build_connections_graph.ts pipeline.
--   • PROCUREMENT (money): company_politicians (008) — person↔company↔contract with total_eur.
-- Money lives on the COMPANY node (from company_public_money, 127); a person's money exposure is the
-- sum over their DISTINCT linked companies (the same shape as person_browse.public_money_eur).
--
-- Plan: docs/plans/connections-engine-v1.md §P3.2. Rebuilt-on-load by scripts/db/load_graph_pg.ts
-- (P3.3), which also applies 127. Approach A: a dedicated precompute store, decoupled from the
-- source shapes (over extending person_connections() live). Serving: graph-ego + a down-sampled
-- graph_payloads blob (129). person_connections() (084) is re-pointed to read these (P3.5).

-- ── EDGES: person ↔ company, typed by how the link was established ──────────────────────────────
-- Grain (person_id, eik, kind, role): a person can be BOTH manager and owner of one company (two
-- tr roles) AND appear via procurement — distinct edges. `role` is NOT NULL DEFAULT '' so it can sit
-- in the unique key (procurement edges carry no TR role → '').
CREATE TABLE IF NOT EXISTS graph_edge (
  person_id   bigint NOT NULL,
  eik         text   NOT NULL,
  kind        text   NOT NULL CHECK (kind IN ('tr_role','tr_owner','declared_stake','procurement')),
  role        text   NOT NULL DEFAULT '',
  is_current  boolean,
  confidence  text,
  PRIMARY KEY (person_id, eik, kind, role)
);
-- BOTH directions are traversed: person → their companies (ego expand), company → its people
-- (co-officer discovery + officer_count). Index each side.
CREATE INDEX IF NOT EXISTS idx_graph_edge_person ON graph_edge (person_id);
-- (eik, person_id) not (eik): the company→people reverse hop (co-officer discovery + officer_count)
-- reads person_id, so a covering index makes it index-only.
CREATE INDEX IF NOT EXISTS idx_graph_edge_eik    ON graph_edge (eik, person_id);

-- ── COMPANY NODES: one per company that carries an edge, with its public money ──────────────────
-- `officer_count` = distinct linked persons OVER ALL EDGES (incl. procurement) — a display/degree
-- signal. `public_officer_count` = distinct PUBLIC-figure CO-OWNERSHIP officers (tr_role/tr_owner
-- only) — the association-noise guard the connections serving layer keys on (MAX_CO_OFFICERS=6): a
-- company with >6 PUBLIC co-owners is a board / professional association, not a business tie. It is the
-- precomputed replacement for 084's per-request public_officer_count(eik) — provably identical to it
-- (co-ownership edges ARE person_role source tr/ngo, and every graph person is active), now a stored
-- O(1) column instead of a whole-corpus scan. The guard keys on the PUBLIC count in BOTH toggle states
-- (mass-membership is a public-official phenomenon); the private toggle only relaxes which endpoints
-- are admitted, never the classification.
-- `coowner_count` = distinct CO-OWNERSHIP officers who are ELIGIBLE persons (public figures ∪ verified
-- Tier-V privates — the whole toggle-visible universe, which is exactly what graph_person_node holds).
-- It is the guard for the PRIVATE (?private=1) toggle: public_officer_count bounds only PUBLIC officers,
-- so a кооперация / many-съдружник vehicle with 1 public + 123 verified owners passes public_officer_count
-- ≤6 yet would fan a private-view subject out to 123 named private individuals — the exact mass-ownership
-- over-link the guard exists to suppress. The toggle path keys on coowner_count ≤6 instead, so the same
-- ≤6 classification bounds the FULL fan-out, not just its public slice.
CREATE TABLE IF NOT EXISTS graph_company_node (
  eik                  text PRIMARY KEY,
  name                 text,
  public_money_eur     double precision NOT NULL DEFAULT 0,
  officer_count        int NOT NULL DEFAULT 0,
  public_officer_count int NOT NULL DEFAULT 0,
  coowner_count        int NOT NULL DEFAULT 0
);
-- Additive columns for DBs whose graph_company_node predates them (the table is TRUNCATEd, not dropped,
-- by the loader, so CREATE TABLE IF NOT EXISTS alone would not add them). Idempotent.
ALTER TABLE graph_company_node ADD COLUMN IF NOT EXISTS public_officer_count int NOT NULL DEFAULT 0;
ALTER TABLE graph_company_node ADD COLUMN IF NOT EXISTS coowner_count        int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_graph_company_money
  ON graph_company_node (public_money_eur DESC NULLS LAST, eik);

-- ── PERSON NODES: one per person with ≥1 edge, denormalized from person_browse ──────────────────
-- `public_money_eur` = Σ over the person's DISTINCT linked company nodes. The graph uses the BROAD
-- basis THROUGHOUT (127: contracts∪subsidies∪funds on the company node, summed here) — this
-- INTENTIONALLY differs from person_browse.public_money_eur, which is contracts-ONLY for public
-- figures (dual basis, 120). The graph's signal is "total public money the tie touches", not
-- procurement-specific exposure, so one broad basis is correct here; the P3.3 loader must NOT try
-- to reconcile it back to person_browse's public-figure figure.
--
-- `degree` = the person's edge count. NOTE for the P3.3 ranking down-sample: an owner who is ALSO a
-- declared-stakeholder of one company yields two edges (tr_owner + declared_stake) to the same eik,
-- so `degree` slightly over-counts a "how many companies" reading — it is an edge count, used only
-- to rank the down-sample, not displayed as a company count.
-- is_public_figure / identity_confidence drive the default-public / private-toggle serving.
CREATE TABLE IF NOT EXISTS graph_person_node (
  person_id           bigint PRIMARY KEY,
  slug                text,
  name                text,
  facet               text,
  position_type       text,
  identity_confidence text,
  is_public_figure    boolean NOT NULL DEFAULT false,
  public_money_eur    double precision NOT NULL DEFAULT 0,
  degree              int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_graph_person_slug ON graph_person_node (slug);
-- The global down-sample ranks by money then degree; index the composite.
CREATE INDEX IF NOT EXISTS idx_graph_person_rank
  ON graph_person_node (public_money_eur DESC NULLS LAST, degree DESC, person_id);
-- Default-public / private-toggle scans.
CREATE INDEX IF NOT EXISTS idx_graph_person_public
  ON graph_person_node (person_id) WHERE is_public_figure;
