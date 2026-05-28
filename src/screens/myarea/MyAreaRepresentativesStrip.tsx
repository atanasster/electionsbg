// "Your MPs" strip for the My-Area dashboard. Reuses the same data layer
// as RegionMpsTile (oblastToMir + findMpsByRegion + electionToNsFolder) but
// presents the result as a horizontal avatar strip with no party grouping —
// the goal here is fast recognition ("are these my people?"), not analysis.
//
// Reads the current cycle from ElectionContext so when the user switches
// elections the MP list re-shuffles to the parliament seated by that cycle
// (or empty for non-parliamentary cycles like local / EU).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Landmark } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useElectionContext } from "@/data/ElectionContext";
import { useMps, type MpIndexEntry } from "@/data/parliament/useMps";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { useRegions } from "@/data/regions/useRegions";
import { Link } from "@/ux/Link";
import { initials, normalizeMpName as normalize } from "@/lib/utils";
import { useCycleKind } from "@/data/area/useCycleKind";

type Props = {
  oblast: string;
};

type Row = {
  mp: MpIndexEntry;
  partyNum: number | null;
  partyNickName: string;
  color: string;
};

export const MyAreaRepresentativesStrip: FC<Props> = ({ oblast }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { selected } = useElectionContext();
  const cycle = useCycleKind();
  const { findMpsByRegion } = useMps();
  const { candidates } = useCandidates();
  const { lookup: lookupParliamentGroup } = useParliamentGroups();
  const { displayNameFor } = useCanonicalParties();
  const { mpName } = useCandidateName();
  const { findRegion } = useRegions();

  // Non-parliamentary cycles don't seat MPs of their own — leave the strip
  // empty rather than guessing. The Mayor & council section below the hero
  // covers local cycles instead.
  const isParliamentaryCycle = cycle.kind === "parliament";
  const nsFolder = isParliamentaryCycle ? electionToNsFolder(selected) : null;
  const mir = oblastToMir(oblast);

  // CIK candidate index: maps a normalized MP name → that name's CIK partyNum
  // in this oblast. Lets us tag each MP with the canonical party color.
  const cikByName = useMemo(() => {
    const m = new Map<string, { partyNum: number }>();
    if (!candidates) return m;
    for (const c of candidates) {
      if (c.oblast !== oblast) continue;
      const k = normalize(c.name);
      if (!m.has(k)) m.set(k, { partyNum: c.partyNum });
    }
    return m;
  }, [candidates, oblast]);

  const rows = useMemo<Row[]>(() => {
    if (!nsFolder || !mir) return [];
    const mps = findMpsByRegion(mir, nsFolder);
    return mps.map((mp) => {
      const cik = cikByName.get(mp.normalizedName);
      const groupOverride = lookupParliamentGroup(mp.currentPartyGroupShort);
      const partyNickName =
        groupOverride?.displayName ??
        mp.currentPartyGroupShort?.replace(/^ПГ(\s+на)?\s+/, "").trim() ??
        "—";
      const color = groupOverride?.color ?? "#888";
      return {
        mp,
        partyNum: cik?.partyNum ?? null,
        partyNickName,
        color,
      };
    });
  }, [nsFolder, mir, findMpsByRegion, cikByName, lookupParliamentGroup]);

  // Don't render the section for local/EU/presidential cycles or when the
  // MIR mapping is missing — the strip would be empty otherwise and the
  // header alone would feel like a broken state.
  if (!isParliamentaryCycle || !mir || rows.length === 0) {
    return null;
  }

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Landmark className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{t("my_area_your_mps")}</h2>
        <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
          {rows.length} {t("mps_short")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => {
          const display = mpName(r.mp);
          const partyLabel = displayNameFor(r.partyNickName) ?? r.partyNickName;
          return (
            <Link
              key={r.mp.id}
              to={candidateUrlForMp(r.mp.id)}
              underline={false}
              className="block group"
              aria-label={`${display} — ${partyLabel}`}
            >
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-card/50 hover:bg-accent/40 transition-colors max-w-[200px]">
                <Avatar
                  className="h-8 w-8 ring-2 shrink-0"
                  style={{ ["--tw-ring-color" as string]: r.color }}
                >
                  {r.mp.photoUrl ? (
                    <AvatarImage
                      src={r.mp.photoUrl}
                      alt={display}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback
                    className="text-[10px] font-bold text-white"
                    style={{ backgroundColor: r.color }}
                  >
                    {initials(display)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium truncate leading-tight">
                    {display}
                  </span>
                  <span
                    className="text-[10px] text-muted-foreground truncate leading-tight"
                    title={partyLabel}
                  >
                    {partyLabel}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {/* Caption surfaces the region context with a link to the regional
          dashboard, so users see exactly which area this MP list
          represents and can click through to its full page. */}
      {(() => {
        const region = findRegion(oblast);
        const regionName = region
          ? lang === "bg"
            ? region.long_name || region.name
            : region.long_name_en || region.name_en
          : null;
        return (
          <p className="text-[10px] text-muted-foreground mt-3">
            {lang === "bg" ? "Народни представители за " : "MPs for "}
            <Link to={`/municipality/${oblast}`} underline>
              МИР {mir}
              {regionName ? ` · ${regionName}` : ""}
            </Link>{" "}
            ({cycle.slug})
          </p>
        );
      })()}
    </Card>
  );
};
