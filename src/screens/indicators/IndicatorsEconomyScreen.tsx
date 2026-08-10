// /indicators/economy — Economy headline, Inflation breakdown, Sentiment.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import {
  useMacroPeers,
  usePeerIndicatorAnnual,
} from "@/data/macro/useMacroPeers";
import { useCompareToggle } from "@/data/macro/useCompareToggle";
import {
  CabinetStrip,
  GovernmentTimeline,
  type PeerOverlay,
} from "@/screens/components/governments/GovernmentTimeline";
import {
  initialIndicatorToggle,
  type IndicatorSpec,
  type IndicatorToggle,
} from "@/screens/components/governments/indicatorToggle";
import type { MacroIndicatorKey } from "@/data/macro/useMacro";
import { InflationBreakdownChart } from "@/screens/components/governments/InflationBreakdownChart";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";
import { PeerSnapshotTable } from "@/screens/components/macro/PeerSnapshotTable";
import { PeerSnapshotStripAnnual } from "@/screens/components/macro/PeerSnapshotStripAnnual";
import { CompareToggleButton } from "@/screens/components/macro/CompareToggleButton";
import { IndicatorsNav } from "./indicatorsNav";
import { ChartSources } from "./indicatorsShared";
import {
  computeLabourSlackCallout,
  computeSlackEuAverage,
} from "./labourSlack";
import { computePayVsProductivityCallout } from "./payVsProductivity";

const ECONOMY_INDICATOR_SPEC: IndicatorSpec = [
  {
    labelKey: "governments_chart_group_headline",
    keys: [
      "gdpGrowth",
      "inflation",
      "unemployment",
      "labourIncome",
    ] as MacroIndicatorKey[],
  },
  {
    labelKey: "governments_chart_group_activity",
    keys: ["industrialProd", "retailVolume"] as MacroIndicatorKey[],
  },
];

const ECONOMY_DEFAULT_ENABLED: MacroIndicatorKey[] = [
  "gdpGrowth",
  "inflation",
  "unemployment",
];

export const IndicatorsEconomyScreen = () => {
  const { t, i18n } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const { data: peers } = useMacroPeers();
  const [compare, toggleCompare] = useCompareToggle();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const peerOverlay = useMemo<PeerOverlay | undefined>(() => {
    if (!peers?.indicators) return undefined;
    return peers.indicators as PeerOverlay;
  }, [peers]);

  const [economyEnabled, setEconomyEnabled] = useState<IndicatorToggle>(() =>
    initialIndicatorToggle(ECONOMY_INDICATOR_SPEC, ECONOMY_DEFAULT_ENABLED),
  );

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  // One decimal, locale separator. Every callout on this screen renders its
  // figures through this — four of them did it inline before, so a change to
  // precision or to the separator had to find each copy.
  const fmt1 = useCallback(
    (v: number) => v.toFixed(1).replace(".", lang === "bg" ? "," : "."),
    [lang],
  );

  // Fresher-than-quarterly headline for a series whose chart line is a
  // quarterly aggregate: the newest monthly reading, rendered as a callout
  // under the line. Parameterised by key because two series need it —
  // unemployment (une_rt_m) and inflation (prc_hicp_minr) — and the quarterly
  // lag is the whole point: `inflation` is the MEAN of its three months, so
  // the line cannot move until a quarter completes.
  const monthlyCallout = useCallback(
    (key: MacroIndicatorKey) => {
      const m = macro?.latestMonthly?.[key];
      if (!m) return null;
      const label = new Date(m.year, m.month - 1, 1).toLocaleDateString(
        lang === "bg" ? "bg-BG" : "en-GB",
        { month: "long", year: "numeric" },
      );
      return {
        label,
        value: fmt1(m.value),
        sourceUrl: m.sourceUrl,
        code: m.datasetCode,
      };
    },
    [macro, lang, fmt1],
  );

  const unemploymentMonthly = useMemo(
    () => monthlyCallout("unemployment"),
    [monthlyCallout],
  );
  const inflationMonthly = useMemo(
    () => monthlyCallout("inflation"),
    [monthlyCallout],
  );

  // Labour-market slack: the broad "true unemployment" measure (annual),
  // rendered as a contextual callout below the unemployment panel. Computation
  // lives in a pure, unit-tested helper — see labourSlack.ts for the ratio and
  // denominator caveats.
  const labourSlackCallout = useMemo(
    () => computeLabourSlackCallout(macro, fmt1),
    [macro, fmt1],
  );

  // Pay vs productivity over the full overlapping window of the three annual
  // series. Pure helper — see payVsProductivity.ts for the deflator choice and
  // the per-employee vs per-person-employed caveat the caption discloses.
  const payVsProductivity = useMemo(
    () => computePayVsProductivityCallout(macro, fmt1),
    [macro, fmt1],
  );

  // EU-27 average slack, shown beside the BG slack callout when Compare is on
  // (only when it shares the BG value's year — see computeSlackEuAverage).
  const slackPeer = usePeerIndicatorAnnual("labourSlack");
  const slackEuAverage = useMemo(
    () =>
      computeSlackEuAverage(
        slackPeer?.latestDistribution,
        labourSlackCallout ? labourSlackCallout.year : null,
        fmt1,
      ),
    [slackPeer, labourSlackCallout, fmt1],
  );

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("indicators_economy_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("indicators_economy_description")}>
        {t("indicators_economy_title")}
      </Title>

      <IndicatorsNav />

      <div className="mb-4 flex justify-end">
        <CompareToggleButton enabled={compare} onToggle={toggleCompare} />
      </div>

      {xDomain ? (
        <CabinetStrip
          governments={governments}
          xDomain={xDomain}
          lang={lang}
          mobileScrollable
        />
      ) : null}

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_economy")}
        </h2>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/namq_10_gdp/default/table",
              label: "Eurostat namq_10_gdp (real GDP growth, quarterly)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
              label:
                "Eurostat prc_hicp_minr (HICP inflation, monthly→quarterly mean; latest month called out below)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
              label: "Eurostat une_rt_q (unemployment rate, quarterly)",
            },
          ]}
        />
        {compare && (
          <PeerSnapshotTable
            rows={[
              { indicatorKey: "gdpGrowth" },
              { indicatorKey: "inflation" },
              { indicatorKey: "unemployment" },
            ].filter(
              (r) => economyEnabled[r.indicatorKey as MacroIndicatorKey],
            )}
          />
        )}
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={ECONOMY_INDICATOR_SPEC}
          enabled={economyEnabled}
          onEnabledChange={setEconomyEnabled}
          yAxisFormatter={(v) => `${v}`}
          unitFormatter={(k, v) =>
            k === "industrialProd" || k === "retailVolume"
              ? v.toFixed(1)
              : `${v.toFixed(1)}%`
          }
          showZeroLine
          height={360}
          peerOverlay={peerOverlay}
          peerCompareEnabled={compare}
        />
        {inflationMonthly && economyEnabled.inflation ? (
          <p className="mt-2 text-xs text-muted-foreground max-w-3xl">
            {t("indicators_inflation_monthly_latest", {
              label: inflationMonthly.label,
              value: inflationMonthly.value,
            })}{" "}
            <a
              href={inflationMonthly.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              {inflationMonthly.code}
            </a>
          </p>
        ) : null}
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_labour")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_labour_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/lfsi_emp_q/default/table",
              label:
                "Eurostat lfsi_emp_q (employment + activity rate, 20-64, quarterly SA)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
              label: "Eurostat une_rt_q (unemployment rate, quarterly SA)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/lfsi_sla_a/default/table",
              label: "Eurostat lfsi_sla_a (labour market slack, 20-64, annual)",
            },
          ]}
        />

        <h3 className="text-sm font-medium text-muted-foreground mt-4 mb-1">
          {t("governments_chart_labour_participation")}
        </h3>
        {compare && (
          // Both rows always shown (unlike the headline chart, which filters by
          // its enabled pills) — this panel's GovernmentTimeline owns its toggle
          // state internally, so there is no lifted `enabled` map to filter by.
          <PeerSnapshotTable
            rows={[
              { indicatorKey: "employmentRate" },
              { indicatorKey: "activityRate" },
            ]}
          />
        )}
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["employmentRate", "activityRate"]}
          yAxisFormatter={(v) => `${v}`}
          unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
          height={300}
          peerOverlay={peerOverlay}
          peerCompareEnabled={compare}
        />

        <h3 className="text-sm font-medium text-muted-foreground mt-6 mb-1">
          {t("governments_chart_labour_unemployment")}
        </h3>
        {compare && (
          // The main line is monthly (no peer data at monthly cadence), so the
          // EU comparison rides the quarterly snapshot table rather than ghost
          // lines on the chart.
          <PeerSnapshotTable
            rows={[
              { indicatorKey: "unemployment" },
              { indicatorKey: "youthUnemployment" },
            ]}
          />
        )}
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["unemploymentMonthly", "youthUnemployment"]}
          referenceKeys={["unemployment"]}
          yAxisFormatter={(v) => `${v}`}
          unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
          height={300}
        />
        {unemploymentMonthly ? (
          <p className="mt-2 text-xs text-muted-foreground max-w-3xl">
            {t("indicators_unemployment_monthly_latest", {
              label: unemploymentMonthly.label,
              value: unemploymentMonthly.value,
            })}{" "}
            <a
              href={unemploymentMonthly.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              une_rt_m
            </a>
          </p>
        ) : null}
        {labourSlackCallout ? (
          <p className="mt-3 text-xs text-muted-foreground max-w-3xl border-l-2 border-border pl-3">
            {t(
              labourSlackCallout.ratio
                ? "indicators_labour_slack"
                : "indicators_labour_slack_short",
              {
                year: labourSlackCallout.year,
                value: labourSlackCallout.value,
                ratio: labourSlackCallout.ratio,
                unemp: labourSlackCallout.unemp,
              },
            )}
            {compare && slackEuAverage
              ? " " + t("indicators_labour_slack_eu", { value: slackEuAverage })
              : ""}
          </p>
        ) : null}
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_productivity")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_productivity_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/nama_10_lp_ulc/default/table",
              label:
                "Eurostat nama_10_lp_ulc (real labour productivity + nominal unit labour cost + compensation per employee, annual, 2015 = 100)",
            },
            {
              // The caption below publishes two figures from THIS dataset —
              // the price rise and the real-pay figure derived from it. Naming
              // it is also where the deflator choice becomes visible: HICP,
              // not the GDP deflator and not the site's own `inflation` rate.
              href: "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_aind/default/table",
              label:
                "Eurostat prc_hicp_aind (annual HICP index — the deflator behind the real-pay figure below)",
            },
            {
              // The tax-wedge sub-chart at the foot of this section. Its own
              // dataset on its own release calendar (tax-and-contribution
              // policy), so it is named separately — and that caption asserts
              // the figure is published rather than derived, which is a claim
              // the reader can only check if the link is here.
              href: "https://ec.europa.eu/eurostat/databrowser/view/earn_nt_taxwedge/default/table",
              label:
                "Eurostat earn_nt_taxwedge (tax wedge on labour costs, annual — single person, no children, 67% of average earnings)",
            },
          ]}
        />
        {/* Both lines share Eurostat's own 2015 = 100 base, so one axis is
            correct here — unlike the headline chart above, which mixes rates
            and indices. Unit labour cost IS pay per unit of output, so the
            pair needs no third derived line to state the gap. */}
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["labourProductivity", "unitLabourCost"]}
          yAxisFormatter={(v) => v.toFixed(0)}
          unitFormatter={(_k, v) => v.toFixed(1)}
          // Fit to the data instead of Recharts' default 0-anchored domain.
          // Neither index goes below ~65, so anchoring at zero spends a third
          // of the plot on empty space and flattens the gap between the two
          // lines — which is the only thing this chart is here to show.
          yDomain={["auto", "auto"]}
          height={300}
        />
        {payVsProductivity ? (
          <p className="mt-3 text-xs text-muted-foreground max-w-3xl border-l-2 border-border pl-3">
            {t("indicators_pay_vs_productivity", {
              from: payVsProductivity.from,
              to: payVsProductivity.to,
              nominalPay: payVsProductivity.nominalPay,
              prices: payVsProductivity.prices,
              realPay: payVsProductivity.realPay,
              productivity: payVsProductivity.productivity,
            })}
            {payVsProductivity.multiple
              ? " " +
                t("indicators_pay_vs_productivity_multiple", {
                  multiple: payVsProductivity.multiple,
                })
              : ""}{" "}
            {t("indicators_pay_vs_productivity_basis")}
          </p>
        ) : null}

        <h3 className="text-sm font-medium text-muted-foreground mt-6 mb-1">
          {t("governments_chart_tax_wedge")}
        </h3>
        <p className="text-xs text-muted-foreground mb-2 max-w-3xl">
          {t("governments_chart_tax_wedge_explainer")}
        </p>
        {/* Own sub-chart rather than a third line above: this is a share of
            labour cost (0-100%), not an index on the 2015 = 100 base, so it
            cannot share that axis. Published by Eurostat, never derived here —
            see the indicator's comment in fetch_eurostat.ts for why pairing
            our own compensation series with НОИ's gross wage does not work. */}
        {/* Annual peers ride a strip, not chart ghost-lines: `peerOverlay`
            reads the QUARTERLY `peers.indicators` block, and taxWedge lands in
            `indicatorsAnnual` — same shape as the society screen's annual
            small-multiples. It is also what makes a deliberately flat line
            legible: without a reference, "this has not moved since 2018" gives
            a reader no way to judge whether 34,9% is high or low. */}
        {compare && (
          <PeerSnapshotStripAnnual
            indicatorKey="taxWedge"
            formatValue={(v) => `${fmt1(v)}%`}
          />
        )}
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["taxWedge"]}
          // A solo chart whose subject IS a share, so the axis carries the
          // unit — the bare `${v}` form belongs to the mixed-unit charts above,
          // where a % would be wrong for the 2015 = 100 indices. Without it the
          // % shows only on hover, i.e. never on touch or in a screenshot.
          yAxisFormatter={(v) => `${v}%`}
          unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
          // One series, and its toggle pill would render the indicator title —
          // the same string as the <h3> directly above. The only thing the pill
          // can do here is blank the chart.
          hideToggles
          height={260}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_inflation_breakdown")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_inflation_breakdown_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_source_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
              label:
                "Eurostat prc_hicp_minr (HICP by ECOICOP, monthly→quarterly mean)",
            },
          ]}
        />
        <InflationBreakdownChart
          governments={governments}
          macro={macro}
          height={340}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_sentiment")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_sentiment_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_source_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/ei_bssi_m_r2/default/table",
              label:
                "Eurostat ei_bssi_m_r2 (consumer confidence + Economic Sentiment Indicator)",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["consumerConfidence", "economicSentiment"]}
          yAxisFormatter={(v) => v.toFixed(0)}
          unitFormatter={(_k, v) => v.toFixed(1)}
          showZeroLine
          height={300}
        />
      </section>
    </div>
  );
};
