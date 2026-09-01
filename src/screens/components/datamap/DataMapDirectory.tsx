// The /data hub's dataset directory and join-key strip.
//
// Two reasons it exists, and the second is the one that pays for it. The page
// shipped a canvas and almost no crawlable text, so nothing on it could be
// found — this puts ~35 internal links with real anchor text into the
// server-rendered HTML (plain <Link>s, never canvas-derived, or the SEO gain is
// zero). And the corpus's actual argument — that these datasets share keys, at
// this measured scale — was stated nowhere on the site.
//
// Nothing new is fetched: every figure here is already in the manifest.
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/ux/Card";
import { formatCount } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type {
  DataMapJoinKey,
  DataMapManifest,
} from "@/data/dataMap/useDataMap";
import { DATA_MAP_KEY_COLOR } from "@/data/dataMap/useDataMap";

type Lang = "bg" | "en";

const KEY_LABEL: Record<DataMapJoinKey, string> = {
  eik: "data_map_key_eik",
  person_id: "data_map_key_person",
  ekatte: "data_map_key_ekatte",
  procedure: "data_map_key_procedure",
  programme: "data_map_key_programme",
};

export const DataMapDirectory: FC<{
  manifest: DataMapManifest;
  lang: Lang;
  className?: string;
}> = ({ manifest, lang, className }) => {
  const { t } = useTranslation();
  const locale = lang === "bg" ? "bg-BG" : "en-GB";

  const datasets = useMemo(
    () => manifest.nodes.filter((n) => n.kind === "dataset"),
    [manifest.nodes],
  );

  // Per dataset: how many sources feed it, and how many lateral links it has.
  const stats = useMemo(() => {
    const sources = new Map<string, number>();
    const links = new Map<string, number>();
    for (const e of manifest.edges)
      if (e.to.startsWith("ds:"))
        sources.set(e.to, (sources.get(e.to) ?? 0) + 1);
    for (const l of manifest.links) {
      links.set(l.a, (links.get(l.a) ?? 0) + 1);
      links.set(l.b, (links.get(l.b) ?? 0) + 1);
    }
    return { sources, links };
  }, [manifest.edges, manifest.links]);

  // The join-key strip: one chip per key, with its LARGEST measured overlap and
  // the number of dataset pairs it joins. The largest rather than the sum,
  // because summing overlaps across pairs counts the same company many times —
  // the exact double-count this map exists to make visible.
  const keys = useMemo(() => {
    const by = new Map<
      DataMapJoinKey,
      { pairs: number; max: number; of?: string }
    >();
    for (const l of manifest.links) {
      if (l.kind !== "join" || !l.key) continue;
      const cur = by.get(l.key) ?? { pairs: 0, max: 0 };
      const beats = (l.overlap ?? 0) > cur.max;
      by.set(l.key, {
        pairs: cur.pairs + 1,
        max: Math.max(cur.max, l.overlap ?? 0),
        // Carry the winning link's denominator caveat. Without it the ekatte
        // chip printed a bare 4,018 whose link declares "of the companies with
        // a resolved seat" — and DataMapPanel prints that caveat on the same
        // page, so the two surfaces disagreed about one figure.
        of: beats ? l.of?.[lang] : cur.of,
      });
    }
    return [...by.entries()].sort((a, b) => b[1].max - a[1].max);
  }, [manifest.links, lang]);

  return (
    <div className={cn("space-y-6", className)}>
      {keys.length ? (
        <section aria-labelledby="datamap-keys">
          <h2
            id="datamap-keys"
            className="mb-2 text-sm font-semibold text-foreground"
          >
            {t("data_map_keys_title")}
          </h2>
          <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
            {t("data_map_keys_intro")}
          </p>
          <ul className="flex flex-wrap gap-2">
            {keys.map(([key, v]) => (
              <li key={key}>
                <Link
                  to={`/data?lens=links`}
                  className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:border-accent/60"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: DATA_MAP_KEY_COLOR[key] }}
                  />
                  <span className="font-medium">{t(KEY_LABEL[key])}</span>
                  <span className="text-muted-foreground">
                    {/* the LARGEST pair, never a sum across pairs */}
                    {t("data_map_keys_scale", {
                      n: formatCount(v.max, locale, 0),
                      pairs: v.pairs,
                    })}
                    {v.of ? ` ${v.of}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="datamap-directory">
        <h2
          id="datamap-directory"
          className="mb-3 text-sm font-semibold text-foreground"
        >
          {t("data_map_directory_title")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {datasets.map((d) => {
            const nLinks = stats.links.get(d.id) ?? 0;
            const nSources = stats.sources.get(d.id) ?? 0;
            return (
              <li key={d.id}>
                <Card className="h-full">
                  <CardContent className="p-3">
                    <Link
                      to={`/data?node=${encodeURIComponent(d.id)}`}
                      className="text-sm font-semibold text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
                    >
                      {d.label[lang]}
                    </Link>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">
                      {d.detail[lang]}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {`${t("data_map_card_sources", { count: nSources })} · ${t("data_map_card_links", { count: nLinks })}`}
                    </p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};
