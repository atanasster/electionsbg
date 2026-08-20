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
//   • `unreviewed`      — PRE-EXISTING debt, listed so the gate is non-vacuous
//                          for NEW loaders rather than blanket-passing. Each one
//                          is a genuine question nobody has answered: does this
//                          corpus ever go stale on prod, and who reloads it?
//                          Moving one out of this bucket is the work; leaving it
//                          here is an admission, not an approval.

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

  // ── pre-existing, unreviewed ───────────────────────────────────────────────
  // Each of these shipped before this gate existed. They are NOT sanctioned —
  // they are the backlog this gate exists to stop growing.
  "build:project-members:cloud": { kind: "unreviewed", reason: "pre-existing" },
  "db:load:agri-hub-stats:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:annexes:pg:cloud": { kind: "unreviewed", reason: "pre-existing" },
  "db:load:budget-hub:pg:cloud": { kind: "unreviewed", reason: "pre-existing" },
  "db:load:budget-muni:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:budget:pg:cloud": { kind: "unreviewed", reason: "pre-existing" },
  "db:load:company-founded:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:court-load:pg:cloud": { kind: "unreviewed", reason: "pre-existing" },
  "db:load:cr-nkid:pg:cloud": { kind: "unreviewed", reason: "pre-existing" },
  "db:load:employer-links:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:funds-fit:pg:cloud": { kind: "unreviewed", reason: "pre-existing" },
  "db:load:grant-links:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:municipal-fiscal:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:nzok-drug-prices:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:nzok-financials:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:nzok-tariffs:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:tr-name-fold-people:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "db:load:transport-facility-map:pg:cloud": {
    kind: "unreviewed",
    reason: "pre-existing",
  },
  "person:kmetstvo-flips:cloud": { kind: "unreviewed", reason: "pre-existing" },
};
