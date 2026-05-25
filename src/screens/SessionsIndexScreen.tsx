import { FC, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";
import { Calendar, X } from "lucide-react";
import { Title } from "@/ux/Title";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { useRollcallIndex } from "@/data/parliament/votes/useRollcallIndex";
import { useTopicIndex } from "@/data/parliament/votes/useTopicIndex";
import { ParliamentVotingTile } from "@/screens/dashboard/ParliamentVotingTile";
import { ContestedVotesFeed } from "@/screens/components/votes/ContestedVotesFeed";
import { SessionOutcomeBar } from "@/screens/components/votes/SessionOutcomeBar";
import { TopicChip } from "@/screens/components/votes/TopicChip";
import type {
  RollcallIndexEntry,
  TopicEntry,
  VoteTopic,
} from "@/data/parliament/votes/types";

const formatDate = (iso: string, lang: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
};

export const SessionsIndexScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { sessions, currentNs, isLoading } = useRollcallIndex();
  const { entries: topicEntries } = useTopicIndex();
  const [params, setParams] = useSearchParams();
  const topicFilter = params.get("topic") as VoteTopic | null;
  const lang = i18n.language;

  // Group topic entries by date so the outcome-bar column lookup is O(1).
  const entriesByDate = useMemo(() => {
    const m = new Map<string, TopicEntry[]>();
    for (const e of topicEntries) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    return m;
  }, [topicEntries]);

  // When the user clicks a TopicChip elsewhere we land here with `?topic=`.
  // Only keep sessions that contain at least one item of that topic.
  const visibleSessions = useMemo(() => {
    if (!topicFilter) return sessions;
    return sessions.filter((s) =>
      (entriesByDate.get(s.date) ?? []).some((e) => e.topic === topicFilter),
    );
  }, [sessions, topicFilter, entriesByDate]);

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
              {formatDate(row.original.date, lang)}
            </span>
          </Link>
        ),
      },
      {
        accessorKey: "items",
        header: t("votes_session_items") || "Vote items",
        cell: ({ row }) => {
          const entries = entriesByDate.get(row.original.date) ?? [];
          return (
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-right shrink-0 w-8 text-muted-foreground">
                {row.original.items}
              </span>
              <div className="flex-1 min-w-[80px]">
                <SessionOutcomeBar entries={entries} />
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
    [t, lang, entriesByDate],
  );

  const pageTitle = t("votes_index_title") || "Roll-call votes";

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={t("votes_index_description") || pageTitle}>
        {pageTitle}
      </Title>

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

        {!topicFilter && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h2 className="sr-only">
                {t("votes_landing_correlation_title") ||
                  "How groups vote together"}
              </h2>
              <ParliamentVotingTile />
            </div>
            <ContestedVotesFeed />
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
