import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LineChart } from "lucide-react";
import { ElectionInfo } from "@/data/dataTypes";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { formatPct, formatThousands, localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { CanonicalParty } from "@/data/parties/canonicalPartyTypes";
import { Sparkline } from "@/ux/Sparkline";
import { Link } from "@/ux/Link";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
  topN?: number;
};

const HISTORY_DEPTH = 8;

// Use canonical-party lineage when available so a party that rebranded
// (e.g. ГЕРБ vs. ГЕРБ-СДС) still connects across elections; fall back to
// nickName matching when no canonical entry exists.
const buildHistory = (
  nickName: string,
  sorted: ElectionInfo[],
  canonical?: CanonicalParty,
): number[] => {
  const lineage = new Map<string, number>();
  canonical?.history.forEach((h) => lineage.set(h.election, h.partyNum));
  return sorted.map((e) => {
    const total = e.results?.votes.reduce((s, v) => s + v.totalVotes, 0) ?? 0;
    if (!total) return 0;
    const lineagePartyNum = lineage.get(e.name);
    const match = lineagePartyNum
      ? e.results?.votes.find((v) => v.partyNum === lineagePartyNum)
      : e.results?.votes.find((v) => v.nickName === nickName);
    if (!match) return 0;
    return (100 * match.totalVotes) / total;
  });
};

export const HistoricalTrendsTile: FC<Props> = ({ parties, topN = 6 }) => {
  const { t } = useTranslation();
  const { stats } = useElectionContext();
  const { colorFor, canonicalIdFor, byId } = useCanonicalParties();

  const { rows, electionLabels } = useMemo(() => {
    const sorted = [...stats]
      .filter((e) => !!e.results?.votes?.length)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(-HISTORY_DEPTH);
    const top = parties.slice(0, topN);
    const maxPct = Math.max(1, ...top.map((p) => p.pct));
    return {
      rows: top.map((p) => {
        const canonicalId = canonicalIdFor(p.nickName);
        const canonical = canonicalId ? byId.get(canonicalId) : undefined;
        return {
          party: p,
          history: buildHistory(p.nickName, sorted, canonical),
          barPct: (p.pct / maxPct) * 100,
          color: p.color || colorFor(p.nickName) || "#888",
        };
      }),
      electionLabels: sorted.map((e) => localDate(e.name)),
    };
  }, [stats, parties, topN, colorFor, canonicalIdFor, byId]);

  if (rows.length === 0) return null;

  const yearsSpan =
    electionLabels.length > 1
      ? `${electionLabels[0].slice(-4)} – ${electionLabels[electionLabels.length - 1].slice(-4)}`
      : electionLabels[0]?.slice(-4);

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4" />
          <span>{t("dashboard_historical_trends")}</span>
        </div>
      }
      hint={t("dashboard_historical_trends_hint")}
      className="overflow-hidden"
    >
      <div className="flex flex-col gap-2.5 mt-1">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(80px,1.4fr)_auto_minmax(60px,90px)] gap-x-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("dashboard_party")}</span>
          <span className="text-right">{t("votes")}</span>
          <span>{t("dashboard_share")}</span>
          <span className="text-right">{t("dashboard_now")}</span>
          <span className="text-right">
            {yearsSpan ? `${yearsSpan}` : t("dashboard_history")}
          </span>
        </div>
        {rows.map(({ party, history, barPct, color }) => (
          <Link
            key={party.partyNum}
            to={`/party/${party.nickName}`}
            underline={false}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(80px,1.4fr)_auto_minmax(60px,90px)] gap-x-3 items-center text-sm hover:bg-muted/40 rounded-md px-1 py-1 -mx-1 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="truncate font-medium">{party.nickName}</span>
            </div>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(party.totalVotes)}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, barPct)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {formatPct(party.pct, 2)}
            </span>
            <Sparkline
              values={history}
              color={color}
              className="h-6"
              ariaLabel={`${party.nickName} historical share`}
            />
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
