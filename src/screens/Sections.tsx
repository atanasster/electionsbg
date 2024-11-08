import { useSearchParams } from "react-router-dom";
import { useSettlementsInfo } from "@/data/SettlementsContext";
import { useElectionInfo } from "@/data/ElectionsContext";

export const SectionsScreen = () => {
  const [searchParams] = useSearchParams();
  const { findSections } = useElectionInfo();
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
  const sections = findSections(regionCode, muniCode, info);
  console.log(sections);

  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      <table>
        <thead>
          <tr>
            <th>Settlement</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => {
            return (
              <tr key={section.section}>
                <td>{section.settlement}</td>
                <td>{section.address}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
