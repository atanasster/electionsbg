import { Section } from "@/layout/Section";
import "react-toastify/dist/ReactToastify.css";
import { ToastContainer } from "react-toastify";
// import { ToastContainer, toast } from "react-toastify";
import { municipalities, regions } from "./data/json_types";
import { RegionsMap } from "./components/RegionsMap";
import { useContext } from "react";
import { RegionContext } from "@/contexts/RegionContext";
import { MunicipalitiesMap } from "./components/MunicipalitiesMap";

export const Dashboard = () => {
  const { code: regionCode } = useContext(RegionContext);
  return (
    <Section title={`${regionCode ? regionCode : "Country"} map`}>
      {regionCode ? (
        <MunicipalitiesMap
          municipalities={municipalities}
          region={regionCode}
        />
      ) : (
        <RegionsMap regions={regions} />
      )}
      <ToastContainer />
    </Section>
  );
};
