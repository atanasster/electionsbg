-- 083_person_review.sql — the review queue for the aggressive-merge policy (plan §3).
-- The resolver merges only SAFE pairs (gold key / corroborant / globally-unique fold);
-- everything else that shares a (given_fold, family_fold) block but could NOT be confirmed
-- the same person is held here as a review candidate — NOT merged, each member stays its
-- own active person. A human (optionally aided by the reconcile-person-link skill, §5a)
-- adjudicates a group_key by writing a person_link_override (merge/split). This table is
-- DERIVED: the resolver rebuilds it every run alongside person/person_role, so it carries
-- no human state — the durable decision lives in person_link_override.
CREATE TABLE IF NOT EXISTS person_review_candidate (
  -- Deterministic id for the ambiguous group (hash of the member persons' slugs), so a
  -- re-run addresses the same group and a UI can key on it.
  group_key     text NOT NULL,
  person_id     bigint NOT NULL REFERENCES person (person_id) ON DELETE CASCADE,
  block_key     text NOT NULL,      -- given_fold \t family_fold — the shared blocking key
  namesake_risk integer NOT NULL,   -- max distinct-company count across the group
  reason        text NOT NULL       -- WHY these can't be auto-resolved (see cluster.ts §3 tier 3)
    CHECK (reason IN ('twopart_block', 'identical_fullname')),
  PRIMARY KEY (group_key, person_id)
);
-- Person-scoped lookup: "is this person in any review group?" for the person page's
-- internal-only "possible same person" panel + the adjudication view.
CREATE INDEX IF NOT EXISTS idx_person_review_candidate_person
  ON person_review_candidate (person_id);
