// Route → breadcrumb-trail lookup for the pages fronted by the two election
// hubs (analyses + reports). Rendered once by <HubBreadcrumb> in LayoutScreen,
// so every hub page gets "Избори › <hub> › …" without each screen wiring its
// own breadcrumb; non-hub routes return null (and keep whatever they render).
//
// Detail pages with a dynamic leaf (a party / agency / cluster / report by id)
// resolve to their parent page's trail — the specific entity name is not in the
// crumb, but "where am I" stays correct.

export type HubTrail = {
  hub: "analysis" | "reports";
  /** Linked parent-page crumb for a sub-page (e.g. Изгубени гласове → /wasted-vote). */
  section?: { labelKey: string; to: string };
  /** i18n key for the current (leaf) crumb. */
  currentKey?: string;
};

// Report grain×slug leaf → its title i18n key (the /reports/{grain}/{slug} matrix
// served through ReportTemplate).
const REPORT_SLUG_TITLE: Record<string, string> = {
  "wasted-votes": "wasted_votes_title",
  concentrated: "concentrated_party_votes",
  top_gainers: "top_gainers",
  top_losers: "top_losers",
  turnout: "voter_turnout",
  invalid_ballots: "invalid_ballots",
  additional_voters: "additional_voters",
  supports_no_one: "support_no_one",
  recount: "voting_recount",
  recount_zero_votes: "zero_votes",
  flash_memory: "flash_memory",
  flash_memory_added: "flash_memory_added",
  flash_memory_removed: "flash_memory_removed",
  missing_flash_memory: "missing_flash_memory",
};

const analysis = (
  currentKey?: string,
  section?: HubTrail["section"],
): HubTrail => ({ hub: "analysis", currentKey, section });
const reports = (
  currentKey?: string,
  section?: HubTrail["section"],
): HubTrail => ({ hub: "reports", currentKey, section });

export const hubBreadcrumbFor = (pathname: string): HubTrail | null => {
  const p = pathname.replace(/\/+$/, "") || "/";

  // ---- Analyses hub ----
  if (p === "/risk-analysis") return analysis("risk_analysis_title");
  if (p === "/risk-analysis/methodology")
    return analysis("breadcrumb_methodology", {
      labelKey: "risk_analysis_title",
      to: "/risk-analysis",
    });
  // /risk-analysis/cluster/:id resolves its own crumb (dynamic cluster name).

  if (p === "/polls") return analysis("polls_title");
  // /polls/:agencyId resolves its own crumb (dynamic agency name).

  if (p === "/benford") return analysis("benford_title");
  if (p === "/benford/methodology")
    return analysis("breadcrumb_methodology", {
      labelKey: "benford_title",
      to: "/benford",
    });
  // /benford/:partyNum resolves its own crumb (dynamic party name).

  if (p === "/wasted-vote") return analysis("wasted_votes_title");
  if (p === "/wasted-vote/regions")
    return analysis("regions", {
      labelKey: "wasted_votes_title",
      to: "/wasted-vote",
    });

  if (p === "/persistence") return analysis("persistence_title");
  if (p === "/where-did-votes-go/methodology")
    return analysis("breadcrumb_methodology", {
      labelKey: "persistence_title",
      to: "/persistence",
    });
  if (p === "/compare") return analysis("compare_title");
  if (p === "/simulator") return analysis("coalition_simulator");

  if (p === "/financing") return analysis("campaign_financing");
  if (p === "/financing/annual-reports")
    return analysis("annual_reports_title", {
      labelKey: "campaign_financing",
      to: "/financing",
    });
  // /financing/annual-reports/:slug resolves its own crumb (dynamic report name).

  if (p === "/party-demographics") return analysis("party_demographics_title");

  // ---- Reports hub ----
  if (p === "/risk-score") return reports("risk_score_title");
  if (p === "/risk-score/methodology")
    return reports("breadcrumb_methodology", {
      labelKey: "risk_score_title",
      to: "/risk-score",
    });

  // Problem sections (section grain) + all its detail sub-pages.
  if (p.startsWith("/reports/section/problem_sections"))
    return reports("problem_sections");

  // The standard report matrix leaf.
  const m = p.match(
    /^\/reports\/(?:settlement|municipality|section)\/([a-z_-]+)$/,
  );
  if (m && REPORT_SLUG_TITLE[m[1]]) return reports(REPORT_SLUG_TITLE[m[1]]);

  return null;
};
