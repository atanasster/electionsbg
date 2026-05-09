import { FC, Fragment, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Title } from "@/ux/Title";
import { Caption } from "@/ux/Caption";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import type { CandidatesInfo } from "@/data/dataTypes";
import { MpAvatar } from "./MpAvatar";
import { PartyLink } from "../party/PartyLink";
import { RegionLink } from "../regions/RegionLink";

type CikBadge = Pick<CandidatesInfo, "partyNum" | "oblast" | "pref">;

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
}) => {
  const { findParty } = usePartyInfo();
  const subtitleText = typeof subtitle === "string" ? subtitle : undefined;
  const resolvedSeoTitle =
    seoTitle ??
    (subtitleText ? `${displayName} — ${subtitleText}` : displayName);
  const resolvedSeoDescription =
    seoDescription ?? subtitleText ?? `Results for candidate ${displayName}`;
  return (
    <>
      {backTo && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel ?? displayName}
        </Link>
      )}
      <Title
        title={resolvedSeoTitle}
        description={resolvedSeoDescription}
        className="pt-4 pb-1 md:pt-10 md:pb-1 sm:pb-1"
      >
        <span className="inline-flex items-center justify-center gap-3">
          {lookupName && (
            <MpAvatar
              name={lookupName}
              className="h-12 w-12 md:h-14 md:w-14"
              showPartyRing={false}
            />
          )}
          <span>{displayName}</span>
        </span>
      </Title>
      {cikRows.length > 0 && (
        <div className="grid grid-cols-[auto_auto_auto] justify-center items-center gap-x-3 gap-y-1.5 px-4 pt-1 pb-2">
          {cikRows.map((c) => {
            const party = findParty(c.partyNum);
            return (
              <Fragment key={`${c.oblast}-${c.pref}`}>
                <PartyLink party={party} width="w-9 shrink-0" />
                <div className="text-sm sm:text-base font-semibold">
                  <RegionLink oblast={c.oblast} />
                </div>
                <div className="text-sm sm:text-base font-semibold tabular-nums">{`#${c.pref}`}</div>
              </Fragment>
            );
          })}
        </div>
      )}
      {subtitle && <Caption>{subtitle}</Caption>}
    </>
  );
};
