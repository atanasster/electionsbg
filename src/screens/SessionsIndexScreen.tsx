import { FC, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";
import { Calendar, X } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { useRollcallIndex } from "@/data/parliament/votes/useRollcallIndex";
import { useVoteDaySummary } from "@/data/parliament/votes/useVoteDaySummary";
import { useDayLabel } from "@/ux/feed";
import { SessionOutcomeBar } from "@/screens/components/votes/SessionOutcomeBar";
import { TopicChip } from "@/screens/components/votes/TopicChip";
import type {
  RollcallIndexEntry,
  VoteTopic,
} from "@/data/parliament/votes/types";

// timeZone: "UTC" via the shared hook. These are calendar days parsed as UTC midnight; the
// local formatter this replaced rendered 2026-07-24 as "23 юли" for every reader west of
// UTC, so the row's date and the /votes/<date> it links to disagreed by one.

export const SessionsIndexScreen: FC = () => {
  const { t } = useTranslation();
  const { sessions, currentNs, isLoading } = useRollcallIndex();
  // One aggregate row per plenary day, not the whole 8 MB corpus (plan §7, P5).
  const { byDate } = useVoteDaySummary();
  const [params, setParams] = useSearchParams();
  const topicFilter = params.get("topic") as VoteTopic | null;
  const day = useDayLabel("long");

  // When the user clicks a TopicChip elsewhere we land here with `?topic=`.
  // Only keep sessions that contain at least one item of that topic.
  const visibleSessions = useMemo(() => {
    if (!topicFilter) return sessions;
    return sessions.filter((s) =>
      (byDate.get(s.date)?.topics ?? []).includes(topicFilter),
    );
  }, [sessions, topicFilter, byDate]);

  const columns: DataTableColumns<RollcallIndexEntry, unknown> = useMemo(
    () => [
      {
        accessorKey: "date",
        header: t("votes_session_date") || "Date",
        cell: ({ row }) => (
          <Link
            to={`/votes/${row.original.date}`}
            underline={false}
            className="flex items-center gap-2 hover:underline"
          >
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium tabular-nums">
              {day(row.original.date)}
            </span>
          </Link>
        ),
      },
      {
        accessorKey: "items",
        header: t("votes_session_items") || "Vote items",
        cell: ({ row }) => {
          const buckets = byDate.get(row.original.date)?.buckets;
          return (
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-right shrink-0 w-8 text-muted-foreground">
                {row.original.items}
              </span>
              <div className="flex-1 min-w-[80px]">
                {buckets ? <SessionOutcomeBar buckets={buckets} /> : null}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "stenogramId",
        header: t("votes_index_stenogram") || "Stenogram",
        cell: ({ row }) => (
          <a
            href={`https://www.parliament.bg/bg/plenaryst/ns/${row.original.ns ?? ""}/ID/${row.original.stenogramId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground tabular-nums hover:underline"
          >
            #{row.original.stenogramId}
          </a>
        ),
      },
    ],
    [t, day, byDate],
  );

  const pageTitle = t("votes_index_title") || "Roll-call votes";

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={t("votes_index_description") || pageTitle}>
        {pageTitle}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="gov_hub_parliament_title"
        sectionTo="/parliament"
        currentKey="sessions_index_title"
        className="mt-5"
      />

      <div className="pb-12 space-y-6">
        <p className="text-sm text-muted-foreground max-w-3xl">
          {t("votes_index_intro") ||
            "Every voting day in the National Assembly. Click a date to see how MPs voted on each item."}
          {currentNs && (
            <span className="ml-2 text-xs">
              · {t("votes_index_current_ns") || "Current parliament"}:{" "}
              {currentNs}
            </span>
          )}
        </p>

        {topicFilter && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("votes_topic_filter_active") || "Filtering by topic"}:
            </span>
            <TopicChip topic={topicFilter} linkable={false} />
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete("topic");
                setParams(next);
              }}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <X className="h-3 w-3" />
              {t("votes_topic_filter_clear") || "Clear topic filter"}
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("loading") || "Loading…"}
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("votes_index_empty") ||
              "No roll-call sessions have been ingested yet."}
          </div>
        ) : (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-2">
              {t("votes_landing_browse_all") || "Browse all voting days"}
              <span className="ml-2 font-normal normal-case text-muted-foreground tabular-nums">
                ({visibleSessions.length})
              </span>
            </h2>
            <DataTable<RollcallIndexEntry, unknown>
              title={pageTitle}
              pageSize={25}
              columns={columns}
              data={visibleSessions}
              initialSort={[{ id: "date", desc: true }]}
            />
          </section>
        )}
      </div>
    </div>
  );
};
