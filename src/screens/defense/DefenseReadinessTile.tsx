// "Хора и готовност" — the people side. Modernisation outpaces recruitment: the
// personnel-vacancy rate and the (much worse) voluntary-reserve fill rate, plus
// the 2025 budget split between personnel and capital. Reused framing: bars with
// a status colour where the reading is unambiguous (a high vacancy is bad).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  useDefensePeers,
  type ReadinessFile,
} from "@/data/defense/useDefenseData";

const Meter: FC<{ label: string; pct: number; color: string }> = ({
  label,
  pct,
  color,
}) => {
  const { i18n } = useTranslation();
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <b className="tabular-nums">
          {pct.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}%
        </b>
      </div>
      <div className="h-3.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
};

export const DefenseReadinessTile: FC<{ data: ReadinessFile }> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data: peers } = useDefensePeers();
  // Active military personnel (NATO Table 7, thousands) — the base the vacancy %
  // is measured against.
  const troops = peers?.bulgaria?.personnelThousands?.at(-1);

  return (
    <Card id="defense-readiness">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          {bg ? "Хора и готовност" : "People & readiness"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {troops != null && (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">
              {Math.round(troops * 1000).toLocaleString(lang)}
            </span>
            <span className="text-xs text-muted-foreground">
              {bg ? "военнослужещи (НАТО)" : "active personnel (NATO)"}
            </span>
          </div>
        )}
        <p className="max-w-[64ch] text-xs text-muted-foreground">
          {bg
            ? "Модернизацията изпреварва набирането — недостигът на личен състав остава структурен проблем."
            : "Modernisation outpaces recruitment — the personnel shortage is a structural problem."}
        </p>
        <div className="space-y-3">
          <Meter
            label={bg ? "Незаети щатни бройки" : "Unfilled established posts"}
            pct={data.personnelVacancyPct}
            color="bg-red-500"
          />
          <Meter
            label={
              bg ? "Запълване на доброволния резерв" : "Voluntary reserve fill"
            }
            pct={data.reserveFillPct}
            color="bg-amber-500"
          />
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">
            {bg
              ? `Бюджет ${data.budgetYear} — разпределение`
              : `Budget ${data.budgetYear} — split`}
          </div>
          <div className="mt-2 flex gap-6">
            <div>
              <div className="text-xl font-bold tabular-nums">
                {formatEurCompact(data.personnelEur, lang)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {bg ? "личен състав" : "personnel"}
              </div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums">
                {formatEurCompact(data.capitalEur, lang)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {bg ? "капиталови (техника)" : "capital (equipment)"}
              </div>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground/80">{data.source}</p>
      </CardContent>
    </Card>
  );
};
