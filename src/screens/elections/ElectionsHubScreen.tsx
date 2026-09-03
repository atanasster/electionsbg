// `/elections` — the cross-kind entry to both electoral systems (Phase 3).
//
// ⚠ IT IS THE ENTRY, NOT A RESULT. `/parliamentary` is canonical for "Bulgarian parliamentary
// results" and `/elections/:date` already carries a `<loc>` per cycle, so a hub that rendered
// the current country result would duplicate two pages that are already indexed (§3.1). What
// this page owns is the thing neither of them can be: both systems, the finder, and the
// partial elections between the regular cycles.
//
// ⚠ THE CYCLE COMES FROM `?elections`, WHICH A LINK CAN FORCE. `usePreserveParams` carries that
// param across every `@/ux/Link` navigation, so a reader arriving from `/elections/2013_05_12`
// brings 2013 with them. A hub that defaulted to the latest would render 2026 while
// `ElectionContext` — and every other reader of the param on this page — resolved 2013, at a
// 200. `resolveHubCycle` is that resolution and it reports its own fallback.
//
// ⚠ SELECTING WRITES THE PARAM, never client-only state (§3.2 rule 4), so the choice survives
// the navigation into `/elections/:date` or `/local/:cycle`.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { HubSearch } from "@/ux/search/HubSearch";
import { Link } from "@/ux/Link";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { buildPlaceItems } from "@/data/search/placeSearchItems";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { formatDate } from "@/lib/formatDate";
import { groupedInt } from "@/screens/analysis/analysisHubFigures";
import { ELECTIONS_BANDS, withLocalCycle } from "./electionsRegistry";
import { ELECTIONS_SCENES } from "./electionsScenes";
import { LATEST_ELECTION_EVENT, resolveHubCycle } from "./electionsHubCycle";
import { electionsHubKpis } from "./electionsHubFigures";
import { electionsSearchSources } from "./electionsSearch";

export const ElectionsHubScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [param, setParam] = useSearchParam("elections", { replace: true });
  const cycle = useMemo(() => resolveHubCycle(param), [param]);
  // ⚠ `useLatestLocalCycle()` RE-ANCHORS ON THE PARLIAMENTARY SELECTION AND CANNOT SEE A LOCAL
  // ONE. It reads `ElectionContext`, whose `selected` is validated against the parliamentary
  // catalogue only — so `?elections=2019_10_27_mi` leaves it on the latest local cycle while
  // this hub's scope pill says 2019. Measured by this screen's own gate. When the reader has
  // selected a local cycle, that IS the cycle; otherwise the anchored one is right, because it
  // is the local government in effect as of the parliamentary vote they picked.
  const anchoredLocal = useLatestLocalCycle();
  const localCycle = cycle.kind === "local" ? cycle.id : anchoredLocal;

  // ⚠ ARMED ON INTENT. `useSettlementsInfo` + `useMunicipalities` are ~980 KB together;
  // `HubSearch` flips this on focus or the first keystroke, so a reader who never searches
  // pays nothing — and a result page that never opens the finder issues no place-catalog
  // request at all, which is Phase 2's own network gate.
  const [armed, setArmed] = useState(false);
  const { settlements } = useSettlementsInfo(armed);
  const { municipalities } = useMunicipalities(armed);
  const { regions } = useRegions();
  const placeItems = useMemo(
    () =>
      settlements && municipalities
        ? buildPlaceItems(settlements, municipalities, regions)
        : null,
    [settlements, municipalities, regions],
  );

  const formatInt = useMemo(() => groupedInt(lang), [lang]);
  const formatPct = useMemo(
    () =>
      new Intl.NumberFormat(lang?.startsWith("bg") ? "bg-BG" : "en-GB", {
        maximumFractionDigits: 1,
      }),
    [lang],
  );
  const kpis = useMemo(
    () =>
      electionsHubKpis({
        cycle,
        lang,
        t,
        formatInt,
        formatPct: (n) => `${formatPct.format(n)}%`,
      }),
    [cycle, lang, t, formatInt, formatPct],
  );

  const sources = useMemo(
    () =>
      electionsSearchSources(placeItems, cycle, {
        inScope: {
          bg: "Места с резултат за този вот",
          en: "Places with a result for this vote",
        },
        outScope: {
          bg: "Места без местен вот (секции в чужбина)",
          en: "Places with no local vote (polling sections abroad)",
        },
      }),
    [placeItems, cycle],
  );

  // The canonical FULL result for the resolved cycle — the page this hub hands over to, and
  // the reason the hub does not try to be one.
  const fullResultTo =
    cycle.kind === "local" ? `/local/${cycle.id}` : `/elections/${cycle.id}`;
  // §Phase 3 item 4: ONE outcome canvas, and a compact adjacent link to the other kind — never
  // two simultaneous maps.
  const otherKindTo =
    cycle.kind === "local" ? "/parliamentary" : `/local/${anchoredLocal}`;

  const sections: TileHubSection[] = ELECTIONS_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map((tile) => ({
      // ⚠ THE CYCLE THE READER SELECTED, not the one the registry was written against. A tile
      // pinned to the latest cycle while the scope bar names an older one is the silent
      // disagreement §3.2 is about, one control down.
      to: tile.cycleScoped ? withLocalCycle(tile.to, localCycle) : tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: ELECTIONS_SCENES[tile.id],
    })),
  }));

  const cycleLabel = t(
    cycle.kind === "local"
      ? "elections_scope_local"
      : "elections_scope_parliamentary",
    // ⚠ `formatDate`, NEVER THE ID. A cycle identifier is a key; the folder form reached 31
    // surfaces once as „Този парламент · 2026-04-19". It also pins `timeZone: "UTC"` for a
    // date-only value, without which every reader west of Greenwich sees the previous day.
    { date: formatDate(cycle.date, lang) },
  );

  return (
    <>
      <HubHead
        eyebrow={t("elections_hub_eyebrow")}
        title={t("elections_hub_title")}
        seoDescription={t("elections_hub_seo_description")}
        deck={t("elections_hub_deck")}
        kpis={kpis}
        scope={
          <div
            className="flex flex-wrap items-center gap-3"
            data-elections-scope
          >
            <span className="rounded-full border bg-card px-3 py-1 text-sm font-medium">
              {cycleLabel}
            </span>
            <Link to={fullResultTo} className="text-sm underline">
              {t("elections_hub_full_result")}
            </Link>
            <Link to={otherKindTo} className="text-sm underline">
              {t(
                cycle.kind === "local"
                  ? "elections_hub_other_parliamentary"
                  : "elections_hub_other_local",
              )}
            </Link>
            {/* ⚠ AN EXPLICIT CONTROL, NEVER A SILENT DEFAULT (§3.2 rule 2). A hub showing 2013
                must say 2013; „switch to the latest" is offered, not applied. */}
            {cycle.id !== LATEST_ELECTION_EVENT.id ? (
              <button
                type="button"
                className="text-sm underline"
                onClick={() => setParam(LATEST_ELECTION_EVENT.id)}
                data-elections-switch-latest
              >
                {t("elections_scope_switch_latest")}
              </button>
            ) : null}
            {/* Rule 3: an unreadable param falls back to the latest AND SAYS SO. */}
            {cycle.fellBack ? (
              <p
                className="w-full text-sm text-muted-foreground"
                data-elections-fallback
              >
                {t("elections_scope_fallback", { requested: cycle.requested })}
              </p>
            ) : null}
          </div>
        }
        search={
          <HubSearch
            sources={sources}
            idPrefix="elections-finder"
            onArm={() => setArmed(true)}
            title={{
              bg: "Намерете населено място",
              en: "Find a place",
            }}
            placeholder={{
              bg: "село, град, община, област…",
              en: "village, town, municipality, region…",
            }}
            hint={{
              bg: "Търси в над 5000 населени места, 265 общини и 28 области.",
              en: "Searches more than 5,000 settlements, 265 municipalities and 28 regions.",
            }}
          />
        }
      />

      <div data-og="elections-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
