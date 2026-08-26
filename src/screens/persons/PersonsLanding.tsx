// The /persons landing — `RegistryLanding` with this page's strings and its mix bar.
//
// The public API is unchanged, so `PersonsLanding.test.tsx` goes on holding the shared
// component's three-state count contract to /persons' expectations without knowing the
// extraction happened.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  RegistryLanding,
  type LandingCard,
} from "@/screens/components/RegistryLanding";
import {
  PERSONS_LANDING_LABELS,
  PERSONS_REGISTRY_ID_PREFIX,
} from "./personsBrowseConstants";

export type { LandingCard };

export const PersonsLanding: FC<{
  cards: LandingCard[];
  mix: ReactNode;
  browseAll: { label: string; onClick: () => void };
  fmtInt: (n: number) => string;
}> = ({ cards, mix, browseAll, fmtInt }) => {
  const { t } = useTranslation();
  return (
    <RegistryLanding
      cards={cards}
      above={mix}
      browse={[
        {
          key: "all",
          label: browseAll.label,
          // Resolved HERE rather than in RegistryLanding, because a page with two browse
          // actions (/companies) gives each its own — so the shared component takes each hint
          // as a resolved string rather than a key.
          hint: t("persons_browse_all_hint", {
            defaultValue:
              "Пълният списък, подреден по обществена значимост. Търсенето и филтрите горе стесняват по-бързо.",
          }),
          onClick: browseAll.onClick,
        },
      ]}
      labels={PERSONS_LANDING_LABELS}
      idPrefix={PERSONS_REGISTRY_ID_PREFIX}
      fmtInt={fmtInt}
    />
  );
};
