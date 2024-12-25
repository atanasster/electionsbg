import { MediaServices } from "@/data/dataTypes";
import { FC } from "react";
import { ItemsTree } from "./ItemsTree";
import { useMediaServices } from "./useMediaServices";

export const MediaPackage: FC<{
  media?: MediaServices;
  priorMedia?: MediaServices;
}> = ({ media, priorMedia }) => {
  const mediaServices = useMediaServices({ media, priorMedia });
  return <ItemsTree items={mediaServices} />;
};
