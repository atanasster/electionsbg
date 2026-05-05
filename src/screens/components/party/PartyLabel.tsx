import { PartyInfo } from "@/data/dataTypes";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { cn } from "@/lib/utils";
import { FC, PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";

export const PartyLabel: FC<
  PropsWithChildren<{ party?: PartyInfo; className?: string }>
> = ({ children, className, party }) => {
  const { t } = useTranslation();
  const { displayNameFor } = useCanonicalParties();
  const label = party?.nickName
    ? (displayNameFor(party.nickName) ?? party.nickName)
    : t("unknown_party");
  return (
    <div
      className={cn(
        `flex justify-between p-1 bg-primary text-center text-white font-bold overflow-hidden whitespace-nowrap`,
        className,
      )}
      style={{ backgroundColor: party?.color }}
    >
      <div>{label}</div>
      {children}
    </div>
  );
};
