import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/MapLayout";
import { regions } from "./data/json_types";
import { RegionsMap } from "./components/RegionsMap";

export const RegionsScreen = () => {
  const { t } = useTranslation();

  return (
    <MapLayout title={t("country")}>
      {(size) => <RegionsMap regions={regions} size={size} />}
    </MapLayout>
  );
};
