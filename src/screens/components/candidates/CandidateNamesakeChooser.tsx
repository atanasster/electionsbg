import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import type { ResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useRegions } from "@/data/regions/useRegions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";

const RegionList: FC<{ codes: string[] }> = ({ codes }) => {
  const { findRegion } = useRegions();
  if (codes.length === 0) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {codes
        .map((c) => findRegion(c)?.name ?? c)
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
};

/** Rendered when /candidate/{name} matches more than one distinct person —
 * different parties, or different MPs sharing the same three-name string.
 * The user clicks through to a slug URL that uniquely identifies one
 * candidate. */
export const CandidateNamesakeChooser: FC<{
  name: string;
  matches: ResolvedCandidate[];
}> = ({ name, matches }) => {
  const { t } = useTranslation();
  const { findParty } = usePartyInfo();
  const { displayNameFor } = useCanonicalParties();
  return (
    <div className="w-full max-w-3xl mx-auto py-8">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <Users className="h-5 w-5" />
        {name}
      </h2>
      <p className="text-sm text-muted-foreground mt-1">
        {t("candidate_namesake_intro") ||
          "Multiple candidates share this name. Pick the one you meant:"}
      </p>
      <ul className="mt-4 flex flex-col divide-y border rounded-md overflow-hidden">
        {matches.map((m) => {
          const party = m.partyNum != null ? findParty(m.partyNum) : null;
          return (
            <li key={m.slug}>
              <Link
                to={`/candidate/${m.slug}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                <Avatar className="h-10 w-10 ring-1 ring-border shrink-0">
                  {m.mpEntry?.photoUrl && (
                    <AvatarImage
                      src={m.mpEntry.photoUrl}
                      alt={m.name}
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className="text-xs bg-muted">
                    {initials(m.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{m.name}</span>
                    {party && (
                      <span
                        className="text-xs rounded px-1.5 py-0.5 text-white"
                        style={{ backgroundColor: party.color }}
                      >
                        {displayNameFor(party.nickName) ?? party.nickName}
                      </span>
                    )}
                    {m.mpEntry?.isCurrent && (
                      <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/10 text-primary">
                        {t("current_mp") || "MP"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {m.mpEntry?.birthDate && (
                      <span>
                        {t("born") || "born"} {m.mpEntry.birthDate.slice(0, 4)}
                      </span>
                    )}
                    <RegionList codes={m.oblasts} />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
