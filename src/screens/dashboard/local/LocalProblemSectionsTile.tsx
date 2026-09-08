// „Проблемни секции" on a LOCAL place page — the parliamentary tile's twin, on the council
// ballot.
//
// ⚠⚠ IT EXISTS BECAUSE THE LOCAL PAGES HAD HALF THE BLOCK. „Рискови гласове" rendered
// `LocalProblemVotesByPartyTile` alone, so a reader saw how the council vote SPLIT inside the
// flagged districts and never saw the districts themselves — how many stations, how many
// people voted, or what the turnout was. Those are the figures the sources are about, and they
// are what the parliamentary and presidential dashboards lead the same section with.
//
// ⚠ NO LINK ON THE DISTRICT NAME, unlike the parliamentary tile. That one links to
// `/reports/section/problem_sections/:id`, which is a report over the PARLIAMENTARY corpus — a
// link from a council result to a parliamentary breakdown of a different ballot is a route a
// reader takes once and is confused by.
//
// ⚠ THE SHARE'S DENOMINATOR IS THE NEIGHBOURHOOD'S OWN VALID COUNCIL VOTES (`numValidVotes`),
// which is what the by-party tile beside it divides by too — two tiles under one heading
// disagreeing about a base is the defect that shape produces.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  LocalProblemSectionsReport,
  useLocalProblemSections,
} from "@/data/local/useLocalProblemSections";
import { formatPct, formatThousands } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { StatCard } from "../StatCard";

type Props = {
  obshtinaCode: string;
  cycle: string;
  /** When set (a район drill-down page), restrict to the neighbourhoods sitting in this 2-digit
   *  административен район; unset folds in every flagged neighbourhood of the município. */
  rayonCode?: string;
};

const select = (
  report: LocalProblemSectionsReport | undefined,
  obshtinaCode: string,
  rayonCode?: string,
) =>
  (report?.neighborhoods ?? []).filter(
    (n) =>
      n.obshtinaCode === obshtinaCode &&
      (!rayonCode || n.rayonCode === rayonCode),
  );

export const LocalProblemSectionsTile: FC<Props> = ({
  obshtinaCode,
  cycle,
  rayonCode,
}) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { displayNameForId } = useCanonicalParties();
  const { data } = useLocalProblemSections(cycle);

  const rows = useMemo(
    () =>
      select(data, obshtinaCode, rayonCode)
        .map((n) => {
          // ⚠ THE LEADER IS PICKED BY VOTES, TIE-BROKEN BY BALLOT NUMBER — a stable order, so
          // two renders of the same data cannot name two different winners.
          const leader = [...n.parties].sort(
            (a, b) => b.votes - a.votes || a.localPartyNum - b.localPartyNum,
          )[0];
          return {
            id: n.id,
            name: isBg ? n.name_bg : n.name_en,
            city: isBg ? n.city_bg : n.city_en,
            sourceUrl: n.source_url,
            sections: n.sectionCount,
            voters: n.totalActualVoters,
            turnout: n.numRegisteredVoters
              ? (100 * n.totalActualVoters) / n.numRegisteredVoters
              : 0,
            leader:
              leader && leader.votes > 0
                ? {
                    name:
                      (leader.primaryCanonicalId
                        ? displayNameForId(leader.primaryCanonicalId)
                        : undefined) ?? leader.localPartyName,
                    color: leader.color,
                    votes: leader.votes,
                    pct: n.numValidVotes
                      ? (100 * leader.votes) / n.numValidVotes
                      : 0,
                  }
                : null,
          };
        })
        .sort((a, b) => b.sections - a.sections || a.id.localeCompare(b.id)),
    [data, obshtinaCode, rayonCode, isBg, displayNameForId],
  );

  if (!rows.length) return null;

  const head =
    "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <StatCard
      label={
        <Hint text={t("dashboard_problem_sections_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            <span>{t("problem_sections")}</span>
          </div>
        </Hint>
      }
    >
      <div className="grid grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto_minmax(80px,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 mt-1 text-sm">
        <span className={head}>{t("dashboard_neighborhood")}</span>
        <span className={`${head} text-right`}>{t("dashboard_sections")}</span>
        <span className={`${head} text-right`}>{t("voted")}</span>
        <span className={`${head} text-right`}>{t("dashboard_turnout")}</span>
        <span className={head}>{t("dashboard_top_party")}</span>
        <span />
        <span className={`${head} text-right`}>{t("votes")}</span>
        <span className={`${head} text-right`}>{t("dashboard_share")}</span>
        {rows.map((r) => (
          <div className="contents" key={r.id}>
            <div className="min-w-0">
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {r.city}
                {" · "}
                {/* ⚠ THE SOURCE, NOT A FOOTNOTE. „Рисков" is somebody else's published
                    finding, and the presidential twin of this tile carries the same link for
                    the same reason. */}
                <a
                  className="underline"
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("source")}
                </a>
              </span>
            </div>
            <span className="text-right text-xs font-semibold tabular-nums">
              {formatThousands(r.sections)}
            </span>
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {formatThousands(r.voters)}
            </span>
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {formatPct(r.turnout, 1)}
            </span>
            <div className="flex min-w-0 items-center gap-2">
              {r.leader ? (
                <>
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: r.leader.color || "#888" }}
                  />
                  <span className="truncate font-medium">{r.leader.name}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
            {r.leader ? (
              <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute bottom-0 left-0 top-0 rounded-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, r.leader.pct))}%`,
                    backgroundColor: r.leader.color || "#888",
                  }}
                />
              </div>
            ) : (
              <span />
            )}
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {r.leader ? formatThousands(r.leader.votes) : "–"}
            </span>
            <span className="text-right text-xs font-semibold tabular-nums">
              {r.leader ? formatPct(r.leader.pct, 1) : "–"}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
