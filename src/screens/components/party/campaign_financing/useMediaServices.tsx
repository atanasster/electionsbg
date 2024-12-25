import { MediaServices } from "@/data/dataTypes";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TreeItemType } from "./ItemsTree";

export const useMediaServices = ({
  media,
  priorMedia,
}: {
  media?: MediaServices;
  priorMedia?: MediaServices;
}): TreeItemType[] => {
  const { t } = useTranslation();
  return useMemo(() => {
    return [
      {
        label: t("printed_media"),
        amount: media?.printedMedia,
        priorAmount: priorMedia?.printedMedia,
      },
      {
        label: t("audio_visual"),
        items: [
          {
            label: t("national_tv"),
            amount: media?.digitalMultiMedia.nationalTV,
            priorAmount: priorMedia?.digitalMultiMedia.nationalTV,
          },
          {
            label: t("other_visual"),
            amount: media?.digitalMultiMedia.otherVisualMedia,
            priorAmount: priorMedia?.digitalMultiMedia.otherVisualMedia,
          },
          {
            label: t("national_radio"),
            amount: media?.digitalMultiMedia.nationalRadio,
            priorAmount: priorMedia?.digitalMultiMedia.nationalRadio,
          },
          {
            label: t("other_radio"),
            amount: media?.digitalMultiMedia.otherRadio,
            priorAmount: priorMedia?.digitalMultiMedia.otherRadio,
          },
        ],
      },
      {
        label: t("digital_other_media"),
        amount: media?.digitalMedia,
        priorAmount: priorMedia?.digitalMedia,
      },
    ];
  }, [priorMedia, media, t]);
};
