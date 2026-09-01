import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Play } from "lucide-react";
import { Title } from "@/ux/Title";
import { cn } from "@/lib/utils";
import {
  DATA_MAP_FRESH_DAYS,
  DATA_MAP_KEY_COLOR,
  useDataMap,
  type DataMapLens,
} from "@/data/dataMap/useDataMap";
import { dataMapExtent, DATA_MAP_FIT_MAX_ZOOM } from "@/data/dataMap/viewport";
import { useDataChanges } from "@/data/dataChanges/useDataChanges";
import { DataMapCanvas } from "@/screens/components/datamap/DataMapCanvas";
import { DataMapPanel } from "@/screens/components/datamap/DataMapPanel";
import { KIND_DOT } from "@/screens/components/datamap/kindDot";
import { DataMapTourBar } from "@/screens/components/datamap/DataMapTourBar";
import { DataNav } from "@/screens/components/DataNav";

const LENSES: DataMapLens[] = ["none", "cadence", "origin", "fresh", "links"];

// Legend entries per lens: colour expression + i18n key.
const LENS_LEGEND: Record<
  Exclude<DataMapLens, "none">,
  { color: string; labelKey: string }[]
> = {
  cadence: [
    { color: "hsl(var(--chart-1))", labelKey: "data_map_cadence_daily" },
    { color: "hsl(var(--chart-3))", labelKey: "data_map_cadence_weekly" },
    { color: "hsl(var(--chart-4))", labelKey: "data_map_cadence_monthly" },
    {
      color: "hsl(var(--muted-foreground))",
      labelKey: "data_map_fresh_static",
    },
  ],
  origin: [
    { color: "hsl(var(--chart-4))", labelKey: "data_map_origin_state" },
    { color: "hsl(var(--chart-2))", labelKey: "data_map_origin_eu" },
    { color: "hsl(var(--chart-5))", labelKey: "data_map_origin_intl" },
    { color: "hsl(var(--chart-3))", labelKey: "data_map_origin_community" },
  ],
  // Derived from DATA_MAP_KEY_COLOR so the legend and the drawn edges cannot
  // disagree about what a colour means.
  links: [
    { color: DATA_MAP_KEY_COLOR.eik, labelKey: "data_map_key_eik" },
    { color: DATA_MAP_KEY_COLOR.person_id, labelKey: "data_map_key_person" },
    { color: DATA_MAP_KEY_COLOR.ekatte, labelKey: "data_map_key_ekatte" },
    { color: DATA_MAP_KEY_COLOR.procedure, labelKey: "data_map_key_procedure" },
    { color: DATA_MAP_KEY_COLOR.programme, labelKey: "data_map_key_programme" },
    {
      color: "hsl(var(--muted-foreground))",
      labelKey: "data_map_key_boundary",
    },
  ],
  fresh: [
    { color: "hsl(var(--chart-1))", labelKey: "data_map_fresh_7" },
    { color: "hsl(var(--chart-3))", labelKey: "data_map_fresh_30" },
    { color: "hsl(var(--chart-5))", labelKey: "data_map_fresh_old" },
    {
      color: "hsl(var(--muted-foreground))",
      labelKey: "data_map_fresh_static",
    },
  ],
};

export const DataMapScreen = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: manifest, isLoading } = useDataMap();
  const { data: changes } = useDataChanges();
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const viewId = searchParams.get("view") ?? "all";
  const viewTag = useMemo(
    () => manifest?.views.find((v) => v.id === viewId)?.tag ?? null,
    [manifest, viewId],
  );

  const rawLens = searchParams.get("lens") as DataMapLens | null;
  const lens: DataMapLens =
    rawLens && LENSES.includes(rawLens) ? rawLens : "none";

  // Guided story state — while a story runs, its current step drives the
  // selection (closure highlight + detail panel).
  const [story, setStory] = useState<{ id: string; step: number } | null>(null);
  const activeTour = useMemo(
    () =>
      story ? (manifest?.tours.find((t) => t.id === story.id) ?? null) : null,
    [manifest, story],
  );
  const storyStep =
    activeTour && story
      ? Math.min(Math.max(story.step, 0), activeTour.steps.length - 1)
      : 0;

  const rawNode = searchParams.get("node");
  const selectedId = useMemo(() => {
    if (activeTour) return activeTour.steps[storyStep].node;
    return rawNode && manifest?.nodes.some((n) => n.id === rawNode)
      ? rawNode
      : null;
  }, [rawNode, manifest, activeTour, storyStep]);

  // Live freshness overlay: data-changes.json (refreshed with every ingest,
  // served from the data bucket) can be newer than the build-time stamp in
  // the bundled manifest — take the max per node via its update skills.
  const freshness = useMemo(() => {
    const map = new Map<string, string>();
    if (!manifest || !changes?.entries) return map;
    const latestBySkill = new Map<string, string>();
    for (const e of changes.entries) {
      const prev = latestBySkill.get(e.skill);
      if (!prev || e.date > prev) latestBySkill.set(e.skill, e.date);
    }
    for (const n of manifest.nodes) {
      let best = n.freshness ?? "";
      for (const skill of n.skills ?? []) {
        const d = latestBySkill.get(skill);
        if (d && d > best.slice(0, 10)) best = d;
      }
      if (best) map.set(n.id, best);
    }
    return map;
  }, [manifest, changes]);

  // A manual node click takes over from a running story.
  const onSelect = useCallback(
    (id: string | null) => {
      setStory(null);
      setParam("node", id);
    },
    [setParam],
  );

  const onStartTour = useCallback(
    (id: string) => {
      setParam("node", null);
      setStory({ id, step: 0 });
    },
    [setParam],
  );

  // Bring the story's current node into view — the camera stays still on
  // desktop, so the page scroll is what walks the reader along the map.
  useEffect(() => {
    if (!activeTour) return;
    const nodeId = activeTour.steps[storyStep].node;
    const timer = window.setTimeout(() => {
      document
        .querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeTour, storyStep]);

  // The three tier counts. They describe the PAGE, so they belong in its head
  // rather than in the detail panel's empty state, where they were 360px of
  // sidebar repeating itself beside a 4000px canvas — and, on a narrow screen,
  // sat BELOW the whole map where nobody reached them.
  const counts = useMemo(() => {
    if (!manifest) return null;
    const by = (kind: string) =>
      manifest.nodes.filter((n) => n.kind === kind).length;
    return {
      source: by("source"),
      dataset: by("dataset"),
      feature: by("feature"),
    };
  }, [manifest]);

  // Size the canvas to the graph's own aspect ratio (width-driven) so the
  // initial fit lands near 1:1 zoom and stays readable — a fixed landscape
  // box would shrink the portrait graph to ~0.45×. Ultra-wide screens are
  // capped at ~1.15× so nodes don't balloon. The extent comes from the same
  // module the canvas frames with, so the box and the framing read one set of
  // bounds — see dataMapExtent for the one way they can still disagree.
  const extent = useMemo(
    () => (manifest ? dataMapExtent(manifest) : { w: 1, h: 1 }),
    [manifest],
  );

  // The detail panel renders under the canvas at every width, so a pick is
  // always off-screen — nudge it into view so the click visibly "answers".
  // During a story the bottom bar carries the narration instead.
  useEffect(() => {
    if (!selectedId || story) return;
    const id = window.setTimeout(() => {
      document
        .getElementById("datamap-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 550);
    return () => window.clearTimeout(id);
  }, [selectedId, story]);

  return (
    <>
      <Title description={t("data_map_description")}>
        {t("data_map_title")}
      </Title>
      <div className="mb-5 flex flex-col items-start gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
          {t("data_map_description")}
        </p>
        <DataNav active="map" />
        {manifest ? (
          <nav
            aria-label={t("data_map_views")}
            className="flex flex-wrap gap-2"
          >
            {manifest.views.map((v) => {
              const active = v.id === viewId;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParam("view", v.id === "all" ? null : v.id)}
                  className={cn(
                    "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-secondary/40 text-secondary-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {v.label[lang]}
                </button>
              );
            })}
          </nav>
        ) : null}
        {manifest && counts ? (
          <>
            {/* One line, not a tile grid: the head already costs ~527px before
                the map starts at 375px, and these are context rather than the
                page's subject. */}
            <div className="space-y-1">
              <p className="text-xs leading-5 text-muted-foreground">
                {(
                  [
                    ["source", counts.source, t("data_map_tier_sources")],
                    ["dataset", counts.dataset, t("data_map_tier_datasets")],
                    ["feature", counts.feature, t("data_map_tier_features")],
                  ] as const
                ).map(([kind, count, label], i) => (
                  <span key={kind}>
                    {i ? <span aria-hidden> · </span> : null}
                    <span
                      aria-hidden
                      className={cn(
                        "mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle",
                        KIND_DOT[kind],
                      )}
                    />
                    <span className="font-semibold text-foreground">
                      {count}
                    </span>{" "}
                    {label}
                  </span>
                ))}
              </p>
              {/* The hint already ends on the pulsing-dot rule, so the panel's
                  separate freshness legend is not repeated here — its key went
                  with the empty state. Grouped with the counts so the two cost
                  one flex gap rather than two: the head is the scarce space on
                  a phone, not the page. */}
              <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                {t("data_map_hint", { days: DATA_MAP_FRESH_DAYS })}
              </p>
            </div>
          </>
        ) : null}
      </div>

      {isLoading || !manifest ? (
        <div className="flex h-[50vh] items-center justify-center text-muted-foreground">
          {t("loading")}
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs lg:justify-start">
            <span className="text-muted-foreground">{t("data_map_lens")}:</span>
            {LENSES.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={l === lens}
                onClick={() => setParam("lens", l === "none" ? null : l)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 font-medium transition-colors",
                  l === lens
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-secondary/40 text-secondary-foreground hover:border-accent",
                )}
              >
                {t(`data_map_lens_${l}`)}
              </button>
            ))}
            {lens !== "none" ? (
              <span className="ml-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                {LENS_LEGEND[lens].map((e) => (
                  <span
                    key={e.labelKey}
                    className="inline-flex items-center gap-1"
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ background: e.color }}
                    />
                    {t(e.labelKey)}
                  </span>
                ))}
              </span>
            ) : null}
            {/* One line, beside the lens that draws them. The full list lives on
                its own page: the content is the eighteen notes, and a strip
                under a 3,000px canvas compressed them into five numbers. */}
            {lens === "links" ? (
              <Link
                to="/data/links"
                className="ml-2 text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
              >
                {t("data_links_pointer")}
              </Link>
            ) : null}
          </div>
          {/* The rail never takes width from the map, at any breakpoint. It
              used to dock from `lg` (1024) up, which left the canvas 617px — a
              0.575 zoom — and INVERTED the sizing: a 768px tablet got a 737px
              map and a 1024px one got 617.

              Docking cannot be afforded in this shell, which is why it is gone
              rather than moved to a wider breakpoint. Layout.tsx wraps every
              screen in `container p-2`, and `theme.container.screens` clamps
              `.container` to max-width 1400px from 1400px up (p-2's 8px a side
              beats the container's 2rem, because utilities follow components in
              index.css). So content is frozen at 1384px however wide the screen
              is, and a docked canvas would be 1384 − 360 − 16 = 1008px at EVERY
              width — below the 1046px this graph needs for 1:1, and a 16% step
              DOWN from the 1203px a stacked canvas gets. Measured: 1024 → 993,
              ≥1280 → 1203 (the cap below), flat from there.

              The panel therefore stacks under the map and T4 gives the
              selection an overlay, which needs no width at all. */}
          {manifest.tours.length ? (
            // A story is a MODE, the same family as the view and lens pills, so
            // it sits with them rather than in the detail panel — where, on a
            // narrow screen, it sat below a 1264px map and nobody reached it.
            // One row that scrolls sideways rather than wrapping, so it costs
            // one line at any width.
            //
            // The -mx-2/px-2 bleed is Layout.tsx's `p-2`: the scroller runs to
            // the page edge so a chip is never clipped mid-row. The two numbers
            // must agree, and dataMapLayout.test.ts holds them together.
            <nav
              aria-label={t("data_map_stories")}
              className="-mx-2 mb-3 flex w-[calc(100%+1rem)] items-center gap-2 overflow-x-auto px-2 py-1"
            >
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("data_map_stories_hint")}
              </span>
              {manifest.tours.map((tour) => {
                const running = story?.id === tour.id;
                return (
                  <button
                    key={tour.id}
                    type="button"
                    // Not aria-pressed: starting a story is an action, and the
                    // chip for the running one marks where the reader is.
                    aria-current={running ? "true" : undefined}
                    onClick={() => onStartTour(tour.id)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                      running
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border bg-secondary/40 text-secondary-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Play aria-hidden className="h-3 w-3 shrink-0" />
                    {tour.title[lang]}
                  </button>
                );
              })}
            </nav>
          ) : null}
          <div className="flex flex-col gap-4">
            <div
              className="relative min-h-[420px] w-full overflow-hidden rounded-xl border border-border bg-card/30"
              style={{
                aspectRatio: `${extent.w} / ${extent.h}`,
                // Past the fit ceiling the framing stops magnifying, so a
                // bigger box would only add empty space around the graph. Both
                // bounds read the ceiling the canvas actually frames with —
                // two literals here would drift from it silently.
                maxWidth: Math.round(extent.w * DATA_MAP_FIT_MAX_ZOOM),
                maxHeight: Math.round(extent.h * DATA_MAP_FIT_MAX_ZOOM),
              }}
            >
              <DataMapCanvas
                manifest={manifest}
                lang={lang}
                selectedId={selectedId}
                viewTag={viewTag}
                freshness={freshness}
                freshLabel={t("data_map_updated")}
                kindLabels={{
                  source: t("data_map_kind_source"),
                  dataset: t("data_map_kind_dataset"),
                  feature: t("data_map_kind_feature"),
                }}
                lens={lens}
                fitLabel={t("data_map_fit")}
                onSelect={onSelect}
              />
            </div>
            {/* empty:hidden — with no selection the panel renders nothing, and
                an empty flex child would still spend the row's 16px gap. */}
            <div id="datamap-panel" className="empty:hidden">
              <DataMapPanel
                manifest={manifest}
                lang={lang}
                selectedId={selectedId}
                freshness={freshness}
                onSelect={onSelect}
              />
            </div>
          </div>
          {activeTour ? (
            <DataMapTourBar
              tour={activeTour}
              step={storyStep}
              lang={lang}
              onStep={(step) => setStory({ id: activeTour.id, step })}
              onExit={() => setStory(null)}
            />
          ) : null}
          <p className="mx-auto mt-5 max-w-3xl text-center text-xs leading-5 text-muted-foreground">
            {t("data_map_method")}{" "}
            <Link
              to="/data/sources"
              className="underline underline-offset-4 decoration-accent/40 hover:decoration-accent"
            >
              {t("data_map_method_link")}
            </Link>
          </p>
        </>
      )}
    </>
  );
};
