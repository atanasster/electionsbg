import { useTranslation } from "react-i18next";
import { ErrorSection } from "./components/ErrorSection";

export const NotFound = () => {
  const { t } = useTranslation();
  return <ErrorSection title="404" description={t("page_not_found")} />;
};
