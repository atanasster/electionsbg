// Цена за единица резултат — the shared methodology page for the unit-cost
// family (W3 of docs/plans/procurement-outcomes-v1.md §3).
//
// WHY IT EXISTS: three sector tiles compute a cost-per-unit-of-service — courts
// (€ per resolved case), roads (€ per kilometre) and health (€ per hospital
// case) — and each restated its own caveat in its own words. Stated once here,
// they are a shared METHOD; the tiles link back rather than re-explaining.
//
// WHAT IT DELIBERATELY IS NOT: a composite efficiency index. €/case, €/km and
// €/case-in-health are not commensurable, and averaging them would manufacture a
// number with no referent. The family is a shared method, never a shared scale
// (plan §3b) — the same rule the normalcy panel follows: position, never verdict.
//
// It carries NO live figures on purpose. Each leg's number is computed where its
// data lives, from three unrelated sources; a fourth copy here would be the
// hub_stats drift the plan warns about, going stale with nothing to catch it.
// The legs are linked instead, and the bases are named.
//
// Route: governance/sectors/methodology (per plan §6c — the repo's existing
// `<area>/methodology` convention, NOT §3a's /data/methodology/unit-cost).

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleLI,
  ArticleP,
  ArticleUL,
} from "@/components/article/ArticleProse";
import { proseClasses } from "@/components/article/proseClasses";
import { usePreserveParams } from "@/ux/usePreserveParams";

/** The three legs, each named by its BASIS — what is divided by what. The scope
 *  caveat travels with the leg, because it is the leg's own, not the family's. */
//
// TWO legs, not three. A health €/case is computable nationally but NO surface
// renders a per-hospital one — NzokActivityTile says so in its own caption
// („Броят случаи е обем, не стойност"), because the activity corpus carries the
// procedure code without a price. Listing it as a leg would point a reader at a
// page that says the opposite. It appears below as a CONTEXT figure instead,
// which is also what plan §6d-3 resolved; the per-hospital version is W2 and
// needs the case-mix adjustment this page's second law describes.
const LEGS: { key: string; to: string }[] = [
  { key: "unit_cost_leg_courts", to: "/judiciary" },
  { key: "unit_cost_leg_roads", to: "/awarder/000695089" },
];

export const UnitCostMethodologyScreen = () => {
  const { t } = useTranslation();
  const searchParams = usePreserveParams();
  // Carry the scope/election params across, like ArticleScreen does — a reader
  // arriving with ?pscope set should keep it when following a leg.
  const linkTo = (path: string) => {
    const merged = searchParams().toString();
    return merged ? `${path}?${merged}` : path;
  };
  return (
    <ArticleLayout
      title={t("unit_cost_title")}
      description={t("unit_cost_description")}
      // The prerendered JSON-LD declares a „Сектори" parent, so the rendered
      // page has to show that trail too — otherwise the crawler and the reader
      // are told different things about where this page sits.
      breadcrumb={{
        to: linkTo("/governance/sectors"),
        label: t("sectors_hub_title") || "Държавни сектори",
      }}
      seoType="website"
    >
      {/* Readiness marker for the OG capture's waitFor, NOT its anchor — the
          shot anchors on the layout's h1 (scripts/og/capture-screens.ts). */}
      <div data-og="unit-cost-methodology">
        <ArticleP>{t("unit_cost_intro")}</ArticleP>
      </div>

      <ArticleH2>{t("unit_cost_h_what")}</ArticleH2>
      <ArticleP>{t("unit_cost_p_what1")}</ArticleP>
      <ArticleP>{t("unit_cost_p_what2")}</ArticleP>

      <ArticleH2>{t("unit_cost_h_cannot")}</ArticleH2>
      <ArticleP>{t("unit_cost_p_cannot1")}</ArticleP>
      <ArticleUL>
        <ArticleLI>{t("unit_cost_p_cannot_attribution")}</ArticleLI>
        <ArticleLI>{t("unit_cost_p_cannot_quality")}</ArticleLI>
        <ArticleLI>{t("unit_cost_p_cannot_direction")}</ArticleLI>
      </ArticleUL>
      <ArticleP>{t("unit_cost_p_cannot2")}</ArticleP>

      <ArticleH2>{t("unit_cost_h_law1")}</ArticleH2>
      <ArticleP>{t("unit_cost_p_law1a")}</ArticleP>
      <ArticleP>{t("unit_cost_p_law1b")}</ArticleP>

      <ArticleH2>{t("unit_cost_h_law2")}</ArticleH2>
      <ArticleP>{t("unit_cost_p_law2a")}</ArticleP>
      <ArticleP>{t("unit_cost_p_law2b")}</ArticleP>

      <ArticleH2>{t("unit_cost_h_legs")}</ArticleH2>
      <ArticleP>{t("unit_cost_p_legs")}</ArticleP>
      <ArticleUL>
        {LEGS.map((leg) => (
          <ArticleLI key={leg.key}>
            <Link to={linkTo(leg.to)} className={proseClasses.a}>
              {t(`${leg.key}_name`)}
            </Link>
            {" — "}
            {t(`${leg.key}_basis`)}
          </ArticleLI>
        ))}
      </ArticleUL>

      <ArticleP>{t("unit_cost_p_health_context")}</ArticleP>

      <ArticleH2>{t("unit_cost_h_notscore")}</ArticleH2>
      <ArticleP>{t("unit_cost_p_notscore1")}</ArticleP>
      <ArticleP>{t("unit_cost_p_notscore2")}</ArticleP>
    </ArticleLayout>
  );
};
