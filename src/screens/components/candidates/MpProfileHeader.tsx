import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Languages, MapPin, ExternalLink, Award } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/ux/Card";
import { useMpProfile } from "@/data/parliament/useMpProfile";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  localizeCountry,
  localizeNs,
  localizeNsShort,
  localizePosition,
  localizeRegionName,
} from "@/data/parliament/localizeMpProfile";
import { initials } from "@/lib/utils";

const formatDate = (iso: string | null, lang: string) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

export const MpProfileHeader: FC<{ name: string }> = ({ name }) => {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const { profile, indexEntry, ns } = useMpProfile(name);
  const { mpName } = useCandidateName();
  const { partyGroupShortLabel } = useCanonicalParties();

  // Show as soon as we have the index entry — even before the heavier profile loads
  if (!indexEntry) return null;

  const localizedName = mpName(indexEntry);
  const photoUrl = indexEntry.photoUrl;
  const region = profile?.region ?? indexEntry.currentRegion;
  const partyGroup = profile?.partyGroup ?? indexEntry.currentPartyGroup;
  const partyGroupShort =
    profile?.partyGroupShort ?? indexEntry.currentPartyGroupShort;
  const partyGroupDisplay = isEn
    ? (partyGroupShortLabel(partyGroupShort) ?? partyGroup)
    : partyGroup;
  const position = profile?.position ?? indexEntry.position;
  const positionDisplay = localizePosition(position, isEn);
  const isCurrent = indexEntry.isCurrent;
  const nsDisplay = ns ? localizeNs(ns, isEn) : null;

  const birthCountryDisplay = localizeCountry(profile?.birthCountry, isEn);
  const birthLine = [
    formatDate(profile?.birthDate ?? indexEntry.birthDate, i18n.language),
    profile?.birthCity && birthCountryDisplay
      ? `${profile.birthCity}, ${birthCountryDisplay}`
      : profile?.birthCity || birthCountryDisplay,
  ]
    .filter(Boolean)
    .join(" · ");

  const regionName = region?.name
    ? localizeRegionName(region.name, isEn)
    : null;

  const allTerms = [
    ...(profile?.pastTerms.map((t) => localizeNsShort(t.nsShort, isEn)) ?? []),
    ...(isCurrent && ns
      ? [localizeNsShort(ns.replace(" Народно събрание", " НС"), isEn)]
      : []),
  ];

  return (
    <Card className="my-4">
      <CardContent className="p-4 md:p-6">
        <div className="flex flex-col sm:flex-row gap-4 md:gap-6 items-center sm:items-start">
          <Avatar className="h-28 w-28 md:h-32 md:w-32 shrink-0 ring-2 ring-border">
            <AvatarImage
              src={photoUrl}
              alt={localizedName}
              className="object-cover"
            />
            <AvatarFallback className="text-xl font-bold bg-muted">
              {initials(localizedName)}
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-col gap-2 min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-col gap-0.5">
              {isCurrent && nsDisplay ? (
                <div className="text-sm text-muted-foreground">
                  {nsDisplay}
                  {positionDisplay ? ` · ${positionDisplay}` : ""}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t("former_mp") || "Former MP"}
                </div>
              )}
              {partyGroupDisplay && (
                <div className="text-sm font-semibold">{partyGroupDisplay}</div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {birthLine && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  <span>{birthLine}</span>
                </div>
              )}
              {regionName && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {region?.code ? `${region.code}-` : ""}
                    {regionName}
                  </span>
                </div>
              )}
              {profile?.profession && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Award className="h-3.5 w-3.5 shrink-0" />
                  <span>{profile.profession}</span>
                </div>
              )}
              {profile?.languages && profile.languages.length > 0 && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Languages className="h-3.5 w-3.5 shrink-0" />
                  <span>{profile.languages.join(", ")}</span>
                </div>
              )}
            </div>

            {profile?.specialization && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {t("specialization") || "Specialization"}:
                </span>{" "}
                {profile.specialization}
              </div>
            )}

            {allTerms.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/70">
                  {t("terms_served") || "Terms"}:
                </span>{" "}
                {allTerms.join(", ")}
              </div>
            )}

            <a
              href={`https://www.parliament.bg/bg/MP/${indexEntry.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline w-fit mx-auto sm:mx-0"
            >
              parliament.bg
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
