import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import type { VoteTopic } from "@/data/parliament/votes/types";

interface Props {
  topic: VoteTopic;
  // When set, the chip becomes a link to the filtered sessions list.
  linkable?: boolean;
}

// Small pill rendered next to a vote item title. Visually subdued — topic
// tags are coarse signal, not the headline.
export const TopicChip: FC<Props> = ({ topic, linkable = true }) => {
  const { t } = useTranslation();
  const label = t(`votes_topic_label_${topic}`, { defaultValue: "" }) || topic;
  const className =
    "inline-flex items-center rounded-full bg-muted text-muted-foreground text-[10px] uppercase tracking-wide px-2 py-0.5 font-medium leading-none";

  if (!linkable) return <span className={className}>{label}</span>;
  return (
    <Link
      to={{ pathname: "/votes", search: { topic } }}
      underline={false}
      className={`${className} hover:bg-muted/70`}
    >
      {label}
    </Link>
  );
};
