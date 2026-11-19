// Sector packs, elections, local data, prices, and the small single-command
// sources. The purely manual sources live at the foot of this file.

import { derive, ingest, pnpm, scopeList, tsx, verify } from "../build";
import { at, jsonNumber, len, noShrink, outputLacks } from "../gates";
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
    runner: "script",
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
    // `data --erik --financing` writes data/<election>/parties/**: tracked
    // AND bucket-served. The runner commits the files there this run wrote.
    publish: { paths: ["financing"], dirsMatching: /^\d{4}_\d{2}_\d{2}$/ },
    never: [
      "Never lower minimumYears — a missing year is a parser or register change to fix.",
    ],
    changelog: "orchestrator",
    outputs: ["data/financing"],
  },
  {
    id: "update-judiciary",
    skill: "update-judiciary",
    // Still delegated — FINDING-013: the high-value spot-check against the source PDFs is mandatory before commit.
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
    runner: "script",
    sources: ["nato_defexp", "mod_defense_report", "moe_arms_exports"],
    steps: [
      // __write_nato.ts shells out to `pdftotext -layout`.
      ingest("defense:write_nato", tsx("scripts/defense/__write_nato.ts"), {
        on: ["nato_defexp"],
        needs: ["bin:pdftotext"],
      }),
    ],
    operator: [
      {
        id: "arms-exports-read",
        on: ["moe_arms_exports"],
        instruction:
          "Read the Ministry of Economy export-control report and hand-edit data/defense/exports.json.",
        blocks: "arm",
      },
      {
        id: "defense-readiness-read",
        on: ["mod_defense_report"],
        instruction:
          "pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json.",
        blocks: "arm",
      },
    ],
    publish: { paths: ["defense"] },
    changelog: "orchestrator",
    outputs: ["data/defense"],
  },
  {
    id: "update-culture",
    skill: "update-culture",
    // Still delegated — FINDING-010: the NFC_FILES year map is hand-kept and the ingest re-parses cached files.
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
        blocks: "arm",
      },
      {
        id: "nfc-commissions-transcribe",
        on: ["nfc_commissions"],
        instruction:
          "Read the order PDF, hand-edit the 21 members and the mandate window, run scripts/culture/write_commissions.ts.",
        blocks: "arm",
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
    gates: [
      outputLacks(
        "culture-eik-linking",
        /producer→EIK linking SKIPPED/,
        "films kept the previous EIKs — Postgres was not reachable",
        ["nfc_film_register"],
      ),
      noShrink(
        "culture-films",
        "data/culture/films.json",
        (j) => len(at(j, "films")),
        2,
        ["nfc_film_register"],
      ),
    ],
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
    runner: "script",
    sources: ["nsi_landuse"],
    steps: [ingest("landuse:fetch", tsx("scripts/landuse/fetch.ts"))],
    // Runbook: 28 oblasts, and the national category percentages sum to
    // 100 ± 0.05 (a column shift breaks the sum before anything else).
    gates: [
      jsonNumber(
        "landuse-oblasts",
        "data/landuse/index.json",
        (j) => len(at(j, "years", String(at(j, "latestYear")), "oblasts")),
        { eq: 28 },
      ),
      jsonNumber(
        "landuse-national-pct-sum",
        "data/landuse/index.json",
        (j) => {
          const pct = at(
            j,
            "years",
            String(at(j, "latestYear")),
            "national",
            "byCategoryPct",
          );
          const sum = Object.values(pct as Record<string, number>).reduce(
            (a, b) => a + b,
            0,
          );
          return Math.round(sum * 100) / 100;
        },
        { min: 99.95, max: 100.05 },
      ),
    ],
    operator: [
      {
        id: "landuse-report-url",
        instruction:
          "Find the new land-use PDF URL on nsi.bg and append it to LANDUSE_REPORTS in scripts/landuse/sources.ts. For a same-year CORRECTION instead, re-run `pnpm exec tsx scripts/landuse/fetch.ts --refresh` first (without it the cached PDF is re-parsed). Then ack.",
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
    // Runbook: "~5,106 settlements"; a sharp drop means the table layout moved.
    gates: [
      jsonNumber(
        "grao-settlements",
        "data/grao_population.json",
        (j) => len(at(j, "settlements")),
        { min: 4900, max: 5400 },
      ),
      noShrink(
        "grao-no-shrink",
        "data/grao_population.json",
        (j) => len(at(j, "settlements")),
        2,
      ),
    ],
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
    // Runbook: 30–45 município stations; fewer means station-prefix aliases rotted.
    gates: [
      jsonNumber(
        "air-stations",
        "data/air/index.json",
        (j) => len(at(j, "stations")),
        { min: 30, max: 45 },
      ),
    ],
    publish: { paths: ["air"] },
    changelog: "orchestrator",
    outputs: ["data/air", "raw_data/air/iaos"],
  },
  {
    id: "update-transparency-lisi",
    skill: "update-transparency-lisi",
    // Still delegated — FINDING-018: unmatched names pass and the hand-edited script must be committed.
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
    // Runbook: every indicator ranks all 265 municipalities. `rankTotals` is
    // what the build computed, unlike `indicators`, which is a constant the
    // script copies into the file and so can never fail.
    gates: [
      jsonNumber(
        "local-taxes-ranked-everywhere",
        "data/local_taxes/index.json",
        (j) =>
          Math.min(
            ...Object.values(at(j, "rankTotals") as Record<string, number>),
          ),
        { eq: 265 },
        ["ipi_local_taxes"],
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
    needs: ["headed", "reach:gov-hosts"],
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
    needs: ["headed", "reach:gov-hosts"],
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
    runner: "script",
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
    knownFailures: [
      {
        match: /refus\w* to (?:prune|shrink)/,
        advice:
          "A município lost protocols: find out why (recipe rot, an IP block — curl first) before any scoped --allow-prune / --allow-shrink.",
      },
      {
        match: /attribution/i,
        advice:
          "Attribution fell below the floor: the councillor-name folds have drifted (councilNameKey must be the only fold).",
      },
    ],
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
