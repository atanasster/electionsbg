import { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SEO } from "@/ux/SEO";
import type { CandidatesInfo } from "@/data/dataTypes";
import { MpAvatar, MpAvatarView } from "./MpAvatar";
import { CandidateBallot } from "./CandidateBallot";

type CikBadge = Pick<CandidatesInfo, "partyNum" | "oblast" | "pref">;

/** Minimal MP fields the header needs for the avatar. */
type HeaderMp = { photoUrl?: string | null } | null;

type Props = {
  /** Display name in the active locale (used for the H1 and SEO). */
  displayName: string;
  /** Bulgarian-form name used to look up the avatar photo. Optional — when
   * absent the avatar is omitted (legacy bare-name URLs without an MP match). */
  lookupName?: string | null;
  /** Renders a back link above the title (used on deep sub-pages like
   * /candidate/:id/assets that benefit from a quick way back to the main
   * candidate dashboard). */
  backTo?: string;
  backLabel?: string;
  /** Sub-page caption, e.g. "Votes by settlement". Omit on the main page. */
  subtitle?: ReactNode;
  /** SEO overrides — fall back to a sensible default built from name + subtitle. */
  seoTitle?: string;
  seoDescription?: string;
  /** Party + region nominations for this candidate. Rendered as a centered
   * grid of (party badge, region link, #pref) rows below the name. Pass the
   * same array on every screen so the candidate's party/region affiliation
   * stays consistent across the dashboard and sub-pages. */
  cikRows?: CikBadge[];
  /** The resolved MP record (or null for a non-MP). When provided — even as
   * null — the avatar renders straight from it without touching the parliament
   * index. Omit it entirely to fall back to the legacy name-keyed lookup
   * (kept for callers that don't have a resolved record on hand). */
  mpEntry?: HeaderMp | undefined;
};

export const CandidateHeader: FC<Props> = ({
  displayName,
  lookupName,
  backTo,
  backLabel,
  subtitle,
  seoTitle,
  seoDescription,
  cikRows = [],
  mpEntry,
}) => {
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
      {/* Left-aligned, compact — matches the person dashboard header so every candidate
          (sub-)page shares one layout. */}
      <div className="flex items-start gap-3">
        {lookupName &&
          (mpEntry !== undefined ? (
            <MpAvatarView
              photoUrl={mpEntry?.photoUrl}
              displayName={displayName}
              className="h-16 w-16 shrink-0"
            />
          ) : (
            <MpAvatar
              name={lookupName}
              className="h-16 w-16 shrink-0"
              showPartyRing={false}
            />
          ))}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{displayName}</h1>
          <CandidateBallot rows={cikRows} />
          {subtitle && (
            <div className="mt-1.5 text-sm font-semibold text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
