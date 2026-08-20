// Which `:cloud` scripts are allowed NOT to be named in any skill, and why.
//
// The rule this backs: a `db:load:*:pg:cloud` script is how a corpus reaches
// PRODUCTION, and nothing runs it automatically. If no skill names it, then when
// its watcher fires an operator re-ingests locally, commits, and prod silently
// keeps the previous vintage at a 200 with every row count reconciling — the
// failure mode `reference_migrated_family_watch_reload` was written for.
//
// ⚠️ THE ENTRIES BELOW ARE NOT ALL EQUAL. Two kinds live here:
//
//   • `operator-tool`   — not a corpus reload at all (a proxy, a restore, a
//                          one-off repair). These will never belong to a skill.
//   • `manual-trigger`  — a real loader whose trigger is a human action with no
//                          watcher behind it (a rate-limited multi-hour crawl,
//                          an operator download). Documented in CLAUDE.md
//                          instead; the reload path is still written down.
// ⚠️ MOVING AN ENTRY OUT OF `unreviewed` IS A TWO-FILE EDIT. Wiring a loader means
// deleting its entry here AND lowering the exact count in cloud_loader_coverage.test.ts
// ("reports the unreviewed backlog"). That assertion is `toBe`, not `<=`, precisely so
// the second half cannot be forgotten: the test fails until the number matches, and its
// message says which direction to move it.
//
//   • `unreviewed`      — a loader nobody has decided about yet. **This bucket is
//                          currently EMPTY, and the gate asserts that.** It held
//                          19 entries when the gate was written; all 19 were
//                          worked through in docs/plans/cloud-loader-coverage-v1.md
//                          — 15 wired into an owning skill, 4 given a real kind
//                          above. Parking a new loader here is allowed only as a
//                          deliberate, temporary admission, and it fails the test
//                          until the count is raised to match.

export type CloudExemptionKind =
  | "operator-tool"
  | "manual-trigger"
  | "unreviewed";

export const CLOUD_SKILL_EXEMPTIONS: Record<
  string,
  { kind: CloudExemptionKind; reason: string }
> = {
  "db:proxy:cloud": {
    kind: "operator-tool",
    reason: "opens the Cloud SQL proxy; loads nothing",
  },
  "db:restore:cloud": {
    kind: "operator-tool",
    reason: "disaster recovery, run by hand against a dump",
  },
  "opencalls:sync-enrichment:cloud": {
    kind: "operator-tool",
    reason:
      "carries a human-reviewed enrichment overlay between databases; not a corpus reload",
  },
  "db:load:subcontractors:pg:cloud": {
    kind: "manual-trigger",
    reason:
      "a PROJECTION over tender_notice whose only staleness trigger is a dossier " +
      "load — itself a rate-limited ~26 h operator crawl with no watcher. The " +
      "reload order is documented in CLAUDE.md's db:load:subcontractors:pg section.",
  },

  // ── decided 2026-08-20 (cloud-loader-coverage-v1) ──────────────────────────
  // These four were part of the original 19-entry backlog and are now SANCTIONED
  // with their real kind. The other 15 were wired into an owning skill instead.
  "build:project-members:cloud": {
    kind: "operator-tool",
    reason:
      "builds the committed data/procurement/projects/members.json reverse index; the :cloud suffix only redirects which database it READS, so it publishes nothing and can never go stale on prod. Its trigger is a change to the curated project files, not a corpus reload.",
  },
  "db:load:company-founded:pg:cloud": {
    kind: "manual-trigger",
    reason:
      "ships the output of a slow rate-limited scrape (fetch_company_founded.ts) that only ever runs against LOCAL Postgres — so its trigger is that operator crawl, which has no watcher. The publish path is documented in CLAUDE.md's CR Deeds section.",
  },
  "db:load:cr-nkid:pg:cloud": {
    kind: "manual-trigger",
    reason:
      "reads the gitignored raw_data/tr/cr_deeds.sqlite operator crawl, so on most machines it has nothing to do. Its four-step cloud publish order is in CLAUDE.md's CR Deeds section.",
  },
  "person:kmetstvo-flips:cloud": {
    kind: "operator-tool",
    reason:
      "a one-off person_slug_lock reconcile, run by hand before a resolve when a local-elections RE-PARSE changes who holds a seat. Not a corpus reload; procedure in docs/plans/village-mayor-attribution-v1.md.",
  },
};
