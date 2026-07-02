// Government-correlation tile for the DB company page: how much this company was
// awarded under each cabinet. Fed entirely from Postgres (company_by_cabinet →
// /api/db/company `cabinets`). Normalises by tenure length (€/month) — caretaker
// cabinets run 2 months, regular ones up to 4 years, so raw totals would mislead.
// Descriptive framing ("awarded during"), not causal; award date is the proxy
// for who governed. See docs/plans/pg-query-performance.md.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";

export interface CabinetRow {
  id: string;
  pm: string | null;
  parties: string[] | null;
  start_date: string;
  end_date: string | null;
  type: string | null;
  contracts: number;
  eur: number;
}

// Lead-party brand colours (only a handful of parties ever form cabinets). Match
// by substring so "ГЕРБ-СДС" → ГЕРБ, "ПП-ДБ" → ПП. Caretaker/unknown → grey.
const partyColor = (party: string | undefined): string => {
  const p = party ?? "";
  if (/ГЕРБ/.test(p)) return "#1f6fd6";
  if (/ПП|Продължаваме/.test(p)) return "#f2a900";
  if (/ДБ|Демократична/.test(p)) return "#14477d";
  if (/БСП/.test(p)) return "#e01a1a";
  if (/ИТН|Има такъв/.test(p)) return "#0f9d8f";
  if (/ДПС/.test(p)) return "#6d28d9";
  if (/НДСВ/.test(p)) return "#eab308";
  return "#9ca3af";
};

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;
const yr = (d: string) => d.slice(0, 4);

export const CabinetTimelineTile: FC<{
  cabinets: CabinetRow[];
  totalEur: number;
}> = ({ cabinets, totalEur }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const rows = (cabinets ?? [])
    .filter((c) => c.contracts > 0)
    .map((c) => {
      const start = Date.parse(c.start_date);
      const end = c.end_date ? Date.parse(c.end_date) : Date.now();
      const months = Math.max(1, (end - start) / MS_PER_MONTH);
      return {
        ...c,
        months,
        perMonth: c.eur / months,
        share: totalEur > 0 ? c.eur / totalEur : 0,
        lead: c.parties?.[0],
        caretaker: c.type === "caretaker" || !c.parties?.length,
      };
    });
  if (rows.length === 0) return null;

  const maxPerMonth = Math.max(...rows.map((r) => r.perMonth), 1);
  // The takeaway answers "which POLITICAL government" — so pick the peak among
  // regular (elected) cabinets, not a short caretaker whose €/month spikes on a
  // couple of contracts in a 2-month window. Fall back to all if no regular one.
  const regular = rows.filter((r) => !r.caretaker);
  const peak = (regular.length ? regular : rows).reduce((a, b) =>
    b.perMonth > a.perMonth ? b : a,
  );
  // chronological for the timeline reading
  const ordered = [...rows].sort((a, b) =>
    a.start_date < b.start_date ? -1 : 1,
  );

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4 text-muted-foreground" />
          {bg ? "Възлагане по правителства" : "Awards by government"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Възложено на компанията по кабинети — темп на месец (кабинетите са с различна дължина), по дата на възлагане."
            : "Awarded to the company per cabinet — rate per month (cabinets vary in length), by award date."}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
          {bg ? "Най-висок темп при " : "Highest rate under "}
          <span className="font-semibold">{peak.pm}</span>
          {peak.lead ? (
            <span className="text-muted-foreground"> ({peak.lead})</span>
          ) : null}
          {": "}
          <span className="font-semibold tabular-nums">
            {formatEurCompact(peak.perMonth, i18n.language)}
          </span>
          {bg ? " / мес" : " / mo"}
        </div>

        <div className="space-y-2.5">
          {ordered.map((c) => (
            <div key={c.id} className="text-xs">
              <div className="flex items-baseline gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: partyColor(c.lead) }}
                />
                <span className="font-medium truncate">
                  {c.pm}
                  {c.caretaker ? (
                    <span className="text-muted-foreground font-normal">
                      {bg ? " · служебен" : " · caretaker"}
                    </span>
                  ) : c.lead ? (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      ({c.lead})
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                  {yr(c.start_date)}–{c.end_date ? yr(c.end_date) : ""}
                </span>
                <span className="ml-auto tabular-nums whitespace-nowrap font-semibold">
                  {formatEurCompact(c.eur, i18n.language)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-[18px]">
                <span className="flex-1 min-w-0 h-2 rounded bg-muted overflow-hidden">
                  <span
                    className="block h-full rounded"
                    style={{
                      width: `${Math.max(2, (c.perMonth / maxPerMonth) * 100)}%`,
                      backgroundColor: partyColor(c.lead),
                      opacity: 0.65,
                    }}
                  />
                </span>
                <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatEurCompact(c.perMonth, i18n.language)}
                  {bg ? "/мес" : "/mo"} · {Math.round(c.share * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
