import InfiniteScroll from "react-infinite-scroll-component";
import { SectionInfo } from "@/data/dataTypes";
import { useSectionsInfo } from "@/data/useSectionsInfo";
import { FC, useState } from "react";
import { Section } from "./Section";
import { Title } from "@/ux/Title";
import { useTranslation } from "react-i18next";

const pageSize = 3;
export const Sections: FC<{ sections: SectionInfo[] }> = ({ sections }) => {
  const { findSection } = useSectionsInfo();
  const { t } = useTranslation();
  const [itemsCount, setItemsCount] = useState(pageSize);
  const getNextPage = () => {
    setItemsCount(Math.min(sections.length, itemsCount + pageSize));
  };
  return (
    <>
      {!!sections.length && (
        <Title description="Bulgaria election results in a set of polling stations">{`${t("total_sections")}: ${sections.length}`}</Title>
      )}
      <InfiniteScroll
        dataLength={itemsCount}
        next={getNextPage}
        hasMore={itemsCount < sections.length}
        loader={<div>Loading...</div>}
      >
        {sections
          .filter((_, index) => index < itemsCount)
          .map((section) => {
            const votes = findSection(section.section);
            if (!votes) {
              return null;
            }

            return <Section key={section.section} section={section} />;
          })}
      </InfiniteScroll>
    </>
  );
};
