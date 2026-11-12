// State budget, macro indicators, regional/municipal indicators, social funds.

import { currentYear, derive, ingest, pnpm, tsx, verify } from "../build";
import type { Handler } from "../types";

const KFP = [
  "egov_budget_execution",
  "ministry_execution_reports",
  "iisda_doklad",
  "minfin_program_otchet",
  "mfa_program_otchet",
  "budget_law",
  "dv_laws",
] as const;
const REVENUE = ["customs_revenue", "nap_annual"] as const;
const POLICY = [
  "eurostat_policy",
  "policy_baseline_local",
  "customs_revenue",
  "nap_annual",
] as const;

/** The five simulator anchors whose check is fully automatic: exit 0 stamps the
 *  marker itself, exit 1 means a curated constant drifted and a human edits it. */
const anchor = (source: string): Handler => ({
  id: source,
  runner: "script",
  stamp: "self",
  sources: [source],
  steps: [
    verify(
      "check_policy_anchors",
      tsx(
        "scripts/budget/check_policy_anchors.ts",
        "--source",
        source,
        "--stamp",
      ),
    ),
  ],
  changelog: "none",
  outputs: [],
});

export const BUDGET_MACRO: Handler[] = [
  {
    id: "update-budget",
    skill: "update-budget",
    runner: "skill",
    sources: [
      ...KFP,
      ...REVENUE,
      "eurostat_policy",
      "policy_baseline_local",
      "dv_investment_annex",
      "ipop_mrrb",
      "capital_programs",
      "egov_municipal_execution",
    ],
    needs: ["pg-local"],
    steps: [
      ingest("budget:ingest", pnpm("budget:ingest"), {
        on: KFP,
        timeoutMin: 60,
      }),
      derive(
        "write_fy2026_frame",
        tsx("scripts/budget/__write_fy2026_frame.ts"),
        { on: ["egov_budget_execution"] },
      ),
      ingest("budget:revenue-breakdown", pnpm("budget:revenue-breakdown"), {
        on: REVENUE,
      }),
      derive(
        "run_consumption_coicop",
        tsx("scripts/budget/run_consumption_coicop.ts"),
        { on: POLICY },
      ),
      derive(
        "run_policy_baseline",
        tsx("scripts/budget/run_policy_baseline.ts"),
        { on: POLICY },
      ),
      ingest(
        "municipal_execution",
        tsx("scripts/budget/municipal_execution/ingest.ts", "--all"),
        { on: ["egov_municipal_execution"], timeoutMin: 60 },
      ),
      // The parser reads a cached CSV and defaults to 2025: fetch today's
      // export first and name the year, or every flip re-parses a stale file.
      ingest("ipop:fetch", pnpm("ipop:fetch"), { on: ["ipop_mrrb"] }),
      ingest("ipop:ingest", tsx("scripts/budget/ipop/ingest.ts"), {
        on: ["ipop_mrrb"],
        args: (ctx) => ["--year", currentYear(ctx)],
      }),
      derive("db:load:budget:pg", pnpm("db:load:budget:pg")),
      derive("db:load:budget-muni:pg", pnpm("db:load:budget-muni:pg")),
      derive("db:load:budget-hub:pg", pnpm("db:load:budget-hub:pg")),
    ],
    operator: [
      {
        id: "budget-law-constants",
        on: ["budget_law", "dv_laws"],
        instruction:
          "A budget law was promulgated: resolve its idMat, edit scripts/budget/fetch_sources.ts and re-verify the statutory constants.",
        blocks: "nothing",
      },
      {
        id: "investment-annex-pdf",
        on: ["dv_investment_annex"],
        instruction:
          "Fetch the Приложение III PDF, add it to the SOURCES maps and run scripts/budget/investment_program/__write_program.ts.",
        blocks: "nothing",
      },
      {
        id: "capital-programmes",
        on: ["capital_programs"],
        instruction:
          "Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts.",
        blocks: "nothing",
      },
      {
        id: "revenue-new-year",
        on: REVENUE,
        instruction:
          "On a new report year: add the PDF URL to the catalogue and hand-refresh data/budget/agencies/{nap,customs}.json, then db:gen-sector-stats.",
        blocks: "nothing",
      },
      {
        id: "execution-report-catalogue",
        on: ["minfin_program_otchet", "mfa_program_otchet"],
        instruction:
          "Backfill the new programme report and extend EXECUTION_REPORTS (WAF-blocked PDFs need a browser download into raw_data/budget/).",
        blocks: "nothing",
      },
    ],
    publish: {
      paths: ["budget"],
      cloud: [
        "pnpm run db:load:place-dim:pg:cloud",
        "pnpm run db:load:budget:pg:cloud",
        "pnpm run db:load:budget-muni:pg:cloud",
        "pnpm run db:load:budget-hub:pg:cloud",
        "pnpm run db:load:agri-hub-stats:pg:cloud",
      ],
    },
    changelog: "orchestrator",
    followUps: ["sector-stats"],
    outputs: ["data/budget", "data/budget_laws.json"],
  },
  {
    id: "update-budget-municipal-fiscal",
    skill: "update-budget",
    runner: "skill",
    sources: ["municipal_fiscal_due"],
    needs: ["pg-local"],
    steps: [
      ingest(
        "municipal_fiscal:ingest",
        tsx("scripts/budget/municipal_fiscal/ingest.ts"),
      ),
      derive(
        "db:load:municipal-fiscal:pg",
        pnpm("db:load:municipal-fiscal:pg"),
      ),
      derive("macro:municipal-stocks", pnpm("macro:municipal-stocks")),
    ],
    operator: [
      {
        id: "minfin-fiscal-workbooks",
        instruction:
          "Download the quarter's МФ financial-indicator workbooks (Cloudflare Turnstile — a browser is required).",
        url: "https://www.minfin.bg/bg/810",
        dropDir: "data/_cache/minfin_municipal_fiscal",
        blocks: "handler",
      },
    ],
    publish: {
      paths: ["macro.json"],
      cloud: [
        "pnpm run db:load:place-dim:pg:cloud",
        "pnpm run db:load:municipal-fiscal:pg:cloud",
      ],
    },
    changelog: "orchestrator",
    outputs: ["data/budget/municipal_fiscal", "data/macro.json"],
  },
  anchor("eu_tax_rates"),
  anchor("eu_excise_rates"),
  anchor("eu_alcohol_excise"),
  anchor("nato_defence"),
  anchor("ec_forecast_bg"),
  {
    id: "update-macro",
    skill: "update-macro",
    runner: "skill",
    sources: [
      "eurostat",
      "ec_budget_per_ms",
      "worldbank_wgi",
      "transparency_cpi",
      "eurobarometer",
      "bnb_auctions",
      "minfin_eurobond",
      "bnb_fdi",
      "minfin_mreports",
      "eurostat_food_pli",
    ],
    steps: [
      ingest(
        "fetch_fiscal_reserve",
        tsx("scripts/macro/fetch_fiscal_reserve.ts"),
        { on: ["minfin_mreports"] },
      ),
      ingest("fetch_bnb_auctions", tsx("scripts/macro/fetch_bnb_auctions.ts"), {
        on: ["bnb_auctions"],
      }),
      ingest("fetch_bnb_fdi", tsx("scripts/macro/fetch_bnb_fdi.ts"), {
        on: ["bnb_fdi"],
      }),
      // The assembler: every other macro fetch feeds it, so it always runs.
      ingest("fetch_eurostat", tsx("scripts/macro/fetch_eurostat.ts"), {
        timeoutMin: 45,
      }),
      ingest("fetch_cofog", tsx("scripts/macro/fetch_cofog.ts"), {
        on: ["eurostat"],
      }),
      ingest("fetch_eu_peers", tsx("scripts/macro/fetch_eu_peers.ts"), {
        on: ["eurostat", "worldbank_wgi"],
        timeoutMin: 45,
      }),
      ingest("fetch_food_pli", tsx("scripts/macro/fetch_food_pli.ts"), {
        on: ["eurostat", "eurostat_food_pli"],
      }),
      derive("admin:build-context", pnpm("admin:build-context"), {
        on: ["eurostat"],
      }),
      // The SILC poverty-impact series (data/social) moves with eurostat.
      ingest(
        "social:poverty_impact",
        tsx("scripts/social/fetch_poverty_impact.ts"),
        { on: ["eurostat"] },
      ),
    ],
    operator: [
      {
        id: "ti-cpi-paste",
        on: ["transparency_cpi"],
        instruction:
          "Paste the new TI CPI {year, value} into the TI_CPI constant in scripts/macro/fetch_eurostat.ts.",
        blocks: "nothing",
      },
      {
        id: "eurobarometer-paste",
        on: ["eurobarometer"],
        instruction:
          "Read QA6 from the new Standard Eurobarometer and paste it into fetch_eurostat.ts.",
        blocks: "nothing",
      },
      {
        id: "ec-budget-per-ms",
        on: ["ec_budget_per_ms"],
        instruction:
          "Read the EC per-member-state XLSX and patch EU_FUNDS / EU_CONTRIBUTION.",
        blocks: "nothing",
      },
      {
        id: "eurobond-emission",
        on: ["minfin_eurobond"],
        instruction: "Hand-add the new emission to data/debt-emissions.json.",
        blocks: "nothing",
      },
    ],
    publish: {
      paths: [
        "macro.json",
        "macro_fdi.json",
        "macro_peers.json",
        "cofog.json",
        "debt-emissions.json",
        "debt-emissions-domestic.json",
        "administration",
        "social/poverty_impact.json",
      ],
    },
    changelog: "orchestrator",
    followUps: ["price-hub-payloads"],
    outputs: [
      "data/macro.json",
      "data/macro_fdi.json",
      "data/macro_peers.json",
      "data/cofog.json",
      "data/debt-emissions.json",
      "data/debt-emissions-domestic.json",
      "data/administration",
      "data/social/poverty_impact.json",
    ],
  },
  {
    id: "update-indicators",
    skill: "update-indicators",
    runner: "skill",
    sources: [
      "indicators_az",
      "indicators_mon_dzi",
      "indicators_nsi_pop",
      "indicators_nsi_vital",
    ],
    steps: [
      ingest("indicators:fetch", tsx("scripts/indicators/fetch.ts"), {
        timeoutMin: 45,
      }),
    ],
    operator: [
      {
        id: "indicator-name-aliases",
        instruction:
          "If the fetch reports unmatched municipalities, add them to scripts/indicators/sources/_name_aliases.json.",
        blocks: "nothing",
      },
    ],
    publish: { paths: ["indicators", "indicators.json"] },
    changelog: "orchestrator",
    outputs: ["data/indicators", "data/indicators.json"],
  },
  {
    id: "update-regional",
    skill: "update-regional",
    runner: "script",
    sources: ["eurostat_regional", "nsi_regional", "indicators_az"],
    // Reads the АЗ XLSX update-indicators caches.
    after: ["update-indicators"],
    steps: [
      ingest("regional:eurostat", tsx("scripts/regional/fetch_eurostat.ts")),
      ingest("regional:az", tsx("scripts/regional/fetch_az_oblast.ts")),
      ingest("regional:nsi", tsx("scripts/regional/fetch_nsi.ts")),
    ],
    publish: { paths: ["regional.json"] },
    changelog: "orchestrator",
    outputs: ["data/regional.json"],
  },
  {
    id: "update-schools",
    skill: "update-schools",
    runner: "script",
    sources: ["indicators_mon_dzi", "indicators_mon_nvo"],
    needs: ["pg-local"],
    // The ДЗИ CSVs come from update-indicators.
    after: ["update-indicators"],
    steps: [
      ingest("schools:fetch_nvo", tsx("scripts/schools/fetch_nvo.ts")),
      derive("schools:build_index", tsx("scripts/schools/build_index.ts")),
      derive("schools:match_eik", tsx("scripts/schools/match_eik.ts")),
      derive(
        "gen_school_context",
        tsx("scripts/education/gen_school_context.ts"),
      ),
      derive(
        "gen_textbook_market",
        tsx("scripts/education/gen_textbook_market.ts"),
      ),
      derive("db:load:schools:pg", pnpm("db:load:schools:pg")),
    ],
    publish: {
      paths: ["schools", "education"],
      cloud: ["pnpm run db:load:schools:pg:cloud"],
    },
    changelog: "orchestrator",
    outputs: ["data/schools", "data/education"],
  },
  {
    id: "update-administration",
    skill: "update-administration",
    runner: "script",
    sources: [
      "iisda_services",
      "eurostat_egov",
      "eurostat_digital_skills",
      "iisda_doklad",
    ],
    needs: ["pg-local"],
    // parse_service_quality reads the Доклад text update-budget caches.
    after: ["update-budget", "update-macro"],
    steps: [
      ingest("admin:fetch_egov", tsx("scripts/administration/fetch_egov.ts")),
      ingest(
        "admin:fetch_digital_skills",
        tsx("scripts/administration/fetch_digital_skills.ts"),
      ),
      ingest(
        "admin:fetch_services",
        tsx("scripts/administration/fetch_services.ts"),
      ),
      derive(
        "admin:parse_service_quality",
        tsx("scripts/administration/parse_service_quality.ts"),
      ),
      derive("admin:build-context", pnpm("admin:build-context")),
      derive("db:load:admin-services:pg", pnpm("db:load:admin-services:pg")),
      ingest("admin:eforms", pnpm("admin:eforms")),
      derive(
        "db:load:admin-service-requests:pg",
        pnpm("db:load:admin-service-requests:pg"),
      ),
    ],
    publish: {
      paths: ["administration"],
      cloud: [
        "pnpm run db:load:admin-services:pg:cloud",
        "pnpm run db:load:admin-service-requests:pg:cloud",
      ],
    },
    changelog: "orchestrator",
    outputs: ["data/administration"],
  },
  {
    id: "update-social",
    skill: "update-social",
    runner: "skill",
    // `eurostat` is NOT a source here: it moves almost daily, and routing it
    // would re-queue this whole handler every night. Its SILC step rides
    // update-macro instead (the shadow run against the LLM trace found this).
    sources: ["asp_benefits", "git_inspections"],
    steps: [
      verify("social:asp", tsx("scripts/social/fetch_asp_benefits.ts"), {
        on: ["asp_benefits"],
        needs: ["egress:bg"],
      }),
      verify("social:git", tsx("scripts/social/fetch_git_inspections.ts"), {
        on: ["git_inspections"],
        needs: ["egress:bg"],
      }),
    ],
    operator: [
      {
        id: "social-curated-drift",
        on: ["asp_benefits", "git_inspections"],
        instruction:
          "The verifier flagged a curated figure: read the source PDF and edit data/social/*.json (or fix the regex on a ⚠).",
        blocks: "nothing",
      },
    ],
    publish: { paths: ["social"] },
    changelog: "orchestrator",
    outputs: ["data/social"],
  },
  {
    id: "update-noi",
    skill: "update-noi",
    runner: "skill",
    sources: ["nssi_b1", "nssi_yearbook", "kfn_pensions"],
    steps: [
      ingest(
        "noi:write_funds",
        tsx("scripts/budget/noi/__write_funds.ts", "--fetch"),
        { on: ["nssi_b1"] },
      ),
      derive("noi:pensioners-by-tp", pnpm("noi:pensioners-by-tp"), {
        on: ["nssi_yearbook"],
      }),
    ],
    agent: [
      {
        id: "noi-yearbook-and-kfn",
        on: ["nssi_yearbook", "kfn_pensions"],
        instruction:
          "Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, then run the matching __write_*.ts.",
        doc: ".claude/skills/update-noi/SKILL.md",
      },
    ],
    publish: { paths: ["budget"] },
    changelog: "orchestrator",
    outputs: ["data/budget/noi", "data/budget/kfn"],
  },
  {
    id: "update-nzok",
    skill: "update-nzok",
    runner: "skill",
    sources: [
      "nzok_hospital_bmp",
      "nzok_drug_quarterly",
      "nzok_drug_unit_prices",
      "nzok_execution_b1",
      "mh_eeof_quarterly",
      "nzok_activities",
      "nzok_nrd_tariffs",
    ],
    needs: ["pg-local"],
    steps: [
      ingest("data:nzok --hospitals", pnpm("data:nzok", "--hospitals"), {
        on: ["nzok_hospital_bmp"],
      }),
      derive("db:load:nzok-hospital:pg", pnpm("db:load:nzok-hospital:pg"), {
        on: ["nzok_hospital_bmp"],
      }),
      derive(
        "db:load:nzok-hospital-map:pg",
        pnpm("db:load:nzok-hospital-map:pg"),
        { on: ["nzok_hospital_bmp"] },
      ),
      ingest("data:nzok --drugs", pnpm("data:nzok", "--drugs"), {
        on: ["nzok_drug_quarterly"],
      }),
      derive(
        "db:load:nzok-drug-quarterly:pg",
        pnpm("db:load:nzok-drug-quarterly:pg"),
        { on: ["nzok_drug_quarterly"] },
      ),
      ingest("data:nzok --execution", pnpm("data:nzok", "--execution"), {
        on: ["nzok_execution_b1"],
      }),
      ingest("data:nzok --drug-prices", pnpm("data:nzok", "--drug-prices"), {
        on: ["nzok_drug_unit_prices"],
      }),
      derive(
        "db:load:nzok-drug-prices:pg",
        pnpm("db:load:nzok-drug-prices:pg"),
        { on: ["nzok_drug_unit_prices"] },
      ),
      ingest("data:nzok --eeof", pnpm("data:nzok", "--eeof"), {
        on: ["mh_eeof_quarterly"],
      }),
      derive("db:load:nzok-financials:pg", pnpm("db:load:nzok-financials:pg"), {
        on: ["mh_eeof_quarterly"],
      }),
      ingest("data:nzok --activities", pnpm("data:nzok", "--activities"), {
        on: ["nzok_activities"],
      }),
      derive("db:load:nzok-activities:pg", pnpm("db:load:nzok-activities:pg"), {
        on: ["nzok_activities"],
      }),
    ],
    operator: [
      {
        id: "nzok-nrd-tariffs",
        on: ["nzok_nrd_tariffs"],
        instruction:
          "A new НРД/amendment PDF: run write_pathway_tariffs.ts with --dump, check the parse by hand, then db:load:nzok-tariffs:pg.",
        blocks: "nothing",
      },
    ],
    publish: {
      paths: ["budget", "data-changes.json"],
      cloud: [
        {
          run: "pnpm run db:load:nzok-hospital:pg:cloud",
          on: ["nzok_hospital_bmp"],
        },
        {
          run: "pnpm run db:load:nzok-hospital-map:pg:cloud",
          on: ["nzok_hospital_bmp"],
        },
        {
          run: "pnpm run db:load:nzok-drug-quarterly:pg:cloud",
          on: ["nzok_drug_quarterly"],
        },
        {
          run: "pnpm run db:load:nzok-drug-prices:pg:cloud",
          on: ["nzok_drug_unit_prices"],
        },
        {
          run: "pnpm run db:load:nzok-financials:pg:cloud",
          on: ["mh_eeof_quarterly"],
        },
        {
          run: "pnpm run db:load:nzok-activities:pg:cloud",
          on: ["nzok_activities"],
        },
        {
          run: "pnpm run db:load:nzok-tariffs:pg:cloud",
          on: ["nzok_nrd_tariffs"],
        },
      ],
    },
    changelog: "self",
    outputs: ["data/budget/nzok", "data/data-changes.json"],
  },
];
