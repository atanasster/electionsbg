// /governments/:slug — one cabinet, in detail. Hero (PM portrait + ribbon +
// dates + end reason), in-page CabinetStrip for one-click switching to
// another cabinet, term-bounded KPI grid (start → end with signed deltas),
// term-zoomed macro chart, in-term EU milestones, and exit links back to
// the all-cabinets table + sideways to the EU-peers comparison anchored on
// this cabinet.
//
// The page mounts under CabinetAnchorProvider (route wrapper), so visiting
// /governments/borisov-3 sets ?cabinet=borisov-3 automatically. Side effect:
// the anchor persists when the user navigates away to /indicators,
// /indicators/compare, or any other governance route — clearing requires
// the header pill ×.

import { FC, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import {
  useGovernments,
  type Government,
} from "@/data/governments/useGovernments";
import { cabinetFullLabel } from "@/data/governments/cabinetLabel";
import { useMacro } from "@/data/macro/useMacro";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMps } from "@/data/parliament/useMps";
import {
  useCabinetAnchor,
  useSetCabinetAnchor,
} from "@/data/macro/cabinetAnchorContext";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import {
  CabinetStrip,
  GovernmentTimeline,
} from "@/screens/components/governments/GovernmentTimeline";
import {
  useEuMilestones,
  milestonesInWindow,
} from "@/screens/components/governments/euMilestones";
import {
  useChartEvents,
  filterEventsToWindow,
} from "@/screens/components/governments/chartEvents";
import { CabinetKpiTile } from "@/screens/components/macro/CabinetKpiTile";
import { CabinetScoreDetail } from "@/screens/components/macro/CabinetScoreCard";
import { colorForGovernmentSolid } from "@/screens/components/governments/governmentColors";
import {
  toFractionalYear,
  xDomainFor,
} from "@/screens/components/governments/governmentTimelineUtils";
import type { MacroIndicatorKey } from "@/data/macro/useMacro";
import { LANDING_KPI_ORDER } from "./indicators/indicatorsRegistry";
import { cn } from "@/lib/utils";

const formatDateLong = (iso: string | null, lang: "bg" | "en"): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

// Term-zoomed chart x-domain: cabinet tenure ± buffer (proportional to the
// tenure length, capped at the timeline edges so we don't show empty space
// past 2005 or beyond now).
const termDomain = (g: Government): [number, number] => {
  const start = toFractionalYear(g.startDate);
  const end = toFractionalYear(g.endDate ?? new Date().toISOString());
  const pad = Math.max(0.5, Math.min(1.5, (end - start) * 0.25));
  return [Math.max(2005, start - pad), end + pad];
};

const Breadcrumb: FC<{
  government: Government;
  allGovernments: Government[];
  lang: "bg" | "en";
}> = ({ government, allGovernments, lang }) => {
  const { t } = useTranslation();
  return (
    <nav
      aria-label="breadcrumb"
      className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Link to="/governments" className="hover:text-foreground hover:underline">
        {t("governments_title")}
      </Link>
      <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
      <span className="text-foreground truncate">
        {cabinetFullLabel(government, allGovernments, lang)}
      </span>
    </nav>
  );
};

const Hero: FC<{
  government: Government;
  allGovernments: Government[];
  lang: "bg" | "en";
}> = ({ government: g, allGovernments, lang }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const { findMpByName } = useMps();
  const ribbon = colorForGovernmentSolid(g, colorFor);
  const mp = findMpByName(g.pmBg);
  const fullName = cabinetFullLabel(g, allGovernments, lang);
  const parties = lang === "bg" ? g.parties : (g.partiesEn ?? g.parties);
  const tenure = `${formatDateLong(g.startDate, lang)} – ${formatDateLong(
    g.endDate,
    lang,
  )}`;
  const endReasonText = lang === "bg" ? g.endReasonBg : g.endReasonEn;
  const caretaker = g.type === "caretaker";
  const partyLabel = caretaker
    ? lang === "bg"
      ? g.pmPartyBg
      : (g.pmPartyEn ?? g.pmPartyBg)
    : parties[0];

  return (
    <section className="mb-6 rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="flex">
        <div
          className="w-2 shrink-0"
          style={{ backgroundColor: ribbon }}
          aria-hidden
        />
        <div className="flex-1 p-5 flex flex-col sm:flex-row items-start gap-4">
          <MpAvatar
            name={g.pmBg}
            mpId={mp?.id}
            className="h-20 w-20 shrink-0"
            showPartyRing={false}
          />
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {fullName}
              </h1>
              <span
                className={cn(
                  "text-[11px] uppercase tracking-wide px-2 py-0.5 rounded",
                  caretaker
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary",
                )}
              >
                {caretaker ? t("gov_type_caretaker") : t("gov_type_regular")}
              </span>
              {partyLabel ? (
                <span className="text-sm text-muted-foreground">
                  {caretaker ? `(${partyLabel})` : partyLabel}
                </span>
              ) : null}
            </div>
            <div className="text-sm text-muted-foreground tabular-nums">
              {tenure}
            </div>
            {parties.length > 0 && !caretaker ? (
              <div className="text-sm">{parties.join(", ")}</div>
            ) : null}
            {endReasonText && g.endReason !== "incumbent" ? (
              <div className="text-xs italic text-muted-foreground mt-1">
                {endReasonText}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};

export const GovernmentDetailScreen: FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const navigate = useNavigate();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const anchor = useCabinetAnchor();
  const setAnchor = useSetCabinetAnchor();
  const milestones = useEuMilestones();
  const allChartEvents = useChartEvents();

  const government = useMemo(() => {
    if (!governments || !slug) return null;
    return governments.find((g) => g.id === slug) ?? null;
  }, [governments, slug]);

  // Visiting /governments/:slug should auto-set the URL anchor so the header
  // pill and every downstream snapshot tile re-anchor consistently. Skip if
  // the URL already carries ?cabinet=<slug>. Side effect (intentional): the
  // anchor persists across navigation to /indicators, /compare, etc. —
  // clearing requires the header pill ×.
  useEffect(() => {
    if (!government) return;
    if (anchor?.cabinet.id === government.id) return;
    setAnchor(government.id);
  }, [government, anchor, setAnchor]);

  // Memoised derived values — must be declared above the early return so
  // hook order stays stable across the loading-skeleton ↔ data-loaded
  // transitions. Guard with null checks; defaults are safe.
  const termEvents = useMemo(
    () =>
      government
        ? milestonesInWindow(
            milestones,
            toFractionalYear(government.startDate),
            toFractionalYear(government.endDate ?? new Date().toISOString()),
          )
        : [],
    [government, milestones],
  );
  // Filter the societal-events strip to events overlapping the cabinet's
  // term so a short caretaker doesn't get a strip full of out-of-window
  // bands.
  const termChartEvents = useMemo(
    () =>
      government
        ? filterEventsToWindow(
            allChartEvents,
            toFractionalYear(government.startDate),
            toFractionalYear(government.endDate ?? new Date().toISOString()),
          )
        : [],
    [government, allChartEvents],
  );
  const termXDomain = useMemo<[number, number] | null>(
    () => (government ? termDomain(government) : null),
    [government],
  );
  const fullXDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  // Skeleton while data is loading.
  if (!governments || !macro) {
    return (
      <div className="pb-12">
        <Title>{t("governments_title")}</Title>
      </div>
    );
  }

  // Bad slug — data has loaded but no matching cabinet. Show a small 404
  // message instead of a blank Title flash, then auto-redirect after a beat
  // so a hand-edited typo still bounces back to the index.
  if (!government) {
    return (
      <div className="pb-12">
        <nav
          aria-label="breadcrumb"
          className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Link
            to="/governments"
            className="hover:text-foreground hover:underline"
          >
            {t("governments_title")}
          </Link>
          <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
          <span className="text-foreground">
            {t("cabinet_detail_not_found_title")}
          </span>
        </nav>
        <Title>{t("cabinet_detail_not_found_title")}</Title>
        <p className="text-sm text-muted-foreground mb-4">
          {t("cabinet_detail_not_found_explainer", { slug: slug ?? "" })}
        </p>
        <Link
          to="/governments"
          className="text-sm text-primary hover:underline"
        >
          ← {t("cabinet_detail_back_to_all")}
        </Link>
        <NotFoundRedirect />
      </div>
    );
  }

  const fullName = cabinetFullLabel(government, governments, lang);

  return (
    <div className="pb-12">
      <Breadcrumb
        government={government}
        allGovernments={governments}
        lang={lang}
      />

      {fullXDomain ? (
        <section className="mb-4">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("cabinet_detail_quick_switch")}
          </div>
          <CabinetStrip
            governments={governments}
            xDomain={fullXDomain}
            lang={lang}
            mobileScrollable
            fullWidth
            anchoredId={government.id}
            onAnchor={(id) =>
              navigate(`/governments/${encodeURIComponent(id)}`)
            }
          />
        </section>
      ) : null}

      <Title description={t("cabinet_detail_description", { name: fullName })}>
        {t("cabinet_detail_title", { name: fullName })}
      </Title>

      <Hero government={government} allGovernments={governments} lang={lang} />

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-1">
          {t("cabinet_detail_term_metrics_heading")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          {t("cabinet_detail_term_metrics_explainer")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {LANDING_KPI_ORDER.map((key: MacroIndicatorKey) => (
            <CabinetKpiTile
              key={key}
              indicatorKey={key}
              government={government}
            />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-1">
          {t("cabinet_detail_term_averages_heading")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          {t("cabinet_detail_term_averages_explainer")}
        </p>
        <CabinetScoreDetail government={government} macro={macro} />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-1">
          {t("cabinet_detail_chart_heading")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          {t("cabinet_detail_chart_explainer")}
        </p>
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["gdpGrowth", "inflation", "unemployment"]}
          yAxisFormatter={(v) => `${v}`}
          unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
          showZeroLine
          hideToggles
          height={300}
          eventMarkers={termEvents}
          xDomainOverride={termXDomain ?? undefined}
          highlightedCabinetId={government.id}
          chartEvents={termChartEvents}
        />
        <p className="mt-2 text-[10px] text-muted-foreground">
          {t("cabinet_detail_chart_window", {
            from: formatDateLong(government.startDate, lang),
            to: formatDateLong(government.endDate, lang),
          })}
        </p>
      </section>

      <section className="mb-2 flex flex-wrap gap-4 items-center justify-between border-t pt-6">
        <Link
          to="/governments"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("cabinet_detail_back_to_all")}
        </Link>
        <div className="flex gap-3 flex-wrap">
          <Link
            to={`/indicators/compare?cabinet=${encodeURIComponent(government.id)}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t("cabinet_detail_compare_link")}
            <ExternalLink className="h-3 w-3" />
          </Link>
          <Link
            to={`/indicators?cabinet=${encodeURIComponent(government.id)}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t("cabinet_detail_indicators_link")}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </section>
    </div>
  );
};

// Auto-bounce to /governments after showing the 404 message for ~1.5s. Gives
// the user a chance to read the message before the redirect; replace:true so
// the bad URL doesn't end up in history.
const NotFoundRedirect: FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(
      () => navigate("/governments", { replace: true }),
      1500,
    );
    return () => clearTimeout(t);
  }, [navigate]);
  return null;
};
