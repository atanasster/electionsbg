import { useSearchParams } from "react-router-dom";
import { Sections } from "./components/Sections";

export const SectionsScreen = () => {
  const [searchParams] = useSearchParams();
  const settlementCode = searchParams.get("settlement") || undefined;

  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      <Sections ekatte={settlementCode} />
    </div>
  );
};
