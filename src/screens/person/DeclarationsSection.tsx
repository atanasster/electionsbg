// The ONE declarations section shell. Three components can open the person page's
// declarations block — PersonMpSections (MP snapshot + filing list), PersonDeclarations
// (the standalone PG list) and PersonNoDeclarationNote ("this office does not file") — and
// the page must show exactly one of them, never two and never zero.
//
// Before this module each wrote its own `<DashboardSection id="declarations" …>`, so the
// invariant lived only in prose and in a predicate two of the three consulted. That is how
// the duplicate shipped in the first place. With one shell the id and the heading have a
// single site, and a test can count `#declarations` and mean something by it.
//
// The anchor is exported because it is a DEEP-LINK TARGET — MpScorecardTile's net-worth
// metric drills to it — so the href and the element must be written once, not twice.

import { FC, PropsWithChildren, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";

export const DECLARATIONS_ANCHOR = "declarations" as const;

export const DeclarationsSection: FC<
  PropsWithChildren<{ subtitle?: ReactNode }>
> = ({ subtitle, children }) => {
  const { t } = useTranslation();
  return (
    <DashboardSection
      id={DECLARATIONS_ANCHOR}
      title={t("mp_section_assets") || "Assets & declarations"}
      icon={Wallet}
      subtitle={subtitle}
    >
      {children}
    </DashboardSection>
  );
};
