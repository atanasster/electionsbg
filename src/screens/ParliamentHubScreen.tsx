// /parliament — the Народно събрание module front page.
//
// Replaces 49 lines of hardcoded JSX that mounted seven preview mini-tiles, each fetching a
// full derived artifact to render three rows: ~1.65 MB of JSON to draw a tile grid. Those
// tiles are dropped here; H1 replaces their numbers with one small hub_stats blob.
//
// Structure is the plan's §4.1: a session-strip hero over the tile bands. Bands 0–2 (wire,
// lead, news rail) arrive in H2 — they are deliberately last, being the only bands with no
// measured demand behind them.
//
// Data from parliamentRegistry; layout from the reusable infographic tile-hub kit. The two
// seeded band-4 tiles resolve from small precomputed shards (4.3 KB + 17 KB), never from
// the 11.7 MB aggregate they summarise, and OMIT themselves when their seed is missing.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import { LeadCard, NewsRail } from "@/ux/feed";
import type { NewsCardProps } from "@/ux/feed";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useParliamentHubStats } from "@/data/parliament/useParliamentHubStats";
import {
  useParliamentHubFeed,
  feedHref,
  type FeedItem,
} from "@/data/parliament/useParliamentHubFeed";
import { ParliamentWire } from "./parliament/ParliamentWire";
import {
  PARLIAMENT_BANDS,
  PARLIAMENT_TILES,
  resolveDestination,
  type ParliamentSeed,
} from "./parliament/parliamentRegistry";
import { PARLIAMENT_SCENES } from "./parliament/parliamentScenes";
import { ParliamentSessionStrip } from "./parliament/ParliamentSessionStrip";

// Dev-time guard for the stringly-typed tile.id ↔ PARLIAMENT_SCENES contract. A tile whose
// id has no scene does NOT degrade to an empty vignette — InfographicTile renders <Scene />
// unguarded, so `undefined` as a component type throws "Element type is invalid" and
// white-screens the route. The real gate is parliamentHubRegistry.test.ts at commit time.
if (import.meta.env.DEV) {
  const missing = PARLIAMENT_TILES.map((tile) => tile.id).filter(
    (id) => !PARLIAMENT_SCENES[id],
  );
  if (missing.length) {
    console.error(
      `[parliament hub] tile id(s) with no PARLIAMENT_SCENES scene: ${missing.join(", ")}`,
    );
  }
}

export const ParliamentHubScreen: FC = () => {
  const { t, i18n } = useTranslation();
  // ONE blob for the whole page. The seven mini-tiles this replaced fetched a full derived
  // artifact each — 1.65 MB between them — to render three rows apiece.
  const { stats } = useParliamentHubStats();
  // A second, per-NS shard for bands 0–2. Fetched in parallel with the blob above, so the
  // split costs no latency; it exists because this one carries Bulgarian bill titles and
  // only the parliament on screen needs them.
  const { feed } = useParliamentHubFeed();

  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB"),
    [i18n.language],
  );
  const pct = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB", {
        style: "percent",
        maximumFractionDigits: 0,
      }),
    [i18n.language],
  );
  const dec2 = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [i18n.language],
  );

  // Every figure carries the basis it was computed on, because there is more than one
  // defensible answer to most of them and the tile has to say which it used. Attendance is
  // WEIGHTED (Σpresent / Σitems); "гласувания" is the post-dedupe item count; "депутати"
  // leads with the DESTINATION's number, since /persons?role=mp is not NS-scoped and
  // cannot be — leading with the chamber's 240 and landing on 2,120 rows is the same
  // "show one window, count another" failure the plan spent three audits removing.
  const metrics = useMemo<
    Record<string, { metric: string; caption: string }>
  >(() => {
    const out: Record<string, { metric: string; caption: string }> = {};
    if (!stats) return out;
    const tiles = stats.tiles;
    Object.assign(out, {
      votes: {
        metric: nf.format(tiles.sessions),
        caption: t("nsh_metric_sessions") || "sittings",
      },
      embedding: {
        metric: nf.format(tiles.membersProjected),
        caption: t("nsh_metric_projected") || "MPs projected",
      },
      cohesion: {
        metric: dec2.format(tiles.cohesionMean),
        caption: t("nsh_metric_cohesion") || "mean cohesion",
      },
      // NO metric on Депутати, deliberately. /persons?role=mp is not NS-scoped and cannot
      // be — person_role rows for `mp` carry ref = mpId with no term column — so the
      // destination shows every member since the 44th, a number this corpus cannot
      // produce. Printing the chamber's roll beside a link to 2,120 rows is the
      // "show one window, count another" failure; an absent figure is honest.
      attendance: {
        metric: pct.format(tiles.attendanceWeighted),
        caption: t("nsh_metric_attendance") || "attendance (weighted)",
      },
    });
    return out;
  }, [stats, nf, pct, dec2, t]);

  // BAND 2 — one card per kind, topped up from the leftovers.
  //
  // The shard carries up to four items of each kind and the rail shows four in total, which
  // looks like waste until a thin parliament arrives: the 45th sat 17 days, and a rail built
  // as "one of each" would have rendered two cards there. Taking the head of each kind first
  // keeps the rail varied when the corpus is rich, and the spares fill it when it is not.
  const railItems = useMemo(() => {
    if (!feed) return [];
    const kinds = [
      feed.feed.sessions,
      feed.feed.bills,
      feed.feed.dissents,
      feed.feed.absences,
    ];
    const picked: FeedItem[] = kinds.map((k) => k[0]).filter(Boolean);
    for (const kind of kinds) {
      for (const item of kind.slice(1)) {
        if (picked.length >= 4) break;
        picked.push(item);
      }
    }
    return picked.slice(0, 4);
  }, [feed]);

  // The generator ships numbers and source text only — no glue prose — so every subtitle is
  // composed here, under an i18n key chosen by `kind`. That is what keeps the English hub
  // from being the Bulgarian one with English headings.
  //
  // A session's yes/no/abstain are VOTES summed over the whole sitting, not members: the
  // budget day is 219 items and 15,961 „за". Printed raw beside a date in a chamber of 240
  // that reads as a membership count off by two orders of magnitude, so they go out as
  // SHARES of the day's cast votes — the same encoding the strip's colours use.
  //
  // Every count goes through a `count` key so Bulgarian inflects it. That is why the session
  // subtitle is two fragments joined rather than one interpolated sentence: i18next
  // pluralises on a single `count`, and the first draft rendered „1 гласувания".
  const railCards = useMemo<(NewsCardProps & { id: string })[]>(
    () =>
      railItems.map((item) => {
        const s = item.stats;
        const cast = (s.yes ?? 0) + (s.no ?? 0) + (s.abstain ?? 0);
        const share = (n: number): string =>
          cast > 0 ? pct.format(n / cast) : "—";
        return {
          id: item.id,
          to: feedHref(item.target),
          at: item.at,
          kicker: t(`nsh_feed_kicker_${item.kind}`),
          title:
            item.title ||
            (item.kind === "absence"
              ? t("nsh_feed_title_absence", {
                  count: s.absent,
                  roll: s.roll,
                })
              : t("nsh_feed_untitled")),
          subtitle:
            item.kind === "session"
              ? [
                  t("nsh_num_items", { count: s.items }),
                  t("nsh_feed_split", {
                    yes: share(s.yes ?? 0),
                    no: share(s.no ?? 0),
                    abstain: share(s.abstain ?? 0),
                  }),
                ].join(" · ")
              : t(`nsh_feed_sub_${item.kind}`, {
                  ...s,
                  // The one number each kind inflects on: articles for a bill, breaks for a
                  // dissent, the sitting's items for the absence aggregate.
                  count:
                    item.kind === "bill"
                      ? s.articles
                      : item.kind === "dissent"
                        ? s.dissents
                        : s.items,
                }),
          badge: item.badge,
        };
      }),
    [railItems, t, pct],
  );

  const pageTitle = t("nsh_hub_title") || "National Assembly";
  const cta = t("gov_hub_view") || "разгледай";

  const seeds: Partial<Record<ParliamentSeed, string | undefined>> = useMemo(
    () => stats?.seeds ?? {},
    [stats],
  );

  const sections: TileHubSection[] = useMemo(
    () =>
      PARLIAMENT_BANDS.map((band) => ({
        heading: t(band.labelKey),
        tiles: band.tiles.flatMap((tile) => {
          const to = resolveDestination(tile, seeds);
          // An unresolved seed omits the tile. Rendering it with the raw `:mpId` pattern
          // would give a link that 404s in the SPA and, worse, would satisfy any gate that
          // only checks the destination is absolute.
          if (!to) return [];
          return [
            {
              to,
              title: t(tile.titleKey),
              desc: t(tile.descKey),
              accent: tile.accent,
              scene: PARLIAMENT_SCENES[tile.id],
              cta,
              ...(metrics[tile.id] ?? {}),
              ...(metrics[tile.id]
                ? { metricCaption: metrics[tile.id].caption }
                : {}),
            },
          ];
        }),
      })).filter((section) => section.tiles.length > 0),
    [t, cta, seeds, metrics],
  );

  return (
    <>
      <Title description={t("nsh_hub_description") || pageTitle}>
        {pageTitle}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="gov_hub_parliament_title"
        sectionTo="/parliament"
        className="mt-5"
      />

      {/* THE THREE COVERAGE STATES (§2.3). `undefined` is not "still loading" — four of the
          thirteen elections in the picker map to a parliament that published no roll-call
          votes, and ?elections= is preserved across navigation, so arriving here from a
          2009 page is an ordinary path. `partial` is the dangerous one: it renders exactly
          like a complete term unless the page says otherwise. */}
      {stats?.coverage === "partial" ? (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("nsh_coverage_partial", {
            from: stats.coveredFrom,
            to: stats.coveredTo,
          })}
        </p>
      ) : null}

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("nsh_hub_intro") ||
          "Roll-call voting in the Bulgarian National Assembly — every sitting, every item, and how each MP voted."}
      </p>

      {/* data-og is the OG capture's anchor (scripts/og/capture-screens.ts). The previous
          capture selected a party-correlation heatmap cell inside a tile this rebuild
          removes, so it would have waited 60 s and failed silently. */}
      <div data-og="parliament-hub">
        {/* BAND 0 — the wire, above the hero. One line, no border: anything boxed here
            competes with the strip for the top of the page, which §4.1 decided the strip
            should win. */}
        {feed?.wire ? (
          <div className="mt-4">
            <ParliamentWire wire={feed.wire} />
          </div>
        ) : null}

        <div className="mt-3">
          <ParliamentSessionStrip feedDays={feed?.strip} />
        </div>

        {/* BAND 1 — the lead. `stage`, never an outcome word: this corpus has no adoption
            marker at all (§4.2), and P3 measured 324 item pages where the obvious reading
            of „приет" — a majority of the votes cast — is wrong outright, because a чл.101
            veto re-vote needs 121 of 240 regardless of how many members are in the room. */}
        {feed?.lead ? (
          <LeadCard
            className="mt-4"
            to={feedHref(feed.lead.target)}
            at={feed.lead.at}
            kicker={t(`nsh_lead_stage_${feed.lead.stage}`)}
            title={feed.lead.title}
            subtitle={t("nsh_lead_basis")}
            stats={[
              {
                label: t("nsh_strip_legend_yes"),
                value: nf.format(feed.lead.stats.yes ?? 0),
                tone: "positive",
              },
              {
                label: t("nsh_strip_legend_no"),
                value: nf.format(feed.lead.stats.no ?? 0),
                tone: "negative",
              },
              {
                label: t("nsh_strip_legend_abstain"),
                value: nf.format(feed.lead.stats.abstain ?? 0),
              },
            ]}
          />
        ) : null}

        {/* BAND 2 — the news rail. Renders nothing at all when the shard has no items,
            rather than an empty row: this is one band of several, and a parliament with
            nothing to report should lose the rail, not gain a box explaining its absence. */}
        <NewsRail
          className="mt-6 sm:mt-8"
          heading={t("nsh_band_latest")}
          action={{ to: "/votes", label: t("gov_hub_view") || "разгледай" }}
          items={railCards}
        />

        <TileHubGrid sections={sections} className="mt-6 sm:mt-8" />
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        {t("nsh_hub_data_note") ||
          "Source: parliament.bg stenograms. Per-MP, per-item votes are extracted from the official roll-call CSV attached to each plenary day."}
      </p>
    </>
  );
};
