// The shared identity header — avatar + name + current-party badge + facet chips + (for MPs)
// a compact one-line parliament bio + known aliases. Rendered identically on the person page
// (/person/:slug) and the candidate sub-pages (/candidate/:id/*), so a candidate drill-down
// shows the same profile as the person dashboard.
//
// Tolerant of a still-loading / absent `profile`: the avatar + name render immediately from
// the props the caller already has, and the party badge / facets / aliases fill in once the
// person profile resolves (or stay hidden for a bare-name legacy URL with no public person).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  Building2,
  Coins,
  FileWarning,
  Landmark,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { MpProfileHeader } from "@/screens/components/candidates/MpProfileHeader";
import { CandidateMpProvider } from "@/data/candidates/CandidateMpContext";
import { useMpEntry } from "@/data/parliament/useMpEntry";
import { usePersonDataCycles } from "@/data/dashboard/usePersonElections";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import type { PersonProfile } from "@/screens/person/usePersonProfile";

const FACET_ICON: Record<string, typeof Landmark> = {
  politician: Landmark,
  executive: Briefcase,
  magistrate: Landmark,
  company: Building2,
  donor: Coins,
  sanctions: ShieldAlert,
  ds: FileWarning,
  regulator: Scale,
};

const Chip: FC<{ children: React.ReactNode; danger?: boolean }> = ({
  children,
  danger,
}) => (
  <span
    className={
      danger
        ? "inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400"
        : "inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
    }
  >
    {children}
  </span>
);

export const PersonProfileHeader: FC<{
  /** Display name for the H1, in the active locale. */
  name: string;
  /** Bulgarian-form name used for the avatar photo + MP-profile lookups (which key on the
   * BG name). Defaults to `name` when omitted (the person page, whose name is already BG). */
  lookupName?: string;
  /** parliament.bg id when this person is a (former) MP — drives the avatar photo, the compact
   * bio line, and the party-group fallback. Null for non-MPs. */
  mpId: number | null;
  /** The unified person profile. `null` while it loads or when there's no public person —
   * the header still renders the avatar + name from the props above. */
  profile: PersonProfile | null;
}> = ({ name, lookupName, mpId, profile }) => {
  const { t } = useTranslation();
  const { entry: mpEntry } = useMpEntry(mpId);
  const { rows, dataCycles } = usePersonDataCycles(profile?.slug ?? "");
  const avatarName = lookupName ?? name;

  const facetLabel = (f: string): string => {
    const k = `pp_facet_${f}`;
    const s = t(k);
    return s === k ? f : s;
  };

  // Current party = the newest election the person ran with results (colored badge). Falls
  // back to the MP's parliamentary-group label when there's no candidacy data.
  const newestCycle = dataCycles[0];
  const newestRow = rows.find((r) => r.election === newestCycle);
  const { findParty } = usePartyInfo(newestCycle);
  const party = newestRow ? findParty(newestRow.partyNum) : undefined;
  const partyLabel = party?.nickName ?? mpEntry?.currentPartyGroupShort ?? null;
  const partyColor = party?.color ?? null;
  const facets = profile?.facets ?? [];

  return (
    <div className="flex items-start gap-4">
      <MpAvatar name={avatarName} mpId={mpId} className="h-20 w-20 shrink-0" />
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight">{name}</h1>
        {(partyLabel || facets.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {partyLabel && <PartyBadge label={partyLabel} color={partyColor} />}
            {facets.map((f) => {
              const Icon = FACET_ICON[f];
              return (
                <Chip key={f} danger={f === "sanctions" || f === "ds"}>
                  {Icon && <Icon className="h-3 w-3" />}
                  {facetLabel(f)}
                </Chip>
              );
            })}
          </div>
        )}
        {mpId != null && (
          <CandidateMpProvider
            value={{ id: mpId, name: avatarName, entry: mpEntry ?? null }}
          >
            <MpProfileHeader name={avatarName} compact />
          </CandidateMpProvider>
        )}
        {profile && profile.aliases.length > 0 && (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("pp_also_known")}: {profile.aliases.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
};
