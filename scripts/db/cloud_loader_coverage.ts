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

// ── Orchestrator-emission exemptions ──────────────────────────────────────────
// CLOUD_SKILL_EXEMPTIONS above covers loaders named in NO skill. This SECOND list
// covers loaders that ARE named in an owning skill but are legitimately NOT emitted
// by `process-watch-report`'s Step 8 — because their trigger is not a daily watcher
// the orchestrator acts on.
//
// The distinction the C1 rollcall gap exposed: "named in a skill" ≠ "emitted by the
// orchestrator". A watcher-triggered PG loader that update-* runs but Step 8 never
// lists leaves prod stale after an ORCHESTRATED publish, even though its own skill
// documents the command. The orchestrator assertion in cloud_loader_coverage.test.ts
// requires every non-exempt `:cloud` loader to appear in process-watch-report; the
// entries here are the deliberate "not in the orchestrator, and here is why" set.
//
// ⚠️ Same two-file discipline as above: adding/removing an entry means changing the
// count pinned in cloud_loader_coverage.test.ts ("the orchestrator-exemption list
// cannot grow unnoticed"). The `toBe` is what forces the reason to be read.
//
// Decided 2026-08-21 (cloud-deploy-speed-v1 §v2-b). A loader whose trigger IS a daily
// watcher does NOT belong here — it belongs in process-watch-report's Step 8.
export const ORCHESTRATOR_EXEMPTIONS: Record<
  string,
  { kind: CloudExemptionKind; reason: string }
> = {
  "db:load:tender-dossier:pg:cloud": {
    kind: "manual-trigger",
    reason:
      "publishes the ЦАИС ЕОП dossier corpus, whose input raw_data/procurement/eop_dossier.sqlite grows only via a rate-limited ~26 h operator crawl (ingest_eop_dossier.ts) with no watcher. Named in update-procurement; reload order in CLAUDE.md's tender_dossier section.",
  },
  "person:slug-redirects:cloud": {
    kind: "manual-trigger",
    reason:
      "loads an officials re-slug map into person_slug_retired and takes the map FILE as an argument (-- raw_data/person/officials_reslug_<date>.json), so it cannot be a blind daily emit; run it when a new re-slug drop lands. Named in update-persons; procedure in CLAUDE.md's person-layer section.",
  },
  "person:slugs:cloud": {
    kind: "manual-trigger",
    reason:
      "mints the committed /person prerender + sitemap manifest (data/person/prerender_slugs.json) FROM the serving DB (emit_prerender_slugs.ts refuses local docker). It is a build-time artifact for the NEXT `npm run build`, so its trigger is a person-page rebuild/deploy, not the daily person ingest. ⚠️ Least-certain classification (cloud-deploy-speed-v1 §v2-b): if the person prerender set widens, promote it into the person cloud chain in process-watch-report.",
  },
  "data:local-person-refresh:cloud": {
    kind: "operator-tool",
    reason:
      "the :cloud suffix only redirects which DB it READS — it rebuilds the committed local-election JSON artifacts (rollups / place-trends / chmi-history) decorated against the person layer, and publishes NO cloud table (its output ships via bucket:sync). Trigger is a local-elections re-parse or a person-layer change; named in update-local-elections / update-persons. Same reads-only-redirect shape as build:project-members:cloud.",
  },
};
