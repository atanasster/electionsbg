import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BarChart3, FileX2, UserPlus } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import {
  SuspiciousCategory,
  SuspiciousTopSettlement,
  useSuspiciousSettlements,
} from "@/data/dashboard/useSuspiciousSections";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
  regionCode?: string;
  regionCodes?: string[];
  municipalityCode?: string;
  ekatte?: string;
};

type ColumnDef = {
  key: "concentrated" | "invalidBallots" | "additionalVoters";
  icon: ReactNode;
  title: string;
  hint: string;
  link: string;
  data: SuspiciousCategory;
  showParty?: boolean;
};

const stripRegionPrefix = (name?: string) =>
  (name ?? "").replace(/^\d+\.\s*/, "");

const settlementLabel = (s: SuspiciousTopSettlement, isBg: boolean) => {
  const settlement = isBg ? s.settlement : (s.settlement_en ?? s.settlement);
  const region = isBg
    ? stripRegionPrefix(s.region_name)
    : (s.region_name_en ?? stripRegionPrefix(s.region_name));
  const parts = [settlement, region].filter(Boolean);
  return parts.join(", ") || s.ekatte;
};

export const SuspiciousSectionsTile: FC<Props> = ({
  parties,
  regionCode,
  regionCodes,
  municipalityCode,
  ekatte,
}) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data } = useSuspiciousSettlements();
  const { displayNameFor } = useCanonicalParties();

  if (!data) return null;

  const filterByRegion = (cat: SuspiciousCategory): SuspiciousCategory => {
    if (ekatte) {
      const top = cat.top.filter((s) => s.ekatte === ekatte);
      return { ...cat, top, count: top.length };
    }
    if (municipalityCode) {
      const top = cat.top.filter((s) => s.obshtina === municipalityCode);
      return { ...cat, top, count: top.length };
    }
    if (regionCodes?.length) {
      const top = cat.top.filter((s) => regionCodes.includes(s.oblast));
      return { ...cat, top, count: top.length };
    }
    if (!regionCode) return cat;
    const top = cat.top.filter((s) => s.oblast === regionCode);
    return { ...cat, top, count: top.length };
  };

  const concentrated = filterByRegion(data.concentrated);
  const invalidBallots = filterByRegion(data.invalidBallots);
  const additionalVoters = filterByRegion(data.additionalVoters);

  const totalFlagged =
    concentrated.count + invalidBallots.count + additionalVoters.count;
  if (!totalFlagged) return null;

  const partyMap = new Map(parties.map((p) => [p.partyNum, p]));

  const columns: ColumnDef[] = [
    {
      key: "concentrated",
      icon: <BarChart3 className="h-4 w-4" />,
      title: t("dashboard_suspicious_concentrated"),
      hint: t("dashboard_suspicious_concentrated_hint", {
        threshold: data.concentrated.threshold,
      }),
      link: "/reports/settlement/concentrated",
      data: concentrated,
      showParty: true,
    },
    {
      key: "invalidBallots",
      icon: <FileX2 className="h-4 w-4" />,
      title: t("dashboard_suspicious_invalid"),
      hint: t("dashboard_suspicious_invalid_hint", {
        threshold: data.invalidBallots.threshold,
      }),
      link: "/reports/settlement/invalid_ballots",
      data: invalidBallots,
    },
    {
      key: "additionalVoters",
      icon: <UserPlus className="h-4 w-4" />,
      title: t("dashboard_suspicious_additional"),
      hint: t("dashboard_suspicious_additional_hint", {
        threshold: data.additionalVoters.threshold,
        floor: data.thresholds.additionalVotersMinActual,
      }),
      link: "/reports/settlement/additional_voters",
      data: additionalVoters,
    },
  ];

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_suspicious_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>{t("dashboard_suspicious_settlements")}</span>
            </div>
          </Hint>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-1">
        {columns.map((col) => (
          <div key={col.key} className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-3">
              <Hint text={col.hint} underline={false}>
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {col.icon}
                  <span>{col.title}</span>
                </div>
              </Hint>
              <Link
                to={col.link}
                className="text-[10px] normal-case text-primary hover:underline shrink-0"
                underline={false}
              >
                {t("dashboard_see_details")} →
              </Link>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {formatThousands(col.data.count)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("dashboard_suspicious_count_suffix", {
                  threshold: col.data.threshold,
                })}
              </span>
            </div>
            {col.data.top.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {col.data.top.map((s) => {
                  const party = col.showParty
                    ? s.partyNum !== undefined
                      ? partyMap.get(s.partyNum)
                      : undefined
                    : undefined;
                  const label = settlementLabel(s, isBg);
                  return (
                    <li
                      key={s.ekatte}
                      className="flex items-center gap-2 min-w-0"
                    >
                      {col.showParty ? (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: party?.color || "#888" }}
                          title={
                            party?.nickName
                              ? (displayNameFor(party.nickName) ??
                                party.nickName)
                              : undefined
                          }
                        />
                      ) : null}
                      {s.ekatte ? (
                        <Link
                          to={`/sections/${s.ekatte}`}
                          className="min-w-0 text-xs text-muted-foreground hover:underline truncate"
                          underline={false}
                          title={label}
                        >
                          {label}
                        </Link>
                      ) : (
                        <span
                          className="min-w-0 text-xs text-muted-foreground truncate"
                          title={label}
                        >
                          {label}
                        </span>
                      )}
                      <span className="tabular-nums text-xs font-semibold shrink-0">
                        {formatPct(s.value, 1)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground">
                {t("dashboard_suspicious_none")}
              </div>
            )}
          </div>
        ))}
      </div>
    </StatCard>
  );
};
