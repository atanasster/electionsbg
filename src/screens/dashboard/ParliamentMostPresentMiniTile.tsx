import { FC } from "react";
import { useTranslation } from "react-i18next";
import { UserCheck, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useAttendanceRanking } from "@/data/parliament/votes/useAttendance";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { titleCaseName } from "@/lib/utils";

const PREVIEW = 5;

const formatPct = (frac: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);

export const ParliamentMostPresentMiniTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { mostPresent, isLoading } = useAttendanceRanking(PREVIEW, PREVIEW);
  const { mpNames, mpParty } = useMpProfile();
  const { findMpById, isLoading: mpsLoading } = useMps();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const candidateUrl = useCandidateUrlForVote();

  if ((isLoading || mpsLoading) && mostPresent.length === 0) {
    return (
      <Card aria-hidden>
        <CardContent>
          <div className="min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }
  if (mostPresent.length === 0) return null;

  const lang = i18n.language;
  const nameOf = (id: number): string =>
    titleCaseName(findMpById(id)?.name ?? mpNames[String(id)]) || `MP #${id}`;
  const partyOf = (id: number, fallback: string): string =>
    mpParty[String(id)] ?? fallback;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <UserCheck className="h-4 w-4" />
          {t("hub_most_present_title") || "Most present MPs"}
          <Link
            to="/parliament/attendance"
            underline={false}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xs text-muted-foreground mb-3">
          {t("hub_most_present_lede") ||
            "MPs with the highest share of roll-call items where they cast a vote (yes / no / abstain)."}
        </div>
        <ul className="divide-y">
          {mostPresent.map((e) => {
            const name = nameOf(e.mpId);
            const party = partyOf(e.mpId, e.partyShort);
            const color = colorForPartyShort(party) ?? "#94a3b8";
            const partyLabel = labelForPartyShort(party) || party;
            return (
              <li key={e.mpId}>
                <Link
                  to={candidateUrl(e.mpId, name)}
                  underline={false}
                  className="flex items-center gap-2 py-1.5 text-xs hover:bg-muted/40 rounded px-1"
                >
                  <MpAvatar name={name} mpId={e.mpId} />
                  <span className="flex-1 truncate">{name}</span>
                  <span
                    className="text-[10px] uppercase tracking-wide shrink-0 truncate max-w-[110px]"
                    style={{ color }}
                  >
                    {partyLabel}
                  </span>
                  <span className="font-semibold tabular-nums shrink-0">
                    {formatPct(e.presentPct, lang)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};
