import { useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleLI,
  ArticleP,
  ArticleUL,
} from "@/components/article/ArticleProse";
import { proseClasses } from "@/components/article/proseClasses";

const REFERENCES: { key: string; href: string }[] = [
  {
    key: "benford_methodology_p_refs_mebane",
    href: "https://websites.umich.edu/~wmebane/pm06.pdf",
  },
  {
    key: "benford_methodology_p_refs_pericchi",
    href: "https://doi.org/10.1214/09-STS296",
  },
  {
    key: "benford_methodology_p_refs_klimek",
    href: "https://www.pnas.org/doi/10.1073/pnas.1210722109",
  },
  {
    key: "benford_methodology_p_refs_beber",
    href: "https://doi.org/10.1093/pan/mps003",
  },
  {
    key: "benford_methodology_p_refs_nigrini",
    href: "https://www.wiley.com/en-us/Benford%27s+Law%3A+Applications+for+Forensic+Accounting%2C+Auditing%2C+and+Fraud+Detection-p-9781118152850",
  },
];

// No backlink: the Избори › Анализи › Законът на Бенфорд › Методология trail
// is rendered by <HubBreadcrumb> in LayoutScreen (see hubBreadcrumbFor).
export const BenfordMethodologyScreen = () => {
  const { t } = useTranslation();
  return (
    <ArticleLayout
      title={t("benford_methodology_title")}
      description={t("benford_methodology_description")}
      breadcrumb={null}
      seoType="website"
    >
      <ArticleP>{t("benford_methodology_intro")}</ArticleP>

      <ArticleH2>{t("benford_methodology_h_2bl")}</ArticleH2>
      <ArticleP>{t("benford_methodology_p_2bl1")}</ArticleP>
      <ArticleP>{t("benford_methodology_p_2bl2")}</ArticleP>

      <ArticleH2>{t("benford_methodology_h_thresholds")}</ArticleH2>
      <ArticleP>{t("benford_methodology_p_thresholds1")}</ArticleP>
      <ArticleP>{t("benford_methodology_p_thresholds2")}</ArticleP>

      <ArticleH2>{t("benford_methodology_h_metrics")}</ArticleH2>
      <ArticleP>{t("benford_methodology_p_metrics1")}</ArticleP>
      <ArticleUL>
        <ArticleLI>{t("benford_methodology_p_metrics_mad")}</ArticleLI>
        <ArticleLI>{t("benford_methodology_p_metrics_chi")}</ArticleLI>
      </ArticleUL>
      <ArticleP>{t("benford_methodology_p_metrics2")}</ArticleP>
      <ArticleUL>
        <ArticleLI>{t("benford_methodology_p_metrics_close")}</ArticleLI>
        <ArticleLI>{t("benford_methodology_p_metrics_moderate")}</ArticleLI>
        <ArticleLI>{t("benford_methodology_p_metrics_strong")}</ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("benford_methodology_h_meaning")}</ArticleH2>
      <ArticleP>{t("benford_methodology_p_meaning1")}</ArticleP>
      <ArticleP>{t("benford_methodology_p_meaning2")}</ArticleP>

      <ArticleH2>{t("benford_methodology_h_alt")}</ArticleH2>
      <ArticleP>{t("benford_methodology_p_alt1")}</ArticleP>
      <ArticleUL>
        <ArticleLI>{t("benford_methodology_p_alt_risk")}</ArticleLI>
        <ArticleLI>{t("benford_methodology_p_alt_problem")}</ArticleLI>
        <ArticleLI>{t("benford_methodology_p_alt_suspicious")}</ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("benford_methodology_h_refs")}</ArticleH2>
      <ArticleUL>
        {REFERENCES.map((ref) => (
          <ArticleLI key={ref.key}>
            <a
              href={ref.href}
              target="_blank"
              rel="noopener noreferrer"
              className={proseClasses.a}
            >
              {t(ref.key)}
            </a>
          </ArticleLI>
        ))}
      </ArticleUL>
    </ArticleLayout>
  );
};
