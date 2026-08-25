// Career-arc timeline for the DB person page — each role rendered as a
// horizontal span from added_at → erased_at (or "now" if active), so the
// person's entry/exit across companies reads at a glance. Replaces the flat
// text chronology. Dependency-free (positioned divs, no chart lib). Roles this
// tile cannot place are dropped — see `isPlottableRole`, which the CALLER also reads
// so it can say how many. Name-only match — a lead.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { trRoleLabel } from "@/lib/trRole";
import { decodeEntities } from "@/lib/decodeEntities";
import { isPlottableRole } from "./plottableRole";

export interface TimelineRole {
  uic: string;
  company: string | null;
  role: string | null;
  added_at: string | null;
  erased_at: string | null;
  active: boolean;
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export const PersonTimelineTile: FC<{
  roles: TimelineRole[];
  /** One line under the heading tying this card to the list it repeats.
   *
   *  Two cards showing the same ten facts, with nothing saying so, read as two datasets
   *  that ought to agree — and this one plots fewer rows than the list above it, because
   *  a role this tile cannot place is silently dropped (`isPlottableRole`). The caller
   *  knows both counts and passes them; the tile does not compute them, because the
   *  number the reader is comparing against is the one the LIST shows, which is per
   *  company after folding rather than per role. */
  note?: string;
}> = ({ roles, note }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const model = useMemo(() => {
    const now = Date.now();
    const rows = roles
      .filter(isPlottableRole)
      .map((r) => {
        const start = Date.parse(String(r.added_at));
        const end = r.erased_at ? Date.parse(String(r.erased_at)) : now;
        return { r, start, end: Math.max(end, start) };
      })
      .sort((a, b) => a.start - b.start);
    if (rows.length === 0) return null;
    const min = Math.min(...rows.map((x) => x.start));
    const max = now;
    const span = Math.max(max - min, YEAR_MS);
    // Year gridlines across the domain.
    const y0 = new Date(min).getFullYear();
    const y1 = new Date(max).getFullYear();
    const years: number[] = [];
    for (let y = y0; y <= y1; y++) years.push(y);
    return { rows, min, span, years };
  }, [roles]);

  if (!model) return null;
  const { rows, min, span, years } = model;
  const posLeft = (ms: number) => ((ms - min) / span) * 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Clock className="h-4 w-4" />
          {bg ? "Хронология на участията" : "Tenure timeline"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {bg
              ? "Периоди на роля по фирми; текущите достигат до днес"
              : "Role spans per company; current ones reach today"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {note && (
          <p className="mb-3 border-l-2 border-border bg-muted/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {note}
          </p>
        )}
        <div className="space-y-1.5">
          {rows.map(({ r, start, end }, i) => {
            const left = posLeft(start);
            const width = Math.max(1.5, posLeft(end) - left);
            return (
              <div
                key={`${r.uic}-${r.role}-${i}`}
                className="flex items-center gap-2"
              >
                <div className="w-40 shrink-0 truncate text-xs md:w-52">
                  <Link
                    to={`/company/${r.uic}`}
                    className="text-accent hover:underline"
                    title={decodeEntities(r.company) || r.uic}
                  >
                    {decodeEntities(r.company) || r.uic}
                  </Link>
                  <span className="ml-1 text-muted-foreground">
                    {trRoleLabel(r.role, t)}
                  </span>
                </div>
                <div className="relative h-4 flex-1 rounded bg-muted/40">
                  <div
                    className={`absolute top-0.5 h-3 rounded ${
                      r.active ? "bg-emerald-500/70" : "bg-muted-foreground/40"
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${String(r.added_at).slice(0, 10)} → ${
                      r.erased_at
                        ? String(r.erased_at).slice(0, 10)
                        : bg
                          ? "днес"
                          : "now"
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Year axis */}
        <div className="relative mt-2 ml-40 h-4 md:ml-52">
          {years.map((y) => {
            const left = posLeft(Date.parse(`${y}-01-01`));
            if (left < 0 || left > 100) return null;
            return (
              <span
                key={y}
                className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground/70"
                style={{ left: `${left}%` }}
              >
                {y}
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
