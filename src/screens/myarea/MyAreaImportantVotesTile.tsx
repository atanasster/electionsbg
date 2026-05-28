// "Как гласуваха" — voting record of the area's MPs on the most consequential
// roll-call items from the currently-selected NS. Sits beneath
// MyAreaRepresentativesStrip and reuses the same MP row resolution so the
// columns line up with the avatars in the strip above.
//
// One row per important vote. Each row carries: a topic + outcome chip pair,
// the bill/motion title (linked to the vote-detail page), and a horizontal
// strip of mini-avatars — one per area MP — colored by how that MP voted.
// Hover a circle to see the MP's name + vote label.
//
// Auto-hides when the current cycle isn't parliamentary, when no MPs resolve
// for the area, or when the importance-filter returns no items for the
// selected NS slice.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useElectionContext } from "@/data/ElectionContext";
import { useMps, type MpIndexEntry } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { useCycleKind } from "@/data/area/useCycleKind";
import { Link } from "@/ux/Link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { useAreaImportantVotes } from "@/data/myarea/useAreaImportantVotes";
import type {
  VoteValue,
  VoteOutcome,
  VoteTopic,
} from "@/data/parliament/votes/types";

type Props = {
  oblast: string;
};

// Match the palette used in RollcallHeatmap / SessionVoteHemicycle so the
// circles read consistently across the site.
const VOTE_COLOR: Record<VoteValue, string> = {
  yes: "#10b981",
  no: "#ef4444",
  abstain: "#f59e0b",
  absent: "#9ca3af",
};

const VOTE_LABEL_KEY: Record<VoteValue, string> = {
  yes: "vote_yes",
  no: "vote_no",
  abstain: "vote_abstain",
  absent: "vote_absent",
};

const TOPIC_LABEL: Record<VoteTopic, { bg: string; en: string }> = {
  confidence_vote: { bg: "Вот на доверие", en: "Confidence vote" },
  ratification: { bg: "Ратификация", en: "Ratification" },
  constitution: { bg: "Конституция", en: "Constitution" },
  personnel: { bg: "Кадрови", en: "Personnel" },
  budget: { bg: "Бюджет", en: "Budget" },
  zkpo: { bg: "ЗКПО", en: "CIT" },
  tax: { bg: "Данъци", en: "Tax" },
  zid: { bg: "ЗИД", en: "Amendment" },
  other: { bg: "Друго", en: "Other" },
};

const OUTCOME_LABEL: Record<VoteOutcome, { bg: string; en: string }> = {
  passed_unanimous: { bg: "Прието единодушно", en: "Passed unanimously" },
  passed: { bg: "Прието", en: "Passed" },
  rejected_unanimous: {
    bg: "Отхвърлено единодушно",
    en: "Rejected unanimously",
  },
  rejected: { bg: "Отхвърлено", en: "Rejected" },
  abstain_unanimous: { bg: "Въздържане", en: "Abstained" },
  contested: { bg: "Оспорено", en: "Contested" },
};

const outcomeToneClass = (outcome: VoteOutcome): string => {
  if (outcome === "passed" || outcome === "passed_unanimous") {
    return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
  }
  if (outcome === "rejected" || outcome === "rejected_unanimous") {
    return "bg-rose-500/10 text-rose-700 border-rose-500/30";
  }
  return "bg-amber-500/10 text-amber-700 border-amber-500/30";
};

type MpRow = {
  mp: MpIndexEntry;
  displayName: string;
  partyColor: string;
};

export const MyAreaImportantVotesTile: FC<Props> = ({ oblast }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { selected } = useElectionContext();
  const cycle = useCycleKind();
  const { findMpsByRegion } = useMps();
  const { lookup: lookupParliamentGroup } = useParliamentGroups();
  const { mpName } = useCandidateName();

  const isParliamentaryCycle = cycle.kind === "parliament";
  const nsFolder = isParliamentaryCycle ? electionToNsFolder(selected) : null;
  const mir = oblastToMir(oblast);

  // Mirror MyAreaRepresentativesStrip's resolution so column order matches
  // the avatars displayed above. Hooks are cached by React Query, so the
  // duplicate findMpsByRegion call is effectively free.
  const mpRows: MpRow[] = useMemo(() => {
    if (!nsFolder || !mir) return [];
    return findMpsByRegion(mir, nsFolder).map((mp) => {
      const groupOverride = lookupParliamentGroup(mp.currentPartyGroupShort);
      const partyColor = groupOverride?.color ?? "#888";
      return { mp, displayName: mpName(mp), partyColor };
    });
  }, [nsFolder, mir, findMpsByRegion, lookupParliamentGroup, mpName]);

  const mpIds = useMemo(() => mpRows.map((r) => r.mp.id), [mpRows]);
  const { items, isLoading } = useAreaImportantVotes(mpIds);

  if (!isParliamentaryCycle || !mir || mpRows.length === 0) return null;
  if (!isLoading && items.length === 0) return null;

  const dateFmt = new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2 mb-1">
        <Vote className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">
          {lang === "bg" ? "Как гласуваха" : "How they voted"}
        </h2>
        {!isLoading && items.length > 0 ? (
          <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
            {items.length}{" "}
            {lang === "bg"
              ? items.length === 1
                ? "гласуване"
                : "гласувания"
              : items.length === 1
                ? "vote"
                : "votes"}
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {lang === "bg"
          ? `Последни важни гласувания в ${nsFolder ?? ""}-то Народно събрание`
          : `Recent key votes in the ${nsFolder ?? ""}th National Assembly`}
      </p>

      {isLoading && items.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {lang === "bg" ? "Зарежда се…" : "Loading…"}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {items.map((it) => {
          const topicLabel = TOPIC_LABEL[it.topic][lang];
          const outcomeLabel = OUTCOME_LABEL[it.outcome][lang];
          const totalCast = it.tally.yes + it.tally.no + it.tally.abstain;
          return (
            <div
              key={`${it.date}-${it.item}`}
              className="rounded-md border bg-card/40 p-2.5 flex flex-col gap-2"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-block text-[9px] tabular-nums px-1.5 py-0.5 rounded border bg-muted/50 text-muted-foreground border-border leading-none">
                  {topicLabel}
                </span>
                <span
                  className={`inline-block text-[9px] tabular-nums px-1.5 py-0.5 rounded border leading-none ${outcomeToneClass(
                    it.outcome,
                  )}`}
                >
                  {outcomeLabel}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                  {dateFmt.format(new Date(it.date))}
                  {totalCast > 0
                    ? ` · ${it.tally.yes}–${it.tally.no}–${it.tally.abstain}`
                    : ""}
                </span>
              </div>
              <Link
                to={it.href}
                underline={false}
                className="text-xs font-medium leading-snug hover:underline group flex gap-1 items-start"
              >
                <span className="line-clamp-2">{it.title}</span>
                <ChevronRight className="size-3 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
              </Link>
              <div className="flex flex-wrap gap-1">
                {mpRows.map((row) => {
                  const vote = it.mpVotes.get(row.mp.id) ?? "absent";
                  const voteColor = VOTE_COLOR[vote];
                  const voteLabel = t(VOTE_LABEL_KEY[vote]);
                  const aria = `${row.displayName} — ${voteLabel}`;
                  return (
                    <Link
                      key={row.mp.id}
                      to={candidateUrlForMp(row.mp.id)}
                      underline={false}
                      aria-label={aria}
                      title={aria}
                      className="block"
                    >
                      <Avatar
                        className="h-6 w-6 ring-2 shrink-0 hover:scale-110 transition-transform"
                        style={{ ["--tw-ring-color" as string]: voteColor }}
                      >
                        {row.mp.photoUrl ? (
                          <AvatarImage
                            src={row.mp.photoUrl}
                            alt={row.displayName}
                            className="object-cover"
                          />
                        ) : null}
                        <AvatarFallback
                          className="text-[8px] font-bold text-white"
                          style={{ backgroundColor: row.partyColor }}
                        >
                          {initials(row.displayName)}
                        </AvatarFallback>
                      </Avatar>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend — once at the bottom, not per row. */}
      <div className="mt-3 pt-2 border-t flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        {(["yes", "no", "abstain", "absent"] as VoteValue[]).map((v) => (
          <span key={v} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full ring-2"
              style={{
                ["--tw-ring-color" as string]: VOTE_COLOR[v],
                backgroundColor: "var(--card)",
              }}
            />
            {t(VOTE_LABEL_KEY[v])}
          </span>
        ))}
      </div>
    </Card>
  );
};
