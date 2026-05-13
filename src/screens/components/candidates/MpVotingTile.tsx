import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote, ArrowRight, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useMps } from "@/data/parliament/useMps";
import { useMpLoyalty } from "@/data/parliament/votes/useMpLoyalty";
import { useRollcallIndex } from "@/data/parliament/votes/useRollcallIndex";

type Props = { name: string; linkSlug?: string };

const RECENT_LIMIT = 10;

const formatPct = (frac: number, lang: string): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);
};

const formatInt = (n: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB").format(n);

// Per-MP roll-call section on the candidate dashboard. Surfaces party-line
// loyalty as the headline, a per-stat breakdown, and a deep-linked list of
// recent sessions with the MP's vote highlight. This replaces the old
// standalone /candidate/:id/votes route — everything roll-call-related for
// one MP lives here so the dashboard tells the full story without a hop.
//
// Roster id (deduped, latest-per-person) is used for the session-highlight
// links so the user lands inside the right MP's history; loyalty itself is
// resolved via useMpLoyalty's name fallback when parliament.bg's per-NS id
// recycling means the roster id doesn't match the CSV id.
export const MpVotingTile: FC<Props> = ({ name }) => {
  const { t, i18n } = useTranslation();
  const { findMpByName, isLoading: mpsLoading } = useMps();
  const mp = findMpByName(name);
  const { entry, file, isLoading: loyaltyLoading } = useMpLoyalty(mp?.id, name);
  const { sessions } = useRollcallIndex();

  if (loyaltyLoading || mpsLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }

  if (!entry || entry.votesCast === 0) return null;

  const dissents = entry.votesCast - entry.withParty;
  const lang = i18n.language;
  const recent = [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, RECENT_LIMIT);

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Vote className="h-4 w-4" />
          {t("mp_voting_title") || "Voting record"}
          <span className="text-xs text-muted-foreground font-normal">
            · {entry.partyShort}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          {t("mp_voting_full_intro") ||
            "Loyalty is the share of votes the MP cast in line with their party group's majority. Absences are excluded."}
        </p>

        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_voting_loyalty") || "With party"}
            </div>
            <div className="text-3xl font-bold tabular-nums">
              {formatPct(entry.loyaltyPct, lang)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_voting_votes_cast") || "Votes cast"}
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatInt(entry.votesCast, lang)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_voting_with_party") || "With group"}
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatInt(entry.withParty, lang)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_voting_dissents") || "Against party"}
            </div>
            <div
              className={`text-2xl font-semibold tabular-nums ${
                dissents > 0 ? "text-amber-600" : ""
              }`}
            >
              {formatInt(dissents, lang)}
            </div>
          </div>
        </div>

        {file && (
          <div className="text-xs text-muted-foreground mt-4 pt-3 border-t">
            {t("mp_voting_window") || "Computed over"}{" "}
            <span className="tabular-nums">
              {file.windowFrom} → {file.windowTo}
            </span>{" "}
            · {formatInt(file.totalVoteItems, lang)}{" "}
            {t("mp_voting_total_items", { count: file.totalVoteItems }) ||
              "vote items"}
          </div>
        )}

        {recent.length > 0 && mp && (
          <div className="mt-5 pt-4 border-t">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {t("mp_voting_recent_sessions") || "Recent sessions"}
            </h3>
            <ul className="divide-y">
              {recent.map((s) => (
                <li key={s.date}>
                  <Link
                    to={{
                      pathname: `/votes/${s.date}`,
                      search: { mp: String(mp.id) },
                    }}
                    underline={false}
                    className="flex items-center gap-3 py-2 text-sm hover:text-primary"
                  >
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="tabular-nums flex-1">{s.date}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.items}{" "}
                      {t("mp_voting_items_short", { count: s.items }) ||
                        "items"}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 opacity-60" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t">
              <Link
                to="/votes"
                underline={false}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                {t("mp_voting_all_sessions") || "Browse all sessions"}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
