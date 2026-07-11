// Култура (МК) sector pack — the Ministry-of-Culture-specific procurement visuals
// on the generic awarder dashboard (/awarder/000695160). Renders ONLY the
// domain-unique tiles; the generic buy-side tiles (KPIs, top contracts/
// contractors, "Какво купува" by CPV, money-flow, tenders, appeals) already sit
// above it.
//
// Deliberately has NO budget bridge (unlike НЗОК/НОИ/ВСС): the МК ministry page
// already owns the €269M budget, programs and execution (plan §1), so the pack
// links there instead of restating it. МК procurement is thin and lumpy
// (~€57M total, most years under €5M), so every procurement-derived piece is
// gated on `hasModel` — an empty scope window must not blank the pack's links.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Palette, ArrowRight } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { useKultura } from "@/data/procurement/useKultura";
import type { ScopeWindow } from "@/data/procurement/useKultura";
import { categoryLabel } from "@/lib/kulturaReferenceData";
import { KulturaCategoryTile } from "./KulturaCategoryTile";

const MINISTRY_PAGE = "/budget/ministry/admin-ministerstvo-na-kulturata";

export const KulturaPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { model, isLoading } = useKultura(eik, scopeWindow);

  const procYears = useMemo(
    () => (model && model.years.length > 0 ? model.years.length : null),
    [model],
  );
  const annualProc = useMemo(() => {
    if (!model || !procYears || procYears <= 0) return null;
    return model.totalEur / procYears;
  }, [model, procYears]);

  const insights = useMemo(() => {
    if (!model) return [] as { text: string; warn?: boolean }[];
    const out: { text: string; warn?: boolean }[] = [];
    const eur = (v: number) => formatEurCompact(v, lang);
    const topYear = [...model.years].sort(
      (a, b) => b.totalEur - a.totalEur || a.year - b.year,
    )[0];
    if (topYear)
      out.push({
        text: `${topYear.year}: ${eur(topYear.totalEur)} — ${bg ? "пик" : "peak year"}`,
      });
    const topCat = model.categories.find(
      (c) => c.totalEur > 0 && c.id !== "other",
    );
    if (topCat)
      out.push({
        text: `${categoryLabel(topCat.id, lang)}: ${eur(topCat.totalEur)}`,
      });
    if (model.directShare > 0.05)
      out.push({
        warn: model.directShare > 0.1,
        text: `${Math.round(model.directShare * 100)}% ${bg ? "без обявление" : "direct award"}`,
      });
    return out;
  }, [model, lang, bg]);

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  const hasModel = !!model && model.totalEur > 0;
  if (!hasModel) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <Palette className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Култура (Министерство на културата)" : "Culture (Ministry)"}
        </h2>
      </div>

      {/* МК-specific KPI: procurement per year. The generic total/contracts/
          suppliers KPIs sit in the awarder header above. */}
      <div className="grid gap-3 grid-cols-2">
        <StatCard
          label={bg ? "Поръчки на година" : "Procurement per year"}
          hint={
            bg
              ? "Договорена стойност, усреднена за годините с договори в обхвата."
              : "Contracted value averaged over the years with contracts in scope."
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {annualProc != null ? formatEurCompact(annualProc, lang) : "—"}
          </span>
        </StatCard>
      </div>

      {insights.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {insights.map((it, i) => (
            <span
              key={i}
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                it.warn
                  ? WARN_CHIP_COLORS
                  : "border-border bg-muted/40 text-foreground"
              }`}
            >
              {it.text}
            </span>
          ))}
        </div>
      )}

      {/* No budget bridge — the real money is elsewhere. Point the reader there
          rather than restating the €269M budget or the film subsidies. */}
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
        <p className="text-muted-foreground">
          {bg
            ? "Обществените поръчки са малка част от парите за култура. Бюджетът и програмите на МК (€269 млн.) са на страницата на министерството; държавните субсидии за кино и грантовете се плащат извън ЗОП."
            : "Procurement is a small slice of culture money. The МК budget and programmes (€269M) are on the ministry page; state film subsidies and grants are paid outside procurement."}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link
            to={MINISTRY_PAGE}
            className="group inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {bg ? "Бюджет на МК" : "МК budget"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/culture"
            className="group inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {bg ? "Субсидии за кино" : "Film subsidies"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* What МК buys via ЗОП, by operating function */}
      <KulturaCategoryTile
        categories={model.categories}
        totalEur={model.totalEur}
      />

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Поръчките са от регистъра на обществените поръчки (АОП/ЦАИС ЕОП). Функционалните категории са изведени от CPV-разделите на договорите. Субсидиите за филми и грантовете за култура се предоставят извън ЗОП и не са включени тук."
          : "Procurement is from the public-procurement register (АОП/ЦАИС ЕОП). Functional categories are derived from the contracts' CPV divisions. Film subsidies and culture grants are awarded outside procurement and are not included here."}
      </p>
    </section>
  );
};
