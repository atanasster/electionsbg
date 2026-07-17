// The "X as a public buyer" section — one card listing a group's awarders, each
// deep-linking to its own /awarder/:eik page.
//
// WHY IT IS SHARED: four screens had grown their own copy of this (SectorAwardersTile,
// DefenseAwardersTile, CultureAwardersTile, JudicialAwardersTile) — the headers even said
// so ("Generic version of DefenseAwardersTile", "Mirrors the judiciary's
// JudicialAwardersTile"). They had already drifted, and the drift was invisible: when the
// awarder links lost the ?pscope carry, SectorAwardersTile preserved it on its group link
// but not on its member chips. One component, one place to fix that class of bug.
//
// TWO LAYOUTS, one data shape — hence `variant` rather than two components:
//   chips  — a lead "whole group" row + members as rounded chips under optional
//            sub-group headings. For big EIK groups (МО's 25, a sector's 30).
//   roster — a divide-y list, one row per body with an optional badge + note + its EIK.
//            For small curated rosters where each body deserves a line (culture, judiciary).
//
// Links go through AwarderLink, so the time scope + canonical naming come for free.

import { FC, ReactNode } from "react";
import { Link, To } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { AwarderLink } from "./AwarderLink";

export interface AwarderRow {
  eik: string;
  /** Already language-resolved by the caller (each roster names things its own way). */
  name: string;
  /** chips: sub-group heading to bucket under (declaration order is preserved). */
  group?: string;
  /** roster: a short pill after the name, e.g. "с бюджетен разрез". */
  badge?: string;
  /** roster: secondary line under the name. */
  note?: string;
}

export const AwarderListSection: FC<{
  title: ReactNode;
  rows: AwarderRow[];
  variant?: "chips" | "roster";
  /** Anchor id (deep links / OG capture). */
  id?: string;
  /** Lead row above the list — the consolidated "whole group" view. */
  lead?: { to: To; label: ReactNode };
  /** Intro line under the title. */
  intro?: ReactNode;
  /** Closing caveat (what the register can't see, what isn't listed, …). */
  footnote?: ReactNode;
  /** roster: show each body's EIK on the secondary line. */
  showEik?: boolean;
  /** Rendered after the list — e.g. culture's "show all institutes" toggle. */
  children?: ReactNode;
}> = ({
  title,
  rows,
  variant = "chips",
  id,
  lead,
  intro,
  footnote,
  showEik,
  children,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // A single-member group reads better as one full-width row than a lone chip.
  const single = variant === "chips" && rows.length === 1;

  // Preserve declaration order of sub-groups for stable rendering.
  const groups = [...new Map(rows.map((r) => [r.group ?? "", r])).keys()];

  return (
    <Card id={id}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {intro && <p className="text-xs text-muted-foreground">{intro}</p>}

        {lead && (
          <Link
            to={lead.to}
            className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5 text-sm hover:border-primary/50"
          >
            <span className="font-medium">{lead.label}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        )}

        {variant === "chips" ? (
          <div className="space-y-3">
            {groups.map((g) => {
              const inGroup = rows.filter((r) => (r.group ?? "") === g);
              return (
                <div key={g || "_"}>
                  {g && (
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {g}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {inGroup.map((r) => (
                      <AwarderLink
                        key={r.eik}
                        eik={r.eik}
                        className={
                          single
                            ? "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm hover:border-primary/50 hover:text-primary"
                            : "rounded-full border px-2.5 py-1 text-xs hover:border-primary/50 hover:text-primary"
                        }
                      >
                        <span>{r.name}</span>
                        {single && (
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </AwarderLink>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((r) => (
              <li key={r.eik}>
                <AwarderLink
                  eik={r.eik}
                  className="group flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium group-hover:text-primary">
                      {r.name}
                      {r.badge && (
                        <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {r.badge}
                        </span>
                      )}
                    </span>
                    {(showEik || r.note) && (
                      <span className="block text-[11px] text-muted-foreground">
                        {showEik ? `${bg ? "ЕИК " : "EIK "}${r.eik}` : ""}
                        {showEik && r.note ? " · " : ""}
                        {r.note ?? ""}
                      </span>
                    )}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                </AwarderLink>
              </li>
            ))}
          </ul>
        )}

        {children}

        {footnote && (
          <p className="text-[11px] text-muted-foreground/80">{footnote}</p>
        )}
      </CardContent>
    </Card>
  );
};
