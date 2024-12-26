import { PartyInfo } from "@/data/dataTypes";
import { cn } from "@/lib/utils";
import { FC, PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";

export const PartyLabel: FC<
  PropsWithChildren<{ party?: PartyInfo; className?: string }>
> = ({ children, className, party }) => {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        `flex justify-between p-1 bg-primary text-center text-white font-bold overflow-hidden whitespace-nowrap`,
        className,
      )}
      style={{ backgroundColor: party?.color }}
    >
      <div>{party?.nickName || t("unknown_party")}</div>
      {children}
    </div>
  );
};
