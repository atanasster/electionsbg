import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/MapLayout";
import { regions } from "./data/json_types";
import { RegionsMap } from "./components/RegionsMap";
import { Title } from "@/ux/Title";

export const RegionsScreen = () => {
  const { t } = useTranslation();

  return (
    <>
      <Title>{t("bulgaria")}</Title>
      <MapLayout>
        {(size) => <RegionsMap regions={regions} size={size} />}
      </MapLayout>
    </>
  );
};
