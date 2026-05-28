// Compact "Местна власт" card — collapses the three separate tiles
// (MunicipalMayorTile, MunicipalCouncilCompositionTile,
// MunicipalOfficialsRosterTile) into one. The full versions still
// render on the direct /settlement/<obshtina> and /municipality/<oblast>
// routes; only the My-Area dashboard uses this slimmer composition.
//
// Data sources (both already cached upstream — no new network hops):
//   - useMunicipalOfficials  →  roster of mayor, deputies, chair, councillors
//   - useLocalMunicipality   →  council party composition (CIK localPartyName + mandatesWon)
//   - useCanonicalParties    →  canonical party color/name lookup

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Crown, ArrowRight, Landmark } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { useMunicipalOfficials } from "@/data/officials/useMunicipalOfficials";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";

type Props = {
  obshtina: string;
};

type CouncilSegment = {
  key: string;
  label: string;
  color: string;
  seats: number;
};

const FALLBACK_COLOR = "#888";

export const MyAreaGovernmentCard: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { roster } = useMunicipalOfficials(obshtina);
  const { municipality: localBundle } = useLocalMunicipality(obshtina);
  const { displayNameForId, colorFor } = useCanonicalParties();
  const { findMunicipality } = useMunicipalities();

  // Mayor + chair + deputy count — same logic as MunicipalMayorTile so the
  // settlement-view detail matches what /municipality/:id shows.
  const mayor = useMemo(() => {
    if (!roster) return null;
    const mayors = roster.entries.filter((e) => e.role === "mayor");
    return mayors.find((e) => !e.district) ?? mayors[0] ?? null;
  }, [roster]);
  const chair = useMemo(() => {
    if (!roster) return null;
    const chairs = roster.entries.filter((e) => e.role === "council_chair");
    return chairs.find((e) => !e.district) ?? chairs[0] ?? null;
  }, [roster]);
  const deputies = useMemo(() => {
    if (!roster) return 0;
    const cityWide = roster.entries.filter(
      (e) => e.role === "deputy_mayor" && !e.district,
    ).length;
    return cityWide > 0 ? cityWide : roster.byRole.deputy_mayor;
  }, [roster]);
  const councillors = roster?.byRole.councillor ?? 0;

  // Mayor party — read from the CIK local-election bundle's elected
  // mayor, which carries the canonical party id. The officials roster
  // doesn't carry party affiliation. Fall back to "—" silently.
  const mayorPartyLabel = useMemo(() => {
    const id = localBundle?.mayor.elected?.primaryCanonicalId;
    if (id) return displayNameForId(id) ?? null;
    const local = localBundle?.mayor.elected;
    if (local?.isIndependent) {
      return lang === "bg" ? "Независим" : "Independent";
    }
    return local?.localPartyName ?? null;
  }, [localBundle, displayNameForId, lang]);

  // Council composition as a stacked bar. Each segment is one local
  // party's mandate count (no merges) — but we colour by canonical id so
  // visually-related parties share a hue.
  const councilSegments = useMemo<CouncilSegment[]>(() => {
    if (!localBundle) return [];
    const parties = localBundle.council
      .filter((p) => p.mandatesWon > 0)
      .sort((a, b) => b.mandatesWon - a.mandatesWon);
    return parties.map((p) => {
      const canonicalId = p.primaryCanonicalId;
      const label =
        (canonicalId ? displayNameForId(canonicalId) : null) ??
        p.localPartyName;
      const color =
        (canonicalId ? colorFor(label) : null) ??
        (p.isIndependent ? "#777" : FALLBACK_COLOR);
      return {
        key: `${p.localPartyNum}-${p.localPartyName}`,
        label,
        color,
        seats: p.mandatesWon,
      };
    });
  }, [localBundle, displayNameForId, colorFor]);
  const totalSeats = councilSegments.reduce((s, x) => s + x.seats, 0);

  // The card auto-hides if the município has no roster *and* no local
  // bundle — both ingests would have to be missing. Otherwise we render
  // the parts we have.
  if (!roster && !localBundle) return null;

  const muni = findMunicipality(obshtina);
  const muniName = muni ? (lang === "bg" ? muni.name : muni.name_en) : null;
  const muniHref = `/settlement/${obshtina}`;

  const declaredYear = roster?.years[0];
  const cycleLabel = localBundle
    ? (() => {
        // cycle is e.g. "2023_10_29_mi" → "октомври 2023" / "October 2023"
        const m = localBundle.cycle.match(/^(\d{4})_(\d{2})_\d{2}_/);
        if (!m) return localBundle.cycle;
        const year = m[1];
        const month = Number(m[2]);
        const monthsBg = [
          "януари",
          "февруари",
          "март",
          "април",
          "май",
          "юни",
          "юли",
          "август",
          "септември",
          "октомври",
          "ноември",
          "декември",
        ];
        const monthsEn = [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ];
        return lang === "bg"
          ? `${monthsBg[month - 1]} ${year}`
          : `${monthsEn[month - 1]} ${year}`;
      })()
    : null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Landmark className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex items-baseline gap-2 flex-1 min-w-0">
          {t("my_area_municipality_section_label")}
          <span className="text-xs font-normal text-muted-foreground">·</span>
          <Link
            to={muniHref}
            underline
            className="text-sm font-semibold truncate"
          >
            {muniName
              ? lang === "bg"
                ? `община ${muniName}`
                : `${muniName} municipality`
              : obshtina}
          </Link>
        </h2>
        <Link
          to={muniHref}
          underline={false}
          className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline shrink-0"
        >
          {lang === "bg" ? "Виж детайли" : "View details"}
          <ArrowRight className="size-3" />
        </Link>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        {/* Mayor column */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
            <Crown className="size-3.5" />
            {lang === "bg" ? "Кмет" : "Mayor"}
          </div>
          {mayor ? (
            <>
              <Link
                to={`/officials/${mayor.slug}?from=${obshtina}`}
                underline={false}
                className="text-base font-semibold leading-tight hover:underline"
              >
                {mayor.name}
              </Link>
              <div className="text-xs text-muted-foreground mt-0.5">
                {mayorPartyLabel ? (
                  <>
                    {mayorPartyLabel}
                    {cycleLabel ? (
                      <>
                        {" · "}
                        {lang === "bg"
                          ? `избран ${cycleLabel}`
                          : `elected ${cycleLabel}`}
                      </>
                    ) : null}
                  </>
                ) : cycleLabel ? (
                  lang === "bg" ? (
                    `избран ${cycleLabel}`
                  ) : (
                    `elected ${cycleLabel}`
                  )
                ) : null}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {lang === "bg"
                ? "Няма деклариран кмет за текущата година"
                : "No mayor declared for the current year"}
            </div>
          )}
          {chair ? (
            <div className="mt-3 pt-2 border-t text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                {lang === "bg" ? "Председател на ОбС" : "Council chair"}
              </div>
              <Link
                to={`/officials/${chair.slug}?from=${obshtina}`}
                underline={false}
                className="text-sm font-medium hover:underline"
              >
                {chair.name}
              </Link>
            </div>
          ) : null}
        </div>

        {/* Council composition column */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {lang === "bg"
              ? "Състав на общинския съвет"
              : "Council composition"}
          </div>
          {totalSeats > 0 ? (
            <>
              <div
                className="h-3 w-full rounded-sm overflow-hidden flex border"
                role="img"
                aria-label={
                  lang === "bg"
                    ? `Партийно разпределение на ${totalSeats} мандата`
                    : `Party split across ${totalSeats} seats`
                }
              >
                {councilSegments.map((s) => (
                  <div
                    key={s.key}
                    style={{
                      width: `${(s.seats / totalSeats) * 100}%`,
                      backgroundColor: s.color,
                    }}
                    title={`${s.label} — ${s.seats}`}
                  />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {councilSegments.slice(0, 5).map((s) => (
                  <li key={s.key} className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="size-2 rounded-sm shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="truncate" title={s.label}>
                      {s.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {s.seats}
                    </span>
                  </li>
                ))}
                {councilSegments.length > 5 ? (
                  <li className="text-muted-foreground tabular-nums">
                    +{councilSegments.length - 5}
                  </li>
                ) : null}
              </ul>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {lang === "bg"
                ? "Няма данни за състава на съвета"
                : "No council composition data"}
            </div>
          )}
          {/* Summary line of headline counts. Always visible — gives a
              one-line sense of the size of the local administration even
              when the bar above is missing. */}
          <div className="mt-3 text-xs text-muted-foreground">
            {[
              councillors > 0
                ? lang === "bg"
                  ? `${councillors} общински съветници`
                  : `${councillors} councillors`
                : null,
              deputies > 0
                ? lang === "bg"
                  ? `${deputies} заместник-кмета`
                  : `${deputies} deputy mayors`
                : null,
              chair
                ? lang === "bg"
                  ? "1 председател на ОбС"
                  : "1 council chair"
                : null,
              declaredYear
                ? lang === "bg"
                  ? `декларация ${declaredYear} г.`
                  : `${declaredYear} declaration`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
    </Card>
  );
};
