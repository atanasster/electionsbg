// Awarder "Announced procedures (tenders)" tile — the live per-buyer pipeline
// from Postgres (useAwarderTenders → /api/db/tenders). Completes the procurement
// lifecycle on the awarder page: the procedures this authority announced, their
// FORECAST value (прогнозна стойност — quarantined, never spend), and the ACTUAL
// awarded total via the ocid → contracts join. Renders nothing when the buyer
// has no procedures (or the live endpoint is unavailable), so it never breaks the
// otherwise-static page. See docs/plans/pg-datasets-roadmap.md §0.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Megaphone, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useAwarderTenders } from "@/data/procurement/useAwarderTenders";

const numFmt = new Intl.NumberFormat("bg-BG");

const Kpi: FC<{ label: string; value: string; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <div className="rounded-lg border bg-card p-3">
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="text-lg font-bold tabular-nums break-words">
      {value || "—"}
    </div>
    {sub ? (
      <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>
    ) : null}
  </div>
);

export const AwarderTendersTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useAwarderTenders(eik);
  const s = data?.summary;
  if (!s || s.procedures === 0) return null;

  const coverage =
    s.first_day && s.last_day
      ? `${s.first_day.slice(0, 4)}–${s.last_day.slice(0, 4)}`
      : "";

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-muted-foreground" />
          {bg
            ? "Обявени поръчки (процедури)"
            : "Announced procedures (tenders)"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Прогнозни (обявени) стойности — очаквани, не реален разход."
            : "Estimated (announced) values — a forecast, not actual spend."}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi
            label={bg ? "Процедури" : "Procedures"}
            value={numFmt.format(s.procedures)}
            sub={
              s.cancelled > 0
                ? `${numFmt.format(s.cancelled)} ${bg ? "прекратени" : "cancelled"}`
                : coverage
            }
          />
          <Kpi
            label={bg ? "Прогнозно (Σ)" : "Forecast (Σ)"}
            value={formatEurCompact(s.forecast_eur, i18n.language)}
            sub={bg ? "прогнозна стойност" : "estimated value"}
          />
          <Kpi
            label={bg ? "Възложено (реално)" : "Awarded (actual)"}
            value={formatEurCompact(s.awarded_eur, i18n.language)}
            sub={`${numFmt.format(s.awarded_procedures)} ${bg ? "с договор" : "with a contract"}`}
          />
          <Kpi
            label={bg ? "Дял с договор" : "Contracted share"}
            value={`${Math.round((100 * s.awarded_procedures) / s.procedures)}%`}
            sub={bg ? "процедури → договор" : "procedures → contract"}
          />
        </div>

        {data && data.recent.length > 0 ? (
          <div className="rounded-md border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 hidden sm:table-cell">
                    {bg ? "Дата" : "Date"}
                  </th>
                  <th className="text-left px-3 py-2">
                    {bg ? "Предмет" : "Subject"}
                  </th>
                  <th className="text-right px-3 py-2">
                    {bg ? "Прогнозно" : "Forecast"}
                  </th>
                  <th className="text-right px-3 py-2">
                    {bg ? "Възложено" : "Awarded"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.recent.map((r) => (
                  <tr key={r.unp}>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums hidden sm:table-cell whitespace-nowrap">
                      {r.publication_date}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/tenders/${encodeURIComponent(r.unp)}`}
                        className="hover:underline line-clamp-2"
                        title={r.subject}
                      >
                        {r.subject}
                      </Link>
                      {r.procedure_type ? (
                        <div className="text-[11px] text-muted-foreground">
                          {r.procedure_type}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {formatEurCompact(r.forecast_eur, i18n.language) || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {r.awarded_eur != null ? (
                        formatEurCompact(r.awarded_eur, i18n.language)
                      ) : r.is_cancelled ? (
                        <span className="text-xs text-muted-foreground">
                          {bg ? "прекратена" : "cancelled"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <Link
          to="/procurement/tenders"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {bg ? "Всички обявени поръчки" : "All announced procedures"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};
