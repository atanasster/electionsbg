import { Trans, useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleLI,
  ArticleP,
  ArticleUL,
} from "@/components/article/ArticleProse";
import { proseClasses } from "@/components/article/proseClasses";

const extLink = (href: string) => (
  <a
    className={proseClasses.a}
    href={href}
    target="_blank"
    rel="noopener noreferrer"
  />
);

export const VoteFlowMethodologyScreen = () => {
  const { t } = useTranslation();
  return (
    <ArticleLayout
      title={t("vote_flow_methodology_title")}
      description={t("vote_flow_methodology_description")}
      breadcrumb={null}
      seoType="website"
    >
      <ArticleP>{t("vote_flow_methodology_intro")}</ArticleP>

      <ArticleH2>{t("vote_flow_methodology_h_estimate")}</ArticleH2>
      <ArticleP>
        <Trans
          i18nKey="vote_flow_methodology_p_estimate1"
          components={{
            goodman: extLink(
              "https://en.wikipedia.org/wiki/Ecological_regression",
            ),
          }}
        />
      </ArticleP>
      <ArticleP>
        <Trans
          i18nKey="vote_flow_methodology_p_estimate2"
          components={{
            ras: extLink(
              "https://en.wikipedia.org/wiki/Iterative_proportional_fitting",
            ),
          }}
        />
      </ArticleP>

      <ArticleH2>{t("vote_flow_methodology_h_pseudo")}</ArticleH2>
      <ArticleP>{t("vote_flow_methodology_p_pseudo1")}</ArticleP>
      <ArticleUL>
        <ArticleLI>{t("vote_flow_methodology_p_pseudo_abstain")}</ArticleLI>
        <ArticleLI>{t("vote_flow_methodology_p_pseudo_joined")}</ArticleLI>
        <ArticleLI>{t("vote_flow_methodology_p_pseudo_exited")}</ArticleLI>
        <ArticleLI>{t("vote_flow_methodology_p_pseudo_small")}</ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("vote_flow_methodology_h_scope")}</ArticleH2>
      <ArticleP>{t("vote_flow_methodology_p_scope")}</ArticleP>

      <ArticleH2>{t("vote_flow_methodology_h_caveats")}</ArticleH2>
      <ArticleUL>
        <ArticleLI>{t("vote_flow_methodology_p_caveat_coalitions")}</ArticleLI>
        <ArticleLI>{t("vote_flow_methodology_p_caveat_sections")}</ArticleLI>
        <ArticleLI>{t("vote_flow_methodology_p_caveat_abroad")}</ArticleLI>
        <ArticleLI>{t("vote_flow_methodology_p_caveat_oblast")}</ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("vote_flow_methodology_h_what_to_trust")}</ArticleH2>
      <ArticleP>{t("vote_flow_methodology_p_trust1")}</ArticleP>
      <ArticleP>{t("vote_flow_methodology_p_trust2")}</ArticleP>
    </ArticleLayout>
  );
};
