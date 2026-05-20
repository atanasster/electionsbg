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

// Paragraph that begins with a bolded short label (signal name + weight,
// or sub-topic title) followed by a colon and a plain-text explanation.
// Used inside the "Шестте сигнала" and "Важни уточнения" sections.
const LabelP: FC<PropsWithChildren<{ label: string }>> = ({
  label,
  children,
}) => (
  <ArticleP>
    <ArticleStrong>{label}</ArticleStrong> {children}
  </ArticleP>
);

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
        title={t("risk_methodology_caveat_title")}
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
      <LabelP label={t("risk_methodology_signal_recount_t")}>
        {t("risk_methodology_signal_recount_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_signal_suemg_t")}>
        {t("risk_methodology_signal_suemg_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_signal_invalid_t")}>
        {t("risk_methodology_signal_invalid_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_signal_additional_t")}>
        {t("risk_methodology_signal_additional_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_signal_concentrated_t")}>
        {t("risk_methodology_signal_concentrated_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_signal_peer_t")}>
        {t("risk_methodology_signal_peer_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_signal_swing_t")}>
        {t("risk_methodology_signal_swing_p")}
      </LabelP>

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
          <ArticleStrong>{t("risk_band_low")} (0–30):</ArticleStrong>{" "}
          {t("risk_methodology_band_low")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>{t("risk_band_elevated")} (30–60):</ArticleStrong>{" "}
          {t("risk_methodology_band_elevated")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>{t("risk_band_high")} (60–80):</ArticleStrong>{" "}
          {t("risk_methodology_band_high")}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>{t("risk_band_critical")} (80–100):</ArticleStrong>{" "}
          {t("risk_methodology_band_critical")}
        </ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("risk_methodology_h_important")}</ArticleH2>
      <LabelP label={t("risk_methodology_important_percentile_t")}>
        {t("risk_methodology_important_percentile_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_important_party_t")}>
        {t("risk_methodology_important_party_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_important_evidence_t")}>
        {t("risk_methodology_important_evidence_p")}
      </LabelP>
      <LabelP label={t("risk_methodology_important_context_t")}>
        {t("risk_methodology_important_context_p")}
      </LabelP>

      <ArticleH2>{t("risk_methodology_h_how_to_use")}</ArticleH2>
      <ArticleP>{t("risk_methodology_p_how_to_use1")}</ArticleP>
      <ArticleP>{t("risk_methodology_p_how_to_use2")}</ArticleP>
    </ArticleLayout>
  );
};
