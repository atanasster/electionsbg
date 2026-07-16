// Митници (Customs) revenue pack — rendered on the generic awarder dashboard
// (/awarder/000627597). Митници is a COLLECTOR: this pack is revenue-first and
// shows where the ~€7bn it collects comes from (акцизи / ДДС при внос / мита /
// глоби), the 2025 excise product split, and the origins of customs duty. The
// small ЗОП buy-side already sits on the generic awarder page below, so the pack
// renders no contract tiles. Banded via the shared <PackSection>.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ship, Flame, Globe, Warehouse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { PackSection } from "../PackSection";
import {
  RevenueCompositionBar,
  type CompositionSegment,
} from "../RevenueCompositionBar";
import { CustomsExciseRegisterTile } from "./CustomsExciseRegisterTile";
import { ExciseWarehouseMap } from "@/screens/customs/ExciseWarehouseMap";
import { useHashScroll } from "@/ux/useHashScroll";
import { formatEurCompact } from "@/lib/currency";
import {
  useCustoms,
  customsLineEur,
  useExciseRegister,
  useExciseWarehouseMap,
} from "@/data/procurement/useCustoms";
import {
  CUSTOMS_LINES,
  CUSTOMS_LINE_COLOR,
  EXCISE_PRODUCTS,
  type CustomsLineId,
} from "@/lib/customsReferenceData";
import type { SectorPackProps } from "../sectorPacks";

const SECONDS_PER_YEAR = 365 * 24 * 3600;

export const CustomsPack: FC<SectorPackProps> = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const { years, byYear, isLoading } = useCustoms();

  const [yearOverride, setYearOverride] = useState<number | null>(null);
  const year = yearOverride ?? years[0] ?? null;
  const file = year != null ? byYear[year] : undefined;

  const total =
    file?.lines.find((l) => l.id === "total_collected")?.amountEur ?? 0;

  const segments: CompositionSegment[] = useMemo(
    () =>
      CUSTOMS_LINES.map((l) => ({
        key: l.id,
        label: bg ? l.bg : l.en,
        eur: customsLineEur(file, l.id),
        color: CUSTOMS_LINE_COLOR[l.id as CustomsLineId],
      })),
    [file, bg],
  );

  // Excise product split — 2025 only (older files carry excise_fuels only, and
  // tobacco/alcohol are null). Gate the donut on ≥2 non-null products.
  const exciseProducts = useMemo(
    () =>
      EXCISE_PRODUCTS.map((p) => ({
        ...p,
        eur: customsLineEur(file, p.id),
      })).filter((p) => p.eur > 0),
    [file],
  );
  const exciseTotal = exciseProducts.reduce((a, p) => a + p.eur, 0);

  const perSecond = total > 0 ? total / SECONDS_PER_YEAR : 0;

  const { data: register } = useExciseRegister();
  const { data: whMap } = useExciseWarehouseMap();
  const warehouses = whMap?.warehouses ?? [];

  useHashScroll([years.length, year, isLoading, register]);

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  if (!file || total <= 0) return null;

  // Bar-scaling denominators — hoisted out of the render loops below.
  const exciseMax = Math.max(1, ...exciseProducts.map((x) => x.eur));
  const dutyMax = Math.max(1, ...file.customsByCountry.map((x) => x.amountEur));

  return (
    <section className="space-y-4">
      {/* ── Band 1 · Приходи / Revenue composition ─────────────────────── */}
      <div
        id="customs-revenue"
        className="flex items-center gap-2 pt-2 scroll-mt-24"
      >
        <Ship className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Митнически приходи" : "Customs revenue"}
        </h2>
      </div>

      <Card data-og="customs-revenue">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              {bg
                ? `Откъде идват митническите приходи (${year})`
                : `Where customs revenue comes from (${year})`}
            </CardTitle>
            {years.length > 1 && (
              <div
                className="flex gap-1"
                role="group"
                aria-label={bg ? "Година" : "Year"}
              >
                {years.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setYearOverride(y)}
                    aria-pressed={y === year}
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                      y === year
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3 md:p-4 space-y-4">
          <RevenueCompositionBar
            headlineEur={total}
            headlineLabel={
              bg
                ? "събрани от Агенция „Митници“"
                : "collected by the Customs Agency"
            }
            segments={segments}
            lang={lang}
          />
          {perSecond > 0 && (
            <p className="text-xs text-muted-foreground/90">
              {bg
                ? `Това е около ${eur(perSecond)} на секунда — всяка секунда от годината.`
                : `That is about ${eur(perSecond)} per second — every second of the year.`}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? `Източник: Агенция „Митници“, „Митническа хроника“ за ${year} г. Сумите са касови постъпления, конвертирани в евро.`
              : `Source: Customs Agency annual report for ${year}. Figures are cash receipts, converted to euro.`}
          </p>
        </CardContent>
      </Card>

      {/* ── Band 2 · Акцизи по продукт / Excise by product (2025) ──────── */}
      {exciseProducts.length >= 2 && exciseTotal > 0 && (
        <PackSection
          icon={Flame}
          id="customs-excise"
          title={bg ? "Акцизи по продукт" : "Excise by product"}
          sub={
            bg
              ? `Разбивка на акциза за ${year} г. — горива, тютюн и алкохол.`
              : `Excise split for ${year} — fuels, tobacco and alcohol.`
          }
        >
          <Card>
            <CardContent className="p-3 md:p-4 space-y-2.5">
              {exciseProducts.map((p) => {
                const share = p.eur / exciseTotal;
                return (
                  <div key={p.id} className="text-xs">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="font-medium">{bg ? p.bg : p.en}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {eur(p.eur)}
                        <span className="ml-1 text-muted-foreground/70">
                          {(share * 100).toLocaleString(lang, {
                            maximumFractionDigits: 0,
                          })}
                          %
                        </span>
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, (p.eur / exciseMax) * 100)}%`,
                          backgroundColor: p.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-muted-foreground/80">
                {bg
                  ? "Продуктовата разбивка на акциза е налична за 2025 г.; горивата включват дизел, бензин, ВНГ, природен газ и керосин."
                  : "The excise product split is available for 2025; fuels include diesel, petrol, LPG, natural gas and kerosene."}
              </p>
            </CardContent>
          </Card>
        </PackSection>
      )}

      {/* ── Band 3 · Мита по произход / Duty by origin ─────────────────── */}
      {file.customsByCountry.length > 0 && (
        <PackSection
          icon={Globe}
          id="customs-trade"
          title={bg ? "Мита по произход" : "Customs duty by origin"}
          sub={
            bg
              ? "Водещи държави по събрано мито при внос."
              : "Top countries by import duty collected."
          }
        >
          <Card>
            <CardContent className="p-3 md:p-4 space-y-2.5">
              {file.customsByCountry.map((c) => {
                return (
                  <div key={c.name} className="text-xs">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {eur(c.amountEur)}
                        <span className="ml-1 text-muted-foreground/70">
                          {c.sharePct.toLocaleString(lang, {
                            maximumFractionDigits: 1,
                          })}
                          %
                        </span>
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.max(2, (c.amountEur / dutyMax) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-muted-foreground/80">
                {bg
                  ? "Дял от събраното мито при внос по държава на произход."
                  : "Share of import duty collected, by country of origin."}
              </p>
            </CardContent>
          </Card>
        </PackSection>
      )}

      {/* ── Band 4 · Лицензирани складодържатели / Excise warehouses ────── */}
      {register && register.activeOperators > 0 && (
        <PackSection
          icon={Warehouse}
          id="customs-register"
          title={
            bg
              ? `Лицензирани акцизни складодържатели (${register.activeOperators})`
              : `Licensed excise warehouse keepers (${register.activeOperators})`
          }
          sub={
            bg
              ? "Фирмите с лиценз да държат акцизни стоки под отложено плащане — горива, тютюн, алкохол. Всяка води към страницата на дружеството."
              : "Companies licensed to hold excise goods under duty suspension — fuels, tobacco, alcohol. Each links to its company page."
          }
        >
          {warehouses.length > 0 && (
            <ExciseWarehouseMap warehouses={warehouses} />
          )}
          <CustomsExciseRegisterTile data={register} />
        </PackSection>
      )}
    </section>
  );
};
