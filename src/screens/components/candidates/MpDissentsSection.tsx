import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { useMpDissents } from "@/data/parliament/votes/useMpDissents";
import { TopicChip } from "@/screens/components/votes/TopicChip";
import type { DissentItem, VoteValue } from "@/data/parliament/votes/types";

type Props = { mpId?: number | null; name: string };

const INITIAL_VISIBLE = 10;

const VOTE_COLOR: Record<Exclude<VoteValue, "absent">, string> = {
  yes: "text-emerald-600",
  no: "text-red-600",
  abstain: "text-amber-600",
};

const formatDate = (iso: string, lang: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
};

// Stacked section under MpVotingTile listing every item where this MP voted
// against their party-plurality vote. Most-recent first, newest 10 visible
// by default with a "show all" expander — we keep the full list rather than
// capping per the Phase 3 decision, and the toggle prevents the candidate
// page from getting unwieldy for highly independent MPs.
export const MpDissentsSection: FC<Props> = ({ mpId, name }) => {
  const { t, i18n } = useTranslation();
  const { entry, isLoading } = useMpDissents(mpId, name);
  const [showAll, setShowAll] = useState(false);

  if (isLoading) return null;
  if (!entry) return null;

  const lang = i18n.language;

  if (entry.dissentCount === 0) {
    return (
      <div className="mt-5 pt-4 border-t">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {t("mp_voting_dissents_title") || "Voted against own party"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("mp_voting_dissents_empty") || "Always voted with the group."}
        </p>
      </div>
    );
  }

  const visible = showAll
    ? entry.recent
    : entry.recent.slice(0, INITIAL_VISIBLE);
  const hidden = entry.dissentCount - visible.length;

  return (
    <div className="mt-5 pt-4 border-t">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {t("mp_voting_dissents_title") || "Voted against own party"}
        <span className="ml-2 font-normal normal-case text-muted-foreground">
          {entry.dissentCount} / {entry.totalCast}
        </span>
      </h3>
      <ul className="divide-y">
        {visible.map((d) => (
          <DissentRow
            key={`${d.date}-${d.item}`}
            d={d}
            lang={lang}
            mpId={mpId}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs text-primary hover:underline"
        >
          {t("mp_voting_dissents_show_all", { count: entry.dissentCount }) ||
            `Show all ${entry.dissentCount} dissents`}
        </button>
      )}
    </div>
  );
};

const DissentRow: FC<{
  d: DissentItem;
  lang: string;
  mpId?: number | null;
}> = ({ d, lang, mpId }) => {
  const { t } = useTranslation();
  const itemUrl = `/votes/${d.date}/item-${d.slug}`;
  const labelMp = t(`vote_${d.mpVote}`) || d.mpVote;
  const labelGroup = t(`vote_${d.majorityVote}`) || d.majorityVote;

  return (
    <li className="py-2">
      <Link
        to={{
          pathname: itemUrl,
          ...(mpId != null ? { search: { mp: String(mpId) } } : {}),
        }}
        underline={false}
        className="block hover:text-primary"
      >
        <div className="flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums mb-0.5 flex-wrap">
          <span>{formatDate(d.date, lang)}</span>
          {d.topic && <TopicChip topic={d.topic} linkable={false} />}
          <span>·</span>
          <span>
            <span className={`font-semibold ${VOTE_COLOR[d.mpVote]}`}>
              {labelMp}
            </span>{" "}
            {t("mp_voting_dissents_vs") || "vs."}{" "}
            <span className={`font-semibold ${VOTE_COLOR[d.majorityVote]}`}>
              {labelGroup}
            </span>{" "}
            <span>({d.groupSize})</span>
          </span>
        </div>
        <div className="text-sm line-clamp-2">{d.title ?? `#${d.item}`}</div>
      </Link>
    </li>
  );
};
