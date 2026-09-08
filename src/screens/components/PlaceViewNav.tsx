// Segmented switcher mounted at the top of a place's five "views" — the
// Governance dashboard (how the place is run now), the parliamentary-elections
// results, the presidential-elections results, the local-elections results, and
// the Consumption / cost-of-living view. It lets a reader pivot between the five
// angles on the SAME place (e.g. район Средец) without going back through
// search. The Governance and Consumption pills resolve at every tier
// (country → settlement) except a polling section.
//
// Governance/parliamentary/consumption/local are pure rewrites of the shared
// geographic identifiers — see placeViews.ts. Presidential is the one exception:
// presidentialViewUrl (also in placeViews.ts) resolves whenever the CODE SHAPE
// is one it can place, without checking whether that cycle actually published a
// surface there, because an uncovered presidential place still renders an
// honest "not published" page rather than a dead link — see its own header. The
// local pill is different: it self-hides when the place
// has no data in the active local cycle (the cycle index is the guard, same rule
// as CrossElectionLink's ToLocalLink), because that destination is a genuine
// 404. The whole control hides when fewer than two views are reachable (nothing
// to switch to).
//
// The active view always renders (highlighted, non-clickable) so the control
// reads as "you are here / here is where else you can go". Each view owns one
// accent hue (see PLACE_VIEW_META) so the active pill, plus PlaceHeader's
// eyebrow + left border, all read as the same colour — the "which dashboard
// am I on" cue. The inactive pills tint just their icon in the target view's
// hue so the colour↔view mapping is learnable.

import { FC } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  PlaceLevel,
  PlaceView,
  governanceUrl,
  parliamentaryUrl,
  localUrl,
  consumptionUrl,
  presidentialViewUrl,
  isSofiaCityObshtina,
} from "@/data/local/placeViews";
import { findCityRayon } from "@/data/local/cityRayonCatalog";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";
import { useLatestPresidentialCycle } from "@/data/presidential/useLatestPresidentialCycle";
import { PLACE_VIEW_META } from "./placeViewMeta";

// Stable left-to-right order of the views.
const ORDER: PlaceView[] = [
  "governance",
  "parliamentary",
  "presidential",
  "local",
  "consumption",
];

type Props = {
  active: PlaceView;
  level: PlaceLevel;
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  align?: "start" | "center";
  className?: string;
};

export const PlaceViewNav: FC<Props> = ({
  active,
  level,
  ekatte,
  obshtina,
  oblast,
  align = "center",
  className,
}) => {
  const { t } = useTranslation();
  const { search } = useLocation();
  const cycle = useLatestLocalCycle();
  const { data: index } = useLocalElectionIndex(cycle);
  const presidentialCycle = useLatestPresidentialCycle();

  const place = { level, ekatte, obshtina, oblast };

  // Local availability: the place's município (or, for a region, any of its
  // municípios) must be present in the active cycle's index. The country always
  // resolves when an index exists. Sections share their parent obshtina, so the
  // obshtina guard covers them (the pill drops to the settlement page). Sofia
  // районs are their own município (S2xxx), so the obshtina guard covers them
  // too. The Sofia city aggregate is keyed SOF00 in the parliamentary/my-area
  // trees but lives under the synthetic SOF bundle in the local index.
  // Пловдив/Варна районите aren't in the local index (their районен кмет is a
  // district within the parent city bundle) — gate the Местни pill on the
  // parent city instead, where localUrl points it.
  const localLookupObshtina = findCityRayon(obshtina)?.obshtina ?? obshtina;
  const localAvailable =
    !!index &&
    (level === "country"
      ? true
      : level === "region"
        ? index.municipalities.some((m) => m.oblast === oblast)
        : isSofiaCityObshtina(obshtina)
          ? index.municipalities.some((m) => m.obshtinaCode === "SOF")
          : index.municipalities.some(
              (m) => m.obshtinaCode === localLookupObshtina,
            ));

  const urlFor = (view: PlaceView): string | null => {
    if (view === "governance") return governanceUrl(place);
    if (view === "parliamentary") return parliamentaryUrl(place);
    if (view === "consumption") return consumptionUrl(place);
    if (view === "presidential")
      return presidentialViewUrl(place, presidentialCycle);
    return localAvailable ? localUrl(place, cycle) : null;
  };

  const items = ORDER.map((view) => ({ view, to: urlFor(view) }));

  // ⚠ FROM A POLLING SECTION EVERY PILL LEADS SOMEWHERE ELSE, AND THE READER IS NEVER TOLD.
  // Governance and Consumption stop above the station, so they are filtered out below; the
  // two that remain both drop to the PARENT SETTLEMENT (placeViews.ts), which is the right
  // destination and a silent one — a reader on station №132900019 taps „Местни" and lands on
  // с. Виноградец with nothing saying the station was left behind.
  //
  // ⚠ AND THE REASON IS NOT „the cycles differ" — it is the KIND boundary, measured
  // 2026-09-04 over the committed corpora. Across CYCLES of the same kind the numbering is
  // stable: parliamentary 2024-10 → 2026-04 keeps 97.1% of its codes, local 2019 → 2023
  // keeps 97.6%. Across KINDS it collapses: of 12,302 local-2023 station codes only 6,683
  // (54.3%) exist at all in parliamentary 2026 — and of those 6,683, **430 (6.4%) name a
  // DIFFERENT SETTLEMENT** (211100004 is с.Градец on one side and гр.Златоград on the
  // other). So following the number across kinds is unusable for 6,049 of 12,302 (49.2%),
  // and the half that "resolves" would put a reader in another town without failing. That
  // is why the fallback is the settlement rather than a same-code lookup, and why the note
  // says kinds rather than cycles.
  const fromSection = level === "section";

  // Keep the active view even if its URL didn't resolve (we're already on it);
  // drop any other view we can't link to.
  const shown = items.filter((it) => it.view === active || it.to);
  if (shown.length < 2) return null;

  const noteId = fromSection ? "place-view-nav-section-note" : undefined;

  return (
    <nav
      aria-label={t("place_view_nav_label")}
      aria-describedby={noteId}
      className={`flex flex-col ${align === "center" ? "items-center" : "items-start"} gap-1.5 ${className ?? ""}`}
    >
      {/* flex-wrap (not inline-flex) so the four pills wrap to a second row on
          a narrow viewport instead of overflowing — they fit one row on desktop,
          so wider screens are unchanged. */}
      <div className="flex flex-wrap items-center justify-center gap-1 rounded-2xl border bg-card p-1 shadow-sm">
        {shown.map((it) => {
          const meta = PLACE_VIEW_META[it.view];
          const Icon = meta.icon;
          const isActive = it.view === active;
          if (isActive || !it.to) {
            return (
              <span
                key={it.view}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${meta.activePill}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span>{t(meta.labelKey)}</span>
              </span>
            );
          }
          return (
            <Link
              key={it.view}
              to={{ pathname: it.to, search }}
              className="group inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent-strong hover:text-accent-strong-foreground"
            >
              {/* The resting icon tint is the view↔colour cue; on hover the whole
                  pill takes the interactive coral so the icon stays legible —
                  without it the amber consumption icon sinks into the fill in
                  light mode, both being orange. `--accent-strong`, not
                  `--accent/60`: that pair was 3.36:1 in dark mode, below AA for
                  12px, where this one is 5.45:1 in both themes. */}
              <Icon
                className={`h-3.5 w-3.5 ${meta.text} group-hover:text-foreground`}
                aria-hidden
              />
              <span>{t(meta.labelKey)}</span>
            </Link>
          );
        })}
      </div>
      {/* Announced in TEXT, not only as a title attribute: a title is invisible to touch and
          to a keyboard, which is most of the traffic this control gets. `aria-describedby` on
          the nav means a screen reader reaches it before the pills rather than after. */}
      {noteId && (
        <p
          id={noteId}
          className={`max-w-prose text-[11px] leading-snug text-muted-foreground ${
            align === "center" ? "text-center" : "text-left"
          }`}
        >
          {t("place_view_nav_section_note")}
        </p>
      )}
    </nav>
  );
};
