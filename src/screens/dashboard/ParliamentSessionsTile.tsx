import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote, ArrowRight, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useRollcallIndex } from "@/data/parliament/votes/useRollcallIndex";

const PREVIEW = 5;

const formatDate = (iso: string, lang: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
};

export const ParliamentSessionsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { sessions, isLoading } = useRollcallIndex();

  if (isLoading && sessions.length === 0) {
    return (
      <Card aria-hidden>
        <CardContent>
          <div className="min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }
  if (sessions.length === 0) return null;

  const recent = [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, PREVIEW);
  const lang = i18n.language;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Vote className="h-4 w-4" />
          {t("hub_votes_title") || "Roll-call votes"}
          <span className="text-xs text-muted-foreground font-normal">
            · {sessions.length}{" "}
            {t("votes_index_sessions", { count: sessions.length }) ||
              "sessions"}
          </span>
          <Link
            to="/votes"
            underline={false}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {recent.map((s) => (
            <li key={s.date}>
              <Link
                to={`/votes/${s.date}`}
                underline={false}
                className="flex items-center gap-3 py-2 text-sm hover:text-primary"
              >
                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">
                  {formatDate(s.date, lang)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {s.items}{" "}
                  {t("mp_voting_items_short", { count: s.items }) || "items"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
