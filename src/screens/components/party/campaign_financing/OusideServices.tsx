import { FilingExternalServices } from "@/data/dataTypes";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ItemsTree, TreeItemType } from "./ItemsTree";
import { useMediaServices } from "./useMediaServices";

export const OutsideServices: FC<{
  services?: FilingExternalServices;
  priorServices?: FilingExternalServices;
}> = ({ services, priorServices }) => {
  const { t } = useTranslation();
  const mediaServices = useMediaServices({
    media: services?.mediaServices,
    priorMedia: priorServices?.mediaServices,
  });
  return useMemo(() => {
    const items: TreeItemType[] = [
      {
        label: t("media"),
        items: mediaServices,
      },
      {
        label: t("polling_agencies"),
        amount: services?.pollingAgencies,
        priorAmount: priorServices?.pollingAgencies,
      },
      {
        label: t("consulting"),
        amount: services?.consulting,
        priorAmount: priorServices?.consulting,
      },
      {
        label: t("party_materials"),
        amount: services?.partyMaterials,
        priorAmount: priorServices?.partyMaterials,
      },
      {
        label: t("public_events"),
        amount: services?.publicEvents,
        priorAmount: priorServices?.publicEvents,
      },
      {
        label: t("postal_expenses"),
        amount: services?.postalExpenses,
        priorAmount: priorServices?.postalExpenses,
      },
      {
        label: t("rental_expenses"),
        amount: services?.rentalExpenses,
        priorAmount: priorServices?.rentalExpenses,
      },
      {
        label: t("other"),
        amount: services?.otherExpenses,
        priorAmount: priorServices?.otherExpenses,
      },
    ];
    return <ItemsTree items={items} />;
  }, [priorServices, services, mediaServices, t]);
};
