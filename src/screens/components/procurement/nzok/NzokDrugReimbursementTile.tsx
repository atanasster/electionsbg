// "Лекарства по реимбурсна сума" — the drugs НЗОК pays most for. Drug
// reimbursement (~€1.33bn/yr) is НЗОК's second-largest budget line and, like
// hospital payments, is paid OUTSIDE public procurement. This tile ranks the
// top INN (active substances) and lets the reader flip to the ATC therapeutic
// area — where oncology's dominance jumps out. Pure from NzokDrugReimbursementFile.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pill } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { NzokDrugReimbursementFile } from "@/data/budget/types";

const TOP_N = 12;

export const NzokDrugReimbursementTile: FC<{
  data: NzokDrugReimbursementFile;
}> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const [view, setView] = useState<"inn" | "atc">("inn");

  const total = data.totalEur;
  if (total <= 0 || !data.top.length) return null;

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
  const max = Math.max(...rows.map((r) => r.value));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Pill className="h-4 w-4" />
            {bg ? "Лекарства по реимбурсна сума" : "Drugs by reimbursement"}
          </CardTitle>
          <div
            className="flex gap-1"
            role="group"
            aria-label={bg ? "Изглед" : "View"}
          >
            {(["inn", "atc"] as const).map((v) => (
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
                  : bg
                    ? "Група"
                    : "Area"}
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
              ? `реимбурсна сума за лекарства (${data.year}) · ${data.distinctInn} молекули`
              : `drug reimbursement (${data.year}) · ${data.distinctInn} substances`}
          </span>
        </div>
        {oncoShare > 0 && (
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

        {/* Ranked list */}
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
                    style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
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

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Източник: НЗОК „Брутни разходи за лекарствени продукти по INN". Сумите са брутен разход за ${data.year} г., конвертиран в евро, и се плащат извън обществените поръчки.`
            : `Source: НЗОК "gross drug reimbursement by INN". Figures are gross ${data.year} reimbursement, converted to euro, paid outside public procurement.`}
        </p>
      </CardContent>
    </Card>
  );
};
