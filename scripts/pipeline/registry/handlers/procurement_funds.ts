// Procurement (АОП / ЦАИС ЕОП / КЗК), EU funds, open calls, farm subsidies.

import {
  currentYear,
  derive,
  listDir,
  ingest,
  pnpm,
  tsx,
  verify,
} from "../build";
import { outputLacks } from "../gates";
import { hasFtsYear } from "../drop_rules";
import type { Handler } from "../types";

const PROC_MAIN = ["egov_procurement", "eop_procurement"] as const;
const FUNDS_MAIN = ["isun_eu_funds", "isun_eu_funds_projects"] as const;
const PROC_MAIN_OR_DEBARRED = [...PROC_MAIN, "aop_debarred"] as const;

// kzk_appeals runs only the intake-side gates: kzk_decisions.data.test.ts
// asserts the MERITS register's newest act is loaded, which only the
// kzk_decisions handler (running after this one) can make true — so running
// it here would fail the intake whenever the merits arm moved, and block both.
const KZK_INTAKE_GATES =
  "pnpm exec vitest run scripts/db/tests/kzk_appeals_provenance.data.test.ts " +
  "scripts/db/tests/kzk_suspension.data.test.ts";
const KZK_GATES =
  "pnpm exec vitest run scripts/db/tests/kzk_decisions.data.test.ts " +
  "scripts/db/tests/kzk_appeals_provenance.data.test.ts " +
  "scripts/db/tests/kzk_suspension.data.test.ts";

export const PROCUREMENT_FUNDS: Handler[] = [
  {
    id: "update-procurement",
    skill: "update-procurement",
    // Still delegated — FINDING-014: the ≥1B review, the new-buyer geo chain and the reopened-АОП-experts framing are judgment steps.
    runner: "skill",
    sources: [
      "egov_procurement",
      "eop_procurement",
      "aop_debarred",
      "cprs_register",
      "ted_bg",
      "adfi_inspections",
      "aop_experts",
    ],
    needs: ["pg-local"],
    steps: [
      // debarred.json is read ONLY by load_pg.ts (→ the `debarred` table), so
      // it must land before db:refresh's db:load:pg, and an aop_debarred-only
      // flip needs a load of its own (below) or it publishes nothing.
      ingest("debarred", tsx("scripts/procurement/debarred.ts"), {
        on: ["aop_debarred"],
      }),
      // When the main corpus ALSO moved, db:refresh reloads again later — a
      // redundant local load, accepted: a step has no "unless X flipped"
      // condition, and an args() returning null would mark the entry
      // scope-failed (unstampable) rather than skip it.
      derive("db:load:pg:debarred", pnpm("db:load:pg"), {
        on: ["aop_debarred"],
      }),
      derive("db:load:annexes:pg:debarred", pnpm("db:load:annexes:pg"), {
        on: ["aop_debarred"],
      }),
      ingest(
        "procurement:ingest-legacy",
        pnpm("procurement:ingest-legacy", "--discover"),
        { on: ["egov_procurement"], timeoutMin: 60 },
      ),
      ingest(
        "ingest_eop",
        tsx("scripts/procurement/ingest_eop.ts", "--self-heal", "--apply"),
        { on: ["eop_procurement"], timeoutMin: 60 },
      ),
      ingest("procurement:ingest", pnpm("procurement:ingest"), {
        on: PROC_MAIN,
        timeoutMin: 90,
      }),
      ingest(
        "ingest_tenders",
        tsx("scripts/procurement/ingest_tenders.ts", "--apply"),
        { on: ["eop_procurement"], timeoutMin: 60 },
      ),
      derive(
        "eop_field_map",
        tsx("scripts/procurement/eop_field_map.ts", "--apply"),
        { on: PROC_MAIN },
      ),
      derive("by_id_shards", tsx("scripts/procurement/by_id_shards.ts"), {
        on: PROC_MAIN,
      }),
      // The current-value chain. Order is fixed: annex fold → УНП backfill →
      // cross-source reconcile → rebuild (CLAUDE.md, "Cross-source
      // reconciliation").
      ingest("ingest_anexi", tsx("scripts/procurement/ingest_anexi.ts"), {
        on: PROC_MAIN,
        timeoutMin: 60,
      }),
      derive(
        "anexi_current_value",
        tsx("scripts/procurement/anexi_current_value.ts", "--apply"),
        { on: PROC_MAIN },
      ),
      derive("proc:backfill-unp:apply", pnpm("proc:backfill-unp:apply"), {
        on: PROC_MAIN,
      }),
      derive("proc:reconcile:apply", pnpm("proc:reconcile:apply"), {
        on: PROC_MAIN,
      }),
      derive(
        "rebuild_from_cache",
        tsx("scripts/procurement/rebuild_from_cache.ts"),
        { on: PROC_MAIN, timeoutMin: 60 },
      ),
      derive("contract_index", tsx("scripts/procurement/contract_index.ts"), {
        on: PROC_MAIN,
      }),
      derive("rebuild_derived", tsx("scripts/procurement/rebuild_derived.ts"), {
        on: PROC_MAIN,
      }),
      derive("db:refresh", pnpm("db:refresh"), {
        on: PROC_MAIN,
        kind: "chain",
        timeoutMin: 240,
      }),
      // The sub-registers. Each of these ingests is DRY-RUN by default or
      // cache-wins: without the flag it exits 0 having done nothing.
      ingest("cprs:ingest", pnpm("cprs:ingest", "--apply", "--refresh"), {
        on: ["cprs_register"],
        timeoutMin: 60,
      }),
      derive("db:load:cprs:pg", pnpm("db:load:cprs:pg"), {
        on: ["cprs_register"],
      }),
      ingest("ted:ingest", pnpm("ted:ingest", "--apply"), { on: ["ted_bg"] }),
      derive("db:load:ted:pg", pnpm("db:load:ted:pg"), { on: ["ted_bg"] }),
      ingest("adfi:ingest", pnpm("adfi:ingest", "--apply"), {
        on: ["adfi_inspections"],
      }),
      derive("db:load:adfi:pg", pnpm("db:load:adfi:pg"), {
        on: ["adfi_inspections"],
      }),
      ingest("aop:experts", pnpm("aop:experts"), { on: ["aop_experts"] }),
      derive("db:load:aop-experts:pg", pnpm("db:load:aop-experts:pg"), {
        on: ["aop_experts"],
      }),
    ],
    agent: [
      {
        id: "procurement-new-buyers",
        on: PROC_MAIN,
        instruction:
          "If the ingest reported new buyers: rebuild the OCDS party geo / tender oblast / awarder geo maps, reload awarder seats and run proc:verify-seats.",
        doc: ".claude/skills/update-procurement/SKILL.md (new-buyers step)",
      },
    ],
    operator: [
      {
        id: "aop-experts-reopened",
        on: ["aop_experts"],
        instruction:
          "The АОП experts register was closed since 2023; a flip means it reopened. Re-read the past-tense framing on every surface.",
        blocks: "nothing",
      },
    ],
    publish: {
      paths: [
        "procurement/roads.json",
        "procurement/derived/mp_party.json",
        "procurement/derived/hub_stats.json",
        "procurement/derived/sector_stats.json",
      ],
      cloud: [
        { run: "pnpm run db:load:pg:cloud", on: PROC_MAIN_OR_DEBARRED },
        { run: "pnpm run db:load:tenders:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:awarder-seats:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run proc:verify-seats:cloud", on: PROC_MAIN },
        // Mandatory after every contracts load (CLAUDE.md, annexes note).
        { run: "pnpm run db:load:annexes:pg:cloud", on: PROC_MAIN_OR_DEBARRED },
        { run: "pnpm run db:load:nzok-hospital-map:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:water-operator-map:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:mvr-directorate-map:pg:cloud", on: PROC_MAIN },
        {
          run: "pnpm run db:load:transport-project-map:pg:cloud",
          on: PROC_MAIN,
        },
        {
          run: "pnpm run db:load:transport-facility-map:pg:cloud",
          on: PROC_MAIN,
        },
        { run: "pnpm run db:load:persons-browse:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:person-search:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:graph:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:agri-hub-stats:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:tr-company-place:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:employer-links:pg:cloud", on: PROC_MAIN },
        { run: "pnpm run db:load:grant-links:pg:cloud", on: PROC_MAIN },
        {
          run: "pnpm run db:load:procurement-scopes:pg:cloud",
          on: PROC_MAIN,
        },
        { run: "pnpm run db:load:cprs:pg:cloud", on: ["cprs_register"] },
        { run: "pnpm run db:load:ted:pg:cloud", on: ["ted_bg"] },
        { run: "pnpm run db:load:adfi:pg:cloud", on: ["adfi_inspections"] },
        { run: "pnpm run db:load:aop-experts:pg:cloud", on: ["aop_experts"] },
      ],
    },
    never: [
      "Re-seed a canary only on a CONFIRMED upstream change, never to make a run pass.",
      "Never pass --allow-shrink without finding out why the source shrank.",
    ],
    knownFailures: [
      {
        match: /canary/i,
        advice:
          "The АОП / ЦАИС feed changed shape: fix the parser and re-seed its fixture from the new upstream.",
      },
      {
        match: /Unrecogni[sz]ed\w*Error/,
        advice:
          "An OCDS label the parser does not know: add it to the label table — an unreadable label must throw, never map to a guess.",
      },
      {
        match: /\b403\b/,
        advice:
          "data.egov.bg answered 403: not a dead portal; the geo merge keeps the previous tier — re-run later.",
      },
    ],
    changelog: "orchestrator",
    followUps: [
      "funds-political-links",
      "textbook-market",
      "roads-hub-stats",
      "water-hub-stats",
      "transport-hub-stats",
      "edu-hub-stats",
      "health-hub-stats",
    ],
    outputs: [
      "data/procurement",
      "data/roads",
      "data/water",
      "data/transport",
      "data/education",
    ],
  },
  {
    id: "kzk_appeals",
    skill: "update-kzk-appeals",
    runner: "script",
    sources: ["kzk_appeals"],
    needs: ["pg-local", "headed", "egress:bg"],
    steps: [
      ingest("kzk_appeals", tsx("scripts/procurement/kzk_appeals.ts"), {
        args: (ctx) => ["--year", currentYear(ctx), "--apply"],
        timeoutMin: 60,
      }),
      verify("kzk:gates", KZK_INTAKE_GATES),
      derive("kzk:summary", pnpm("kzk:summary")),
    ],
    publish: {
      paths: ["procurement/derived/hub_stats.json"],
      cloud: [
        {
          run: (ctx) => `pnpm run kzk:appeals:cloud --year ${currentYear(ctx)}`,
        },
      ],
    },
    never: [
      "Never lower the kzk_baselines ratchet.",
      "Never overwrite a hand-seeded outcome (decision_act_no IS NULL).",
    ],
    gates: [
      outputLacks(
        "kzk-gates-armed",
        /\bDISARMED\b/,
        // Catches gates that announce through report_skip (stderr). Gates that
        // only console.warn are swallowed by vitest's reporter and stay
        // invisible here — a gap in those tests, not in this gate.
        "a disarmed data gate proves nothing — its input is missing",
      ),
    ],
    changelog: "orchestrator",
    followUps: ["procurement-hub-stats"],
    outputs: ["data/procurement"],
    notes:
      "kzk_appeals has no loader: publishing re-crawls against the cloud URL " +
      "(headed, BG egress). kzk:appeals:cloud applies 042 there first.",
  },
  {
    id: "kzk_decisions",
    skill: "update-kzk-appeals",
    runner: "script",
    sources: ["kzk_decisions"],
    needs: ["pg-local", "headed", "egress:bg"],
    after: ["kzk_appeals"],
    steps: [
      ingest("kzk:decisions", pnpm("kzk:decisions"), {
        args: (ctx) => ["--year", currentYear(ctx), "--apply"],
        timeoutMin: 60,
      }),
      derive("db:load:kzk-decisions:pg", pnpm("db:load:kzk-decisions:pg")),
      derive("kzk:rejoin", pnpm("kzk:rejoin", "--apply")),
      verify("kzk:gates", KZK_GATES),
      derive("kzk:summary", pnpm("kzk:summary")),
    ],
    publish: {
      paths: ["procurement/derived/hub_stats.json"],
      cloud: [
        "pnpm run db:load:kzk-decisions:pg:cloud",
        "pnpm run kzk:rejoin:cloud --apply",
      ],
    },
    never: [
      "Never lower the kzk_baselines ratchet.",
      "Never overwrite a hand-seeded outcome (decision_act_no IS NULL).",
    ],
    gates: [
      outputLacks(
        "kzk-gates-armed",
        /\bDISARMED\b/,
        // Catches gates that announce through report_skip (stderr). Gates that
        // only console.warn are swallowed by vitest's reporter and stay
        // invisible here — a gap in those tests, not in this gate.
        "a disarmed data gate proves nothing — its input is missing",
      ),
    ],
    changelog: "orchestrator",
    followUps: ["procurement-hub-stats"],
    outputs: ["data/procurement"],
  },
  {
    id: "mon_ri_register",
    skill: "update-procurement",
    runner: "skill",
    sources: ["mon_ri_register"],
    needs: ["pg-local", "headed"],
    steps: [
      ingest("mon_ri_crawl", tsx("scripts/procurement/mon_ri_crawl.ts"), {
        timeoutMin: 60,
      }),
      derive("awarder_geo_map", tsx("scripts/procurement/awarder_geo_map.ts")),
    ],
    agent: [
      {
        id: "mon-ri-current-value-chain",
        instruction:
          "After the crawl re-run the procurement current-value chain so the new awarder geo reaches the corpus.",
        doc: ".claude/skills/update-procurement/SKILL.md",
      },
    ],
    changelog: "orchestrator",
    outputs: ["data/procurement"],
  },
  {
    id: "procurement_scope_windows",
    runner: "script",
    sources: ["procurement_scope_windows"],
    needs: ["pg-local"],
    steps: [
      derive(
        "db:load:procurement-scopes:pg",
        pnpm("db:load:procurement-scopes:pg"),
      ),
    ],
    publish: { cloud: ["pnpm run db:load:procurement-scopes:pg:cloud"] },
    changelog: "none",
    outputs: [],
  },
  {
    id: "update-funds",
    skill: "update-funds",
    runner: "script",
    sources: [
      "isun_eu_funds",
      "isun_eu_funds_projects",
      "keep_eu_interreg",
      "isun_clean_delivery",
    ],
    needs: ["pg-local"],
    steps: [
      ingest("funds:ingest", pnpm("funds:ingest"), {
        on: ["isun_eu_funds"],
        timeoutMin: 60,
      }),
      ingest("funds:ingest-projects", pnpm("funds:ingest-projects"), {
        on: ["isun_eu_funds_projects"],
        timeoutMin: 90,
      }),
      derive("build_geo_pins", tsx("scripts/funds/build_geo_pins.ts"), {
        on: FUNDS_MAIN,
      }),
      derive("db:load:funds:pg", pnpm("db:load:funds:pg"), { on: FUNDS_MAIN }),
      derive("db:load:grant-links:pg", pnpm("db:load:grant-links:pg"), {
        on: FUNDS_MAIN,
      }),
      derive("db:load:funds-fit:pg", pnpm("db:load:funds-fit:pg"), {
        on: FUNDS_MAIN,
      }),
      verify("funds:parity", tsx("scripts/db/gen_funds/parity.ts", "--full"), {
        on: FUNDS_MAIN,
      }),
      // Crawl keep.eu, then ingest — unattended. The crawler is resumable by
      // design and `--auto` picks the ~2 h full walk only when the last one is
      // over 35 days old or incomplete (crawl.ts → autoFullReason). A crawl
      // keep.eu refuses exits 3: the ingest is skipped (corpus unchanged),
      // the publish is NOT held, and the next run retries.
      ingest("funds:interreg-auto", pnpm("funds:interreg-auto"), {
        on: ["keep_eu_interreg"],
        timeoutMin: 180,
        operatorExit: {
          codes: [3],
          instruction:
            "The keep.eu crawl failed; the Interreg corpus stays on its previous vintage and the next run retries automatically. If it keeps failing, probe with `pnpm run funds:crawl-interreg --index-only --max-pages 1`.",
          detail: /interreg-auto:|WARNING|Error/,
        },
      }),
      derive("db:load:place-dim:pg", pnpm("db:load:place-dim:pg"), {
        on: ["keep_eu_interreg"],
      }),
      derive("db:load:interreg:pg", pnpm("db:load:interreg:pg"), {
        on: ["keep_eu_interreg"],
      }),
      ingest("funds:clean-delivery", pnpm("funds:clean-delivery", "--fetch"), {
        on: ["isun_clean_delivery"],
      }),
      derive("db:load:clean-delivery:pg", pnpm("db:load:clean-delivery:pg"), {
        on: ["isun_clean_delivery"],
      }),
      // The local twins of the publish set below, in CLAUDE.md order
      // (persons-browse → person-search → graph → agri-hub-stats →
      // tr-company-place): without them local keeps the previous money basis
      // and graph.data.test.ts fails while cloud is current. graph is also
      // 127's only applier, so it re-runs after an Interreg load.
      derive("db:load:persons-browse:pg", pnpm("db:load:persons-browse:pg"), {
        on: FUNDS_MAIN,
      }),
      derive("db:load:person-search:pg", pnpm("db:load:person-search:pg"), {
        on: FUNDS_MAIN,
      }),
      derive("db:load:graph:pg", pnpm("db:load:graph:pg")),
      derive("db:load:agri-hub-stats:pg", pnpm("db:load:agri-hub-stats:pg"), {
        on: FUNDS_MAIN,
      }),
      derive(
        "db:load:tr-company-place:pg",
        pnpm("db:load:tr-company-place:pg"),
      ),
    ],
    publish: {
      cloud: [
        { run: "pnpm run db:load:funds:pg:cloud --full", on: FUNDS_MAIN },
        { run: "pnpm run db:load:funds-fit:pg:cloud", on: FUNDS_MAIN },
        { run: "pnpm run db:load:grant-links:pg:cloud", on: FUNDS_MAIN },
        { run: "pnpm run db:load:persons-browse:pg:cloud", on: FUNDS_MAIN },
        { run: "pnpm run db:load:person-search:pg:cloud", on: FUNDS_MAIN },
        { run: "pnpm run db:load:agri-hub-stats:pg:cloud", on: FUNDS_MAIN },
        {
          run: "pnpm run db:load:place-dim:pg:cloud",
          on: ["keep_eu_interreg"],
        },
        { run: "pnpm run db:load:interreg:pg:cloud", on: ["keep_eu_interreg"] },
        { run: "pnpm run db:load:graph:pg:cloud" },
        { run: "pnpm run db:load:tr-company-place:pg:cloud" },
        {
          run: "pnpm run db:load:clean-delivery:pg:cloud",
          on: ["isun_clean_delivery"],
        },
      ],
    },
    knownFailures: [
      {
        match: /Request Rejected/,
        advice:
          "The ИСУН F5 refused the client: it rejects node's TLS fingerprint and any Referer — fetch through curl without a Referer, or hand-download and pass --file.",
      },
    ],
    changelog: "orchestrator",
    followUps: [
      "roads-hub-stats",
      "water-hub-stats",
      "transport-hub-stats",
      "edu-hub-stats",
      "health-hub-stats",
    ],
    outputs: [
      "data/funds",
      "data/roads",
      "data/water",
      "data/transport",
      "data/education",
    ],
  },
  {
    id: "update-open-calls",
    skill: "update-open-calls",
    runner: "script",
    sources: [
      "isun_procedures",
      "sp2023_indicative",
      "interreg_calls",
      "ahu_calls",
    ],
    needs: ["pg-local"],
    steps: [
      ingest("opencalls:isun", pnpm("opencalls:isun"), {
        on: ["isun_procedures"],
      }),
      ingest("opencalls:sp2023", pnpm("opencalls:sp2023"), {
        on: ["sp2023_indicative"],
      }),
      ingest("opencalls:ahu", pnpm("opencalls:ahu"), { on: ["ahu_calls"] }),
      // АЗ has no watcher, so it rides every open-calls refresh.
      ingest("opencalls:az", pnpm("opencalls:az")),
      ingest("opencalls:interreg", pnpm("opencalls:interreg"), {
        on: ["interreg_calls"],
      }),
      derive("db:load:open-calls:pg", pnpm("db:load:open-calls:pg")),
      verify(
        "open_calls.data.test",
        "pnpm exec vitest run scripts/db/tests/open_calls.data.test.ts",
      ),
    ],
    publish: { cloud: ["pnpm run db:load:open-calls:pg:cloud"] },
    changelog: "orchestrator",
    outputs: ["data/opencalls"],
    notes:
      "Never runs enrich-open-calls — that is a separate, human-gated skill.",
  },
  {
    id: "update-agri",
    skill: "update-agri",
    // Still delegated — FINDING-016: a new egov year must be promoted by hand and there is no FY sanity gate yet.
    runner: "skill",
    sources: ["dfz_subsidies"],
    needs: ["pg-local"],
    steps: [
      // Non-fatal by design: an unreachable СЕУ falls back to the cached CSVs.
      ingest("agri:seu", pnpm("agri:seu"), { okExit: [1], timeoutMin: 60 }),
      ingest("agri:ingest", pnpm("agri:ingest"), { timeoutMin: 60 }),
      derive("db:load:agri-hub-stats:pg", pnpm("db:load:agri-hub-stats:pg")),
    ],
    operator: [
      {
        id: "agri-new-year-layout",
        instruction:
          "A new egov financial year: check the sheet header carries ЕИК (12-column layout) before promoting it in AGRI_YEAR_RESOURCES.",
        blocks: "nothing",
      },
    ],
    publish: {
      cloud: [
        "pnpm run db:load:agri:pg:cloud",
        "pnpm run db:load:agri-hub-stats:pg:cloud",
        "pnpm run db:load:persons-browse:pg:cloud",
        "pnpm run db:load:person-search:pg:cloud",
        "pnpm run db:load:graph:pg:cloud",
        "pnpm run db:load:tr-company-place:pg:cloud",
      ],
    },
    never: [
      "Never promote an 18-column СЕУ-layout year into AGRI_YEAR_RESOURCES — it carries no ЕИК.",
    ],
    changelog: "orchestrator",
    // The /sector/edu research arm reads agri_subsidies (ССА payouts).
    followUps: ["edu-hub-stats"],
    outputs: ["data/education"],
  },
  {
    id: "db-load-ngo-funding",
    runner: "script",
    sources: ["ec_fts"],
    needs: ["pg-local"],
    steps: [derive("db:load:ngo-funding:pg", pnpm("db:load:ngo-funding:pg"))],
    operator: [
      {
        id: "fts-xlsx-download",
        instruction:
          "Download the new {YEAR}_FTS_dataset_en.xlsx from the EC Financial Transparency System.",
        url: "https://ec.europa.eu/budget/financial-transparency-system/",
        dropDir: "raw_data/ngo_funding/fts",
        blocks: "handler",
        // The loader rebuilds the whole corpus from the files present: without
        // the new year's XLSX it truncates ngo_funding, so the FILE is the
        // proof, never an ack.
        done: (ctx) =>
          hasFtsYear(
            listDir("raw_data/ngo_funding/fts"),
            ctx.meta("ec_fts")?.latestYear,
          ),
      },
    ],
    publish: {
      paths: ["procurement/derived/hub_stats.json"],
      cloud: ["pnpm run db:load:ngo-funding:pg:cloud"],
    },
    changelog: "orchestrator",
    followUps: ["procurement-hub-stats"],
    outputs: ["data/procurement"],
  },
];
