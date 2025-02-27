import { ElectionSettlement } from "@/data/dataTypes";
import settlementsData from "../../../public/settlements.json";
export const parseSettlement2005 = (
  settlementName: string,
  oblast: string,
  settlements?: ElectionSettlement[],
) => {
  let settlement: ElectionSettlement | undefined = undefined;
  const sectionSettlement = settlementName
    .trim()
    .split(/,| и | \(/)
    .map((s) =>
      s
        .split(".")
        .map((p) => p.trim())
        .join("."),
    );
  const list = settlements || settlementsData;
  const matchedNames = list.filter(
    (s) =>
      s.oblast === oblast &&
      s.name &&
      sectionSettlement.find((t) =>
        t.includes(".") ? s.t_v_m && t === s.t_v_m + s.name : t === s.name,
      ),
  );
  if (matchedNames.length >= 1) {
    settlement = matchedNames[0];
  }
  return settlement;
};
