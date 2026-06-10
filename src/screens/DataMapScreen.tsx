import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Title } from "@/ux/Title";
import { cn } from "@/lib/utils";
import { useDataMap } from "@/data/dataMap/useDataMap";
import { useDataChanges } from "@/data/dataChanges/useDataChanges";
import { DataMapCanvas } from "@/screens/components/datamap/DataMapCanvas";
import { DataMapPanel } from "@/screens/components/datamap/DataMapPanel";
import { DataNav } from "@/screens/components/DataNav";

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

  const rawNode = searchParams.get("node");
  const selectedId = useMemo(
    () =>
      rawNode && manifest?.nodes.some((n) => n.id === rawNode) ? rawNode : null,
    [rawNode, manifest],
  );

  const viewId = searchParams.get("view") ?? "all";
  const viewTag = useMemo(
    () => manifest?.views.find((v) => v.id === viewId)?.tag ?? null,
    [manifest, viewId],
  );

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

  const onSelect = useCallback(
    (id: string | null) => setParam("node", id),
    [setParam],
  );

  // Size the canvas to the graph's own aspect ratio (width-driven) so the
  // initial fit lands near 1:1 zoom and stays readable — a fixed landscape
  // box would shrink the portrait graph to ~0.45×. Ultra-wide screens are
  // capped at ~1.15× so nodes don't balloon.
  const extent = useMemo(() => {
    if (!manifest) return { w: 1, h: 1 };
    const w = Math.max(...manifest.tiers.map((t) => t.x + t.w)) + 16;
    const h = Math.max(...manifest.tiers.map((t) => t.y + t.h)) + 16;
    return { w, h };
  }, [manifest]);

  // On narrow screens the detail panel renders below the canvas — nudge it
  // into view when a node is picked so the tap visibly "answers".
  useEffect(() => {
    if (!selectedId || window.innerWidth >= 1024) return;
    const id = window.setTimeout(() => {
      document
        .getElementById("datamap-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 550);
    return () => window.clearTimeout(id);
  }, [selectedId]);

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
                className="lg:sticky lg:top-20 lg:max-h-[74vh] lg:overflow-y-auto"
              />
            </div>
          </div>
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
