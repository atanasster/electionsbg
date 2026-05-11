import { useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleH3,
  ArticleLI,
  ArticleP,
  ArticleStrong,
  ArticleUL,
} from "@/components/article/ArticleProse";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";

// Methodology page for the section risk-screening score. Mirrors the
// VoteFlowMethodologyScreen layout — long-form prose under
// ArticleLayout so it reads like the rest of the site's editorial
// content. Every concept the UI surfaces (signals, weights, bands,
// percentile, partial-data masking) is grounded here.
export const RiskScoreMethodologyScreen = () => {
  const { t } = useTranslation();
  return (
    <ArticleLayout
      title={t("risk_methodology_title")}
      description={t("risk_methodology_description")}
      breadcrumb={null}
      seoType="website"
    >
      <MethodologyCallout
        variant="disputed"
        title={t("risk_score_caveat_title")}
        className="mb-4"
      >
        {t("risk_score_caveat_body")}
      </MethodologyCallout>

      <ArticleP>{t("risk_methodology_intro")}</ArticleP>

      <ArticleH2>{t("risk_methodology_h_what")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_what1")}</ArticleP>
      <ArticleP>{t("risk_methodology_p_what2")}</ArticleP>

      <ArticleH2>{t("risk_methodology_h_signals")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_signals_intro")}</ArticleP>

      <ArticleH3>{t("risk_signal_recount")}</ArticleH3>
      <ArticleP>{t("risk_methodology_p_recount")}</ArticleP>

      <ArticleH3>{t("risk_signal_suemgMismatch")}</ArticleH3>
      <ArticleP>{t("risk_methodology_p_suemg")}</ArticleP>

      <ArticleH3>{t("risk_signal_invalidBallots")}</ArticleH3>
      <ArticleP>{t("risk_methodology_p_invalid")}</ArticleP>

      <ArticleH3>{t("risk_signal_additionalVoters")}</ArticleH3>
      <ArticleP>{t("risk_methodology_p_additional")}</ArticleP>

      <ArticleH3>{t("risk_signal_concentrated")}</ArticleH3>
      <ArticleP>{t("risk_methodology_p_concentrated")}</ArticleP>

      <ArticleH3>{t("risk_signal_peerOutlier")}</ArticleH3>
      <ArticleP>{t("risk_methodology_p_peer")}</ArticleP>

      <ArticleH2>{t("risk_methodology_h_formula")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_formula1")}</ArticleP>
      <ArticleP>
        <ArticleStrong>{t("risk_methodology_p_formula_eq")}</ArticleStrong>
      </ArticleP>
      <ArticleP>{t("risk_methodology_p_formula2")}</ArticleP>

      <ArticleH2>{t("risk_methodology_h_bands")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_bands_intro")}</ArticleP>
      <ArticleUL>
        <ArticleLI>
          <ArticleStrong>{t("risk_band_low")}</ArticleStrong>{" "}
          {t("risk_methodology_band_low")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>{t("risk_band_elevated")}</ArticleStrong>{" "}
          {t("risk_methodology_band_elevated")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>{t("risk_band_high")}</ArticleStrong>{" "}
          {t("risk_methodology_band_high")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>{t("risk_band_critical")}</ArticleStrong>{" "}
          {t("risk_methodology_band_critical")}
        </ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("risk_methodology_h_percentile")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_percentile")}</ArticleP>

      <ArticleH2>{t("risk_methodology_h_affected_party")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_affected_party")}</ArticleP>

      <ArticleH2>{t("risk_methodology_h_partial")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_partial1")}</ArticleP>
      <ArticleP>{t("risk_methodology_p_partial2")}</ArticleP>

      <ArticleH2>{t("risk_methodology_h_caveats")}</ArticleH2>
      <ArticleUL>
        <ArticleLI>{t("risk_methodology_caveat_screening")}</ArticleLI>
        <ArticleLI>{t("risk_methodology_caveat_weights")}</ArticleLI>
        <ArticleLI>{t("risk_methodology_caveat_small_n")}</ArticleLI>
        <ArticleLI>{t("risk_methodology_caveat_demographic")}</ArticleLI>
        <ArticleLI>{t("risk_methodology_caveat_independence")}</ArticleLI>
        <ArticleLI>{t("risk_methodology_caveat_neighborhood")}</ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("risk_methodology_h_how_to_use")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_how_to_use1")}</ArticleP>
      <ArticleP>{t("risk_methodology_p_how_to_use2")}</ArticleP>
      <ArticleP>{t("risk_methodology_p_how_to_use3")}</ArticleP>

      <ArticleH2>{t("risk_methodology_h_source")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_source")}</ArticleP>
    </ArticleLayout>
  );
};
