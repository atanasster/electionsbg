import { FC, PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleLI,
  ArticleP,
  ArticleStrong,
  ArticleUL,
} from "@/components/article/ArticleProse";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";

const LabelP: FC<PropsWithChildren<{ label: string }>> = ({
  label,
  children,
}) => (
  <ArticleP>
    <ArticleStrong>{label}</ArticleStrong> {children}
  </ArticleP>
);

// Methodology page for the Composite Election Risk Index — the 8-component
// 0–100 aggregation rendered in CompositeIndexHero (on /risk-analysis) and
// CompositeIndexRibbon (on the home Anomalies section). Mirrors the
// RiskScoreMethodologyScreen structure: caveat banner → what it is →
// components → formula → bands → important caveats → how to use.
export const RiskAnalysisMethodologyScreen = () => {
  const { t } = useTranslation();
  return (
    <ArticleLayout
      title={t("composite_methodology_title")}
      description={t("composite_methodology_description")}
      breadcrumb={null}
      seoType="website"
    >
      <MethodologyCallout
        variant="disputed"
        title={t("composite_methodology_caveat_title")}
        className="mb-4"
      >
        {t("composite_methodology_caveat_body")}
      </MethodologyCallout>

      <ArticleP>{t("composite_methodology_intro")}</ArticleP>

      <ArticleH2>{t("composite_methodology_h_what")}</ArticleH2>
      <ArticleP>{t("composite_methodology_p_what1")}</ArticleP>
      <ArticleP>{t("composite_methodology_p_what2")}</ArticleP>

      <ArticleH2>{t("composite_methodology_h_components")}</ArticleH2>
      <ArticleP>{t("composite_methodology_p_components_intro")}</ArticleP>
      <LabelP label={t("composite_methodology_c_sections_t")}>
        {t("composite_methodology_c_sections_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_c_benford_t")}>
        {t("composite_methodology_c_benford_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_c_machine_t")}>
        {t("composite_methodology_c_machine_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_c_missingFlash_t")}>
        {t("composite_methodology_c_missingFlash_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_c_concentration_t")}>
        {t("composite_methodology_c_concentration_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_c_procedural_t")}>
        {t("composite_methodology_c_procedural_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_c_neighborhoods_t")}>
        {t("composite_methodology_c_neighborhoods_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_c_polls_t")}>
        {t("composite_methodology_c_polls_p")}
      </LabelP>

      <ArticleH2>{t("composite_methodology_h_bands")}</ArticleH2>
      <ArticleP>{t("composite_methodology_p_bands_intro")}</ArticleP>
      <ArticleUL>
        <ArticleLI>
          <ArticleStrong>
            {t("composite_methodology_band_label_calm")} (0–20):
          </ArticleStrong>{" "}
          {t("composite_methodology_band_calm")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>
            {t("composite_methodology_band_label_elevated")} (20–40):
          </ArticleStrong>{" "}
          {t("composite_methodology_band_elevated")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>
            {t("composite_methodology_band_label_high")} (40–60):
          </ArticleStrong>{" "}
          {t("composite_methodology_band_high")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>
            {t("composite_methodology_band_label_critical")} (60–100):
          </ArticleStrong>{" "}
          {t("composite_methodology_band_critical")}
        </ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("composite_methodology_h_important")}</ArticleH2>
      <LabelP label={t("composite_methodology_important_caps_t")}>
        {t("composite_methodology_important_caps_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_important_available_t")}>
        {t("composite_methodology_important_available_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_important_polls_t")}>
        {t("composite_methodology_important_polls_p")}
      </LabelP>
      <LabelP label={t("composite_methodology_important_evidence_t")}>
        {t("composite_methodology_important_evidence_p")}
      </LabelP>
    </ArticleLayout>
  );
};
