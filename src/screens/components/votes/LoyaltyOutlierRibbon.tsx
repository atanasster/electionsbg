import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { useLoyaltyRanking } from "@/data/parliament/votes/useMpLoyalty";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import type { LoyaltyEntry } from "@/data/parliament/votes/types";

const MIN_VOTES = 30;

const formatPct = (frac: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);

// Two-column tile (most loyal | most independent) rendered above the cohesion
// trend on /parliament/cohesion. Mirrors the existing per-party cohesion list
// pattern but operates one level down — at the MP grain — so the user can
// jump straight from "this party is unified" to "these are the MPs holding
// the line / breaking it."
export const LoyaltyOutlierRibbon: FC = () => {
  const { t, i18n } = useTranslation();
  const { top, bottom, isLoading } = useLoyaltyRanking(5, 5, MIN_VOTES);
  const { mpNames } = useMpProfile();
  const candidateUrl = useCandidateUrlForVote();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();

  if (isLoading) return null;
  if (top.length === 0 && bottom.length === 0) return null;

  const lang = i18n.language;
  const title =
    t("cohesion_outlier_title") || "Most independent and most loyal MPs";
  const threshold =
    t("cohesion_outlier_threshold", { count: MIN_VOTES }) ||
    `≥${MIN_VOTES} votes`;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-1">
        {title}
      </h2>
      <p className="text-xs text-muted-foreground mb-3">{threshold}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <RibbonColumn
          heading={t("cohesion_outlier_most_loyal") || "Most loyal"}
          entries={top}
          lang={lang}
          mpNames={mpNames}
          candidateUrl={candidateUrl}
          colorForPartyShort={colorForPartyShort}
          labelForPartyShort={labelForPartyShort}
        />
        <RibbonColumn
          heading={t("cohesion_outlier_most_breakaway") || "Most independent"}
          entries={bottom}
          lang={lang}
          mpNames={mpNames}
          candidateUrl={candidateUrl}
          colorForPartyShort={colorForPartyShort}
          labelForPartyShort={labelForPartyShort}
        />
      </div>
    </section>
  );
};

// Inline party badge — non-linked so it's safe to nest inside the outer
// candidate Link. `PartyTag` can render as a Link to the CIK party page,
// which would otherwise cause invalid nested-anchor HTML.
const PartyBadge: FC<{
  partyShort: string;
  color?: string;
  label: string;
}> = ({ color, label }) => (
  <span
    className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap"
    style={
      color
        ? { backgroundColor: color, color: "rgba(255,255,255,0.95)" }
        : {
            backgroundColor: "transparent",
            color: "var(--muted-foreground)",
            border: "1px solid hsl(var(--border))",
          }
    }
  >
    {label}
  </span>
);

const RibbonColumn: FC<{
  heading: string;
  entries: LoyaltyEntry[];
  lang: string;
  mpNames: Record<string, string>;
  candidateUrl: (csvMpId: number, sessionName?: string | null) => string;
  colorForPartyShort: (s?: string | null) => string | undefined;
  labelForPartyShort: (s?: string | null) => string;
}> = ({
  heading,
  entries,
  lang,
  mpNames,
  candidateUrl,
  colorForPartyShort,
  labelForPartyShort,
}) => (
  <div>
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
      {heading}
    </h3>
    <ul className="divide-y">
      {entries.map((e) => {
        const name = mpNames[String(e.mpId)] ?? `MP #${e.mpId}`;
        const color = colorForPartyShort(e.partyShort);
        const label = labelForPartyShort(e.partyShort) || e.partyShort;
        return (
          <li key={e.mpId} className="py-2">
            <Link
              to={candidateUrl(e.mpId, name)}
              underline={false}
              className="flex items-center gap-2.5 text-sm hover:text-primary"
            >
              <MpAvatar mpId={e.mpId} name={name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{name}</div>
                <div className="mt-0.5">
                  <PartyBadge
                    partyShort={e.partyShort}
                    color={color}
                    label={label}
                  />
                </div>
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div className="text-base font-semibold">
                  {formatPct(e.loyaltyPct, lang)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {e.withParty}/{e.votesCast}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  </div>
);
