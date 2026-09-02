import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Search, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { Anchor } from "@/ux/Anchor";
import { Input } from "@/components/ui/input";
import { Pill, PillGroup } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/skeleton";
import {
  computeFreshnessMap,
  dataMapFreshnessTier,
  dataMapLensColor,
  useDataMap,
  type DataMapNode,
  type DataMapOrigin,
} from "@/data/dataMap/useDataMap";
import { useDataChanges } from "@/data/dataChanges/useDataChanges";
import { formatDate } from "@/lib/formatDate";

// Data-driven registry: one tile per SOURCE_GROUPS entry (scripts/data_map/model.ts),
// read from the same served manifest (data_map.json) that /data already fetches — so
// this list is never hand-maintained out of step with what the site actually reads.
// Sections come from the manifest's own `views` (the same six the /data lens picker
// offers), grouped by each source's PRIMARY tag (tags[0]).

const ORIGINS: DataMapOrigin[] = ["state", "eu", "intl", "community"];

/** Parses cleanly for every SOURCE_GROUPS entry today (all are hand-typed
 *  `https://…` literals), but nothing validates that at the data layer besides
 *  model.test.ts's own url-format assertion — a future typo must not blank
 *  all 46 tiles from one bad `new URL()` throw during render. */
const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const DomainHeading: React.FC<{ id: string; children: React.ReactNode }> = ({
  id,
  children,
}) => (
  <h3
    id={id}
    className="scroll-mt-24 font-display text-xl md:text-2xl font-bold tracking-tight text-foreground border-b border-border pb-2"
  >
    {children}
  </h3>
);

const Stat: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className="flex flex-col">
    <span className="font-display text-2xl font-medium leading-none text-foreground">
      {value}
    </span>
    <span className="mt-1 text-xs text-muted-foreground">{label}</span>
  </div>
);

const LegendDot: React.FC<{ color: string; label: string }> = ({
  color,
  label,
}) => (
  <span className="flex items-center gap-1.5">
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
    {label}
  </span>
);

const SourceTile: React.FC<{
  node: DataMapNode;
  lang: "bg" | "en";
  freshAt: string | undefined;
  now: number;
}> = ({ node, lang, freshAt, now }) => {
  const { t } = useTranslation();
  // The color and the label must agree on whether the origin is KNOWN: a grey
  // ("unknown") dot beside a specific country name previously asserted a false
  // claim for the (today unreachable, but not type-impossible — see
  // DataMapNode.origin) case of a node with no origin at all.
  const originKnown = node.origin !== undefined;
  const originColor = originKnown
    ? (dataMapLensColor("origin", node, freshAt, now) ??
      "hsl(var(--muted-foreground))")
    : "hsl(var(--muted-foreground))";
  const originKey = node.origin ?? "unknown";
  const freshColor =
    dataMapLensColor("fresh", node, freshAt, now) ??
    "hsl(var(--muted-foreground))";
  const tier = dataMapFreshnessTier(freshAt, now);
  const freshLabel =
    tier === "static"
      ? t("data_sources_freshness_static")
      : formatDate(freshAt!, lang);

  return (
    <Card className="flex h-full flex-col transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-lg">
      <CardContent className="flex flex-1 flex-col gap-3 p-4 md:p-5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
          {/* Text stays on a fixed AA-safe token — the chart palette is only
              vetted as a decorative fill/dot elsewhere (DataMapNodeCard), and
              painting foreground text with it fails WCAG AA contrast in the
              light theme for all four origin values. */}
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: originColor }}
            />
            {t(`data_sources_origin_${originKey}`)}
          </span>
          <span className="flex items-center gap-1.5 font-normal text-muted-foreground">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: freshColor }}
            />
            {freshLabel}
          </span>
        </div>

        <div>
          <h4 className="font-semibold leading-snug text-foreground">
            {node.label[lang]}
          </h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {node.desc[lang]}
          </p>
        </div>

        {node.issue ? (
          <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
            <TriangleAlert
              aria-hidden
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
            />
            <div>
              <p className="text-xs font-bold text-destructive">
                {node.issue.label[lang]}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-foreground/80">
                {node.issue.note[lang]}
              </p>
            </div>
          </div>
        ) : null}

        {node.url ? (
          <Anchor
            href={node.url}
            target="_blank"
            rel="noreferrer"
            className="mt-auto inline-flex items-center gap-1 self-start text-sm font-medium text-accent-strong hover:underline"
          >
            {hostnameOf(node.url)}
            <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0" />
          </Anchor>
        ) : null}
      </CardContent>
    </Card>
  );
};

export const DataSources = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: manifest, isLoading } = useDataMap();
  const { data: changes } = useDataChanges();
  const searchId = useId();

  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<"all" | DataMapOrigin>("all");
  const [issuesOnly, setIssuesOnly] = useState(false);

  const sources = useMemo(
    () => (manifest?.nodes ?? []).filter((n) => n.kind === "source"),
    [manifest],
  );

  const freshness = useMemo(
    () => computeFreshnessMap(sources, changes?.entries),
    [sources, changes],
  );

  const now = Date.now();
  const totalIssues = useMemo(
    () => sources.filter((n) => n.issue).length,
    [sources],
  );

  const q = query.trim().toLowerCase();
  const matches = (n: DataMapNode) => {
    if (origin !== "all" && n.origin !== origin) return false;
    if (issuesOnly && !n.issue) return false;
    if (q) {
      const hay =
        `${n.label[lang]} ${n.detail[lang]} ${n.desc[lang]}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const visibleCount = sources.filter(matches).length;

  const sections = useMemo(() => {
    if (!manifest) return [];
    return manifest.views
      .filter((v) => v.tag)
      .map((v) => ({
        view: v,
        nodes: sources.filter((n) => n.tags[0] === v.tag),
      }))
      .filter((s) => s.nodes.length > 0);
  }, [manifest, sources]);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    );
  }
  if (!manifest) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-6 border-b border-border pb-5">
        <Stat value={sources.length} label={t("data_sources_stat_sources")} />
        <Stat value={totalIssues} label={t("data_sources_stat_issues")} />
        <Stat value={visibleCount} label={t("data_sources_stat_shown")} />
        <div className="ml-auto flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <LegendDot
            color="hsl(var(--chart-1))"
            label={t("data_sources_legend_fresh")}
          />
          <LegendDot
            color="hsl(var(--chart-3))"
            label={t("data_sources_legend_aging")}
          />
          <LegendDot
            color="hsl(var(--chart-5))"
            label={t("data_sources_legend_stale")}
          />
          <LegendDot
            color="hsl(var(--muted-foreground))"
            label={t("data_sources_freshness_static")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <label htmlFor={searchId} className="sr-only">
            {t("data_sources_search_label")}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("data_sources_search_placeholder")}
            className="pl-9"
          />
        </div>
        <PillGroup label={t("data_sources_origin_filter_label")}>
          <Pill
            tone="neutral"
            size="sm"
            selected={origin === "all"}
            onClick={() => setOrigin("all")}
          >
            {t("data_sources_filter_all")}
          </Pill>
          {ORIGINS.map((o) => (
            <Pill
              key={o}
              tone="neutral"
              size="sm"
              selected={origin === o}
              onClick={() => setOrigin(o)}
            >
              {t(`data_sources_origin_${o}`)}
            </Pill>
          ))}
        </PillGroup>
        <Pill
          tone="neutral"
          size="sm"
          selected={issuesOnly}
          onClick={() => setIssuesOnly((v) => !v)}
          className="ml-auto"
        >
          {t("data_sources_issues_only")}
        </Pill>
      </div>

      {/* Always mounted, so it exists BEFORE its text first changes — a region
          that only acquires role="status" the moment its text changes is
          typically silent in real screen-reader/browser pairs (the same
          reasoning RegistrySearchField.tsx documents for its own live region). */}
      <span role="status" aria-live="polite" className="sr-only">
        {t("data_sources_stat_shown")}: {visibleCount}
      </span>

      {sections.map(({ view, nodes }) => {
        const visible = nodes.filter(matches);
        if (!visible.length) return null;
        return (
          <section key={view.id} className="space-y-4">
            <DomainHeading id={`sources-${view.id}`}>
              {view.label[lang]}
            </DomainHeading>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((n) => (
                <SourceTile
                  key={n.id}
                  node={n}
                  lang={lang}
                  freshAt={freshness.get(n.id)}
                  now={now}
                />
              ))}
            </div>
          </section>
        );
      })}

      {visibleCount === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("data_sources_empty")}
        </p>
      ) : null}
    </div>
  );
};
