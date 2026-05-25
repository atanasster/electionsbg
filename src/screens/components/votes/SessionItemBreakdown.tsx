import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { PartyTag } from "@/screens/components/party/PartyTag";
import { TopicChip } from "@/screens/components/votes/TopicChip";
import type { SessionFile, VoteValue } from "@/data/parliament/votes/types";
import type {
  ItemMetrics,
  PartyTally,
} from "@/data/parliament/votes/sessionMetrics";

type Props = {
  session: SessionFile;
  perItem: ItemMetrics[];
};

const VOTE_COLOR: Record<VoteValue, string> = {
  yes: "#10b981",
  no: "#ef4444",
  abstain: "#f59e0b",
  absent: "#e5e7eb",
};

type Outcome =
  | "passed_unanimous"
  | "passed"
  | "rejected_unanimous"
  | "rejected"
  | "abstain_unanimous"
  | "contested";

const outcomeFor = (m: ItemMetrics): Outcome => {
  const { yes, no, abstain } = m.item.tallies;
  const cast = yes + no + abstain;
  if (yes === cast) return "passed_unanimous";
  if (no === cast) return "rejected_unanimous";
  if (abstain === cast) return "abstain_unanimous";
  if (yes > no + abstain) return "passed";
  if (no + abstain > yes) return "rejected";
  return "contested";
};

const OUTCOME_CLASS: Record<Outcome, string> = {
  passed_unanimous: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  passed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected_unanimous: "bg-red-500/15 text-red-700 dark:text-red-400",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
  abstain_unanimous: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  contested: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const PartyBar: FC<{ tally: PartyTally; total: number }> = ({
  tally,
  total,
}) => {
  const segments: Array<{ vote: VoteValue; count: number; pct: number }> = [
    { vote: "yes", count: tally.yes, pct: (tally.yes / total) * 100 },
    { vote: "no", count: tally.no, pct: (tally.no / total) * 100 },
    {
      vote: "abstain",
      count: tally.abstain,
      pct: (tally.abstain / total) * 100,
    },
    { vote: "absent", count: tally.absent, pct: (tally.absent / total) * 100 },
  ];
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {segments.map((s) =>
        s.count === 0 ? null : (
          <Tooltip
            key={s.vote}
            content={
              <span className="tabular-nums">
                {s.count} {s.vote}
              </span>
            }
          >
            <div
              className="h-full"
              style={{
                width: `${s.pct}%`,
                backgroundColor: VOTE_COLOR[s.vote],
              }}
            />
          </Tooltip>
        ),
      )}
    </div>
  );
};

export const SessionItemBreakdown: FC<Props> = ({ session, perItem }) => {
  const { t } = useTranslation();
  if (perItem.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {perItem.map((m) => {
        const title = session.itemTitles?.[String(m.item.item)];
        const slug =
          session.itemSlugs?.[String(m.item.item)] ?? String(m.item.item);
        const topic = session.itemTopics?.[String(m.item.item)];
        const outcome = outcomeFor(m);
        const { yes, no, abstain } = m.item.tallies;
        return (
          <section
            key={m.item.item}
            className="rounded-xl border bg-card p-4 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground tabular-nums font-medium">
                    #{m.item.item}
                  </span>
                  {topic && <TopicChip topic={topic} />}
                </div>
                <Link
                  to={`/votes/${session.date}/item-${slug}`}
                  underline={false}
                  className="text-sm font-medium leading-snug line-clamp-2 hover:underline"
                >
                  {title || (t(`votes_outcome_${outcome}`) ?? outcome)}
                </Link>
              </div>
              <span
                className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded whitespace-nowrap ${OUTCOME_CLASS[outcome]}`}
              >
                {t(`votes_outcome_${outcome}`) || outcome}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs tabular-nums">
              <span className="text-emerald-600 font-medium">
                {t("vote_yes") || "Yes"}: {yes}
              </span>
              <span className="text-red-600 font-medium">
                {t("vote_no") || "No"}: {no}
              </span>
              <span className="text-amber-600 font-medium">
                {t("vote_abstain") || "Abstain"}: {abstain}
              </span>
              <span className="text-muted-foreground">
                {t("votes_session_margin") || "margin"} ±{m.marginAbs}
              </span>
              {m.dissenters.length > 0 && (
                <span className="text-muted-foreground">
                  · {m.dissenters.length} {t("mp_voting_dissents") || "dissent"}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              {m.partyTallies.map((tally) => {
                const total =
                  tally.yes + tally.no + tally.abstain + tally.absent;
                if (total === 0) return null;
                return (
                  <div
                    key={tally.party}
                    className="grid grid-cols-[5.5rem_1fr_2.5rem] sm:grid-cols-[7.5rem_1fr_3.25rem] items-center gap-2"
                  >
                    <PartyTag partyShort={tally.party} />
                    <PartyBar tally={tally} total={total} />
                    <span className="text-[10px] text-muted-foreground tabular-nums text-right">
                      {total}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
