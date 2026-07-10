// "Плащания за лекарства" — the drugs НЗОК pays most for. Drug
// reimbursement (~€1.33bn/yr) is НЗОК's second-largest budget line and, like
// hospital payments, is paid OUTSIDE public procurement. This tile ranks the
// top INN (active substances) and lets the reader flip to the ATC therapeutic
// area — where oncology's dominance jumps out. Pure from NzokDrugReimbursementFile.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pill, TrendingUp, TrendingDown, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type {
  NzokDrugReimbursementFile,
  NzokDrugMover,
} from "@/data/budget/types";

const TOP_N = 12;

export const NzokDrugReimbursementTile: FC<{
  data: NzokDrugReimbursementFile;
  /** Drop the card's own title when the band header already names it. The
   *  substance/area/growth view toggle stays. */
  hideTitle?: boolean;
}> = ({ data, hideTitle }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const hasGrowth =
    !!data.growth &&
    data.growth.risers.length +
      data.growth.fallers.length +
      data.growth.newlyReimbursed.length >
      0;
  const [view, setView] = useState<"inn" | "atc" | "growth">("inn");

  const total = data.totalEur;
  if (total <= 0 || !data.top.length) return null;
  const growth = data.growth ?? null;

  // Oncology (ATC group L) share — the headline story.
  const oncoEur = data.byAtcGroup.find((g) => g.code === "L")?.eur ?? 0;
  const oncoShare = oncoEur / total;

  const rows =
    view === "inn"
      ? data.top.slice(0, TOP_N).map((d) => ({
          key: d.inn,
          label: d.inn,
          sub: d.topProduct ? `${d.atc} · ${d.topProduct}` : d.atc,
          value: d.eur,
        }))
      : data.byAtcGroup.slice(0, TOP_N).map((g) => ({
          key: g.code,
          label: bg ? g.bg : g.en,
          sub: `ATC ${g.code}`,
          value: g.eur,
        }));
  // Guard the ACTIVE view's array: the toggled view renders a different field
  // than the early-return guard checked, so an empty secondary array would make
  // Math.max(...[]) return -Infinity (every bar collapses to the 2% floor).
  const max = rows.length ? Math.max(...rows.map((r) => r.value)) : 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div
          className={`flex flex-wrap items-center gap-2 ${
            hideTitle ? "justify-end" : "justify-between"
          }`}
        >
          {!hideTitle && (
            <CardTitle className="text-base flex items-center gap-2">
              <Pill className="h-4 w-4" />
              {bg ? "Плащания за лекарства" : "Drug reimbursement"}
            </CardTitle>
          )}
          <div
            className="flex gap-1"
            role="group"
            aria-label={bg ? "Изглед" : "View"}
          >
            {(hasGrowth
              ? (["inn", "atc", "growth"] as const)
              : (["inn", "atc"] as const)
            ).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={v === view}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                  v === view
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {v === "inn"
                  ? bg
                    ? "Молекула"
                    : "Substance"
                  : v === "atc"
                    ? bg
                      ? "Група"
                      : "Area"
                    : bg
                      ? "Ръст"
                      : "Growth"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Headline + oncology share */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">{eur(total)}</span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `платени за лекарства (${data.year}) · ${data.distinctInn} молекули`
              : `paid for medicines (${data.year}) · ${data.distinctInn} substances`}
          </span>
        </div>
        {view !== "growth" && oncoShare > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <span className="font-semibold tabular-nums">
              {(oncoShare * 100).toLocaleString(lang, {
                maximumFractionDigits: 0,
              })}
              %
            </span>{" "}
            <span className="text-muted-foreground">
              {bg
                ? `от разхода за лекарства е за онкологични и имуномодулиращи продукти (${eur(oncoEur)}).`
                : `of drug spend is antineoplastic & immunomodulating (oncology) — ${eur(oncoEur)}.`}
            </span>
          </div>
        )}

        {/* Ranked list (Молекула / Група) */}
        {view !== "growth" && (
          <div className="space-y-2">
            {rows.map((r) => {
              const share = r.value / total;
              return (
                <div key={r.key} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="min-w-0 truncate font-medium">
                      {r.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground shrink-0">
                      {eur(r.value)}
                      <span className="ml-1 text-muted-foreground/70">
                        {(share * 100).toLocaleString(lang, {
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
                        width: `${Math.max(2, (r.value / max) * 100)}%`,
                      }}
                    />
                  </div>
                  {r.sub && (
                    <div className="mt-0.5 min-w-0 truncate text-[11px] text-muted-foreground/70">
                      {r.sub}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Growth view — full-year-vs-full-year fastest movers (CMS pattern) */}
        {view === "growth" && growth && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {bg
                ? `Промяна на брутния разход по молекула, ${growth.priorYear} → ${growth.year} г. (пълни години; молекули с разход над ${eur(growth.floorEur)} и в двете години).`
                : `Change in gross spend by molecule, ${growth.priorYear} → ${growth.year} (full years; molecules above ${eur(growth.floorEur)} in both).`}
            </p>
            <MoverSection
              title={bg ? "Най-бърз ръст" : "Fastest rising"}
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              tone="rose"
              movers={growth.risers}
              lang={lang}
              bg={bg}
            />
            <MoverSection
              title={bg ? "Най-голям спад" : "Fastest falling"}
              icon={<TrendingDown className="h-3.5 w-3.5" />}
              tone="emerald"
              movers={growth.fallers}
              lang={lang}
              bg={bg}
            />
            {growth.newlyReimbursed.length > 0 && (
              <MoverSection
                title={
                  bg ? "Новодобавени в реимбурсацията" : "Newly reimbursed"
                }
                icon={<Sparkles className="h-3.5 w-3.5" />}
                tone="sky"
                movers={growth.newlyReimbursed}
                lang={lang}
                bg={bg}
              />
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {view === "growth" && growth
            ? bg
              ? `Източник: НЗОК „Брутни разходи по INN" за ${growth.priorYear} и ${growth.year} г. Ръстът е между две пълни години, затова не зависи от текущата незавършена година.`
              : `Source: НЗОК "gross reimbursement by INN" for ${growth.priorYear} and ${growth.year}. Growth is between two full years, so it doesn't depend on the current partial year.`
            : bg
              ? `Източник: НЗОК „Брутни разходи за лекарствени продукти по INN". Сумите са брутен разход за ${data.year} г., конвертиран в евро, и се плащат извън обществените поръчки.`
              : `Source: НЗОК "gross drug reimbursement by INN". Figures are gross ${data.year} reimbursement, converted to euro, paid outside public procurement.`}
        </p>
      </CardContent>
    </Card>
  );
};

// One labelled block of movers (risers / fallers / newly-reimbursed). Each row:
// molecule, current-year €, and the YoY delta (or "нов" for a newly-reimbursed
// molecule with no prior-year figure). Rising spend reads rose (watchdog),
// falling emerald; newly-added is a neutral sky highlight.
const MoverSection: FC<{
  title: string;
  icon: React.ReactNode;
  tone: "rose" | "emerald" | "sky";
  movers: NzokDrugMover[];
  lang: string;
  bg: boolean;
}> = ({ title, icon, tone, movers, lang, bg }) => {
  if (movers.length === 0) return null;
  const eur = (v: number) => formatEurCompact(v, lang);
  const toneClass =
    tone === "rose"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "emerald"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-sky-600 dark:text-sky-400";
  return (
    <div className="space-y-1.5">
      <div
        className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide ${toneClass}`}
      >
        {icon}
        {title}
      </div>
      {movers.map((m) => (
        <div
          key={m.inn}
          className="flex items-baseline justify-between gap-2 text-xs"
        >
          <span className="min-w-0 truncate font-medium">
            {m.inn}
            <span className="ml-1 text-muted-foreground/60">{m.atcGroup}</span>
          </span>
          <span className="shrink-0 tabular-nums">
            <span className="text-muted-foreground">{eur(m.eur)}</span>
            <span className={`ml-1.5 font-semibold ${toneClass}`}>
              {m.deltaPct == null
                ? bg
                  ? "нов"
                  : "new"
                : `${m.deltaPct > 0 ? "+" : ""}${(
                    m.deltaPct * 100
                  ).toLocaleString(lang, { maximumFractionDigits: 0 })}%`}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
};
