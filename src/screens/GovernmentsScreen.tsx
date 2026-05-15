import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import { Link } from "react-router-dom";
import {
  CabinetStrip,
  GovernmentTimeline,
} from "./components/governments/GovernmentTimeline";
import { xDomainFor } from "./components/governments/governmentTimelineUtils";
import { GovernmentTable } from "./components/governments/GovernmentTable";

export const GovernmentsScreen = () => {
  const { t, i18n } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("governments_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("governments_description")}>
        {t("governments_title")}
      </Title>

      <p className="text-sm text-muted-foreground mb-6 max-w-3xl mx-auto text-center">
        {t("governments_explainer")}
      </p>

      {xDomain ? (
        <CabinetStrip governments={governments} xDomain={xDomain} lang={lang} />
      ) : null}

      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
          <h2 className="text-lg font-semibold">
            {t("governments_headline_tile_heading")}
          </h2>
          <Link
            to="/indicators"
            className="text-sm text-primary hover:underline whitespace-nowrap"
          >
            {t("governments_to_indicators_link")}
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_headline_tile_explainer")}
        </p>
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["gdpGrowth", "inflation", "unemployment"]}
          yAxisFormatter={(v) => `${v}`}
          unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
          showZeroLine
          hideToggles
          height={280}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_table_heading")}
        </h2>
        <GovernmentTable governments={governments} macro={macro} />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_observations_heading")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_observations_explainer")}
        </p>
        <Link
          to="/observations"
          className="text-sm text-primary hover:underline"
        >
          {t("observations_nav_link")}
        </Link>
      </section>

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
          href="https://www.osce.org/odihr/elections/bulgaria"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          OSCE/ODIHR
        </a>
        {" · "}
        {lang === "bg"
          ? "правителства от Уикипедия"
          : "cabinets from Wikipedia"}
      </p>
    </div>
  );
};
