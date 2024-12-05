import { PartyInfo } from "@/data/dataTypes";
import { Hint } from "@/ux/Hint";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const PartyLabel: FC<{ party?: PartyInfo }> = ({ party }) => {
  const { t } = useTranslation();
  return (
    <Hint text={`${party ? party?.name : t("unknown_party")}`}>
      <div
        className={`px-2 text-white font-bold max-w-32`}
        style={{ backgroundColor: party?.color }}
      >
        {party?.nickName || t("unknown_party")}
      </div>
    </Hint>
  );
};
