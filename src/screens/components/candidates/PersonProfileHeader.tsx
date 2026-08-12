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
  Library,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { Link } from "@/ux/Link";
import { partyHref } from "@/lib/utils";
import { MpProfileHeader } from "@/screens/components/candidates/MpProfileHeader";
import { CandidateMpProvider } from "@/data/candidates/CandidateMpContext";
import { useMpEntry } from "@/data/parliament/useMpEntry";
import { usePersonDataCycles } from "@/data/dashboard/usePersonElections";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import type { PersonProfile } from "@/screens/person/usePersonProfile";

const FACET_ICON: Record<string, typeof Landmark> = {
  politician: Landmark,
  executive: Briefcase,
  public_sector: Library,
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

  // ONE decision, resolved once. The label, the colour and the linked-vs-bare branch used
  // to be three separate expressions over the same tiering, agreeing by construction rather
  // than by contract — and the disagreement they could produce is the specific one this
  // feature must not have: a career badge rendered inside an election-scoped /party link.
  //
  // Tier 3 is the coalition the MP was ELECTED with, off their parliament.bg profile. The
  // first two tiers are current-cycle — a candidacy with results, then the sitting roster's
  // group — so before it a former MP had no badge at all: 1,443 of the 2,122 roster entries.
  //
  // `cycle` is the whole attribution rule. A badge carries one only when it came from a
  // specific election, and a link is minted iff `cycle` is set. Tier 3 has none to carry:
  // parliament.bg holds ONE value per person, and against the roll-call-derived per-NS group
  // for the 72 MPs who changed group it matches the last NS 12 times, the first 4, both 17,
  // and neither endpoint 27. So it is never linked, never presented as "the group they sat
  // with", and never written into person_role.party.
  //
  // `||` and not `??` between the tiers: `toMp` emits `""` for an MP parliament.bg lists
  // with no group (an independent), the loader stores it verbatim, and `??` does not fall
  // through on `""` — the badge would vanish entirely for exactly the people tier 3 exists
  // to serve. Measured at 0 occurrences today, so latent.
  const { colorFor, findCanonicalNickName, partyGroupShortLabel } =
    useCanonicalParties();
  const electedWith = mpEntry?.electedWith || null;

  const badge: {
    label: string;
    color: string | null;
    /** The election this affiliation belongs to. Set ⇒ linkable. */
    cycle?: string;
    /** Tier 3 — qualify it in the UI as "elected with", never as a current affiliation. */
    electedWith?: boolean;
  } | null = party?.nickName
    ? {
        label: party.nickName,
        color: party.color ?? null,
        cycle: newestCycle,
      }
    : mpEntry?.currentPartyGroupShort
      ? {
          // Через the same fold tier 3 uses. Stored raw these are parliament.bg's group
          // labels — `ПГ на ГЕРБ – СДС`, `ПГ "Прогресивна България"` — so without it a
          // SITTING MP got a grey prefixed pill while a former one got a branded one.
          label:
            partyGroupShortLabel(mpEntry.currentPartyGroupShort) ??
            mpEntry.currentPartyGroupShort,
          color: colorFor(mpEntry.currentPartyGroupShort) ?? null,
        }
      : electedWith
        ? {
            // The register's own words, NOT the fold's display name. The fold resolves
            // „ГЕРБ" to canonical id `gerb`, whose displayName is „ГЕРБ-СДС" — the 2021
            // coalition brand — which would tell 85 MPs elected before it existed that they
            // stood for it. `findCanonicalNickName` returns the nickname actually used as
            // the /party slug and leaves an unknown value alone, so „Коалиция за България"
            // (which the fold does not know) stays as the 2005 ballot printed it.
            label: findCanonicalNickName(electedWith) ?? electedWith,
            color: colorFor(electedWith) ?? null,
            electedWith: true,
          }
        : null;
  const facets = profile?.facets ?? [];

  return (
    <div className="flex items-start gap-4">
      <MpAvatar name={avatarName} mpId={mpId} className="h-20 w-20 shrink-0" />
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight">{name}</h1>
        {(badge || facets.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {badge &&
              // Linked iff the affiliation belongs to a named election — the same
              // condition that decides whether it is attributable at all.
              (badge.cycle ? (
                <Link
                  to={{
                    pathname: partyHref(badge.label),
                    search: { elections: badge.cycle },
                  }}
                  underline={false}
                  aria-label={party?.name ?? badge.label}
                >
                  <PartyBadge
                    label={badge.label}
                    color={badge.color}
                    className="transition-opacity hover:opacity-90"
                  />
                </Link>
              ) : (
                <span
                  className="inline-flex items-center gap-1"
                  // Said to the READER, not only in the code comments: this is the party
                  // they were elected with across a career, not a current affiliation and
                  // not the group they sat with in any particular parliament.
                  title={badge.electedWith ? t("pp_elected_with") : undefined}
                >
                  {badge.electedWith && (
                    <span className="text-xs text-muted-foreground">
                      {t("pp_elected_with")}
                    </span>
                  )}
                  <PartyBadge label={badge.label} color={badge.color} />
                </span>
              ))}
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
