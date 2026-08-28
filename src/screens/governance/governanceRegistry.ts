// The top-level /governance hub registry — the single source of truth for the
// curated list of sub-hubs shown on the Управление front door (GovernanceScreen).
// Mirrors sectorRegistry.ts: pure data, the scene is referenced by `id`
// (GOV_HUB_SCENES[id]), so this module carries no JSX.
//
// These are SUB-HUB tiles (a short curated list of related areas), not a mirror
// of the old 18-leaf dropdown: each routes to a hub that carries its own shortcut
// tiles. Titles reuse the existing menu label keys where they exist; descriptions
// are new plain-language one-liners (answer "what will I find", ≤6 words).

import { TILE_ACCENTS } from "@/ux/infographic";

export interface GovHubTile {
  id: string; // scene key (GOV_HUB_SCENES)
  titleKey: string;
  descKey: string;
  to: string;
  accent: string; // a TILE_ACCENTS token
}

// ⚠ `descKey` is written out, never built as `${labelKey}_desc`. A template key defeats the
// i18n reachability analysis: `scripts/i18n/bundle_reachability.test.ts` treats a built
// template as naming EVERY key it could match, so one `${x}_desc` here made all eight
// deferred `budget.json` description keys "reachable from /governance" and failed the gate.
export const GOV_HUB_CLUSTERS: {
  labelKey: string;
  descKey: string;
  tiles: GovHubTile[];
}[] = [
  {
    labelKey: "gov_hub_cluster_money",
    descKey: "gov_hub_cluster_money_desc",
    tiles: [
      {
        id: "budget",
        titleKey: "budget_link_label",
        descKey: "gov_hub_budget_desc",
        to: "/budget",
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "procurement",
        titleKey: "procurement_link_label",
        descKey: "procurement_hub_analysis_desc",
        to: "/procurement",
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "funds",
        titleKey: "funds_index_title",
        descKey: "gov_hub_funds_desc",
        to: "/funds",
        accent: TILE_ACCENTS.azure,
      },
      {
        // ДФ „Земеделие" CAP payments. A whole money vertical (/subsidies +
        // /subsidies/browse + /farm/:eik) that had NO hub tile and no menu
        // entry — reachable only from a /farm or /company record page, i.e.
        // only once you had already found a recipient.
        id: "subsidies",
        titleKey: "subsidies_nav",
        descKey: "gov_hub_subsidies_desc",
        to: "/subsidies",
        accent: TILE_ACCENTS.moss,
      },
      {
        // The one liability the state's own headline numbers exclude: the
        // consolidated cash deficit books a municipal payment when it is made,
        // so a município's forward commitments are invisible nationally until
        // they are paid. That is why it belongs on this cluster rather than
        // beside a sector — it is a TIER of government, not a policy area.
        id: "municipal-finance",
        titleKey: "mf_browse_nav",
        descKey: "gov_hub_municipal_finance_desc",
        to: "/governance/municipal-finance",
        accent: TILE_ACCENTS.wine,
      },
      {
        id: "sectors",
        titleKey: "sectors_hub_nav",
        descKey: "gov_hub_sectors_desc",
        to: "/governance/sectors",
        accent: TILE_ACCENTS.clay,
      },
    ],
  },
  {
    labelKey: "gov_hub_cluster_accountability",
    descKey: "gov_hub_cluster_accountability_desc",
    tiles: [
      {
        id: "parliament",
        titleKey: "gov_hub_parliament_title",
        descKey: "gov_hub_parliament_desc",
        to: "/parliament",
        accent: TILE_ACCENTS.plum,
      },
      {
        // The local counterpart of /parliament: 265 municipal councils legislate
        // for their own municipality, and 16 of them are in the corpus.
        id: "council",
        titleKey: "council_hub_title",
        descKey: "gov_hub_council_desc",
        to: "/council",
        accent: TILE_ACCENTS.ochre,
      },
      {
        id: "governments",
        titleKey: "governments_title",
        descKey: "gov_hub_governments_desc",
        to: "/governments",
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "declarations",
        titleKey: "menu_group_declarations",
        descKey: "gov_hub_declarations_desc",
        to: "/governance/declarations",
        accent: TILE_ACCENTS.rose,
      },
      {
        // A national comparison of the mayors who administer the same local
        // institutions as the council and municipal-finance tiles. It belongs
        // in accountability: this is a declared-income transparency surface,
        // not a municipal-budget measure.
        id: "mayor-pay",
        titleKey: "mp_page_title",
        descKey: "gov_hub_mayor_pay_desc",
        to: "/governance/mayor-pay",
        // `magenta` is already used on /procurement, not on this hub. The
        // palette deliberately permits cross-page reuse while the hub test
        // keeps every simultaneous tile distinct.
        accent: TILE_ACCENTS.magenta,
      },
      {
        // The cross-cutting view of the person layer that /officials/assets and
        // /mp-assets each slice. Sits in accountability rather than under Декларации
        // because it spans nine registers, only one of which is the declarations one.
        id: "persons",
        titleKey: "persons_title",
        descKey: "gov_hub_persons_desc",
        to: "/persons",
        accent: TILE_ACCENTS.indigo,
      },
      {
        // The connections graph, PROMOTED to the top hub: it is built from the
        // Commerce Registry and the procurement corpus, not from declarations,
        // so having its only entry point behind Декларации buried the site's
        // most distinctive asset two clicks deep under the wrong parent.
        //
        // The Декларации tile deliberately STAYS as a secondary path — from an
        // MP's declared interests the graph is the obvious next question — and
        // keeps its own narrower descKey ("Фирмите зад депутатите") because
        // there it answers that narrower question. `to` and `titleKey` are
        // gated equal across the two hubs in hubRegistry.test.ts; descKey is
        // explicitly allowed to differ, unlike the `persons` pair.
        id: "connections",
        titleKey: "connections_link_label",
        descKey: "gov_hub_connections_desc",
        to: "/connections",
        accent: TILE_ACCENTS.emerald,
      },
      {
        // The general company registry browse (188) — the third "who/what is in the
        // registry" tool beside persons/connections. Points at the UNFILTERED /companies,
        // unlike the narrower ?political=1 tile the declarations and parliament sub-hubs
        // carry for the same destination (each answers a more contextual question there).
        //
        // accent: `cobalt`, not `fern` — `fern` is already SPENT on /procurement's „Места"
        // tile (tileAccents.ts), and per-page uniqueness alone doesn't rule out the visual
        // confusion of the same accent meaning two different things on two pages a reader
        // moves between. `cobalt` was minted as RESERVED HEADROOM for exactly this — a new
        // tile needing a colour with nothing already spent to reuse — and its 245° hue lands
        // almost exactly on this page's own widest remaining gap (indigo 230° → iris 259°,
        // midpoint 244.5°), so it reads as distinct from its neighbours here too.
        id: "companies",
        titleKey: "companies_browse_title",
        descKey: "gov_hub_companies_desc",
        to: "/companies",
        accent: TILE_ACCENTS.cobalt,
      },
    ],
  },
  {
    // Показатели — the indicators feature, surfaced as its six topical domains
    // directly on the hub (was a single "Показатели" tile → /indicators). Titles
    // reuse the indicators sub-nav label keys so the pills and these tiles agree.
    //
    // 2026-08-22: SPLIT into two bands of four. It was one band of NINE, which at `xl`
    // (4 columns) renders 4+4+1 and strands a tile alone on its own row — and a nine-item
    // band is not a table of contents either. The nine tiles are all KEPT: collapsing them
    // back to a single /indicators tile would undo the deliberate expansion this comment
    // records. `ind_compare` moves to the last band instead, which is what lets the rest
    // divide 4+4. See docs/plans/hub-hero-v1.md §9.5.
    labelKey: "gov_hub_cluster_indicators",
    descKey: "gov_hub_cluster_indicators_desc",
    tiles: [
      {
        id: "overview",
        titleKey: "gov_hub_overview_title",
        descKey: "gov_hub_overview_desc",
        to: "/governance/overview",
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "ind_economy",
        titleKey: "indicators_nav_economy",
        descKey: "gov_hub_ind_economy_desc",
        to: "/indicators/economy",
        accent: TILE_ACCENTS.green,
      },
      {
        id: "ind_fiscal",
        titleKey: "indicators_nav_fiscal",
        descKey: "gov_hub_ind_fiscal_desc",
        to: "/indicators/fiscal",
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "ind_budgets",
        titleKey: "indicators_nav_budgets",
        descKey: "gov_hub_ind_budgets_desc",
        to: "/indicators/budgets",
        accent: TILE_ACCENTS.gold,
      },
    ],
  },
  {
    // The second half of the indicators block — the outcome side: how the country is doing
    // rather than what it collects and spends.
    labelKey: "gov_hub_cluster_society",
    descKey: "gov_hub_cluster_society_desc",
    tiles: [
      {
        id: "ind_governance",
        titleKey: "indicators_nav_governance",
        descKey: "gov_hub_ind_governance_desc",
        to: "/indicators/governance",
        accent: TILE_ACCENTS.iris,
      },
      {
        id: "ind_society",
        titleKey: "indicators_nav_society",
        descKey: "gov_hub_ind_society_desc",
        to: "/indicators/society",
        accent: TILE_ACCENTS.terracotta,
      },
      {
        id: "demographics",
        titleKey: "demographics_title",
        descKey: "gov_hub_demographics_desc",
        to: "/demographics",
        accent: TILE_ACCENTS.leaf,
      },
      {
        // Училища и матури. It sat on /governance/sectors until 2026-08-18 and
        // did not belong there: МОН already has its sector tile (`edu`, the
        // ministry's budget), this one carries the SAME agency badge, has no
        // awarder/EIK set behind it and no /sector/:id dashboard, and its
        // headline was the one non-money number on a grid that answers "what
        // does the state spend here". As an outcome browser keyed by place it
        // belongs beside `demographics` — same shape, same question.
        id: "schools",
        titleKey: "sector_schools_title",
        descKey: "sector_schools_desc",
        to: "/education",
        accent: TILE_ACCENTS.mulberry,
      },
    ],
  },
  {
    // Инструменти — the interactive tools (as opposed to read-only dashboards):
    // the personal "what did my taxes buy?" calculator and the national
    // tax-policy simulator. Both live under /budget but are hoisted here so
    // they're reachable straight from the hub (they were orphaned when the
    // mega-menu collapsed — see reportMenus.ts governanceMenu). Kept last as a
    // footer band of hands-on tools below the read-only dashboards. Titles reuse
    // the budget page/link label keys so the hub and the pages agree.
    // 2026-08-22: renamed from „Инструменти" and joined by `ind_compare` — the third thing
    // on this page where the reader DOES something (picks peer countries) rather than reads.
    labelKey: "gov_hub_cluster_tools",
    descKey: "gov_hub_cluster_tools_desc",
    tiles: [
      {
        id: "ind_compare",
        titleKey: "indicators_nav_compare",
        descKey: "gov_hub_ind_compare_desc",
        to: "/indicators/compare",
        accent: TILE_ACCENTS.olive,
      },
      {
        id: "tax_calculator",
        titleKey: "budget_tax_calculator_link_label",
        descKey: "gov_hub_tax_calc_desc",
        to: "/budget/tax-calculator",
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "simulator",
        titleKey: "budget_policy_page_title",
        descKey: "gov_hub_simulator_desc",
        to: "/budget/simulator",
        accent: TILE_ACCENTS.aqua,
      },
    ],
  },
];

/** The four tiles the /governance KPI band promotes, and where each cell links.
 *
 *  They live in the registry rather than in the screen for the reason every other list here
 *  does — a gate can read them. `hubHead.gates.test.ts` checks destination-uniqueness over
 *  THIS map: the cells build `to` from it rather than from literals, so a source scan of the
 *  component reads zero destinations and passes on nothing, which is exactly what it did until
 *  a non-vacuity assert caught it.
 */
export const BAND_TILES = [
  "budget",
  "procurement",
  "funds",
  "subsidies",
] as const;

/** Where each band figure sends the reader, carrying the scope its caption names. A tile
 *  whose destination is scoped by `?pscope` must FORCE it, or the reader lands on that hub's
 *  own default and sees a different number (hub-hero-v1 §9.2). */
export const BAND_TO: Record<string, string> = {
  budget: "/budget",
  procurement: "/procurement/contracts?pscope=all",
  funds: "/funds/beneficiaries",
  subsidies: "/subsidies?pscope=all",
};
