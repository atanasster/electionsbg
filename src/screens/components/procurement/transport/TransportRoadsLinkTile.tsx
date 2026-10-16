// "Пътната инфраструктура е отделен сектор" — the minimal roads cross-link. Road
// building (АПИ) has its own dedicated dashboard, so the transport view
// deliberately keeps NO roads spend of its own — it only points the reader there,
// so the two don't double-count and the rail/port/safety story stays in focus. The
// roads figure is read from the roads hub blob, never restated here: a literal went
// stale twice.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Milestone, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { useRoadsHubStats } from "@/data/roads/hubStats";
import { formatEurCompact } from "@/lib/currency";

export const TransportRoadsLinkTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useRoadsHubStats();
  const roadsEur = data?.procurement.eur;
  const amount = roadsEur
    ? formatEurCompact(roadsEur, bg ? "bg-BG" : "en-GB")
    : null;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 md:p-4">
        <Milestone className="h-5 w-5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {bg
            ? `Пътната инфраструктура (Агенция „Пътна инфраструктура“ и НКСИП) е отделен сектор${amount ? ` с ${amount} договори за целия период` : ""} и не е включена в тези суми — за да не се дублира и да остане на фокус железопътният, морският и въздушният транспорт.`
            : `Road infrastructure (the Road Infrastructure Agency and НКСИП) is a separate sector${amount ? ` with ${amount} in contracts over the whole period` : ""} and is not counted in these figures — so the two don't double-count and rail, maritime and air stay in focus.`}
        </p>
        <Link
          to="/sector/roads"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          {bg ? "Виж сектор „Пътища“" : "See the Roads sector"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};
