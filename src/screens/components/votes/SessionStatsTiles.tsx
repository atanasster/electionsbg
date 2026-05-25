import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, ExternalLink } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import type { SessionFile } from "@/data/parliament/votes/types";
import type { SessionMetrics } from "@/data/parliament/votes/sessionMetrics";

type Props = {
  session: SessionFile;
  metrics: SessionMetrics;
  headingDate: string;
};

const Value: FC<{ children: ReactNode; sub?: ReactNode }> = ({
  children,
  sub,
}) => (
  <>
    <div className="text-xl font-semibold tabular-nums leading-tight">
      {children}
    </div>
    {sub != null && (
      <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>
    )}
  </>
);

export const SessionStatsTiles: FC<Props> = ({
  session,
  metrics,
  headingDate,
}) => {
  const { t } = useTranslation();
  const castItemCount = metrics.perItem.length;
  const totalItems = session.sessions.length;
  const totalMps = session.sessions[0]?.votes.length ?? 0;
  const turnoutPct = Math.round(metrics.turnoutPct * 100);
  const avgCast = Math.round(totalMps * metrics.turnoutPct);
  const cohesionPct =
    metrics.cohesion == null ? null : Math.round(metrics.cohesion * 100);
  const itemsWithDissents = metrics.perItem.filter(
    (m) => m.dissenters.length > 0,
  ).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard
        label={
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {t("votes_session_date") || "Date"}
          </span>
        }
      >
        <Value sub={`${t("votes_session_ns") || "Parliament"} ${session.ns}`}>
          {headingDate}
        </Value>
      </StatCard>

      <StatCard label={t("votes_session_items") || "Vote items"}>
        <Value
          sub={
            castItemCount === totalItems
              ? undefined
              : `${castItemCount} / ${totalItems} ${t("votes_session_cast") || "cast"}`
          }
        >
          {castItemCount}
        </Value>
      </StatCard>

      <StatCard
        label={t("votes_session_turnout") || "Turnout"}
        hint={
          t("votes_session_turnout_hint") ||
          "Share of seated MPs who cast a vote (yes/no/abstain), averaged across items."
        }
      >
        <Value sub={`${avgCast} / ${totalMps}`}>{turnoutPct}%</Value>
      </StatCard>

      <StatCard
        label={t("votes_session_cohesion") || "Cohesion"}
        hint={
          t("votes_session_cohesion_hint") ||
          "Average share of each group voting the same way, weighted by group size. 100% = every group unanimous."
        }
      >
        <Value
          sub={
            cohesionPct == null
              ? t("votes_session_cohesion_na") || "no qualifying groups"
              : cohesionPct >= 95
                ? t("votes_session_cohesion_disciplined") ||
                  "highly disciplined"
                : cohesionPct >= 80
                  ? t("votes_session_cohesion_typical") || "typical"
                  : t("votes_session_cohesion_split") || "cross-party splits"
          }
        >
          {cohesionPct == null ? "—" : `${cohesionPct}%`}
        </Value>
      </StatCard>

      <StatCard
        label={t("votes_session_dissents_stat") || "Dissents"}
        hint={
          t("votes_session_dissents_hint") ||
          "Number of (MP × item) votes against the MP's own group plurality."
        }
      >
        <Value
          sub={
            metrics.dissentCount === 0
              ? t("votes_session_dissents_none") || "none"
              : `${t("votes_session_across") || "across"} ${itemsWithDissents} ${t("votes_session_items_lc") || "items"}`
          }
        >
          {metrics.dissentCount}
        </Value>
      </StatCard>

      <StatCard
        label={t("votes_session_closest") || "Closest vote"}
        hint={
          t("votes_session_closest_hint") ||
          "Smallest |yes − (no + abstain)| margin among the session's items."
        }
      >
        {metrics.closestItem ? (
          <Value sub={`#${metrics.closestItem.itemNo}`}>
            ±{metrics.closestItem.marginAbs}
          </Value>
        ) : (
          <Value>—</Value>
        )}
      </StatCard>

      {session.pdfUrl && (
        <div className="col-span-2 sm:col-span-3 lg:col-span-6 flex justify-end">
          <a
            href={session.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            {t("votes_session_pdf") || "Виж в parliament.bg"}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </div>
  );
};
