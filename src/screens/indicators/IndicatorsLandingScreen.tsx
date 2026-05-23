// /indicators — the new KPI dashboard front door. 12 KpiTile cards above the
// CabinetStrip ribbon and a CabinetScoreRow below it. Each tile links to its
// domain page; the cards under the ribbon mirror the strip's left-to-right
// pill order so a sweep across both reads the same.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";
import { CabinetStrip } from "@/screens/components/governments/GovernmentTimeline";
import { KpiTile } from "@/screens/components/macro/KpiTile";
import { CabinetScoreRow } from "@/screens/components/macro/CabinetScoreCard";
import { LANDING_KPI_ORDER } from "./indicatorsRegistry";

const localDateFromIso = (
  iso: string | undefined,
  lang: "bg" | "en",
): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const DomainLink: FC<{ to: string; labelKey: string }> = ({ to, labelKey }) => {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
    >
      {t(labelKey)}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
};

export const IndicatorsLandingScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  const fetchedDate = localDateFromIso(macro?.fetchedAt, lang);

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("indicators_page_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("indicators_page_description")}>
        {t("indicators_page_title")}
      </Title>

      <p className="text-sm text-muted-foreground mb-6 max-w-3xl mx-auto text-center">
        {t("indicators_page_explainer")}
      </p>

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-3">
          <DomainLink
            to="/indicators/economy"
            labelKey="indicators_nav_economy"
          />
          <DomainLink
            to="/indicators/fiscal"
            labelKey="indicators_nav_fiscal"
          />
          <DomainLink
            to="/indicators/governance"
            labelKey="indicators_nav_governance"
          />
          <DomainLink
            to="/indicators/society"
            labelKey="indicators_nav_society"
          />
          <DomainLink
            to="/indicators/compare"
            labelKey="indicators_nav_compare"
          />
        </div>
        <Link
          to="/governments"
          className="text-sm text-primary hover:underline"
        >
          {t("indicators_to_governments_link")}
        </Link>
      </div>

      <section
        aria-label={t("indicators_landing_kpi_grid_aria")}
        className="mb-8"
        data-og="indicators-kpi-grid"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {LANDING_KPI_ORDER.map((key) => (
            <KpiTile key={key} indicatorKey={key} />
          ))}
        </div>
      </section>

      {xDomain ? (
        <section className="mb-6">
          <CabinetStrip
            governments={governments}
            xDomain={xDomain}
            lang={lang}
            mobileScrollable
          />
          {macro ? (
            <CabinetScoreRow
              governments={governments}
              macro={macro}
              hoveredId={hoveredId}
              onHoverChange={setHoveredId}
              className="mt-3"
            />
          ) : null}
        </section>
      ) : null}

      <p className="text-[11px] text-muted-foreground mt-6">
        {t("governments_source_prefix")}{" "}
        <a
          href="https://ec.europa.eu/eurostat/databrowser/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Eurostat
        </a>
        {" · "}
        <a
          href="https://databank.worldbank.org/source/worldwide-governance-indicators"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          World Bank WGI
        </a>
        {" · "}
        <a
          href="https://www.transparency.org/en/cpi"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Transparency International CPI
        </a>
        {" · "}
        <a
          href="https://europa.eu/eurobarometer/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {lang === "bg" ? "Евробарометър" : "Eurobarometer"}
        </a>
        {fetchedDate ? (
          <>
            {" · "}
            {t("indicators_landing_as_of")} {fetchedDate}
          </>
        ) : null}
      </p>
    </div>
  );
};
