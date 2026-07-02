// Government-correlation tile for the DB company page: how much this company was
// awarded under each cabinet, as a party-coloured bar chart. Fed from Postgres
// (company_by_cabinet → /api/db/company `cabinets`). Bar HEIGHT = €/month rate,
// NOT total € — caretaker cabinets run ~2 months and regular ones up to 4 years,
// so raw totals would just rank cabinets by length. Descriptive ("awarded
// during"), not causal; award date is the proxy for who governed.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
const surname = (pm: string | null): string =>
  (pm ?? "").trim().split(/\s+/).pop() ?? "—";

interface Datum {
  key: string;
  label: string;
  pm: string | null;
  lead: string | undefined;
  years: string;
  perMonth: number;
  eur: number;
  share: number;
  caretaker: boolean;
  color: string;
}

const ChartTooltip: FC<{
  active?: boolean;
  payload?: { payload: Datum }[];
  bg: boolean;
  lang: string;
}> = ({ active, payload, bg, lang }) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs">
      <div className="font-semibold">
        {d.pm}
        {d.caretaker ? (
          <span className="font-normal text-muted-foreground">
            {bg ? " · служебен" : " · caretaker"}
          </span>
        ) : d.lead ? (
          <span className="font-normal text-muted-foreground"> ({d.lead})</span>
        ) : null}
      </div>
      <div className="text-muted-foreground tabular-nums">{d.years}</div>
      <div className="tabular-nums">
        <span className="font-semibold">
          {formatEurCompact(d.perMonth, lang)}
        </span>
        {bg ? " / мес" : " / mo"}
      </div>
      <div className="text-muted-foreground tabular-nums">
        {formatEurCompact(d.eur, lang)} · {Math.round(d.share * 100)}%
      </div>
    </div>
  );
};

export const CabinetTimelineTile: FC<{
  cabinets: CabinetRow[];
  totalEur: number;
}> = ({ cabinets, totalEur }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [regularOnly, setRegularOnly] = useState(false);

  const all = useMemo<Datum[]>(
    () =>
      (cabinets ?? [])
        .filter((c) => c.contracts > 0)
        .map((c) => {
          const start = Date.parse(c.start_date);
          const end = c.end_date ? Date.parse(c.end_date) : Date.now();
          const months = Math.max(1, (end - start) / MS_PER_MONTH);
          const lead = c.parties?.[0];
          const caretaker = c.type === "caretaker" || !c.parties?.length;
          return {
            key: c.id,
            label: `${surname(c.pm)} '${yr(c.start_date).slice(2)}`,
            pm: c.pm,
            lead,
            years: `${yr(c.start_date)}–${c.end_date ? yr(c.end_date) : ""}`,
            perMonth: c.eur / months,
            eur: c.eur,
            share: totalEur > 0 ? c.eur / totalEur : 0,
            caretaker,
            color: partyColor(lead),
          };
        })
        .sort((a, b) => (a.years < b.years ? -1 : 1)),
    [cabinets, totalEur],
  );

  const data = regularOnly ? all.filter((d) => !d.caretaker) : all;
  if (all.length === 0) return null;

  // Peak among REGULAR (elected) cabinets — a 2-month caretaker's €/month spikes
  // on a couple of contracts and isn't the political takeaway.
  const regular = all.filter((d) => !d.caretaker);
  const peak = (regular.length ? regular : all).reduce((a, b) =>
    b.perMonth > a.perMonth ? b : a,
  );
  const avg =
    data.length > 0
      ? data.reduce((s, d) => s + d.perMonth, 0) / data.length
      : 0;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4 text-muted-foreground" />
          {bg ? "Възлагане по правителства" : "Awards by government"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Темп на възлагане на месец по кабинети (кабинетите са с различна дължина), по дата на възлагане."
            : "Award rate per month by cabinet (cabinets vary in length), by award date."}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={regularOnly}
              onChange={(e) => setRegularOnly(e.target.checked)}
            />
            {bg ? "само редовни кабинети" : "regular cabinets only"}
          </label>
        </div>

        <div style={{ height: 280, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 44, left: 0 }}
            >
              <XAxis
                dataKey="label"
                interval={0}
                angle={-38}
                textAnchor="end"
                height={44}
                tickLine={false}
                axisLine={false}
                fontSize={10}
                className="fill-muted-foreground"
              />
              <YAxis
                tickFormatter={(v: number) =>
                  v >= 1_000_000
                    ? `€${(v / 1_000_000).toFixed(0)}M`
                    : v >= 1_000
                      ? `€${(v / 1_000).toFixed(0)}k`
                      : `€${v}`
                }
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
                width={52}
              />
              <Tooltip
                content={<ChartTooltip bg={bg} lang={i18n.language} />}
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              />
              {avg > 0 && (
                <ReferenceLine
                  y={avg}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                  label={{
                    value: bg ? "средно" : "avg",
                    position: "right",
                    fontSize: 10,
                    fill: "var(--muted-foreground)",
                  }}
                />
              )}
              <Bar dataKey="perMonth" radius={[2, 2, 0, 0]}>
                {data.map((d) => (
                  <Cell
                    key={d.key}
                    fill={d.color}
                    fillOpacity={d.caretaker ? 0.4 : 0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
