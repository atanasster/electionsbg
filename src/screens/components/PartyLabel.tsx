import { PartyInfo } from "@/data/dataTypes";
import { Hint } from "@/ux/Hint";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const PartyLabel: FC<{ party?: PartyInfo }> = ({ party }) => {
  const { t } = useTranslation();
  const isXSmall = useMediaQueryMatch("xs");
  return (
    <Hint text={`${party ? party?.name : t("unknown_party")}`}>
      <div
        className={`px-2 text-white font-bold ${isXSmall ? "max-w-16" : "max-w-32"} overflow-hidden whitespace-nowrap`}
        style={{ backgroundColor: party?.color }}
      >
        {party?.nickName || t("unknown_party")}
      </div>
    </Hint>
  );
};
