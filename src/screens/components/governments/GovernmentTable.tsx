import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Government,
  GovernmentEndReason,
} from "@/data/governments/useGovernments";
import { MacroPayload } from "@/data/macro/useMacro";
import { useMps } from "@/data/parliament/useMps";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { CandidateLink } from "@/screens/components/candidates/CandidateLink";

const formatDate = (iso: string | null, lang: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

// Average a yearly indicator across the years a cabinet was in office, weighted
// by the fraction of the year they served. Annual data is the highest-frequency
// signal we have, so this is approximate but visually meaningful.
const periodAverage = (
  series: { year: number; value: number }[] | undefined,
  startIso: string,
  endIso: string | null,
): number | null => {
  if (!series?.length) return null;
  const start = new Date(startIso);
  const end = new Date(endIso ?? new Date().toISOString());
  if (end <= start) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const point of series) {
    const yStart = new Date(Date.UTC(point.year, 0, 1));
    const yEnd = new Date(Date.UTC(point.year + 1, 0, 1));
    const overlapStart = start > yStart ? start : yStart;
    const overlapEnd = end < yEnd ? end : yEnd;
    const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
    if (overlapMs <= 0) continue;
    const days = overlapMs / (1000 * 60 * 60 * 24);
    weightedSum += point.value * days;
    totalWeight += days;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
};

// Total a flow indicator (e.g. annual EU funds in EUR bn) across a cabinet's
// tenure, pro-rated by the fraction of the year they served. Distinct from
// periodAverage because we want the cumulative volume, not the mean rate.
const periodTotal = (
  series: { year: number; value: number }[] | undefined,
  startIso: string,
  endIso: string | null,
): number | null => {
  if (!series?.length) return null;
  const start = new Date(startIso);
  const end = new Date(endIso ?? new Date().toISOString());
  if (end <= start) return null;

  let total = 0;
  let anyOverlap = false;
  for (const point of series) {
    const yStart = new Date(Date.UTC(point.year, 0, 1));
    const yEnd = new Date(Date.UTC(point.year + 1, 0, 1));
    const overlapStart = start > yStart ? start : yStart;
    const overlapEnd = end < yEnd ? end : yEnd;
    const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
    if (overlapMs <= 0) continue;
    anyOverlap = true;
    const yearMs = yEnd.getTime() - yStart.getTime();
    total += point.value * (overlapMs / yearMs);
  }
  return anyOverlap ? total : null;
};

export const GovernmentTable: FC<{
  governments: Government[];
  macro: MacroPayload | undefined;
}> = ({ governments, macro }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { findMpByName } = useMps();

  const endReasonLabel = (reason: GovernmentEndReason): string => {
    const map: Record<GovernmentEndReason, string> = {
      term_end: t("gov_end_term_end"),
      election: t("gov_end_election"),
      snap_election: t("gov_end_snap_election"),
      no_confidence: t("gov_end_no_confidence"),
      resignation: t("gov_end_resignation"),
      rotation_failed: t("gov_end_rotation_failed"),
      incumbent: t("gov_end_incumbent"),
    };
    return map[reason];
  };

  const rows = useMemo(() => {
    return governments.map((g) => {
      const gdpGrowth = periodAverage(
        macro?.series.gdpGrowth,
        g.startDate,
        g.endDate,
      );
      const inflation = periodAverage(
        macro?.series.inflation,
        g.startDate,
        g.endDate,
      );
      const unemployment = periodAverage(
        macro?.series.unemployment,
        g.startDate,
        g.endDate,
      );
      const euFunds = periodTotal(
        macro?.series.euFunds,
        g.startDate,
        g.endDate,
      );
      return {
        g,
        indicators: { gdpGrowth, inflation, unemployment, euFunds },
      };
    });
  }, [governments, macro]);

  const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-muted-foreground border-b">
          <tr>
            <th className="text-left py-2 pr-3">{t("gov_pm")}</th>
            <th className="text-left py-2 pr-3">{t("gov_type")}</th>
            <th className="text-left py-2 pr-3">{t("gov_period")}</th>
            <th className="text-left py-2 pr-3">{t("gov_parties")}</th>
            <th className="text-right py-2 pr-3">{t("gov_avg_gdp_growth")}</th>
            <th className="text-right py-2 pr-3">{t("gov_avg_inflation")}</th>
            <th className="text-right py-2 pr-3">
              {t("gov_avg_unemployment")}
            </th>
            <th className="text-right py-2 pr-3">{t("gov_eu_funds")}</th>
            <th className="text-left py-2">{t("gov_end_reason")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ g, indicators }) => {
            const pm = lang === "bg" ? g.pmBg : g.pmEn;
            const parties =
              lang === "bg" ? g.parties : (g.partiesEn ?? g.parties);
            const endReason =
              g.endReason === "incumbent"
                ? endReasonLabel(g.endReason)
                : `${endReasonLabel(g.endReason)} — ${
                    lang === "bg" ? g.endReasonBg : g.endReasonEn
                  }`;
            // PM names in governments.json use the three-name form
            // parliament.bg indexes by, so a direct lookup resolves the photo
            // and id. Marin Raykov was never an MP — he gracefully falls
            // through to initials + plain text.
            const mp = findMpByName(g.pmBg);
            const nameCell = mp ? (
              <CandidateLink name={pm} mpId={mp.id}>
                {pm}
              </CandidateLink>
            ) : (
              <span>{pm}</span>
            );
            // For regular cabinets the lead coalition party is the PM's party
            // at the time (Borisov-I was GERB regardless of parliament.bg's
            // current group for him). For caretakers the cabinet itself is
            // non-partisan, but several PMs come from a parliamentary party —
            // we surface that as `pmPartyBg`/`pmPartyEn` so the table can
            // distinguish "PM is GERB" from "PM was a GERB MP before being
            // appointed caretaker".
            const isCaretaker = g.type === "caretaker";
            const pmPartyLabel = isCaretaker
              ? lang === "bg"
                ? g.pmPartyBg
                : (g.pmPartyEn ?? g.pmPartyBg)
              : parties[0];
            const partyTitle = isCaretaker
              ? t("gov_pm_prior_party")
              : t("gov_pm_party");
            return (
              <tr
                key={g.id}
                className="border-b last:border-b-0 hover:bg-accent/5"
              >
                <td className="py-2 pr-3 font-medium">
                  <div className="flex items-center gap-2">
                    <MpAvatar
                      name={g.pmBg}
                      mpId={mp?.id}
                      className="h-7 w-7"
                      showPartyRing={false}
                    />
                    <div className="flex flex-col leading-tight min-w-0">
                      {nameCell}
                      {pmPartyLabel ? (
                        <span
                          className="text-[10px] uppercase tracking-wide text-muted-foreground font-normal"
                          title={partyTitle}
                        >
                          {isCaretaker ? `(${pmPartyLabel})` : pmPartyLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      g.type === "caretaker"
                        ? "bg-muted text-muted-foreground"
                        : "bg-accent/10 text-foreground"
                    }`}
                  >
                    {g.type === "caretaker"
                      ? t("gov_type_caretaker")
                      : t("gov_type_regular")}
                  </span>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                  {formatDate(g.startDate, lang)} –{" "}
                  {formatDate(g.endDate, lang)}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {parties.length === 0 ? "—" : parties.join(", ")}
                </td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    indicators.gdpGrowth !== null && indicators.gdpGrowth < 0
                      ? "text-rose-600"
                      : ""
                  }`}
                >
                  {fmtPct(indicators.gdpGrowth)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {fmtPct(indicators.inflation)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {fmtPct(indicators.unemployment)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {indicators.euFunds === null
                    ? "—"
                    : `€${indicators.euFunds.toFixed(1)}B`}
                </td>
                <td className="py-2 text-muted-foreground text-xs">
                  {endReason}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
