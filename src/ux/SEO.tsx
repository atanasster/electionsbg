import { FC } from "react";
import { useTranslation } from "react-i18next";

export const SEO: FC<{
  title: string;
  description: string;
  keywords?: string[];
  type?: string;
}> = ({ title, description, keywords = [], type = "website" }) => {
  const allKeywords = ["bulgaria", "elections"].concat(keywords);
  const { t } = useTranslation();
  return (
    <>
      <title>{`${
        t("elections").charAt(0).toUpperCase() + t("elections").slice(1)
      } | ${title}`}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={allKeywords.join()} />
      {/* Facebook tags */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {/* Twitter tags */}
      <meta name="twitter:creator" content="electionsbg.com" />
      <meta name="twitter:card" content={type} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </>
  );
};
