// "Конкуренция и почтеност" — the integrity read, done the way no benchmarked
// procurement tool does it. OpenTender / SIGMA / the EU scoreboard all score a
// single-bid contract as a red flag whether the sole supplier was chosen or
// named by law. НОИ has two suppliers whose lack of competition is STATUTE
// (Информационно обслужване = the state's systems integrator by ЗЕУ; Български
// пощи = pension delivery under НПОС) — so the honest number is the single-bid
// rate with those statutory mandates removed. We show both: the raw rate the
// generic benchmarks tile reports, and the discretionary rate that actually
// signals procurement behaviour, plus how much single-bid spend is statute.
//
// This does NOT duplicate the awarder page's generic single-bid gauge — it adds
// the statutory split that gauge cannot make.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Gavel } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { NOI_SUPPLIER_CONTEXT } from "@/lib/noiBenchmarks";
import type { NoiModel } from "@/lib/noiAttributes";

// Reference band for a single-bid / direct-award share, matching the site's
// generic benchmarks tile (green ≤10%, amber ≤20%, red above).
const band = (share: number): "green" | "amber" | "red" =>
  share <= 0.1 ? "green" : share <= 0.2 ? "amber" : "red";

const BAND_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};
const BAND_TEXT: Record<string, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-rose-600 dark:text-rose-400",
};

const IndicatorBar: FC<{
  label: string;
  share: number | null;
  hint: string;
  lang: string;
}> = ({ label, share, hint, lang }) => {
  if (share == null) return null;
  const b = band(share);
  // Axis scaled so 20% (the red threshold) sits at ~66% width — keeps small,
  // good numbers visually small without crushing them.
  const max = Math.max(0.3, share * 1.15);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold tabular-nums ${BAND_TEXT[b]}`}>
          {(share * 100).toLocaleString(lang, { maximumFractionDigits: 0 })}%
        </span>
      </div>
      <div className="relative mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
        {/* green/amber guide ticks */}
        <div
          className="absolute inset-y-0 w-px bg-emerald-500/50"
          style={{ left: `${(0.1 / max) * 100}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-amber-500/50"
          style={{ left: `${(0.2 / max) * 100}%` }}
        />
        <div
          className={`h-full rounded-full ${BAND_DOT[b]}`}
          style={{ width: `${Math.min(100, (share / max) * 100)}%` }}
        />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>
    </div>
  );
};

export const NoiIntegrityTile: FC<{ model: NoiModel }> = ({ model }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const view = useMemo(() => {
    // Split per-supplier single-bid into statutory-mandated vs discretionary.
    // The model carries singleBidShare + bidKnownN per supplier; singleBidN is
    // reconstructed from them (the model doesn't store the raw count).
    let discBidKnown = 0;
    let discSingle = 0;
    const statutorySuppliers: {
      eik: string;
      name: string;
      totalEur: number;
      ctxBg: string;
      ctxEn: string;
    }[] = [];
    for (const s of model.suppliers) {
      const ctx = NOI_SUPPLIER_CONTEXT[s.eik];
      if (ctx) {
        statutorySuppliers.push({
          eik: s.eik,
          name: s.name,
          totalEur: s.totalEur,
          ctxBg: ctx.bg,
          ctxEn: ctx.en,
        });
      } else if (s.singleBidShare != null) {
        discBidKnown += s.bidKnownN;
        discSingle += Math.round(s.singleBidShare * s.bidKnownN);
      }
    }
    return {
      rawShare: model.singleBidShare,
      discretionaryShare: discBidKnown > 0 ? discSingle / discBidKnown : null,
      directShare: model.directShare,
      statutorySuppliers: statutorySuppliers.sort(
        (a, b) => b.totalEur - a.totalEur,
      ),
    };
  }, [model]);

  // Nothing to say if the corpus carries no bid-count data and no direct spend.
  if (view.rawShare == null && view.directShare === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          {bg ? "Конкуренция и почтеност" : "Competition and integrity"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        <div className="space-y-3">
          <IndicatorBar
            lang={lang}
            label={
              bg
                ? "С една оферта — извън законовия мандат"
                : "Single-bid — outside the statutory mandate"
            }
            share={view.discretionaryShare}
            hint={
              bg
                ? "Делът с една оферта, след като се извадят доставчиците, определени по закон — истинският сигнал за конкуренцията."
                : "The single-bid share once the suppliers named by law are removed — the real competition signal."
            }
          />
          <IndicatorBar
            lang={lang}
            label={bg ? "С една оферта — общо" : "Single-bid — raw"}
            share={view.rawShare}
            hint={
              bg
                ? "Суровият дял, който общите показатели над пакета отчитат — включва и законовия мандат."
                : "The raw share the generic benchmarks above report — includes the statutory mandate."
            }
          />
          <IndicatorBar
            lang={lang}
            label={bg ? "Без обявление (пряко)" : "Direct award (no notice)"}
            share={view.directShare}
            hint={
              bg
                ? "Дял от стойността, възложен по процедури без предварително обявление."
                : "Share of value awarded via procedures with no prior notice."
            }
          />
        </div>

        {view.statutorySuppliers.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
              <Gavel className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {bg
                ? "Мандат по закон — не е нарушение"
                : "Mandated by law — not a red flag"}
            </div>
            <ul className="space-y-1.5">
              {view.statutorySuppliers.map((s) => (
                <li key={s.eik} className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{s.name}</span>
                  {" — "}
                  {bg ? s.ctxBg : s.ctxEn}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Показателите са изведени от договорите на НОИ (АОП/ЦАИС ЕОП). Зелено ≤10%, кехлибарено ≤20%. За разлика от повечето инструменти, тук доставчик, определен по закон, не се брои като червен флаг."
            : "Indicators are derived from НОИ's contracts. Green ≤10%, amber ≤20%. Unlike most tools, a supplier named by law is not counted as a red flag here."}
        </p>
      </CardContent>
    </Card>
  );
};
