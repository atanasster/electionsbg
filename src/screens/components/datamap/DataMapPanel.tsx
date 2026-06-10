import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowUpRight, Play, X } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { Anchor } from "@/ux/Anchor";
import { cn } from "@/lib/utils";
import type {
  DataMapKind,
  DataMapManifest,
  DataMapNode,
} from "@/data/dataMap/useDataMap";

type Props = {
  manifest: DataMapManifest;
  lang: "bg" | "en";
  selectedId: string | null;
  freshness: Map<string, string>;
  onSelect: (id: string | null) => void;
  onStartTour: (id: string) => void;
  className?: string;
};

const KIND_DOT: Record<DataMapKind, string> = {
  source: "bg-[hsl(var(--muted-foreground))]",
  dataset: "bg-[hsl(var(--chart-2))]",
  feature: "bg-[hsl(var(--accent))]",
};

const formatDate = (iso: string, lang: "bg" | "en"): string =>
  new Date(iso).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const NeighborChip: FC<{
  node: DataMapNode;
  lang: "bg" | "en";
  onSelect: (id: string) => void;
}> = ({ node, lang, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(node.id)}
    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:border-accent hover:bg-accent hover:text-accent-foreground"
  >
    <span
      aria-hidden
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", KIND_DOT[node.kind])}
    />
    <span className="truncate">{node.label[lang]}</span>
  </button>
);

const MetaRow: FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-baseline justify-between gap-3 text-sm">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 text-right font-medium text-foreground">
      {children}
    </span>
  </div>
);

export const DataMapPanel: FC<Props> = ({
  manifest,
  lang,
  selectedId,
  freshness,
  onSelect,
  onStartTour,
  className,
}) => {
  const { t } = useTranslation();
  const byId = useMemo(
    () => new Map(manifest.nodes.map((n) => [n.id, n])),
    [manifest.nodes],
  );
  const node = selectedId ? byId.get(selectedId) : undefined;

  const { upstream, downstream } = useMemo(() => {
    if (!node) return { upstream: [], downstream: [] };
    const up = manifest.edges
      .filter((e) => e.to === node.id)
      .map((e) => byId.get(e.from)!)
      .filter(Boolean);
    const down = manifest.edges
      .filter((e) => e.from === node.id)
      .map((e) => byId.get(e.to)!)
      .filter(Boolean);
    return { upstream: up, downstream: down };
  }, [manifest.edges, byId, node]);

  if (!node) {
    const counts = {
      sources: manifest.nodes.filter((n) => n.kind === "source").length,
      datasets: manifest.nodes.filter((n) => n.kind === "dataset").length,
      features: manifest.nodes.filter((n) => n.kind === "feature").length,
    };
    return (
      <Card className={className}>
        <CardContent className="p-5 space-y-3">
          <h3 className="font-display text-lg font-bold text-foreground">
            {t("data_map_hint_title")}
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("data_map_hint")}
          </p>
          <div className="grid grid-cols-3 gap-2 pt-1">
            {(
              [
                ["source", counts.sources, t("data_map_tier_sources")],
                ["dataset", counts.datasets, t("data_map_tier_datasets")],
                ["feature", counts.features, t("data_map_tier_features")],
              ] as const
            ).map(([kind, count, label]) => (
              <div
                key={kind}
                className="rounded-lg bg-secondary/40 px-2 py-2 text-center"
              >
                <div className="text-xl font-bold text-foreground">{count}</div>
                <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn("h-1.5 w-1.5 rounded-full", KIND_DOT[kind])}
                  />
                  {label}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("data_map_legend_fresh")}
          </p>
          {manifest.tours.length ? (
            <div className="border-t border-border pt-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("data_map_stories")}
              </h4>
              <p className="mb-2 text-xs leading-5 text-muted-foreground">
                {t("data_map_stories_hint")}
              </p>
              <ul className="space-y-1.5">
                {manifest.tours.map((tour) => (
                  <li key={tour.id}>
                    <button
                      type="button"
                      onClick={() => onStartTour(tour.id)}
                      className="inline-flex w-full items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-left text-sm font-medium text-secondary-foreground transition-colors hover:border-accent hover:bg-accent hover:text-accent-foreground"
                    >
                      <Play aria-hidden className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{tour.title[lang]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const freshAt = freshness.get(node.id) ?? node.freshness;

  return (
    <Card className={className}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 rounded-full", KIND_DOT[node.kind])}
              />
              {t(`data_map_kind_${node.kind}`)}
            </div>
            <h3 className="font-display text-lg font-bold leading-tight text-foreground">
              {node.label[lang]}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label={t("data_map_clear")}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm leading-6 text-foreground/90">
          {node.desc[lang]}
        </p>

        <div className="space-y-1.5 border-t border-border pt-3">
          {node.origin ? (
            <MetaRow label={t("data_map_origin")}>
              {t(`data_map_origin_${node.origin}`)}
            </MetaRow>
          ) : null}
          {node.cadence ? (
            <MetaRow label={t("data_map_cadence")}>
              {t(`data_map_cadence_${node.cadence}`)}
            </MetaRow>
          ) : null}
          {freshAt ? (
            <MetaRow label={t("data_map_updated")}>
              {formatDate(freshAt, lang)}
            </MetaRow>
          ) : null}
          {node.path ? (
            <MetaRow label={t("data_map_path")}>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {node.path}
              </code>
            </MetaRow>
          ) : null}
        </div>

        {upstream.length ? (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("data_map_upstream")}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {upstream.map((n) => (
                <NeighborChip
                  key={n.id}
                  node={n}
                  lang={lang}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ) : null}

        {downstream.length ? (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("data_map_downstream")}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {downstream.map((n) => (
                <NeighborChip
                  key={n.id}
                  node={n}
                  lang={lang}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ) : null}

        {node.sources?.length ? (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("data_map_group_sources")}
            </h4>
            <ul className="space-y-1.5">
              {node.sources.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  />
                  <span className="min-w-0">
                    <Anchor
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
                    >
                      {s.label}
                    </Anchor>
                    {s.cadence ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        · {t(`data_map_cadence_${s.cadence}`)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {node.route ? (
            <Link
              to={node.route}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              {t("data_map_open")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
          {node.url ? (
            <Anchor
              href={node.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:border-accent hover:bg-accent hover:text-accent-foreground"
            >
              {t("data_map_visit")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Anchor>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};
