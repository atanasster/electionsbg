import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useFactionCohesion } from "@/data/parliament/votes/useFactionCohesion";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";

const PREVIEW = 6;

const formatPct = (frac: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);

export const ParliamentCohesionMiniTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { entries, isLoading } = useFactionCohesion();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();

  const ordered = useMemo(
    () =>
      [...entries]
        .sort((a, b) => b.meanCohesion - a.meanCohesion)
        .slice(0, PREVIEW),
    [entries],
  );

  if (isLoading && entries.length === 0) {
    return (
      <Card aria-hidden>
        <CardContent>
          <div className="min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }
  if (ordered.length === 0) return null;

  // Compact bar scale: use min/max within the previewed set so the contrast
  // is visible even when every group is >85%.
  const min = ordered.reduce(
    (m, e) => Math.min(m, e.meanCohesion),
    Number.POSITIVE_INFINITY,
  );
  const max = ordered.reduce((m, e) => Math.max(m, e.meanCohesion), 0);
  const span = Math.max(0.0001, max - min);
  const lang = i18n.language;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4" />
          {t("hub_cohesion_title") || "Group cohesion"}
          <Link
            to="/parliament/cohesion"
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
          {t("hub_cohesion_lede") ||
            "Average within-group unanimity per parliamentary group. 100% means every member always voted together."}
        </div>
        <ul className="space-y-2.5">
          {ordered.map((e) => {
            const color = colorForPartyShort(e.partyShort) ?? "#94a3b8";
            const label = labelForPartyShort(e.partyShort) || e.partyShort;
            const width = ((e.meanCohesion - min) / span) * 100;
            return (
              <li key={e.partyShort}>
                <div className="flex items-baseline gap-2 text-xs mb-1">
                  <span className="font-medium truncate" style={{ color }}>
                    {label}
                  </span>
                  <span className="ml-auto tabular-nums font-semibold">
                    {formatPct(e.meanCohesion, lang)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.max(4, width)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};
