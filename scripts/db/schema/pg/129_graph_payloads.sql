-- 129_graph_payloads.sql — the down-sampled global blob behind the /connections OVERVIEW. The full
-- graph (128) is 162k edges / 70k companies — far too big to ship or draw. This is ONE precomputed
-- jsonb blob per scope: a bounded, view-ready node/edge set plus the facet×facet bridge matrix.
--
-- scope 'global' = the PUBLIC-figure bridge graph (the default /connections audience; the private
-- Tier-V owners are reached via ego + search, never the global overview — see P3.5's include_private
-- toggle). Its node set is the TOP-N bridge COMPANIES by public money — companies that connect ≥2
-- distinct public figures through a real (≤6-officer, non-mass-membership) tie — together with every
-- public figure on them and the person↔company edges between the two. That is precisely the
-- "which companies bridge politicians/executives/magistrates" question /connections exists to answer.
--
-- Rebuilt-on-load by load_graph_pg.ts (P3.3/P3.4), AFTER the three graph_* tables. The blob is a
-- plain SELECT over them, so it inherits their broad-money basis and mass-membership guard.
-- Plan: docs/plans/connections-engine-v1.md §P3.4.

CREATE TABLE IF NOT EXISTS graph_payloads (
  scope   text  PRIMARY KEY,
  payload jsonb NOT NULL
);
