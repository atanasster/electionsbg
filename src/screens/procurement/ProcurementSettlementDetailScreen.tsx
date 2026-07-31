// /procurement/settlement/:ekatte — public procurement in one settlement.
//
// A contracts BROWSER scoped to a place, not a static summary: the buyers seated at this
// EKATTE, then every contract they awarded, with the same filters, KPI strip and columns
// as /procurement/contracts and /company/:eik/contracts.
//
// TWO DATA PATHS, ONE WINDOW. The buyers card reads procurement_settlement_detail (the
// place's own aggregate); the table below reads the `contracts` resource through the
// awarder_ekatte semi-join. Both are bounded by the SAME ?pscope — but through different
// helpers, because the endpoints take opposite bound conventions: useScopeWindow here
// (half-open, `date < to`) and scopeRange inside the section (inclusive, `date <= max`).
// Passing either helper's pair to the other path silently shifts one side by a day. See
// docs/plans/procurement-settlement-browser-v1.md §3.1a.

import { FC, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Title } from "@/ux/Title";
import { SEO } from "@/ux/SEO";
import { FollowStar } from "@/screens/components/procurement/FollowStar";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { ProcurementBreadcrumb } from "@/screens/components/procurement/ProcurementBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { PlaceHeaderView } from "@/screens/components/place/PlaceHeaderView";
import { useSettlementProcurement } from "@/data/procurement/useSettlementProcurement";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { ProcurementSettlementContractsSection } from "./ProcurementSettlementContractsSection";
import { settlementHero, settlementSeo } from "./settlementHero";
import type { ProcurementAwarderTier } from "@/data/dataTypes";

const eurFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("bg-BG");

// NOTE on the `t(key) || "fallback"` idiom used elsewhere in this file and across the
// codebase: it is DEAD CODE. i18n.ts sets `fallbackLng: lng` with no missing-key handler,
// so i18next returns the KEY itself for a missing string — which is truthy, so the `||`
// arm never runs and the reader sees `procurement_settlement_show_all_buyers` on screen.
// (That is exactly what happened while building this page.) New keys here are added to
// BOTH bundles and called as a bare `t(key)`; do not "restore" a fallback.

// София has 327 buyers, Пловдив 153. Rendering every row on mount is a long scroll past
// the thing most readers came for (the contracts), so the list opens at the head of the
// ranking and expands on request.
const BUYERS_COLLAPSED = 10;

const TIER_LABEL_BG: Record<ProcurementAwarderTier, string> = {
  municipal: "Община",
  school: "Училище",
  hospital: "Болница",
  university: "Университет",
  forestry: "Горско стопанство",
  regional_gov: "Регионална администрация",
  utility: "Комунално дружество",
  central_ministry: "Министерство",
  central_agency: "Държавна агенция",
  national_state_co: "Държавна компания",
  other: "Друго",
};
const TIER_LABEL_EN: Record<ProcurementAwarderTier, string> = {
  municipal: "Municipality",
  school: "School",
  hospital: "Hospital",
  university: "University",
  forestry: "Forestry",
  regional_gov: "Regional gov.",
  utility: "Utility",
  central_ministry: "Ministry",
  central_agency: "Agency",
  national_state_co: "State company",
  other: "Other",
};

export const ProcurementSettlementDetailScreen: FC = () => {
  const { ekatte } = useParams<{ ekatte: string }>();
  const { t, i18n } = useTranslation();
  // Half-open [from, to) — the shape procurement_settlement_detail filters on.
  const { from, to } = useScopeWindow();
  const q = useSettlementProcurement(ekatte ?? null, { from, to });
  const data = q.data;
  const [showAllBuyers, setShowAllBuyers] = useState(false);

  // Every state renders the same hierarchy crumb, one level under the
  // "По място" list: Управление › Обществени поръчки › По място › <settlement>.
  const bySettlement = {
    labelKey: "procurement_by_settlement_nav",
    to: "/procurement/by-settlement",
  };

  if (q.isLoading) {
    return (
      <div>
        <ProcurementBreadcrumb section={bySettlement} className="my-3" />
        {/* The control stays mounted while loading: a scope switch is the most common
            way into this branch, and hiding the pill mid-toggle is the one moment the
            reader needs it. (placeholderData usually skips this branch entirely on a
            toggle — this is for the genuine first load.) */}
        <ScopeControl mode="toggle" className="mb-3" />
        <Title>{t("procurement_settlement_loading") || "Loading…"}</Title>
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <ProcurementBreadcrumb
          section={bySettlement}
          current={ekatte}
          className="my-3"
        />
        <ScopeControl mode="toggle" className="mb-3" />
        <Title>
          {t("procurement_settlement_not_found_title") || "No procurement data"}
        </Title>
        {/* The scope control stays mounted here on purpose: under a narrow ?pscope this
            branch also means "nothing in THIS period", and without a visible way back to
            "all years" the page reads as "this settlement has no procurement at all". */}
        <p className="text-muted-foreground">
          {t("procurement_settlement_not_found_body") ||
            "This settlement has no local-tier procurement on record. The dataset only covers contracts whose buyer headquarters resolve to a settlement in our catalog; small villages and inactive buyers may simply be missing."}
        </p>
      </div>
    );
  }

  const tierLabel = i18n.language === "bg" ? TIER_LABEL_BG : TIER_LABEL_EN;
  const lang = i18n.language === "bg" ? "bg" : "en";
  const hero = settlementHero(data, lang);
  const seo = settlementSeo(data, hero.displayName, lang);

  const buyers = showAllBuyers
    ? data.awarders
    : data.awarders.slice(0, BUYERS_COLLAPSED);

  return (
    <div>
      <SEO title={seo.title} description={seo.description} />
      <ProcurementBreadcrumb
        section={bySettlement}
        current={data.name}
        className="my-3"
      />
      {/* The shared scope control, in the same slot every /procurement* page puts it.
          NOT ProcurementSectionHeader: that wrapper takes an i18n KEY for a single-level
          breadcrumb leaf, and this page's crumb is two levels deep with a dynamic
          settlement name. */}
      <ScopeControl mode="toggle" className="mb-3" />
      {/* Compact: the location display only (title + breadcrumb + map). The full view
          switcher belongs on the governance/parliamentary/local/consumption pages where
          switching navigates — not here, where the page just scopes procurement to a place. */}
      <PlaceHeaderView
        active="governance"
        level="settlement"
        variant="compact"
        titleText={hero.titleText}
        narrative={hero.narrative}
        loc={hero.loc}
        isAbroad={false}
        thumbName={hero.displayName}
        extra={
          <FollowStar
            kind="place"
            id={ekatte ?? data.ekatte}
            label={data.name}
            size="md"
          />
        }
        className="mb-6"
      />

      {/* Buyers. The count lives in the header rather than in a KPI card of its own: it
          is the length of THIS list, and it is the one figure the contracts strip below
          cannot produce (the table aggregates rows, not distinct buyers). Unlike that
          strip it reacts to the scope but NOT to the filters — which is why it is worded
          as "buyers in this settlement" rather than as a count of what is shown below. */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            {t("procurement_settlement_buyers_header") ||
              "Buyers in this settlement"}{" "}
            <span className="text-muted-foreground tabular-nums font-normal">
              ({countFmt.format(data.awarders.length)})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 w-10">#</th>
                  <th className="text-left px-3 py-2">
                    {t("procurement_settlement_col_buyer") || "Buyer"}
                  </th>
                  <th className="text-left px-3 py-2 hidden sm:table-cell">
                    {t("procurement_settlement_col_tier") || "Type"}
                  </th>
                  <th className="text-right px-3 py-2 tabular-nums">
                    {t("procurement_settlement_col_eur") || "Total EUR"}
                  </th>
                  <th className="text-right px-3 py-2 tabular-nums hidden md:table-cell">
                    {t("procurement_settlement_col_contracts") || "Contracts"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {buyers.map((a, idx) => (
                  <tr key={a.eik}>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2">
                      <AwarderLink
                        eik={a.eik}
                        className="font-medium hover:underline"
                      >
                        {a.name}
                      </AwarderLink>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                      {tierLabel[a.tier]}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      €{eurFmt.format(Math.round(a.totalEur))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                      {countFmt.format(a.contractCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.awarders.length > BUYERS_COLLAPSED && (
            <div className="border-t px-3 py-2">
              <button
                type="button"
                onClick={() => setShowAllBuyers((v) => !v)}
                className="text-xs text-primary underline underline-offset-2 hover:no-underline"
              >
                {showAllBuyers
                  ? t("procurement_settlement_show_fewer_buyers")
                  : `${t("procurement_settlement_show_all_buyers")} (${countFmt.format(
                      data.awarders.length,
                    )})`}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The contracts browser. Brings its own KPI strip — Σ€, count, single-bid and
          direct-award shares — all reactive to the filters, which is why the page no
          longer carries static total/contract cards of its own: two sets of the same
          numbers, one of them ignoring the filters, is the disagreement this page was
          rebuilt to remove. */}
      {ekatte ? (
        <ProcurementSettlementContractsSection ekatte={ekatte} />
      ) : null}

      <p className="mt-6 text-xs text-muted-foreground">
        {t("procurement_settlement_detail_footnote") ||
          'Buyer HQ is the location proxy. Central ministries and national state companies based in Sofia procure nationally — they are not shown on this page; see the "national procurement" rollup on the landing page.'}
      </p>
    </div>
  );
};
