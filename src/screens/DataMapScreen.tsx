import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Title } from "@/ux/Title";
import { cn } from "@/lib/utils";
import { useDataMap, type DataMapLens } from "@/data/dataMap/useDataMap";
import { useDataChanges } from "@/data/dataChanges/useDataChanges";
import { DataMapCanvas } from "@/screens/components/datamap/DataMapCanvas";
import { DataMapPanel } from "@/screens/components/datamap/DataMapPanel";
import { DataMapTourBar } from "@/screens/components/datamap/DataMapTourBar";
import { DataNav } from "@/screens/components/DataNav";

const LENSES: DataMapLens[] = ["none", "cadence", "origin", "fresh"];

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

  // Size the canvas to the graph's own aspect ratio (width-driven) so the
  // initial fit lands near 1:1 zoom and stays readable — a fixed landscape
  // box would shrink the portrait graph to ~0.45×. Ultra-wide screens are
  // capped at ~1.15× so nodes don't balloon.
  const extent = useMemo(() => {
    if (!manifest || !manifest.tiers.length) return { w: 1, h: 1 };
    const w = Math.max(...manifest.tiers.map((t) => t.x + t.w)) + 16;
    const h = Math.max(...manifest.tiers.map((t) => t.y + t.h)) + 16;
    return { w, h };
  }, [manifest]);

  // On narrow screens the detail panel renders below the canvas — nudge it
  // into view when a node is picked so the tap visibly "answers". During a
  // story the bottom bar carries the narration instead.
  useEffect(() => {
    if (!selectedId || story || window.innerWidth >= 1024) return;
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
      <div className="-mt-4 mb-5 flex flex-col items-center gap-4">
        <p className="max-w-2xl text-center text-sm text-muted-foreground md:text-base">
          {t("data_map_description")}
        </p>
        <DataNav active="map" />
        {manifest ? (
          <nav
            aria-label={t("data_map_views")}
            className="flex flex-wrap justify-center gap-2"
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
          </div>
          <div className="flex flex-col gap-4 lg:flex-row">
            <div
              className="relative min-h-[420px] w-full flex-1 overflow-hidden rounded-xl border border-border bg-card/30"
              style={{
                aspectRatio: `${extent.w} / ${extent.h}`,
                maxHeight: Math.round(extent.h * 1.2),
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
                onSelect={onSelect}
              />
            </div>
            <div id="datamap-panel" className="lg:w-[360px] lg:shrink-0">
              <DataMapPanel
                manifest={manifest}
                lang={lang}
                selectedId={selectedId}
                freshness={freshness}
                onSelect={onSelect}
                onStartTour={onStartTour}
                className="lg:sticky lg:top-20 lg:max-h-[74vh] lg:overflow-y-auto"
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
