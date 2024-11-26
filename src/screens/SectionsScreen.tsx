import { useSearchParams } from "react-router-dom";
import { useSettlementsInfo } from "@/data/useSettlements";
import { useSectionsInfo } from "@/data/useSectionsInfo";
import { Sections } from "./components/Sections";

export const SectionsScreen = () => {
  const [searchParams] = useSearchParams();
  const { findSections } = useSectionsInfo();
  const { findSettlement } = useSettlementsInfo();
  const regionCode = searchParams.get("region");
  const muniCode = searchParams.get("municipality");
  const settlementCode = searchParams.get("settlement");

  if (!regionCode || !muniCode || !settlementCode) {
    return null;
  }
  const info = findSettlement(settlementCode);

  if (!info) {
    return null;
  }

  const sections = findSections(info.ekatte);
  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      {sections ? <Sections sections={sections} /> : null}
    </div>
  );
};
