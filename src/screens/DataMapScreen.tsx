import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, Play } from "lucide-react";
import { Title } from "@/ux/Title";
import { cn } from "@/lib/utils";
import {
  dataMapView,
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
import { SHELL_BLEED } from "@/layout/shellPadding";
import { Pill, PillGroup } from "@/components/ui/Pill";
import { pillClass } from "@/components/ui/pillClass";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";

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
  // `lg` here is Tailwind's `lg` — the hook's own (min-width: 1024px).
  const overlays = useMediaQueryMatch("lg");
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
  // What the map actually draws: with a baked layout this is the view's members
  // at that view's positions; without one it is the whole graph and the canvas
  // dims the rest, which is how this filter behaved before v3.
  const graph = useMemo(
    () => (manifest ? dataMapView(manifest, viewId) : null),
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

  // Which edge the overlay hangs off. Features are the right-hand column and
  // sources the left, so a card on the opposite edge cannot cover the node that
  // was just clicked; datasets are the middle column and neither edge reaches
  // them, so they leave the card where it is.
  //
  // That last clause is hysteresis, and it is the point: recomputing the side
  // from every selection flipped it on 216 of 364 neighbour-chip traversals
  // (59%) and mid-tour in 3 of the 4 guided stories — a ~1,000px sideways jump,
  // with no transition, on the majority of clicks.
  // The toolbar's second row wraps once a lens legend renders (the `links`
  // lens alone is six entries), so its height is not a constant — and the
  // detail card offsets from it. A literal was right in the default state and
  // wrong the moment a lens was picked, with the toolbar painting over the
  // card's own title and close button. Measured, exactly as Header.tsx does
  // for --header-height and for the same reason.
  const toolbarRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () =>
      root.style.setProperty("--datamap-toolbar", `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--datamap-toolbar");
    };
  });

  const [overlaySide, setOverlaySide] = useState<"left" | "right">("right");
  const selectedKind = useMemo(
    () => manifest?.nodes.find((n) => n.id === selectedId)?.kind ?? null,
    [manifest, selectedId],
  );
  useEffect(() => {
    if (selectedKind === "feature") setOverlaySide("left");
    else if (selectedKind === "source") setOverlaySide("right");
  }, [selectedKind]);

  // The three tier counts, taken from what the map ACTUALLY DRAWS rather than
  // from the corpus. They describe the page, so they belong in its head rather
  // than in the detail panel's empty state — but since the `?view=` filter
  // reflows instead of dimming, a corpus-wide 46/36/26 beside a 9-node prices
  // view would be a caption for a different graph.
  const counts = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const by = (kind: string) => nodes.filter((n) => n.kind === kind).length;
    return {
      source: by("source"),
      dataset: by("dataset"),
      feature: by("feature"),
    };
  }, [graph]);

  // Size the canvas to the graph's own aspect ratio (width-driven) so the
  // initial fit lands near 1:1 zoom and stays readable — a fixed landscape
  // box would shrink the portrait graph to ~0.45×. Ultra-wide screens are
  // capped at ~1.15× so nodes don't balloon. The extent comes from the same
  // module the canvas frames with, so the box and the framing read one set of
  // bounds — see dataMapExtent for the one way they can still disagree.
  const extent = useMemo(
    () => (graph ? dataMapExtent(graph) : { w: 1, h: 1 }),
    [graph],
  );

  // A neighbour chip, a deep link or a tour step can name a node the active
  // view does not contain. Without this the panel would describe a node the map
  // does not draw — so the view widens to `all` rather than the two disagreeing.
  useEffect(() => {
    if (!graph || !selectedId || viewId === "all") return;
    if (!graph.nodes.some((n) => n.id === selectedId)) setParam("view", null);
  }, [graph, selectedId, viewId, setParam]);

  // The overlay materialises over the canvas with no viewport movement (the
  // nudge below is suppressed there), so Escape is the keyboard exit to match
  // the card's own close button.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onSelect]);

  // Below `lg` the panel renders under the map, so a pick lands off-screen —
  // nudge it into view so the click visibly "answers". At `lg` and up the card
  // overlays the canvas and is already in view, so nudging would just scroll
  // the page out from under the reader. `matchMedia` rather than a width
  // comparison: `window.innerWidth` counts the scrollbar and so disagrees with
  // the CSS breakpoint by ~15px. During a story the bottom bar narrates instead.
  useEffect(() => {
    if (!selectedId || story || overlays) return;
    const id = window.setTimeout(() => {
      document
        .getElementById("datamap-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 550);
    return () => window.clearTimeout(id);
  }, [selectedId, story, overlays]);

  return (
    <>
      {/* Title and section nav on ONE line. The H1 and the active DataNav pill
          were the same words 34px apart, and H1's own `py-3 md:py-5` plus
          `md:text-4xl` made that duplicate cost 80px. The deck paragraph that
          sat under them is gone entirely — it still earns its keep as the SEO
          description, which is where a 72px restatement of the page title
          belongs. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Title
          description={t("data_map_description")}
          // Every variant H1's base sets must be named here or it survives the
          // merge: `sm:text-3xl` made the title 30px at 640-767 — LARGER than
          // the 24px above it — and `md:py-5` kept all 40px of the padding this
          // was meant to remove. `leading-tight` is restated because twMerge
          // drops it when a text-size utility (which carries its own
          // line-height) replaces the base size.
          className="py-1 md:py-1 text-xl sm:text-xl md:text-2xl leading-tight"
        >
          {t("data_map_title")}
        </Title>
        <DataNav active="map" />
      </div>

      {isLoading || !manifest ? (
        <div className="flex h-[50vh] items-center justify-center text-muted-foreground">
          {t("loading")}
        </div>
      ) : (
        <>
          {/* ONE sticky toolbar in place of four stacked rows (view pills,
              counts, lens, stories — ~250px). It sticks because the map is
              4,237px tall: scroll into it and every control used to be gone, so
              changing the view meant scrolling all the way back to the top.
              `--header-height` rather than a literal, so it tracks the header
              it sits under; z-9 keeps it below that header and above the map.

              Sticky from `sm` UP only: the utility line wraps on a phone, where
              the bar is 159px — 28% of an 812px viewport to hold permanently,
              against a page this work already took from 2,576px to 1,821px. */}
          <div
            ref={toolbarRef}
            className={cn(
              SHELL_BLEED,
              "z-[9] mb-3 border-b border-border/60 bg-card py-2",
              "sm:sticky sm:top-[var(--header-height,70px)]",
            )}
          >
            <PillGroup label={t("data_map_views")} scroll className="gap-1.5">
              {manifest.views.map((v) => (
                <Pill
                  key={v.id}
                  selected={v.id === viewId}
                  onClick={() => setParam("view", v.id === "all" ? null : v.id)}
                >
                  {v.label[lang]}
                </Pill>
              ))}
            </PillGroup>

            {/* Counts, lens and stories were three rows saying "how do I look
                at this map". One line, and the counts read the DRAWN graph. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <p className="text-muted-foreground">
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

              <span aria-hidden className="text-border">
                |
              </span>

              <span className="text-muted-foreground">
                {t("data_map_lens")}:
              </span>
              {LENSES.map((l) => (
                <Pill
                  key={l}
                  size="sm"
                  selected={l === lens}
                  onClick={() => setParam("lens", l === "none" ? null : l)}
                >
                  {t(`data_map_lens_${l}`)}
                </Pill>
              ))}

              {lens !== "none" ? (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
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

              {/* One line, beside the lens that draws them. The full list lives
                  on its own page: the content is the eighteen notes, and a strip
                  under a 3,000px canvas compressed them into five numbers. */}
              {lens === "links" ? (
                <Link
                  to="/data/links"
                  // NOT text-accent-strong: that token is measured for white
                  // ON the fill (5.45:1); as text on --card it is 4.05:1, below
                  // AA for 12px. --popover-foreground is the palette's existing
                  // "coral dark enough to read as body text" stop.
                  className="text-popover-foreground underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                >
                  {t("data_links_pointer")}
                </Link>
              ) : null}

              {manifest.tours.length ? (
                <>
                  <span aria-hidden className="ml-auto text-border">
                    |
                  </span>
                  {/* A menu, not a Select: starting a story is an ACTION, and
                      four of them as chips cost a whole row of their own. */}
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        // It renders in the selected colour, so it has to say
                        // so: Radix contributes aria-haspopup/expanded, neither
                        // of which means "a story is running".
                        aria-current={story ? "true" : undefined}
                        className={cn(pillClass(!!story, "sm"), "gap-1")}
                      >
                        <Play aria-hidden className="h-3 w-3" />
                        {story
                          ? (activeTour?.title[lang] ?? t("data_map_stories"))
                          : t("data_map_stories")}
                        <ChevronDown aria-hidden className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-w-[18rem]">
                      {manifest.tours.map((tour) => (
                        <DropdownMenuItem
                          key={tour.id}
                          onSelect={() => onStartTour(tour.id)}
                        >
                          {tour.title[lang]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
            </div>
          </div>

          <div
            className="relative isolate flex flex-col gap-4"
            style={{
              // The overlay anchors to this wrapper, so it has to end where the
              // canvas does — otherwise a right-hand card hangs 181px off the
              // map at >=1400 while a left-hand one sits flush. `isolate` keeps
              // the card's z-10 out of the root stacking context, where the
              // fixed header also lives at z-10 and would lose to it on DOM
              // order alone.
              maxWidth: Math.round(extent.w * DATA_MAP_FIT_MAX_ZOOM),
            }}
          >
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
              {/* The hint is guidance ABOUT the map, so it is drawn on it —
                  faint, over the empty band above the first row of cards — and
                  it goes away the moment a node is picked. As page chrome it
                  cost 24px of head forever and sat where the reader was not
                  looking. pointer-events-none so it never eats a pan. */}
              {!selectedId && !story ? (
                <p className="pointer-events-none absolute inset-x-4 top-3 z-[1] text-center text-xs leading-5 text-muted-foreground">
                  {t("data_map_hint", { days: DATA_MAP_FRESH_DAYS })}
                </p>
              ) : null}
              <DataMapCanvas
                graph={graph!}
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
                hiddenLabel={(n) => t("data_map_hidden_edges", { count: n })}
                // One value decides both: the card and the zoom/fit controls
                // are the only two things that float over this canvas, and
                // bottom-right is where BOTH defaulted. A sticky card unpins at
                // the column's bottom, so the overlap sat exactly where a
                // reader reaches for "fit" — on 82 of 108 nodes.
                controlsSide={overlaySide === "left" ? "right" : "left"}
                onSelect={onSelect}
              />
            </div>
            {/* Below `lg` the card sits under the map. From `lg` up it OVERLAYS
                the canvas instead of docking beside it, because the shell has
                no width to give it: `.container` is clamped to 1400px, so a
                docked column would take 360 of a fixed 1384 at every size (see
                T2). An overlay costs nothing when idle and nothing when open.

                The column spans the canvas so the card can `sticky` down its
                whole 4,000px height, and it hangs off the edge OPPOSITE the
                selected node's tier so it never covers what was just clicked.
                pointer-events are off on the column and back on for the card,
                so the empty space above and below it still pans the map.

                empty:hidden — with no selection the panel renders nothing, and
                an empty flex child would still spend the row's 16px gap. */}
            <div
              id="datamap-panel"
              role="region"
              aria-live="polite"
              aria-label={t("data_map_detail")}
              className={cn(
                "empty:hidden lg:pointer-events-none lg:absolute lg:inset-y-0 lg:z-10 lg:w-[320px] xl:w-[360px]",
                overlaySide === "left" ? "lg:left-0" : "lg:right-0",
              )}
            >
              <DataMapPanel
                manifest={manifest}
                lang={lang}
                selectedId={selectedId}
                freshness={freshness}
                onSelect={onSelect}
                // Below the sticky toolbar, not under it — both measured, so a
                // wrapped lens legend cannot leave the toolbar painting over
                // this card's title and close button.
                className="lg:pointer-events-auto lg:sticky lg:top-[calc(var(--header-height,70px)+var(--datamap-toolbar,88px))] lg:max-h-[74vh] lg:overflow-y-auto lg:shadow-xl"
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
