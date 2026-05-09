import { FC } from "react";
import { PartyInfo } from "@/data/dataTypes";
import { Title } from "@/ux/Title";
import { Caption } from "@/ux/Caption";
import { PartyLink } from "./PartyLink";

export const PartyHeader: FC<{
  party?: PartyInfo;
  fullName: string;
  subtitle?: string;
  seoTitle?: string;
  seoDescription?: string;
}> = ({ party, fullName, subtitle, seoTitle, seoDescription }) => {
  const isMain = !subtitle;
  const captionText = subtitle ?? fullName;
  const resolvedSeoTitle =
    seoTitle ?? (isMain ? fullName : `${fullName} — ${subtitle}`);
  const resolvedSeoDescription = seoDescription ?? captionText;
  return (
    <>
      <Title
        className="w-auto flex justify-center pt-4 pb-1 md:pt-10 md:pb-2"
        title={resolvedSeoTitle}
        description={resolvedSeoDescription}
      >
        <PartyLink
          className="w-auto px-4"
          party={party}
          width="w-16"
          link={!isMain}
        />
      </Title>
      <Caption>{captionText}</Caption>
    </>
  );
};
