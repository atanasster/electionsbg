// Parliament, polls, declarations, officials, Commerce Registry and the unified
// person layer.

import { derive, ingest, pnpm, tsx, verify } from "../build";
import { at, len, noShrink, rollcallSessionsLoaded } from "../gates";
import type { Handler } from "../types";

export const PARLIAMENT_PEOPLE: Handler[] = [
  {
    id: "update-rollcall",
    skill: "update-rollcall",
    runner: "script",
    sources: ["parliament_votes"],
    needs: ["pg-local", "egress:non-bg"],
    // rollcall:scrape reads data/parliament/index.json (the MP roster) that
    // parliament-scrape writes (.claude/skills/update-rollcall/SKILL.md).
    after: ["parliament-scrape"],
    steps: [
      ingest("rollcall:scrape", pnpm("rollcall:scrape"), { timeoutMin: 60 }),
      ingest("parliament:bills", pnpm("parliament:bills")),
      derive("db:load:rollcall:pg", pnpm("db:load:rollcall:pg")),
      derive(
        "db:load:rollcall-derived:pg",
        pnpm("db:load:rollcall-derived:pg"),
      ),
    ],
    agent: [
      {
        id: "pin-rollcall-counts",
        instruction:
          "Update the four pinned counts in scripts/db/tests/rollcall.data.test.ts from the loader output.",
        doc: ".claude/skills/update-rollcall/SKILL.md (Step 5c)",
      },
    ],
    publish: {
      paths: ["parliament/votes"],
      cloud: [
        "pnpm run db:load:rollcall:pg:cloud",
        "pnpm run db:load:rollcall-derived:pg:cloud",
      ],
    },
    never: [
      "Never raise --seated-tolerance to make a run pass — a tally mismatch is a parser bug.",
    ],
    knownFailures: [
      {
        match: /canary|tally|unknown vote code/i,
        advice:
          "parliament.bg changed a session page or a vote code: fix the parser in scripts/parliament/votes/.",
      },
    ],
    gates: [
      noShrink(
        "rollcall-sessions",
        "data/parliament/votes/index.json",
        (j) => len(at(j, "sessions")),
        0,
      ),
      // noShrink alone passes a run that ingested nothing; this one fails when
      // a roll-call session the watcher announced has no session file.
      rollcallSessionsLoaded(["parliament_votes"]),
    ],
    changelog: "orchestrator",
    outputs: [
      "data/parliament/votes",
      "data/parliament/bills",
      "tests/fixtures/parliament/votes",
    ],
  },
  {
    id: "parliament-scrape",
    skill: "parliament-scrape",
    runner: "script",
    sources: ["parliament_mps"],
    needs: ["pg-local", "egress:non-bg"],
    steps: [
      ingest(
        "scrape_mps",
        tsx("scripts/parliament/scrape_mps.ts", "--all", "--refresh-current"),
        { timeoutMin: 60 },
      ),
      derive(
        "decorate_local_mp_links",
        tsx("scripts/parsers_local/decorate_local_mp_links.ts"),
      ),
      derive(
        "rebuild_resolved",
        tsx("scripts/preferences/rebuild_resolved.ts"),
      ),
      derive("db:load:mp-roster:pg", pnpm("db:load:mp-roster:pg")),
    ],
    publish: {
      paths: ["parliament"],
      // decorate_local_mp_links / rebuild_resolved rewrite the gitignored,
      // bucket-only per-election candidates and per-cycle município trees.
      dirsMatching: /^\d{4}_\d{2}_\d{2}(_mi|_chmi(_nov)?)?$/,
      cloud: ["pnpm run db:load:mp-roster:pg:cloud"],
    },
    changelog: "orchestrator",
    outputs: ["data/parliament"],
  },
  {
    id: "update-polls",
    skill: "update-polls",
    runner: "skill",
    sources: [
      "wiki_polls",
      "polls_trend",
      "polls_alpha_research",
      "polls_market_links",
      "polls_sova_harris",
      "polls_myara",
      "polls_global_metrics",
      "polls_gallup",
      "polls_press",
    ],
    steps: [
      ingest("polls:backlog", tsx("scripts/polls/backlog.ts")),
      ingest("polls:fetch", pnpm("polls:fetch")),
      ingest("polls:extract", pnpm("polls:extract")),
      ingest("polls:review:prepare", pnpm("polls:review", "--prepare")),
      verify("polls:crosscheck", pnpm("polls:crosscheck")),
      derive("polls:analyze", pnpm("polls:analyze")),
      derive(
        "polls:analyze:presidential",
        pnpm("polls:analyze", "--race", "presidential"),
      ),
      verify(
        "polls:presidential:coverage",
        pnpm("polls:presidential:coverage"),
      ),
    ],
    agent: [
      {
        id: "polls-independent-readings",
        instruction:
          "Run one independent reading per prepared review task, then `pnpm run polls:review`.",
        doc: ".claude/skills/update-polls/SKILL.md",
      },
    ],
    operator: [
      {
        id: "polls-accept-inbox",
        instruction:
          "Review data/polls/_inbox drafts with no built extractor and `pnpm run polls:accept <id>` the ones the evidence supports.",
        blocks: "nothing",
      },
      {
        id: "polls-press-verify",
        on: ["polls_press"],
        instruction:
          "Resolve the real article URL, capture it with `polls:fetch --url`, and lock only when a second independent outlet agrees.",
        blocks: "nothing",
      },
    ],
    publish: { paths: ["polls"] },
    changelog: "orchestrator",
    outputs: ["data/polls", "state/polls"],
  },
  {
    id: "update-connections",
    skill: "update-connections",
    // Still delegated — FINDING-019: the >10% drop and `no MP match` checks are read by eye.
    runner: "skill",
    sources: ["cacbg_declarations", "bgpost_postcodes"],
    needs: ["pg-local"],
    steps: [
      ingest(
        "build_postcode_ekatte",
        tsx("scripts/parliament/build_postcode_ekatte.ts"),
        { on: ["bgpost_postcodes"] },
      ),
      ingest("data:declarations", pnpm("data", "--declarations"), {
        timeoutMin: 90,
      }),
      verify(
        "check_suspicious_values",
        tsx("scripts/declarations/check_suspicious_values.ts"),
      ),
    ],
    operator: [
      {
        id: "declaration-flag-triage",
        instruction:
          "Rule on each new FLAG / AUTO-CORRECTED line: typo (add an override), legitimate, or wrong field.",
        blocks: "nothing",
      },
    ],
    publish: { paths: ["governance/declarations_hub_stats.json"] },
    changelog: "orchestrator",
    followUps: ["declarations-hub-stats"],
    outputs: ["data/parliament", "data/declarations", "data/governance"],
  },
  {
    id: "update-officials",
    skill: "update-officials",
    // Still delegated — FINDING-012/019: the runbook's >20% rankings-drop and alias checks have no working gate yet.
    runner: "skill",
    sources: ["cacbg_officials", "cacbg_local"],
    needs: ["pg-local"],
    steps: [
      ingest("officials:executive", tsx("scripts/officials/index.ts"), {
        on: ["cacbg_officials"],
        timeoutMin: 90,
      }),
      ingest("officials:municipal", tsx("scripts/officials/municipal.ts"), {
        on: ["cacbg_local"],
        timeoutMin: 120,
      }),
      verify("declarations:coverage", tsx("scripts/declarations/coverage.ts")),
      derive("db:load:ngo-board-links", pnpm("db:load:ngo-board-links")),
      verify(
        "check_suspicious_values",
        tsx("scripts/declarations/check_suspicious_values.ts"),
      ),
    ],
    operator: [
      {
        id: "officials-alias-triage",
        instruction:
          "On an unmapped município or a new FLAG line: edit the alias / override table and re-run.",
        blocks: "nothing",
      },
    ],
    publish: {
      paths: ["officials"],
      cloud: [
        "pnpm run db:load:ngo-board-links:cloud",
        "pnpm run db:load:employer-links:pg:cloud",
      ],
    },
    changelog: "orchestrator",
    followUps: ["funds-political-links"],
    outputs: ["data/officials"],
  },
  {
    id: "tr-daily-refresh",
    runner: "script",
    sources: ["egov_commerce"],
    needs: ["pg-local"],
    steps: [
      ingest("tr:daily-refresh", pnpm("tr:daily-refresh"), {
        kind: "chain",
        timeoutMin: 120,
      }),
      // The local half of the founding-date publish: local IS the source of
      // truth, so this only reports what the cloud ship will carry (and any
      // pre-provenance NULLs that must be requeued first).
      verify("db:load:company-founded:pg", pnpm("db:load:company-founded:pg")),
    ],
    publish: {
      cloud: [
        "pnpm run db:load:tr:pg:cloud",
        "pnpm run db:load:cr-nkid:pg:cloud",
        // tr:daily-refresh folds CR founding dates into LOCAL company_founded
        // (db:load:cr-founding:pg); only this ships them (CLAUDE.md, CR Deeds).
        // Precondition: 033 applied to Cloud SQL (http_status/attempts) — the
        // loader does not apply it; it refreshes the risk-indexes payload itself.
        "pnpm run db:load:company-founded:pg:cloud",
        "pnpm run db:load:persons-browse:pg:cloud",
        "pnpm run db:load:person-search:pg:cloud",
        "pnpm run db:load:graph:pg:cloud",
        "pnpm run db:load:tr-company-place:pg:cloud",
        "pnpm run db:refresh:risk:cloud",
      ],
    },
    changelog: "orchestrator",
    outputs: [],
    notes:
      "A TR daily flip is deliberately NOT a trigger for update-persons (CLAUDE.md: " +
      "'A TR daily flip on its own is not a trigger').",
  },
  {
    id: "update-persons",
    skill: "update-persons",
    runner: "script",
    sources: [
      "cacbg_declarations",
      "vss_court_statistics",
      "ivss_declarations",
      "cacbg_officials",
      "cacbg_local",
      "cik_results",
      "erik_campaign_financing",
      "person_link_overrides",
      "ofac_sanctions",
      "comdos_ds",
      "regulator_rosters",
    ],
    needs: ["pg-local"],
    after: [
      "update-connections",
      "update-officials",
      "update-judiciary",
      "update-local-elections",
      "update-financing",
      "tr-daily-refresh",
    ],
    // Phase 1 of the declarations load precedes the resolver (it writes the
    // subject_ref the resolver dates officials postings from); everything
    // after the resolver re-attaches a positional person_id.
    steps: [
      // Dimensions the resolver joins — BEFORE it (CLAUDE.md: place-dim and
      // judicial-bodies precede db:resolve:persons). Mirrors the cloud chain.
      derive("db:load:place-dim:pg", pnpm("db:load:place-dim:pg")),
      derive("db:load:judicial-bodies:pg", pnpm("db:load:judicial-bodies:pg")),
      derive("db:load:declarations:pg", pnpm("db:load:declarations:pg")),
      derive("db:load:employer-links:pg", pnpm("db:load:employer-links:pg")),
      derive(
        "db:load:tr-name-fold-people:pg",
        pnpm("db:load:tr-name-fold-people:pg"),
      ),
      // --no-stamp: the resolver would otherwise stamp the marker at step 2 of
      // the chain, so a later failure would leave it reading "done".
      derive("db:resolve:persons", pnpm("db:resolve:persons", "--no-stamp"), {
        timeoutMin: 60,
      }),
      derive(
        "db:load:declarations:pg --resolve",
        pnpm("db:load:declarations:pg", "--resolve"),
      ),
      derive(
        "db:load:company-politicians:pg",
        pnpm("db:load:company-politicians:pg"),
      ),
      derive(
        "db:load:person-elections:pg",
        pnpm("db:load:person-elections:pg"),
      ),
      derive(
        "db:load:official-candidate-links:pg",
        pnpm("db:load:official-candidate-links:pg"),
      ),
      derive("db:load:council:pg", pnpm("db:load:council:pg")),
      derive("db:load:persons-browse:pg", pnpm("db:load:persons-browse:pg")),
      derive("db:load:person-search:pg", pnpm("db:load:person-search:pg")),
      derive("db:load:graph:pg", pnpm("db:load:graph:pg")),
      derive("db:load:agri-hub-stats:pg", pnpm("db:load:agri-hub-stats:pg")),
      derive(
        "db:load:tr-company-place:pg",
        pnpm("db:load:tr-company-place:pg"),
      ),
      derive("data:local-person-refresh", pnpm("data:local-person-refresh")),
      verify("test:person", pnpm("test:person")),
    ],
    operator: [
      {
        id: "curated-person-registers",
        on: ["ofac_sanctions", "comdos_ds", "regulator_rosters"],
        instruction:
          "Verify the change at the official source and edit data/person/{sanctions,ds,regulators}.json by hand (defamation rules apply).",
        blocks: "arm",
      },
    ],
    publish: {
      cloud: [
        "pnpm run db:load:place-dim:pg:cloud",
        // The roster is a prerequisite of judicial-bodies AND of the resolve
        // (CLAUDE.md: a stale cloud `magistrate` drops retained magistrates'
        // person rows at a 200). CLOUD_ORDER puts it before both.
        {
          run: "pnpm run db:load:magistrates:pg:cloud",
          on: ["ivss_declarations", "vss_court_statistics"],
        },
        "pnpm run db:load:judicial-bodies:pg:cloud",
        "pnpm run db:load:tr-name-fold-people:pg:cloud",
        "pnpm run db:load:declarations:pg:cloud",
        "pnpm run db:resolve:persons:cloud",
        "pnpm run db:load:declarations:pg:cloud --resolve",
        "pnpm run db:load:company-politicians:pg:cloud",
        "pnpm run db:load:employer-links:pg:cloud",
        "pnpm run db:load:official-candidate-links:pg:cloud",
        "pnpm run db:load:person-elections:pg:cloud",
        "pnpm run db:load:council:pg:cloud",
        "pnpm run db:load:persons-browse:pg:cloud",
        "pnpm run db:load:person-search:pg:cloud",
        "pnpm run db:load:graph:pg:cloud",
        "pnpm run db:load:agri-hub-stats:pg:cloud",
        "pnpm run db:load:tr-company-place:pg:cloud",
        "pnpm run person:slugs:cloud",
        "pnpm run data:local-person-refresh:cloud",
      ],
      commitAfter: ["data/person/prerender_slugs.json"],
    },
    // --no-stamp also suppresses the resolver's own data-changes row.
    changelog: "orchestrator",
    followUps: ["declarations-hub-stats", "funds-political-links"],
    outputs: ["data/person", "data/governance"],
  },
];
