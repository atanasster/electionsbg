import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { SectionInfo } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const TOP_N = 15;

type Props = {
  ekatte?: string;
  sections?: SectionInfo[];
  seeDetailsHref?: string;
};

const stripSettlementFromAddress = (
  address: string | undefined,
  settlement: string | undefined,
) => {
  if (!address) return settlement || "";
  if (!settlement) return address;
  const settlementKey = settlement.replace(/\s+/g, "").toLowerCase();
  const addressKey = address.replace(/\s+/g, "").toLowerCase();
  const idx = addressKey.indexOf(settlementKey);
  if (idx < 0) return address;
  const numSpaces =
    (address.slice(0, settlementKey.length).split(" ").length || 1) - 1;
  const trimmed = address.slice(idx + settlementKey.length + numSpaces + 1);
  return trimmed.trim() || address;
};

export const TopSectionsTile: FC<Props> = ({
  ekatte,
  sections,
  seeDetailsHref,
}) => {
  const { t } = useTranslation();
  const { topVotesParty } = usePartyInfo();
  const { displayNameFor } = useCanonicalParties();

  const rows = useMemo(() => {
    if (!sections?.length) return [];
    const enriched = sections.map((s) => {
      const totalActualVoters = s.results.protocol?.totalActualVoters ?? 0;
      const registeredVoters = s.results.protocol?.numRegisteredVoters ?? 0;
      const turnout =
        registeredVoters > 0 ? (100 * totalActualVoters) / registeredVoters : 0;
      const winner = topVotesParty(s.results.votes);
      return {
        section: s.section,
        address: stripSettlementFromAddress(s.address, s.settlement),
        totalActualVoters,
        registeredVoters,
        turnout,
        winner,
      };
    });
    const sorted = enriched.sort(
      (a, b) => b.totalActualVoters - a.totalActualVoters,
    );
    const top = sorted.slice(0, TOP_N);
    const maxVoters = top[0]?.totalActualVoters ?? 1;
    return top.map((r) => ({
      ...r,
      barPct: maxVoters > 0 ? (r.totalActualVoters / maxVoters) * 100 : 0,
    }));
  }, [sections, topVotesParty]);

  if (!sections || sections.length < 2 || rows.length === 0) return null;

  const totalCount = sections.length;
  const showAllInTile = totalCount <= TOP_N;
  const titleKey = showAllInTile
    ? "dashboard_settlement_sections"
    : "dashboard_settlement_top_sections";
  const hintKey = showAllInTile
    ? "dashboard_settlement_sections_hint"
    : "dashboard_settlement_top_sections_hint";

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t(hintKey)} underline={false}>
            <div className="flex items-center gap-2">
              <Vote className="h-4 w-4" />
              <span>{t(titleKey)}</span>
            </div>
          </Hint>
          {!showAllInTile && (seeDetailsHref || ekatte) ? (
            <Link
              to={seeDetailsHref ?? `/sections/${ekatte}/list`}
              className="text-[10px] normal-case text-primary hover:underline"
              underline={false}
            >
              {t("dashboard_see_details")} →
            </Link>
          ) : null}
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(60px,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("section")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("address")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("voters")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("voter_turnout")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("winner")}
        </span>
        {rows.map((r) => (
          <Link
            key={r.section}
            to={`/section/${r.section}`}
            underline={false}
            className="contents"
          >
            <span className="tabular-nums text-xs font-mono text-muted-foreground">
              {r.section}
            </span>
            <span className="truncate text-xs" title={r.address}>
              {r.address || "—"}
            </span>
            <span className="tabular-nums text-xs font-medium text-right">
              {formatThousands(r.totalActualVoters)}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, r.barPct)}%`,
                  backgroundColor: r.winner?.color || "#888",
                }}
              />
            </div>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {r.registeredVoters > 0 ? formatPct(r.turnout, 1) : "—"}
            </span>
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: r.winner?.color || "#888" }}
              />
              <span className="truncate text-xs" title={r.winner?.nickName}>
                {r.winner?.nickName
                  ? (displayNameFor(r.winner.nickName) ?? r.winner.nickName)
                  : "—"}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
