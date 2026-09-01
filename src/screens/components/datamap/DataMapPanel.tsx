import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowUpRight, X } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { Anchor } from "@/ux/Anchor";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/currency";
import type { DataMapManifest, DataMapNode } from "@/data/dataMap/useDataMap";
import { dataMapLinkNeighbours } from "@/data/dataMap/useDataMap";
import { KIND_DOT } from "./kindDot";
import { formatDateLong } from "@/lib/formatDate";

type Props = {
  manifest: DataMapManifest;
  lang: "bg" | "en";
  selectedId: string | null;
  freshness: Map<string, string>;
  onSelect: (id: string | null) => void;
  /** T4's overlay classes: sticky positioning, the scroll ceiling and the
   *  shadow that lifts the card off the dotted canvas at >= lg. */
  className?: string;
};

const formatDate = (iso: string, lang: "bg" | "en"): string =>
  formatDateLong(iso, lang);

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
  className,
}) => {
  const { t } = useTranslation();
  const byId = useMemo(
    () => new Map(manifest.nodes.map((n) => [n.id, n])),
    [manifest.nodes],
  );
  const node = selectedId ? byId.get(selectedId) : undefined;
  // Lateral neighbours of the selection, ONE hop. Empty for every non-dataset
  // node, and the section is omitted entirely rather than shown empty.
  const links = useMemo(
    () =>
      selectedId
        ? dataMapLinkNeighbours(manifest.links, selectedId)
            .map((l) => ({
              link: l,
              other: byId.get(l.a === selectedId ? l.b : l.a),
            }))
            .filter((x) => !!x.other)
        : [],
    [manifest.links, selectedId, byId],
  );

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

  // No selection, nothing to say. The hint, the tier counts, the freshness
  // legend and the stories all described the PAGE rather than a node, so they
  // moved into the head — and a panel that renders nothing costs no width, no
  // height and no scroll, which is the whole point of T3.
  if (!node) return null;

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

        {links.length ? (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("data_map_group_links")}
            </h4>
            <ul className="space-y-1.5">
              {links.map(({ link, other }) => (
                <li key={link.id} className="text-sm">
                  <button
                    type="button"
                    onClick={() => onSelect(other!.id)}
                    className="text-left text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
                  >
                    {other!.label[lang]}
                  </button>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {link.kind === "boundary"
                      ? `· ${t("data_map_key_boundary")}`
                      : `· ${t(`data_map_key_${link.key === "person_id" ? "person" : link.key}`)}`}
                    {/* The overlap is a COUNT of shared keys. Where the key is
                        sparse the link declares what it is a share of, and that
                        caveat is printed with it — 1,471 of 12,015 Interreg
                        partner rows carry a place, so a bare number beside the
                        dataset name would claim coverage it does not have. */}
                    {typeof link.overlap === "number"
                      ? ` · ${formatCount(link.overlap, lang === "bg" ? "bg-BG" : "en-GB", 0)}${
                          link.of ? ` ${link.of[lang]}` : ""
                        }`
                      : ""}
                  </span>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {link.label[lang]}
                  </p>
                  {/* What turns the map's claim ("these two join on ЕИК") into
                      something a reader can run, rather than a diagram. The
                      link names a library query id — never raw SQL in a URL. */}
                  {link.query ? (
                    <Link
                      to={`/db?q=${link.query}`}
                      className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                    >
                      {t("data_map_run_query")}
                      <ArrowUpRight className="size-3" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
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
