import { Button } from "@/components/ui/button";
import { Title } from "@/ux/Title";
import { Separator } from "@/components/ui/separator";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const ErrorSection: FC<{ title: string; description: string }> = ({
  title,
  description,
}) => {
  const navigate = useNavigateParams();
  const { t } = useTranslation();
  return (
    <div className="w-full py-16 h-full">
      <Separator />
      <div className="overflow-hidden sm:rounded-lg pb-8 flex justify-center">
        <div className="text-center pt-8 w-9/12">
          <Title className="text-destructive" description={description}>
            {title}
          </Title>
          <p className="text-4xl pb-8 px-12 font-medium text-secondary-foreground">
            {description}
          </p>
          <Button onClick={() => navigate({ pathname: "/" })}>
            {t("home")}
          </Button>
        </div>
      </div>
      <Separator />
    </div>
  );
};
