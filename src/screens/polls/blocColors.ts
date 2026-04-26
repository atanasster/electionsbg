import { BlocId } from "@/data/polls/pollsTypes";

export const BLOC_COLORS: Record<BlocId, string> = {
  right_govt: "rgb(12, 69, 135)", // GERB blue
  reformist: "rgb(66, 0, 255)", // PP-DB purple
  nationalist: "rgb(51, 51, 51)", // Vazrazhdane near-black
  left: "rgb(237, 28, 36)", // BSP red
  minority: "rgb(33, 125, 223)", // DPS blue
  populist: "rgb(75, 185, 222)", // ITN cyan
  other: "#888888",
};

export const BLOC_LABELS: Record<BlocId, { en: string; bg: string }> = {
  right_govt: { en: "Right (GERB)", bg: "Десни (ГЕРБ)" },
  reformist: { en: "Reformist", bg: "Реформистки" },
  nationalist: { en: "Nationalist", bg: "Националистически" },
  left: { en: "Left (BSP)", bg: "Леви (БСП)" },
  minority: { en: "Minority (DPS)", bg: "Малцинствени (ДПС)" },
  populist: { en: "Populist", bg: "Популистки" },
  other: { en: "Other", bg: "Други" },
};
