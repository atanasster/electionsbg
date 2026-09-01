// /data/links — "How the data connects".
//
// The corpus's own argument, which was stated nowhere on the site: these
// datasets are not separate, they join on a handful of keys, and here is the
// measured size of each join.
//
// It exists as a PAGE rather than a strip on /data because the content is the
// eighteen NOTES, not the five numbers. A chip row compressed 18 sentences into
// 5 maxima and dropped every caveat — including the boundary link, whose whole
// point is one sentence ("cross-border money, published separately — never add
// the two totals") that otherwise renders as an unlabelled dashed grey edge you
// only meet by selecting one of its endpoints.
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { DataNav } from "@/screens/components/DataNav";
import { formatCount } from "@/lib/currency";
import {
  DATA_MAP_KEY_COLOR,
  useDataMap,
  type DataMapJoinKey,
  type DataMapLink,
  type DataMapManifest,
} from "@/data/dataMap/useDataMap";

const KEY_LABEL: Record<DataMapJoinKey, string> = {
  eik: "data_map_key_eik",
  person_id: "data_map_key_person",
  ekatte: "data_map_key_ekatte",
  procedure: "data_map_key_procedure",
  programme: "data_map_key_programme",
};

/** Stable key order: the widest joins first, so the page opens on the big ones. */
const KEY_ORDER: DataMapJoinKey[] = [
  "eik",
  "person_id",
  "ekatte",
  "procedure",
  "programme",
];

const LinkRow: FC<{
  link: DataMapLink;
  lang: "bg" | "en";
  label: (id: string) => string;
}> = ({ link, lang, label }) => {
  const { t } = useTranslation();
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return (
    <li className="border-t border-border py-2.5 first:border-t-0">
      <p className="text-sm font-medium">
        <Link
          to={`/data?node=${encodeURIComponent(link.a)}`}
          className="text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
        >
          {label(link.a)}
        </Link>
        <span className="mx-1.5 text-muted-foreground">↔</span>
        <Link
          to={`/data?node=${encodeURIComponent(link.b)}`}
          className="text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
        >
          {label(link.b)}
        </Link>
      </p>
      {/* The note is the content — it says what the join ANSWERS. */}
      <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
        {link.label[lang]}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {typeof link.overlap === "number" ? (
          <span className="font-medium text-foreground">
            {t("data_links_overlap", {
              n: formatCount(link.overlap, locale, 0),
            })}
          </span>
        ) : null}
        {/* The denominator, where the key is sparse. A bare number beside a
            corpus-sized dataset name claims coverage the key does not have. */}
        {link.of ? <span>{link.of[lang]}</span> : null}
        {link.query ? (
          <Link
            to={`/db?q=${link.query}`}
            className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          >
            {t("data_map_run_query")}
          </Link>
        ) : null}
      </p>
    </li>
  );
};

export const DataLinksScreen = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  // NOT `as { data?: … }`: that cast discards isLoading, and without it both
  // the loading state and a CACHED v1 manifest (coerced to links: []) render a
  // finished-looking page — title, nav, and an intro promising "the figure
  // beside each pair is measured against the data itself" above nothing.
  const { data, isLoading } = useDataMap();
  const manifest = data as DataMapManifest | undefined;

  const label = useMemo(() => {
    const byId = new Map(
      (manifest?.nodes ?? []).map((n) => [n.id, n.label[lang]]),
    );
    return (id: string) => byId.get(id) ?? id;
  }, [manifest, lang]);

  const byKey = useMemo(() => {
    const m = new Map<DataMapJoinKey, DataMapLink[]>();
    for (const l of manifest?.links ?? []) {
      if (l.kind !== "join" || !l.key) continue;
      m.set(l.key, [...(m.get(l.key) ?? []), l]);
    }
    for (const arr of m.values())
      arr.sort((a, b) => (b.overlap ?? 0) - (a.overlap ?? 0));
    return m;
  }, [manifest]);

  const boundaries = useMemo(
    () => (manifest?.links ?? []).filter((l) => l.kind === "boundary"),
    [manifest],
  );

  return (
    <>
      <Title description={t("data_links_description")}>
        {t("data_links_title")}
      </Title>
      <div className="mb-5 flex flex-col items-start gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
          {t("data_links_intro")}
        </p>
        <DataNav active="links" />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : !byKey.size && !boundaries.length ? (
        // A returning visitor can pair a fresh bundle with a CDN-cached v1
        // manifest, which has no `links` at all. Say so rather than showing an
        // empty page under a paragraph that promises measured figures.
        <p className="text-sm text-muted-foreground">
          {t("data_links_unavailable")}
        </p>
      ) : null}

      <div className="space-y-6">
        {KEY_ORDER.filter((k) => byKey.has(k)).map((key) => (
          <section key={key} aria-labelledby={`k-${key}`}>
            <h2
              id={`k-${key}`}
              className="mb-1 flex items-center gap-2 text-sm font-semibold"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: DATA_MAP_KEY_COLOR[key] }}
              />
              {t(KEY_LABEL[key])}
            </h2>
            <Card>
              <CardContent className="px-3 py-1">
                <ul>
                  {byKey.get(key)!.map((l) => (
                    <LinkRow key={l.id} link={l} lang={lang} label={label} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))}

        {boundaries.length ? (
          <section aria-labelledby="k-boundary">
            <h2 id="k-boundary" className="mb-1 text-sm font-semibold">
              {t("data_links_boundary_title")}
            </h2>
            <p className="mb-2 max-w-2xl text-sm text-muted-foreground">
              {t("data_links_boundary_intro")}
            </p>
            <Card>
              <CardContent className="px-3 py-1">
                <ul>
                  {boundaries.map((l) => (
                    <LinkRow key={l.id} link={l} lang={lang} label={label} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
};
