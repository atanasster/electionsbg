// The standard header for every /candidate/:id/* sub-page (regions, sections, donations,
// assets, connections, procurement, funds, …). It shows the SAME identity block as the
// person dashboard (PersonProfileHeader — avatar, name, party, facets, MP bio) plus the
// candidate's ballot in the selected election (CandidateBallot), then the sub-page caption.
//
// It resolves the person profile itself from the URL id (candidate → person → profile), so a
// screen only has to pass the id, the already-resolved display/lookup names, mpId and cikRows.
// A bare-name legacy URL with no public person degrades gracefully to avatar + name + ballot.

import { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { useCandidatePerson } from "@/data/candidates/useCandidatePerson";
import { usePersonProfile } from "@/screens/person/usePersonProfile";
import { PersonProfileHeader } from "./PersonProfileHeader";
import { CandidateBallot, type BallotRow } from "./CandidateBallot";

type Props = {
  /** The raw /candidate/:id URL param — used to resolve the owning person. */
  idParam: string;
  /** Display name in the active locale (H1 + SEO). */
  displayName: string;
  /** Bulgarian-form name used for the avatar photo + MP-profile lookups. */
  lookupName: string;
  /** parliament.bg id when this candidate is a (former) MP; null otherwise. */
  mpId?: number | null;
  /** The candidate's ballot rows for the selected election (party + region + preference). */
  cikRows?: BallotRow[];
  /** Renders a back link above the header (deep sub-pages like /assets). */
  backTo?: string;
  backLabel?: string;
  /** Sub-page caption, e.g. "Preferences by settlement". Omit on the main dashboard. */
  subtitle?: ReactNode;
  /** SEO overrides — fall back to a sensible default built from name + subtitle. */
  seoTitle?: string;
  seoDescription?: string;
};

export const CandidateProfileHeader: FC<Props> = ({
  idParam,
  displayName,
  lookupName,
  mpId,
  cikRows,
  backTo,
  backLabel,
  subtitle,
  seoTitle,
  seoDescription,
}) => {
  const personSlug = useCandidatePerson(idParam);
  const profile = usePersonProfile(personSlug ?? "");

  const subtitleText = typeof subtitle === "string" ? subtitle : undefined;
  const resolvedSeoTitle =
    seoTitle ??
    (subtitleText ? `${displayName} — ${subtitleText}` : displayName);
  const resolvedSeoDescription =
    seoDescription ?? subtitleText ?? `Results for candidate ${displayName}`;

  return (
    <>
      <SEO title={resolvedSeoTitle} description={resolvedSeoDescription} />
      {backTo && (
        <Link
          to={backTo}
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel ?? displayName}
        </Link>
      )}
      <PersonProfileHeader
        name={displayName}
        lookupName={lookupName}
        mpId={mpId ?? null}
        profile={profile ?? null}
      />
      <CandidateBallot rows={cikRows} />
      {subtitle && (
        <div className="mt-2 text-sm font-semibold text-muted-foreground">
          {subtitle}
        </div>
      )}
    </>
  );
};
