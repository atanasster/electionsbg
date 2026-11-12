// Sector packs, elections, local data, prices, and the small single-command
// sources. The purely manual sources live at the foot of this file.

import { derive, ingest, pnpm, scopeList, tsx, verify } from "../build";
import type { Handler } from "../types";

/** A source that maps to exactly one fetch script and one bucket path. */
const single = (
  source: string,
  script: string,
  paths: string[],
  extra: Partial<Handler> = {},
): Handler => ({
  id: source,
  runner: "script",
  sources: [source],
  steps: [ingest(source, tsx(script))],
  publish: { paths },
  changelog: "orchestrator",
  outputs: paths.map((p) => `data/${p}`),
  ...extra,
});

/** A source nothing can ingest: a human edits a file, then acks the marker. */
const manual = (source: string, instruction: string): Handler => ({
  id: source,
  runner: "operator",
  sources: [source],
  steps: [],
  operator: [{ id: `${source}-manual`, instruction, blocks: "handler" }],
  changelog: "none",
  outputs: [],
});

export const SECTORS_LOCAL: Handler[] = [
  {
    id: "update-financing",
    skill: "update-financing",
    runner: "skill",
    sources: ["smetna_palata", "financing_reports", "erik_campaign_financing"],
    steps: [
      ingest(
        "financing:scrape_index",
        tsx("scripts/financing/scrape_index.ts"),
        {
          on: ["smetna_palata", "financing_reports"],
        },
      ),
      ingest(
        "financing:scrape_reports",
        tsx("scripts/financing/scrape_reports.ts"),
        { on: ["financing_reports"], timeoutMin: 60 },
      ),
      ingest("data:erik", pnpm("data", "--erik", "--financing"), {
        on: ["erik_campaign_financing"],
        timeoutMin: 60,
      }),
    ],
    operator: [
      {
        id: "erik-party-overrides",
        on: ["erik_campaign_financing"],
        instruction:
          "On an unreconciled participant add a PARTY_OVERRIDES entry; on a new election append it to ERIK_ELECTIONS.",
        blocks: "nothing",
      },
    ],
    publish: { paths: ["financing"] },
    changelog: "orchestrator",
    outputs: ["data/financing"],
  },
  {
    id: "update-judiciary",
    skill: "update-judiciary",
    runner: "skill",
    sources: ["vss_court_statistics", "ivss_declarations"],
    needs: ["pg-local"],
    steps: [
      ingest(
        "judiciary:write_caseload",
        tsx("scripts/judiciary/__write_caseload.ts"),
        { on: ["vss_court_statistics"] },
      ),
      derive(
        "judiciary:write_court_load",
        tsx("scripts/judiciary/__write_court_load.ts"),
        { on: ["vss_court_statistics"] },
      ),
      ingest(
        "judiciary:write_declarations",
        tsx("scripts/judiciary/__write_declarations.ts"),
        { on: ["ivss_declarations"], timeoutMin: 60 },
      ),
      ingest(
        "judiciary:write_magistrate_holdings",
        tsx("scripts/judiciary/__write_magistrate_holdings.ts"),
        { on: ["ivss_declarations"], needs: ["tr-state"], timeoutMin: 45 },
      ),
      derive(
        "db:load:judiciary-payloads:pg",
        pnpm("db:load:judiciary-payloads:pg"),
      ),
      derive("db:load:court-load:pg", pnpm("db:load:court-load:pg")),
      derive("db:load:magistrates:pg", pnpm("db:load:magistrates:pg")),
      derive(
        "db:load:magistrate-filing-assets:pg",
        pnpm("db:load:magistrate-filing-assets:pg"),
      ),
      derive("db:load:judicial-bodies:pg", pnpm("db:load:judicial-bodies:pg")),
    ],
    operator: [
      {
        id: "vss-annual-table-url",
        on: ["vss_court_statistics"],
        instruction:
          "Add the new ВСС annual table PDF URL to VSS_ANNUAL_TABLES in scripts/judiciary/sources.ts.",
        blocks: "arm",
      },
      {
        id: "ivss-diff-review",
        on: ["ivss_declarations"],
        instruction:
          "Read the diff of the integrity lists and spot-check the top bank_cash_lv values against the source PDFs before publishing.",
        blocks: "nothing",
      },
    ],
    publish: {
      paths: ["judiciary"],
      cloud: [
        "pnpm run db:load:judiciary-payloads:pg:cloud",
        "pnpm run db:load:court-load:pg:cloud",
        "pnpm run db:load:magistrates:pg:cloud",
        "pnpm run db:load:magistrate-filing-assets:pg:cloud",
        "pnpm run db:load:judicial-bodies:pg:cloud",
      ],
    },
    changelog: "orchestrator",
    outputs: ["data/judiciary"],
  },
  {
    id: "update-defense",
    skill: "update-defense",
    runner: "skill",
    sources: ["nato_defexp", "mod_defense_report", "moe_arms_exports"],
    steps: [
      ingest("defense:write_nato", tsx("scripts/defense/__write_nato.ts"), {
        on: ["nato_defexp"],
      }),
    ],
    operator: [
      {
        id: "arms-exports-read",
        on: ["moe_arms_exports"],
        instruction:
          "Read the Ministry of Economy export-control report and hand-edit data/defense/exports.json.",
        blocks: "nothing",
      },
      {
        id: "defense-readiness-read",
        on: ["mod_defense_report"],
        instruction:
          "pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json.",
        blocks: "nothing",
      },
    ],
    publish: { paths: ["defense"] },
    changelog: "orchestrator",
    outputs: ["data/defense"],
  },
  {
    id: "update-culture",
    skill: "update-culture",
    runner: "skill",
    sources: [
      "nfc_film_register",
      "ncf_grant_results",
      "nfc_commissions",
      "mc_dki_register",
    ],
    // Without Postgres the film ingest succeeds but carries old EIKs forward.
    needs: ["pg-local"],
    steps: [
      ingest("culture:ingest", tsx("scripts/culture/ingest.ts"), {
        on: ["nfc_film_register"],
      }),
      ingest("culture:dki", pnpm("culture:dki", "--apply"), {
        on: ["mc_dki_register"],
      }),
      verify("culture:dki:tests", "pnpm exec vitest run scripts/culture/dki/", {
        on: ["mc_dki_register"],
      }),
    ],
    operator: [
      {
        id: "ncf-grant-results-url",
        on: ["ncf_grant_results"],
        instruction:
          "Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.",
        blocks: "nothing",
      },
      {
        id: "nfc-commissions-transcribe",
        on: ["nfc_commissions"],
        instruction:
          "Read the order PDF, hand-edit the 21 members and the mandate window, run scripts/culture/write_commissions.ts.",
        blocks: "nothing",
      },
      {
        id: "dki-reconciliation-ruling",
        on: ["mc_dki_register"],
        instruction:
          "If the ДКИ reconciliation gate reports a difference, rule on it against the four-list allowlist.",
        blocks: "nothing",
      },
    ],
    publish: { paths: ["culture"] },
    changelog: "orchestrator",
    followUps: ["culture-hub-stats"],
    outputs: ["data/culture"],
  },
  {
    id: "update-energy",
    skill: "update-energy",
    runner: "script",
    sources: ["ember_generation", "eurostat_energy_prices"],
    steps: [
      ingest("energy:generation", tsx("scripts/energy/fetch_generation.ts"), {
        on: ["ember_generation"],
      }),
      ingest("energy:prices", tsx("scripts/energy/fetch_prices.ts"), {
        on: ["eurostat_energy_prices"],
      }),
    ],
    publish: { paths: ["energy"] },
    changelog: "orchestrator",
    followUps: ["price-hub-payloads"],
    outputs: ["data/energy"],
  },
  {
    id: "update-landuse",
    skill: "update-landuse",
    runner: "skill",
    sources: ["nsi_landuse"],
    steps: [ingest("landuse:fetch", tsx("scripts/landuse/fetch.ts"))],
    operator: [
      {
        id: "landuse-report-url",
        instruction:
          "Find the new land-use PDF URL on nsi.bg and append it to LANDUSE_REPORTS in scripts/landuse/sources.ts.",
        blocks: "handler",
      },
    ],
    publish: { paths: ["landuse"] },
    changelog: "orchestrator",
    outputs: ["data/landuse"],
  },
  {
    id: "update-grao",
    skill: "update-grao",
    runner: "script",
    sources: ["grao"],
    steps: [ingest("grao:fetch", tsx("scripts/grao/fetch.ts"))],
    publish: { paths: ["grao", "grao_population.json"] },
    changelog: "orchestrator",
    outputs: ["data/grao", "data/grao_population.json"],
  },
  {
    id: "update-municipal-contacts",
    skill: "update-municipal-contacts",
    runner: "script",
    sources: ["iisda_mayors"],
    steps: [
      ingest(
        "scrape_iisda",
        tsx("scripts/officials/municipal_contacts/scrape_iisda.ts"),
        { timeoutMin: 45 },
      ),
    ],
    publish: { paths: ["officials"] },
    changelog: "orchestrator",
    outputs: ["data/officials"],
  },
  {
    id: "update-air-quality",
    skill: "update-air-quality",
    runner: "script",
    sources: ["iaos_air_quality"],
    steps: [ingest("air:build_index", tsx("scripts/air/build_index.ts"))],
    publish: { paths: ["air"] },
    changelog: "orchestrator",
    outputs: ["data/air", "raw_data/air/iaos"],
  },
  {
    id: "update-transparency-lisi",
    skill: "update-transparency-lisi",
    runner: "skill",
    sources: ["ti_bg_lisi"],
    steps: [derive("build_lisi", tsx("scripts/transparency/build_lisi.ts"))],
    operator: [
      {
        id: "lisi-scores-paste",
        instruction:
          "Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts.",
        url: "https://lisi.transparency.bg/",
        blocks: "handler",
      },
    ],
    publish: { paths: ["municipal_transparency"] },
    changelog: "orchestrator",
    outputs: ["data/municipal_transparency"],
  },
  {
    id: "update-local-taxes",
    skill: "update-local-taxes",
    runner: "script",
    sources: ["ipi_local_taxes", "municipal_naredba"],
    steps: [
      ingest(
        "local_taxes:build_index",
        tsx("scripts/local_taxes/build_index.ts"),
        { on: ["ipi_local_taxes"] },
      ),
      ingest(
        "local_taxes:run_naredba",
        tsx("scripts/local_taxes/run_naredba.ts"),
        {
          on: ["municipal_naredba"],
          args: (ctx) => {
            const codes = scopeList(ctx, "municipal_naredba", "obshtini");
            return codes ? [codes.join(",")] : null;
          },
        },
      ),
    ],
    publish: { paths: ["local_taxes"] },
    changelog: "orchestrator",
    outputs: ["data/local_taxes"],
  },
  {
    id: "update-local-elections",
    marker: "cik_local",
    skill: "update-local-elections",
    runner: "skill",
    stamp: "self",
    sources: ["cik_results"],
    needs: ["headed", "egress:non-bg"],
    steps: [
      ingest("data:local-ingest", pnpm("data"), {
        args: (ctx) => {
          const cycles = scopeList(ctx, "cik_results", "cycles");
          return cycles ? cycles.flatMap((c) => ["--local-ingest", c]) : null;
        },
        timeoutMin: 120,
      }),
      derive(
        "backfill_kmetstvo_ekatte",
        tsx("scripts/parsers_local/backfill_kmetstvo_ekatte.ts"),
      ),
      derive(
        "decorate_local_mp_links",
        tsx("scripts/parsers_local/decorate_local_mp_links.ts"),
      ),
      derive("data:local-coords", pnpm("data", "--local-coords")),
      derive(
        "data:local-problem-sections",
        pnpm("data", "--local-problem-sections"),
      ),
      // Flag-gated and outside `--all`: without them the cross-cycle trees
      // never gain the new cycle.
      derive("data:local-place-trends", pnpm("data", "--local-place-trends")),
      derive("data:prevote-flows", pnpm("data", "--prevote-flows")),
      derive("data:local-flows", pnpm("data", "--local-flows")),
    ],
    operator: [
      {
        id: "local-coalition-overrides",
        instruction:
          "If data/<cycle>/_unmatched_coalitions.json is non-empty, add the coalitions to local_coalition_overrides.ts and re-parse.",
        blocks: "nothing",
      },
    ],
    publish: {
      paths: [
        "local_chmi_history.json",
        "chmi_history",
        "local_place_trends",
        "local_mayors",
        "transitions_prevote",
        "transitions_local",
      ],
      // The per-cycle bundles are gitignored and bucket-only.
      dirsMatching: /^\d{4}_\d{2}_\d{2}_(mi|chmi|chmi_nov)$/,
    },
    changelog: "orchestrator",
    outputs: [
      "data/local_mayors",
      "data/transitions_prevote",
      "data/transitions_local",
    ],
  },
  {
    id: "update-presidential-elections",
    skill: "update-presidential-elections",
    runner: "skill",
    stamp: "self",
    sources: ["cik_presidential"],
    needs: ["headed", "egress:non-bg"],
    steps: [
      ingest("data:pvr-download", pnpm("data"), {
        args: (ctx) => {
          const cycles = scopeList(ctx, "cik_presidential", "cycles");
          return cycles ? cycles.flatMap((c) => ["--pvr-download", c]) : null;
        },
        timeoutMin: 60,
      }),
      derive(
        "pvr:build_catalogue",
        tsx("scripts/parsers_presidential/build_catalogue.ts", "--write"),
      ),
      ingest("data:pvr", pnpm("data"), {
        args: (ctx) => {
          const cycles = scopeList(ctx, "cik_presidential", "cycles");
          return cycles ? cycles.flatMap((c) => ["--pvr", c]) : null;
        },
        timeoutMin: 60,
      }),
      derive("elections:surfaces", pnpm("elections:surfaces", "--write")),
      derive("data:presidential-flows", pnpm("data", "--presidential-flows")),
      derive("sitemap", pnpm("sitemap")),
    ],
    operator: [
      {
        id: "pvr-new-cycle-urls",
        instruction:
          "For a NEW cycle: confirm the archive URLs in a browser and add them to PRESIDENTIAL_SOURCES.",
        blocks: "nothing",
      },
    ],
    publish: {
      paths: ["transitions_presidential", "presidential"],
      dirsMatching: /^\d{4}_\d{2}_\d{2}_pvr$/,
      cloud: ["pnpm run db:load:election-national:pg:cloud"],
    },
    changelog: "orchestrator",
    outputs: ["data/transitions_presidential", "data/presidential"],
  },
  {
    id: "update-prices",
    skill: "update-prices",
    runner: "script",
    sources: ["kzp_prices"],
    needs: ["pg-local", "drive:prices"],
    steps: [ingest("prices", pnpm("prices"), { timeoutMin: 90 })],
    publish: { cloud: ["pnpm run prices:ingest:cloud"] },
    changelog: "self",
    outputs: ["data/prices/product_slugs.json", "data/data-changes.json"],
  },
  {
    id: "update-council-minutes",
    skill: "update-council-minutes",
    runner: "skill",
    sources: ["council_minutes"],
    needs: ["pg-local", "bin:pdftotext", "bin:unzip"],
    // The loader re-attaches council_vote.person_id, so it follows a resolve.
    after: ["update-persons"],
    steps: [
      ingest("council:scrape", pnpm("council:scrape", "--per-councillor"), {
        timeoutMin: 90,
      }),
      derive("db:load:council:pg", pnpm("db:load:council:pg")),
      verify(
        "council:index_corpus.test",
        "pnpm exec vitest run scripts/council/lib/index_corpus.test.ts",
      ),
    ],
    publish: { cloud: ["pnpm run db:load:council:pg:cloud"] },
    changelog: "orchestrator",
    outputs: ["data/council", "state/ingest"],
  },

  // ---- single-command sources -------------------------------------------
  {
    id: "customs_excise_register",
    runner: "script",
    sources: ["customs_excise_register"],
    needs: ["pg-local"],
    steps: [
      ingest("customs:excise-register", pnpm("customs:excise-register")),
      derive(
        "db:load:excise-warehouses:pg",
        pnpm("db:load:excise-warehouses:pg"),
      ),
    ],
    publish: {
      paths: ["customs"],
      cloud: ["pnpm run db:load:excise-warehouses:pg:cloud"],
    },
    changelog: "orchestrator",
    outputs: ["data/customs"],
  },
  {
    id: "nsi_water_stats",
    runner: "script",
    sources: ["nsi_water_stats"],
    needs: ["pg-local"],
    // `--refresh` is mandatory: the cache wins otherwise and the run is a no-op.
    steps: [ingest("water:stats", pnpm("water:stats", "--refresh"))],
    publish: { paths: ["water"] },
    changelog: "orchestrator",
    followUps: ["water-hub-stats"],
    outputs: ["data/water"],
  },
  single("eurostat_road_safety", "scripts/security/fetch_road_safety.ts", [
    "security",
  ]),
  single("eurostat_rail", "scripts/transport/fetch_rail_ridership.ts", [
    "transport",
  ]),
  // One script serves both the monthly and the annual source, so one handler:
  // when both flip it runs once.
  single(
    "eurostat_tourism",
    "scripts/tourism/fetch_eurostat_tourism.ts",
    ["tourism"],
    { sources: ["eurostat_tourism", "eurostat_tourism_annual"] },
  ),
  single("eurostat_env", "scripts/environment/fetch_waste.ts", ["environment"]),
  single(
    "ec_oil_bulletin",
    "scripts/consumption/fetch_fuel.ts",
    ["fuel.json"],
    {
      changelog: "self",
      followUps: ["price-hub-payloads"],
      outputs: ["data/fuel.json", "data/data-changes.json"],
    },
  ),

  // ---- manual: a human edits something, then acks ------------------------
  manual(
    "wiki_governments",
    "A cabinet changed: edit data/governments.json by hand.",
  ),
  manual(
    "oecd_pit_params",
    "OECD PIT parameters moved: review the simulator anchors and edit the curated constants.",
  ),
  manual(
    "oecd_family_leave",
    "OECD family-leave table moved: review the simulator anchors and edit the curated constants.",
  ),
  manual(
    "nsi_edp",
    "A new NSI EDP notification: re-check the deficit/debt constants it backs.",
  ),
  manual(
    "ec_vat_gap",
    "A new EC VAT-gap report: update the curated VAT-gap figure.",
  ),
  manual(
    "imf_weo_bg",
    "A new IMF WEO vintage: update the curated forecast rows.",
  ),
  manual(
    "fiscal_council_bg",
    "A new Fiscal Council opinion: check whether any simulator lever is affected.",
  ),
  manual(
    "api_road_charges",
    "АПИ road-charge tariffs moved: update the curated tariff table.",
  ),
  manual(
    "rnfl_insolvency",
    "The natural-person insolvency register moved: decide whether to ingest (privacy review).",
  ),
];
