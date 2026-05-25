import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Title } from "@/ux/Title";
import { useFactionCohesion } from "@/data/parliament/votes/useFactionCohesion";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { CohesionTrendChart } from "./components/charts/CohesionTrendChart";
import { LoyaltyOutlierRibbon } from "./components/votes/LoyaltyOutlierRibbon";

const formatPct = (frac: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);

const formatInt = (n: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB").format(n);

export const ParliamentCohesionScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { entries, series, computedAt, isLoading } = useFactionCohesion();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();

  // Newest cohesion file first. Sort by meanCohesion desc so the most-unified
  // parliamentary group is at the top; min/max define the bar scale.
  const ordered = useMemo(
    () => [...entries].sort((a, b) => b.meanCohesion - a.meanCohesion),
    [entries],
  );
  // Scale bars from min to max for visual contrast; with a hard 0-1 scale the
  // bars all look identical (most groups vote together >85% of the time).
  const min = ordered.reduce(
    (m, e) => Math.min(m, e.meanCohesion),
    Number.POSITIVE_INFINITY,
  );
  const max = ordered.reduce((m, e) => Math.max(m, e.meanCohesion), 0);
  const span = Math.max(0.0001, max - min);
  const lang = i18n.language;
  const pageTitle = t("cohesion_title") || "Parliamentary group cohesion";

  // Default the trend chart to the top-6 groups by mean cohesion. Anything
  // beyond that is opt-in via the toggle row — beyond ~8 lines the chart
  // turns into noise.
  const DEFAULT_N = 6;
  const [selectedParties, setSelectedParties] = useState<Set<string> | null>(
    null,
  );
  const defaultSelected = useMemo(
    () => ordered.slice(0, DEFAULT_N).map((e) => e.partyShort),
    [ordered],
  );
  const activeSelection = useMemo(
    () => (selectedParties ? [...selectedParties] : defaultSelected),
    [selectedParties, defaultSelected],
  );
  const colorOf = (short: string) => colorForPartyShort(short) ?? "#94a3b8";
  const labelOf = (short: string) => labelForPartyShort(short) || short;
  const toggleParty = (short: string) => {
    setSelectedParties((prev) => {
      const base = prev ?? new Set(defaultSelected);
      const next = new Set(base);
      if (next.has(short)) next.delete(short);
      else next.add(short);
      return next;
    });
  };

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={t("cohesion_description") || pageTitle}>
        {pageTitle}
      </Title>

      <div className="max-w-5xl mx-auto pb-12 space-y-6">
        <p className="text-sm text-muted-foreground">
          {t("cohesion_intro") ||
            "How unified each parliamentary group is when its members vote. Cohesion = share of the group voting the same way per item, averaged across every item the group participated in. 1.00 means every member voted the same way every time; 0.50 is an even split. Absences are excluded."}
        </p>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("loading") || "Loading…"}
          </div>
        ) : ordered.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("cohesion_empty") ||
              "No cohesion data has been computed yet — run the derived-metrics step first."}
          </div>
        ) : (
          <>
            <LoyaltyOutlierRibbon />

            {series.length > 0 && (
              <section className="rounded-xl border bg-card p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide mb-2">
                  {t("cohesion_trend_title") || "Cohesion over time"}
                </h2>
                <CohesionTrendChart
                  series={series}
                  selected={activeSelection}
                  colorFor={colorOf}
                  labelFor={labelOf}
                />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {ordered.map((e) => {
                    const active = activeSelection.includes(e.partyShort);
                    const color = colorOf(e.partyShort);
                    return (
                      <button
                        key={e.partyShort}
                        type="button"
                        onClick={() => toggleParty(e.partyShort)}
                        className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                          active
                            ? "text-white"
                            : "text-muted-foreground bg-transparent"
                        }`}
                        style={
                          active
                            ? { backgroundColor: color, borderColor: color }
                            : { borderColor: color }
                        }
                      >
                        {labelOf(e.partyShort)}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <ul className="border rounded-xl bg-card divide-y">
              {ordered.map((e) => {
                const color = colorOf(e.partyShort);
                const label = labelOf(e.partyShort);
                const width = ((e.meanCohesion - min) / span) * 100;
                return (
                  <li key={e.partyShort} className="p-4">
                    <div className="flex items-baseline gap-3 mb-1.5 flex-wrap">
                      <Users className="h-4 w-4 shrink-0" style={{ color }} />
                      <div className="font-semibold text-sm" style={{ color }}>
                        {label}
                      </div>
                      <div className="ml-auto text-lg font-bold tabular-nums">
                        {formatPct(e.meanCohesion, lang)}
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full transition-[width] duration-300"
                        style={{
                          width: `${Math.max(4, width)}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-3 tabular-nums">
                      <span>
                        {t("cohesion_median") || "Median"}:{" "}
                        {formatPct(e.medianCohesion, lang)}
                      </span>
                      <span>
                        {t("cohesion_members") || "Members"}:{" "}
                        {formatInt(e.membersTracked, lang)}
                      </span>
                      <span>
                        {t("cohesion_items_covered") || "Items covered"}:{" "}
                        {formatInt(e.itemsCovered, lang)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {computedAt && (
              <p className="text-xs text-muted-foreground">
                {t("cohesion_computed_at") || "Computed"}:{" "}
                <span className="tabular-nums">{computedAt.slice(0, 10)}</span>
                {". "}
                {t("cohesion_methodology_note") ||
                  "The list aggregates cohesion across every item ingested; the chart shows per-session mean cohesion. Absences are excluded from both."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
