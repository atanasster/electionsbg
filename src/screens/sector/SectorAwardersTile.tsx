// The bridge to the money: every awarder institution in the sector, each
// deep-linking to its own /awarder/:eik page. Generic version of
// DefenseAwardersTile — grouped by an optional sub-group label, with a lead link
// to the consolidated group pack. Single-member sectors render one chip plus a
// note pointing at the awarder page for the full breakdown.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { SectorDashboardConfig } from "./sectorDashboards";

export const SectorAwardersTile: FC<{ config: SectorDashboardConfig }> = ({
  config,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { members, leadEik } = config;
  const single = members.length === 1;

  // Preserve declaration order of sub-groups (if any) for stable rendering.
  const groups = [
    ...new Map(
      members.map((m) => [m.group ? (bg ? m.group.bg : m.group.en) : "", m]),
    ).keys(),
  ];

  return (
    <Card id="sector-awarders">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? single
              ? "Възложителят на сектора"
              : `Възложителите на сектора (${members.length})`
            : single
              ? "The sector's awarder"
              : `The sector's awarders (${members.length})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {!single && (
          <Link
            to={`/awarder/${leadEik}`}
            className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5 text-sm hover:border-primary/50"
          >
            <span className="font-medium">
              {bg
                ? "Обществените поръчки на цялата група"
                : "Public procurement of the whole group"}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        )}

        <div className="space-y-3">
          {groups.map((g) => {
            const rows = members.filter(
              (m) => (m.group ? (bg ? m.group.bg : m.group.en) : "") === g,
            );
            return (
              <div key={g || "_"}>
                {g && (
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {rows.map((m) => (
                    <Link
                      key={m.eik}
                      to={`/awarder/${m.eik}`}
                      className={
                        single
                          ? "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm hover:border-primary/50 hover:text-primary"
                          : "rounded-full border px-2.5 py-1 text-xs hover:border-primary/50 hover:text-primary"
                      }
                    >
                      <span>{bg ? m.name.bg : m.name.en}</span>
                      {single && (
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {single && (
          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? "Пълната разбивка по договори, изпълнители и категории е на страницата на възложителя."
              : "The full breakdown by contracts, contractors and categories is on the awarder's page."}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
