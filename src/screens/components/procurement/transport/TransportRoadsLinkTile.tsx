// "Пътната инфраструктура е отделен сектор" — the minimal roads cross-link. Road
// building (АПИ, ~€5.6bn) has its own dedicated dashboard, so the transport view
// deliberately keeps NO roads spend of its own — it only points the reader there,
// so the two don't double-count and the rail/port/safety story stays in focus.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Milestone, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";

export const TransportRoadsLinkTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 md:p-4">
        <Milestone className="h-5 w-5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {bg
            ? "Пътната инфраструктура (Агенция „Пътна инфраструктура“) е отделен сектор с над €5 млрд. договори и не е включена в тези суми — за да не се дублира и да остане на фокус железопътният, морският и въздушният транспорт."
            : "Road infrastructure (Road Infrastructure Agency) is a separate sector with over €5bn in contracts and is not counted in these figures — so the two don't double-count and rail, maritime and air stay in focus."}
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
