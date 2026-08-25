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

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  HubHead,
  TileHubGrid,
  TileHubSection,
  type HubKpi,
} from "@/ux/infographic";
import { HubSearch } from "@/ux/search/HubSearch";
import { parliamentSearchSources } from "./parliament/parliamentSearch";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { nsOrdinal } from "@/data/parliament/nsOrdinal";
import { formatDate } from "@/lib/formatDate";
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

  // The roster is ~2,120 rows and only the finder needs it, so it is fetched on the first
  // focus or keystroke rather than on page load — a reader who never searches pays nothing.
  const [searchArmed, setSearchArmed] = useState(false);
  const { mps } = useMps(searchArmed);
  const { selected } = useElectionContext();
  const searchNs = useMemo(() => electionToNsFolder(selected), [selected]);
  const searchSources = useMemo(
    () =>
      parliamentSearchSources({
        mps: searchArmed ? mps : undefined,
        ns: searchNs ?? null,
        bg: i18n.language === "bg",
      }),
    [searchArmed, mps, searchNs, i18n.language],
  );

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
    Record<string, { metric: string; caption: string; secondary?: string }>
  >(() => {
    const out: Record<
      string,
      { metric: string; caption: string; secondary?: string }
    > = {};
    if (!stats) return out;
    const tiles = stats.tiles;
    Object.assign(out, {
      // ⚠ NO `metric` — the head's band publishes `sessions` now, with a declared basis and
      // above the fold. §3.1 rule 5: the same number twice on one page reads as two facts,
      // and the resolution is to drop it from the LOWER position. What survives here is the
      // figure the band does NOT carry: „законопроекти на второ четене", NOT „приети закони",
      // because the corpus has no adoption marker (§4.2) — so the phrase names the READING
      // rather than an outcome.
      votes: {
        metric: nf.format(tiles.billsSecondReading),
        // `count` drives the plural. Bulgarian's бройна форма („законопроекта") is wrong at
        // n = 1, and n = 1 is reachable — the 45th sat 17 days.
        caption: t("nsh_metric_bills", { count: tiles.billsSecondReading }),
      },
      embedding: {
        metric: nf.format(tiles.membersProjected),
        caption: t("nsh_metric_projected") || "MPs projected",
        secondary: t("nsh_metric2_groups", { count: tiles.groups }),
      },
      cohesion: {
        metric: dec2.format(tiles.cohesionMean),
        caption: t("nsh_metric_cohesion") || "mean cohesion",
        // The MINIMUM beside the mean, which is the pairing the tile has needed since an
        // earlier draft printed 0.94 as „средна кохезия" when 0.934 was the min and the mean
        // was 0.970. One number cannot wear both labels; two numbers can.
        ...(tiles.leastUnifiedGroup && tiles.leastUnifiedValue != null
          ? {
              secondary: t("nsh_metric2_least", {
                group: tiles.leastUnifiedGroup,
                value: dec2.format(tiles.leastUnifiedValue),
              }),
            }
          : {}),
      },
      // NO metric on Депутати, deliberately. /persons?role=mp is not NS-scoped and cannot
      // be — person_role rows for `mp` carry ref = mpId with no term column — so the
      // destination shows every member since the 44th, a number this corpus cannot
      // produce. Printing the chamber's roll beside a link to 2,120 rows is the
      // "show one window, count another" failure; an absent figure is honest.
      // ⚠ NO metric — both this tile's figure AND its secondary (`attendanceWeighted` and
      // `membersVoting`) are now the head's third and fourth KPI cells. Rule 5 again: this
      // tile keeps its description and stops restating the band.
      //
      // It is deliberately NOT given a substitute figure. `inRecessDays` is the only
      // unclaimed number in the blob and it describes the CALENDAR, not attendance — a
      // number under „Присъствие" that measures something else is worse than none.
    });
    return out;
  }, [stats, nf, dec2, t]);

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

  /** The head's four figures — the module's thesis, read as one sentence: „39 sittings,
   *  1 198 votes, 270 MPs, 73% attendance".
   *
   *  ⚠ THREE OF THE FOUR HAVE MORE THAN ONE DEFENSIBLE ANSWER, and this hub is where a draft
   *  once got six of six wrong, each for a different reason. It happened again in this very
   *  step — „депутати" was captioned „гласували поне веднъж" and the figure counts the roll,
   *  absences included. The basis line is what picks one, and it is only worth anything when
   *  somebody has checked which one the field actually holds:
   *
   *    гласувания   1 198 post-dedupe · 1 263 raw · 1 157 titled
   *    присъствие   73.2% weighted · 70.2% simple mean · 73.6% over full-term members
   *    депутати     270 on the roll · 255 the projection places · 240 seats
   *
   *  So „точки, след обединяване на прегласуванията" and „претеглено по точки" are not
   *  hedges — each is the one clause that makes its number checkable.
   *
   *  ⚠ NO `to` ON THESE CELLS. §3.1 rule 4 wants a KPI to link somewhere that can name the
   *  rows behind it, and for three of these that page does not exist: /persons?role=mp is not
   *  NS-scoped and cannot be (person_role rows for `mp` carry ref = mpId with no term
   *  column), so it answers with every member since the 44th. A cell linking to a page that
   *  counts a different set is the failure rule 4 exists to prevent; an unlinked cell is
   *  merely quiet. The `votes` and `attendance` TILES below still link, scoped correctly.
   *
   *  ⚠ SCOPE IS `?elections`, WHICH A LINK CANNOT CLEAR. §3.1's „not forceable" case: quote
   *  the SELECTED parliament and let the caption name it, which is what `{{ns}}` does. */
  const kpis: HubKpi[] = useMemo(() => {
    if (!stats) return [];
    // ⚠ `assembly`, NOT `ns`. `ns` is a RESERVED i18next option meaning NAMESPACE, so
    // `t(key, { ns })` sends the lookup to a namespace named „52-ро НС", finds nothing and
    // returns the KEY — which renders as „NSH_KPI_SESSIONS_BASIS" under a figure, uppercased
    // by the cell's own styling. Invisible to tsc and to every unit test in this repo, and
    // caught only by loading the page. The same trap hit `nsh_kpi_note_partial`, which is
    // the coverage caveat — the one string that must not fail silently.
    const assembly = nsOrdinal(searchNs ?? "", i18n.language);
    const tiles = stats.tiles;
    return [
      {
        value: nf.format(tiles.sessions),
        label: t("nsh_kpi_sessions") || "Sittings",
        basis: t("nsh_kpi_sessions_basis", { assembly }) || "plenary days",
        // The ONE cell that can link honestly. /votes is strictly NS-scoped
        // (`useRollcallIndex` filters `s.ns === ns`) and `useHeadHref` carries `?elections`
        // forward, so the page it opens lists exactly these sittings — verified equal to
        // `tiles.sessions` for all nine parliaments. The other three stay unlinked, and
        // /parliament/attendance is NOT the exception it looks like: it filters rows by
        // ATTENDANCE_MIN_ITEMS and isSeatedNow, so it counts a different set.
        to: "/votes",
      },
      {
        value: nf.format(tiles.items),
        label: t("nsh_kpi_items") || "Votes",
        basis: t("nsh_kpi_items_basis") || "items, after folding re-votes",
      },
      {
        // ⚠ NOT „гласували поне веднъж". `membersVoting` is `attendanceEntries.length`, and
        // `computeAttendance` opens an entry on `vote === "absent"` too — so it counts every
        // MP who appears in a roll call, cast or not. Measured across the corpus: 2 of the
        // 52nd's 270 never cast a vote, and 24 of the 50th's 289 (8.3%). „Voted at least
        // once" would have contradicted the absence card three rows below it, which reads
        // „50 от 240 депутати не гласуваха по нито една точка".
        value: nf.format(tiles.membersVoting),
        label: t("nsh_kpi_members") || "MPs",
        basis: t("nsh_kpi_members_basis") || "on the roll-call lists",
      },
      {
        value: pct.format(tiles.attendanceWeighted),
        label: t("nsh_kpi_attendance") || "Attendance",
        basis: t("nsh_kpi_attendance_basis") || "weighted by item",
      },
    ];
  }, [stats, searchNs, i18n.language, nf, pct, t]);

  /** The head's ranked list — who is actually in this parliament.
   *
   *  It DECOMPOSES the „Депутати" cell directly above it: the rows sum to `membersVoting` by
   *  construction, so they are parts of a number the reader has just read rather than a fifth
   *  statistic. That is also why the partition comes from the roll and not from `cohesion.json`,
   *  whose own population sums to 273 against the cell's 270.
   *
   *  ⚠ IT IS NOT A SEAT COUNT and the basis says so. An MP who changed group is counted once,
   *  under the last one the attendance pass saw — so „ПБ 143" is „143 on the roll under ПБ",
   *  not „ПБ holds 143 seats". The two differ by exactly the switchers.
   *
   *  Rows are UNLINKED: there is no per-group page in this module, and /party/:id is the
   *  ELECTORAL party keyed by its election name — matching „ГЕРБ - СДС" onto it is a
   *  name-match masquerading as an identity. The heading's action goes to /parliament/cohesion,
   *  which lists the same SET (these groups) even though it ranks them by a different measure.
   */
  const evidence = useMemo(() => {
    const rows = stats?.topGroups ?? [];
    if (!rows.length) return undefined;
    return {
      heading: t("nsh_evidence_groups") || "Parliamentary groups",
      basis: t("nsh_evidence_groups_basis"),
      rows: rows.map((g) => ({
        id: g.short,
        label: g.short,
        value: nf.format(g.members),
      })),
      action: {
        to: "/parliament/cohesion",
        // NO SILENT CAP. The blob carries five groups and the cut hides at least one in eight
        // of the nine parliaments — on the 51st the five shown hold 214 of 309 members, under
        // a „Депутати 309" cell one column over. So when there is a remainder the link SAYS
        // how much it is, and „всички групи" is reserved for the case where there is none.
        label: stats?.otherGroups
          ? t("nsh_evidence_groups_more", { count: stats.otherGroups })
          : t("nsh_evidence_groups_all") || "all groups",
      },
    };
  }, [stats, nf, t]);

  const pageTitle = t("nsh_hub_title") || "National Assembly";

  const seeds: Partial<Record<ParliamentSeed, string | undefined>> = useMemo(
    () => stats?.seeds ?? {},
    [stats],
  );

  const sections: TileHubSection[] = useMemo(
    () =>
      PARLIAMENT_BANDS.map((band) => ({
        heading: t(band.labelKey),
        description: t(band.descKey),
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
              // NO `cta`. „разгледай →" repeated on every tile is an affordance the tile
              // already has — the whole card is the link, and it carries a hover state that
              // says so. The one place a cta earns its keep is where it names a DIFFERENT
              // action than "open this" (ProjectFileScreen's „Създай досие"), which is why
              // the prop stays optional rather than being removed from the kit.
              ...(metrics[tile.id] ?? {}),
              ...(metrics[tile.id]
                ? {
                    metricCaption: metrics[tile.id].caption,
                    ...(metrics[tile.id].secondary
                      ? { metricSecondary: metrics[tile.id].secondary }
                      : {}),
                  }
                : {}),
            },
          ];
        }),
      })).filter((section) => section.tiles.length > 0),
    [t, seeds, metrics],
  );

  return (
    <>
      <GovernanceBreadcrumb
        sectionKey="gov_hub_parliament_title"
        sectionTo="/parliament"
        className="mt-5"
      />
      <HubHead
        eyebrow={t("nsh_head_eyebrow") || "NATIONAL ASSEMBLY"}
        title={pageTitle}
        seoDescription={t("nsh_hub_description") || pageTitle}
        deck={
          t("nsh_hub_intro") ||
          "Roll-call voting in the Bulgarian National Assembly — every sitting, every item, and how each MP voted."
        }
        search={
          /* IN the head's slot now, but unchanged in every other respect: still directly
             above the bands, still arming its roster only on intent, so a visitor who never
             searches pays nothing for the ~2 120 rows. */
          <HubSearch
            sources={searchSources}
            idPrefix="parliament-search"
            onArm={() => setSearchArmed(true)}
            title={{ bg: "Търсене в парламента", en: "Search parliament" }}
            placeholder={{
              bg: "депутат или тема на гласуване…",
              en: "an MP or a voted item…",
            }}
            hint={{
              bg: "Депутати и гласувани теми — в избраното НС и в останалите.",
              en: "MPs and voted items — in the selected Assembly and the others.",
            }}
          />
        }
        kpis={kpis}
        kpisPending={4}
        evidence={evidence}
        /* THE COVERAGE CAVEAT BELONGS UNDER THE FIGURES IT QUALIFIES, not in a paragraph
           above them. `partial` is the dangerous state precisely because it renders exactly
           like a complete term — the 44th holds five months of four years — and four of the
           thirteen elections in the picker map to a parliament with no roll-call votes at
           all, reachable by ordinary navigation since `?elections` is preserved. */
        kpiNote={
          stats?.coverage === "partial"
            ? t("nsh_kpi_note_partial", {
                assembly: nsOrdinal(searchNs ?? "", i18n.language),
                // Localized, not raw ISO. `formatDate` also pins a date-only value to UTC,
                // so the window cannot shift a day west of Greenwich.
                from: formatDate(stats.coveredFrom, i18n.language),
                to: formatDate(stats.coveredTo, i18n.language),
              })
            : undefined
        }
      />

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
