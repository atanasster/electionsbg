import { Button } from "@/components/ui/button";
import { Title } from "@/ux/Title";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTranslation } from "react-i18next";

export const NotFound = () => {
  const navigate = useNavigateParams();
  const { t } = useTranslation();
  return (
    <div className="w-9/12 m-auto py-16 min-h-screen flex items-center justify-center">
      <div className="bg-neutral-content shadow overflow-hidden sm:rounded-lg pb-8">
        <div className="border-t border-gray-200 text-center pt-8">
          <Title description="The page you are searching for coud not be found">
            404
          </Title>
          <h1 className="text-6xl font-medium py-8">Oops! Page not found</h1>
          <p className="text-2xl pb-8 px-12 font-medium">
            {t("page_not_found")}
          </p>
          <Button onClick={() => navigate({ pathname: "/" })}>
            {t("home")}
          </Button>
        </div>
      </div>
    </div>
  );
};
