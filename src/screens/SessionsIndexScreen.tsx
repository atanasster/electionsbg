import { FC, useMemo } from "react";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import { Title } from "@/ux/Title";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { useRollcallIndex } from "@/data/parliament/votes/useRollcallIndex";
import type { RollcallIndexEntry } from "@/data/parliament/votes/types";

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
  const lang = i18n.language;

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
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{row.original.items}</div>
        ),
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
    [t, lang],
  );

  const pageTitle = t("votes_index_title") || "Roll-call votes";

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={t("votes_index_description") || pageTitle}>
        {pageTitle}
      </Title>

      <div className="max-w-5xl mx-auto pb-12">
        <p className="text-sm text-muted-foreground mb-6">
          {t("votes_index_intro") ||
            "Every voting day in the National Assembly. Click a date to see how MPs voted on each item."}
          {currentNs && (
            <span className="ml-2 text-xs">
              · {t("votes_index_current_ns") || "Current parliament"}:{" "}
              {currentNs}
            </span>
          )}
        </p>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("loading") || "Loading…"}
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("votes_index_empty") ||
              "No roll-call sessions have been ingested yet."}
          </div>
        ) : (
          <DataTable<RollcallIndexEntry, unknown>
            title={pageTitle}
            pageSize={25}
            columns={columns}
            data={sessions}
            initialSort={[{ id: "date", desc: true }]}
          />
        )}
      </div>
    </div>
  );
};
