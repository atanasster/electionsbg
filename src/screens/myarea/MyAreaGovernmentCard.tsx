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

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crown, ArrowRight, Landmark, ChevronDown, Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { useMunicipalOfficials } from "@/data/officials/useMunicipalOfficials";
import { useMunicipalContacts } from "@/data/officials/useMunicipalContacts";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { isSofiaCityObshtina } from "@/data/local/placeViews";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { buildCouncilSegments, type CouncilSegment } from "./councilSegments";

// Small clickable mail-icon chip rendered next to an official's name
// when iisda's directory has an email for them. Visually unobtrusive
// (size-3 icon, no surrounding text) so it doesn't compete with the
// person's name for attention. The mailto: opens the user's default
// mail client.
const MailLink: FC<{ email: string; nameForAria: string }> = ({
  email,
  nameForAria,
}) => (
  <a
    href={`mailto:${email}`}
    onClick={(e) => e.stopPropagation()}
    aria-label={`Email ${nameForAria} (${email})`}
    title={email}
    className="inline-flex items-center text-muted-foreground hover:text-primary align-middle"
  >
    <Mail className="size-3" />
  </a>
);

type Props = {
  obshtina: string;
};

export const MyAreaGovernmentCard: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  // Sofia city aggregate keys officials/contacts as SOF00 but its local
  // bundle (mayor + council) lives under the synthetic SOF code.
  const sofiaCity = isSofiaCityObshtina(obshtina);
  const localCode = sofiaCity ? "SOF" : obshtina;
  const { roster } = useMunicipalOfficials(obshtina);
  const { emailForName } = useMunicipalContacts(obshtina);
  const { municipality: localBundle, cycle: localCycle } =
    useLocalMunicipality(localCode);
  const { displayNameForId, colorFor } = useCanonicalParties();
  const { findMunicipality } = useMunicipalities();
  const [expanded, setExpanded] = useState(false);

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

  // Council composition as a stacked bar — see councilSegments.ts for the
  // palette / fallback rules.
  const councilSegments = useMemo<CouncilSegment[]>(
    () =>
      buildCouncilSegments(localBundle?.council, displayNameForId, colorFor),
    [localBundle, displayNameForId, colorFor],
  );
  const totalSeats = councilSegments.reduce((s, x) => s + x.seats, 0);

  // Roster index: normalized-name → slug. Lets us link elected councillor /
  // deputy names in the expanded list to their /officials/<slug> page when
  // the registry carries a matching declaration.
  const slugByNormalized = useMemo(() => {
    const m = new Map<string, string>();
    if (!roster) return m;
    for (const e of roster.entries) {
      if (e.normalizedName) m.set(e.normalizedName, e.slug);
      m.set(e.name.toLocaleUpperCase("bg"), e.slug);
    }
    return m;
  }, [roster]);

  const deputyMayors = useMemo(() => {
    if (!roster) return [];
    return roster.entries.filter(
      (e) => e.role === "deputy_mayor" && !e.district,
    );
  }, [roster]);

  const chiefArchitect = useMemo(() => {
    if (!roster) return null;
    return roster.entries.find((e) => e.role === "chief_architect") ?? null;
  }, [roster]);

  const totalOfficials = roster?.entries.length ?? 0;

  // The card auto-hides if the município has no roster *and* no local
  // bundle — both ingests would have to be missing. Otherwise we render
  // the parts we have.
  if (!roster && !localBundle) return null;

  const muni = findMunicipality(obshtina);
  const muniName = sofiaCity
    ? lang === "bg"
      ? "София"
      : "Sofia"
    : muni
      ? lang === "bg"
        ? muni.name
        : muni.name_en
      : null;
  // Sofia has no /settlement/SOF00 page — its parliamentary view is /sofia.
  const muniHref = sofiaCity ? "/sofia" : `/settlement/${obshtina}`;
  // "View details" should land on the local-election dashboard for this
  // município (council, mayor, sections) — not the parliamentary settlement
  // page. Only viable when we have a local bundle (and thus a cycle); fall
  // back to the settlement page otherwise.
  const localHref = localBundle
    ? `/local/${localCycle}/${localCode}`
    : muniHref;

  const declaredYear = roster?.years[0];

  // Local-election turnout (избирателна активност) for the cycle the
  // current mayor was elected in. A one-line context badge below the
  // mayor name — gives users a sense of how strongly the result was
  // mandated.
  const localTurnout = (() => {
    const p = localBundle?.protocol;
    if (!p || !p.numRegisteredVoters || p.numRegisteredVoters <= 0) return null;
    if (!p.totalActualVoters) return null;
    return p.totalActualVoters / p.numRegisteredVoters;
  })();

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
        <Landmark className="size-4 text-primary shrink-0" />
        <h2 className="text-sm font-semibold flex items-baseline gap-2 flex-1 min-w-0">
          <span className="whitespace-nowrap">
            {t("my_area_municipality_section_label")}
          </span>
          <span className="text-xs font-normal text-muted-foreground">·</span>
          <Link
            to={localHref}
            underline
            className="text-sm font-semibold truncate min-w-0"
          >
            {muniName
              ? lang === "bg"
                ? `община ${muniName}`
                : `${muniName} municipality`
              : obshtina}
          </Link>
        </h2>
        <Link
          to={localHref}
          underline={false}
          aria-label={lang === "bg" ? "Виж детайли" : "View details"}
          className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline shrink-0"
        >
          <span className="hidden sm:inline">
            {lang === "bg" ? "Виж детайли" : "View details"}
          </span>
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
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <Link
                  to={`/officials/${mayor.slug}?from=${obshtina}`}
                  underline={false}
                  className="text-base font-semibold leading-tight hover:underline"
                >
                  {mayor.name}
                </Link>
                {(() => {
                  const email = emailForName(mayor.name);
                  return email ? (
                    <MailLink email={email} nameForAria={mayor.name} />
                  ) : null;
                })()}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span>
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
                </span>
                {localTurnout != null ? (
                  <span
                    className="text-[10px] tabular-nums px-1.5 py-0.5 rounded border border-primary/30 text-primary leading-none"
                    title={
                      lang === "bg"
                        ? "Избирателна активност на тези местни избори"
                        : "Voter turnout at this local election"
                    }
                  >
                    {lang === "bg" ? "активност" : "turnout"}{" "}
                    {(localTurnout * 100).toFixed(1)}%
                  </span>
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
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <Link
                  to={`/officials/${chair.slug}?from=${obshtina}`}
                  underline={false}
                  className="text-sm font-medium hover:underline"
                >
                  {chair.name}
                </Link>
                {(() => {
                  const email = emailForName(chair.name);
                  return email ? (
                    <MailLink email={email} nameForAria={chair.name} />
                  ) : null;
                })()}
              </div>
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
                {councilSegments.map((s) => (
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

      {totalOfficials > 0 ? (
        <div className="mt-3 pt-3 border-t">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            <ChevronDown
              className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            {expanded
              ? lang === "bg"
                ? "Скрий списъка"
                : "Hide list"
              : lang === "bg"
                ? `Виж всички ${totalOfficials} длъжностни лица`
                : `Show all ${totalOfficials} officials`}
          </button>

          {expanded ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
              {deputyMayors.length > 0 ? (
                <RosterSection
                  title={lang === "bg" ? "Заместник-кметове" : "Deputy mayors"}
                  obshtina={obshtina}
                  entries={deputyMayors.map((e) => ({
                    name: e.name,
                    slug: e.slug,
                    email: emailForName(e.name),
                  }))}
                />
              ) : null}
              {chiefArchitect ? (
                <RosterSection
                  title={lang === "bg" ? "Главен архитект" : "Chief architect"}
                  obshtina={obshtina}
                  entries={[
                    {
                      name: chiefArchitect.name,
                      slug: chiefArchitect.slug,
                      email: emailForName(chiefArchitect.name),
                    },
                  ]}
                />
              ) : null}

              {councilSegments.length > 0 ? (
                <div className="sm:col-span-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                    {lang === "bg" ? "Общински съветници" : "Councillors"}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {councilSegments.map((s) => {
                      const elected = s.party.candidates.filter(
                        (c) => c.isElected,
                      );
                      if (elected.length === 0) return null;
                      return (
                        <div key={s.key} className="min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span
                              className="size-2 rounded-sm shrink-0"
                              style={{ backgroundColor: s.color }}
                            />
                            <span
                              className="text-[11px] font-medium truncate"
                              title={s.label}
                            >
                              {s.label}
                            </span>
                            <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                              {elected.length}
                            </span>
                          </div>
                          <ul className="ml-3.5 space-y-0.5">
                            {elected.map((c) => {
                              const slug =
                                slugByNormalized.get(
                                  c.name.toLocaleUpperCase("bg"),
                                ) ?? slugByNormalized.get(c.name);
                              return (
                                <li key={c.listPos} className="truncate">
                                  {slug ? (
                                    <Link
                                      to={`/officials/${slug}?from=${obshtina}`}
                                      underline={false}
                                      className="hover:underline"
                                    >
                                      {c.name}
                                    </Link>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      {c.name}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};

type RosterEntry = { name: string; slug: string; email?: string };

const RosterSection: FC<{
  title: string;
  obshtina: string;
  entries: RosterEntry[];
}> = ({ title, obshtina, entries }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
      {title}
    </div>
    <ul className="space-y-0.5">
      {entries.map((e) => (
        <li key={e.slug} className="truncate">
          <Link
            to={`/officials/${e.slug}?from=${obshtina}`}
            underline={false}
            className="hover:underline"
          >
            {e.name}
          </Link>
          {e.email ? (
            <>
              {" "}
              <MailLink email={e.email} nameForAria={e.name} />
            </>
          ) : null}
        </li>
      ))}
    </ul>
  </div>
);
