// "Кой плаща за влака" — the rail subsidy-dependency tile (Phase 3a, the flagship). The
// state subsidises passenger rail through the PSO to „БДЖ — Пътнически" and the
// infrastructure grant to НКЖИ; this tile puts that subsidy PER PASSENGER — the €/ticket
// the taxpayer pays on top of the fare — and shows it rising while ridership does not.
// Reads data/transport/{rail_subsidy,rail_ridership}.json (budget law + Eurostat), joined
// in useRailSubsidy. Annual, national — not scope-windowed (like the budget tile).
//
// Honesty: the per-passenger figure uses the PSO (operating) subsidy only — the "per
// ticket" money; НКЖИ infrastructure + capital are shown separately (track, not tickets).
// Figures are the BUDGETED subsidy (ЗДБ), not executed; ridership is national rail ≈ БДЖ.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { TrainFront } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useRailSubsidy } from "@/data/procurement/useRailSubsidy";

export const TransportSubsidyTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { rows, latest, isLoading } = useRailSubsidy();

  if (isLoading)
    return (
      <div className="h-[260px] animate-pulse rounded-xl border bg-card" />
    );
  if (!latest || latest.perPassenger == null) return null;

  const perPax = latest.perPassenger;
  const fmtPerPax = (v: number) =>
    bg
      ? `${v.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
      : `€${v.toFixed(2)}`;

  // Composition of the latest year's total rail subsidy.
  const pso = latest.pso ?? 0;
  const nkzhi = latest.nkzhi ?? 0;
  const bdzCap = latest.bdzCapital ?? 0;
  const total = pso + nkzhi + bdzCap;
  const seg = (v: number) => (total > 0 ? Math.max(0, (v / total) * 100) : 0);

  // Per-passenger trend (rows with a value), for the sparkline.
  const trend = rows.filter((r) => r.perPassenger != null);
  const maxPer = Math.max(...trend.map((r) => r.perPassenger as number), 0.01);
  const first = trend[0];
  const growth =
    first && first.perPassenger && first.perPassenger > 0
      ? perPax / first.perPassenger
      : null;

  return (
    <Card id="rail-subsidy">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrainFront className="h-4 w-4" />
          {bg ? "Кой плаща за влака" : "Who pays for the railway"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {fmtPerPax(perPax)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `държавна субсидия на пътник (PSO), ${latest.year} г.`
              : `state subsidy per passenger (PSO), ${latest.year}`}
          </span>
          {growth != null && growth >= 1.1 && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              ×{growth.toLocaleString(loc, { maximumFractionDigits: 1 })}{" "}
              {bg ? `от ${first.year}` : `since ${first.year}`}
            </span>
          )}
        </div>

        {/* Total rail subsidy composition — PSO (operating) · НКЖИ (infra) · БДЖ capital. */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">
              {bg ? "Обща субсидия за железници" : "Total rail subsidy"}
            </span>
            <span className="font-semibold tabular-nums">
              {formatEurCompact(total, lang)} · {latest.year}
            </span>
          </div>
          <div className="flex h-4 overflow-hidden rounded-md border">
            <div className="bg-primary" style={{ width: `${seg(pso)}%` }} />
            <div
              className="bg-primary/50"
              style={{ width: `${seg(nkzhi)}%` }}
            />
            <div
              className="bg-primary/25"
              style={{ width: `${seg(bdzCap)}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-primary" />
              {bg ? "БДЖ — PSO (превоз)" : "БДЖ — PSO (service)"}{" "}
              <span className="tabular-nums">
                {formatEurCompact(pso, lang)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-primary/50" />
              {bg ? "НКЖИ (инфраструктура)" : "НКЖИ (infrastructure)"}{" "}
              <span className="tabular-nums">
                {formatEurCompact(nkzhi, lang)}
              </span>
            </span>
            {bdzCap > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-primary/25" />
                {bg ? "БДЖ (капитал)" : "БДЖ (capital)"}{" "}
                <span className="tabular-nums">
                  {formatEurCompact(bdzCap, lang)}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Per-passenger subsidy trend — rising while ridership is flat. */}
        {trend.length > 1 && (
          <div>
            <div className="flex items-end gap-1" style={{ height: 40 }}>
              {trend.map((r) => (
                <div
                  key={r.year}
                  className="flex-1"
                  title={`${r.year}: ${fmtPerPax(r.perPassenger as number)}`}
                >
                  <div
                    className={`w-full rounded-t ${
                      r.year === latest.year ? "bg-primary" : "bg-primary/35"
                    }`}
                    style={{
                      height: `${Math.max(3, ((r.perPassenger as number) / maxPer) * 40)}px`,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{trend[0].year}</span>
              <span>{latest.year}</span>
            </div>
          </div>
        )}

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              Държавата плаща{" "}
              <span className="font-semibold tabular-nums">
                {fmtPerPax(perPax)}
              </span>{" "}
              субсидия за всеки пътник на „БДЖ — Пътнически" (
              {latest.passengers
                ? `${(latest.passengers / 1e6).toLocaleString("bg-BG", { maximumFractionDigits: 1 })} млн. пътници`
                : "—"}
              , {latest.year} г.) — над цената на билета. Субсидията расте, а
              броят пътници — не. Плюс инфраструктурната вноска към НКЖИ.
            </>
          ) : (
            <>
              The state pays{" "}
              <span className="font-semibold tabular-nums">
                {fmtPerPax(perPax)}
              </span>{" "}
              of subsidy for every „БДЖ — Passenger" traveller (
              {latest.passengers
                ? `${(latest.passengers / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M passengers`
                : "—"}
              , {latest.year}) — on top of the fare. The subsidy is rising while
              ridership is not. Plus the infrastructure grant to НКЖИ.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Субсидия: Закон за държавния бюджет (бюджетирана, не изпълнена). Пътници: Eurostat rail_pa_total (национален жп ≈ БДЖ). Субсидията на пътник ползва само PSO (оперативната субсидия); НКЖИ е инфраструктура."
            : "Subsidy: State Budget Law (budgeted, not executed). Passengers: Eurostat rail_pa_total (national rail ≈ БДЖ). “Per passenger” uses the PSO (operating) subsidy only; НКЖИ is infrastructure."}
        </p>
      </CardContent>
    </Card>
  );
};
