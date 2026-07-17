// „Пътищата и ВиК са отделни сектори" — the honest carve-out strip. МРРБ is the
// administrative parent of Агенция „Пътна инфраструктура" (АПИ, roads, ~€6.3bn — ~63×
// the whole МРРБ group) and the ВиК water system, both of which the app already covers
// as their own sectors. Rolling them into the regional KPIs would make the dashboard
// read as "roads" (the transport lesson) and double-count. This band makes the exclusion
// explicit rather than hidden, and links out. Mirrors TransportRoadsLinkTile (which is a
// single-target card; this one carries both siblings).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Milestone, Droplets, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";

export const RegionalCrossLinkTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const links = [
    {
      to: "/sector/roads",
      Icon: Milestone,
      title: bg ? "Пътища (АПИ)" : "Roads (АПИ)",
      note: bg
        ? "Агенция „Пътна инфраструктура“ — ~€6,3 млрд., най-голямото дете на МРРБ, отделен сектор."
        : "Road Infrastructure Agency — ~€6.3bn, МРРБ's biggest child, a separate sector.",
    },
    {
      to: "/water",
      Icon: Droplets,
      title: bg ? "Води (ВиК)" : "Water (ВиК)",
      note: bg
        ? "Български ВиК холдинг и операторите — водният сектор, отделен изглед."
        : "The Bulgarian Water Holding and the operators — the water sector, a separate view.",
    },
  ];

  return (
    <Card id="regional-cross-links">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg
            ? "Пътищата и ВиК са отделни сектори"
            : "Roads and water are separate sectors"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <p className="text-sm text-muted-foreground leading-snug">
          {bg
            ? "МРРБ е административен принципал и на пътищата (АПИ), и на ВиК, но те са толкова големи, че биха удавили картината на регионалното развитие — затова се броят като собствени сектори, не тук."
            : "МРРБ is the administrative principal of both roads (АПИ) and water (ВиК), but they are so large they would drown the regional-development picture — so they count as their own sectors, not here."}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {links.map(({ to, Icon, title, note }) => (
            <Link
              key={to}
              to={to}
              className="group flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
              <span className="min-w-0">
                <span className="flex items-center gap-1 font-medium">
                  {title}
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {note}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
