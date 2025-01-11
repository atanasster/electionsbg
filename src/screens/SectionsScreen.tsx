import { useParams } from "react-router-dom";
import { Sections } from "./components/sections/Sections";

export const SectionsScreen = () => {
  const { id: settlementCode } = useParams();

  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      {settlementCode && <Sections ekatte={settlementCode} />}
    </div>
  );
};
