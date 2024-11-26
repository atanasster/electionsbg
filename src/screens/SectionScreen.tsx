import { useSearchParams } from "react-router-dom";
import { useSectionsInfo } from "@/data/useSectionsInfo";
import { Section } from "./components/Section";

export const SectionScreen = () => {
  const [searchParams] = useSearchParams();
  const { findSection } = useSectionsInfo();
  const sectionCode = searchParams.get("section");
  if (!sectionCode) {
    return null;
  }

  const section = findSection(sectionCode);
  if (!section) {
    return null;
  }
  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      <Section section={section} />
    </div>
  );
};
