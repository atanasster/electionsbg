// „Поскъпна ли храната заради еврото?" — Croatia's Kretanje-cijena four-bucket
// classification against euro day (2026-01-02), the headline feature of the
// consumption view (design §9.1.2).
//
// FIVE buckets, not four. `no_baseline` (нови след еврото) are products with no
// observation on euro day — 43% of the catalogue. They are neither "unchanged"
// nor droppable: hiding them would understate the denominator, and folding them
// into "unchanged" would fabricate a result. The buckets sum to 100% of the
// priced universe, and the tile says what the fifth one is.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useEuroVerdict } from "@/data/prices/useProducts";
import { EURO_ADOPTION } from "@/data/prices/euroBaseline";

const fmtN = (n: number, lang: string) =>
  n.toLocaleString(lang === "bg" ? "bg-BG" : "en-US");

export const EuroVerdictTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { data } = useEuroVerdict();
  if (!data) return null;

  const cheaper = Number(data.cheaper);
  const dearer = Number(data.dearer);
  const unchanged = Number(data.unchanged);
  const noBase = Number(data.no_baseline);
  // The comparable universe excludes products with no euro-day baseline.
  const cmp = cheaper + dearer + unchanged || 1;

  // Largest-remainder rounding so the three legend percentages sum to exactly
  // 100 (independent .toFixed(0) can read 33/33/33=99 or 34/33/34=101).
  const pcts = ((): number[] => {
    const raw = [cheaper, unchanged, dearer].map((n) => (n / cmp) * 100);
    const floors = raw.map(Math.floor);
    let rem = 100 - floors.reduce((s, v) => s + v, 0);
    const order = raw
      .map((v, i) => ({ i, frac: v - floors[i] }))
      .sort((a, b) => b.frac - a.frac);
    const out = [...floors];
    for (const { i } of order) {
      if (rem <= 0) break;
      out[i] += 1;
      rem -= 1;
    }
    return out;
  })();

  const bars = [
    {
      n: cheaper,
      pct: pcts[0],
      cls: "bg-green-500 dark:bg-green-600",
      label: T("поевтиняха", "cheaper"),
    },
    {
      n: unchanged,
      pct: pcts[1],
      cls: "bg-slate-400 dark:bg-slate-500",
      label: T("без промяна", "unchanged"),
    },
    {
      n: dearer,
      pct: pcts[2],
      cls: "bg-red-500 dark:bg-red-600",
      label: T("поскъпнаха", "dearer"),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground max-w-2xl">
        {T(
          `От ${fmtN(cmp, lang)} продукта, следени и преди, и сега`,
          `Of ${fmtN(cmp, lang)} products tracked both before and now`,
        )}
        :
      </p>

      <div className="flex h-6 w-full overflow-hidden rounded">
        {bars.map((b) => (
          <div
            key={b.label}
            className={b.cls}
            // Widths use the same largest-remainder `pct` as the legend, so a
            // segment's visible width never disagrees with its printed % by 1pp.
            style={{ width: `${b.pct}%` }}
            title={`${b.label}: ${fmtN(b.n, lang)}`}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {bars.map((b) => (
          <div key={b.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${b.cls}`} />
            <span className="tabular-nums font-medium">{b.pct}%</span>
            <span className="text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground max-w-2xl">
        {T(
          `Още ${fmtN(noBase, lang)} продукта се появиха на рафтовете след ${EURO_ADOPTION.bg} и нямат база за сравнение. Мониторингов индекс на КЗП, не официален ИПЦ — ЕЦБ оценява ефекта от еврото на 0,3–0,4 процентни пункта.`,
          `Another ${fmtN(noBase, lang)} products appeared after ${EURO_ADOPTION.en} and have no baseline to compare against. CPC monitoring data, not official CPI — the ECB estimates the euro's one-off effect at 0.3–0.4pp.`,
        )}
      </p>

      <Link
        to="/consumption/products"
        className="inline-block text-sm text-primary hover:underline"
      >
        {T("Разгледай всички продукти", "Browse all products")} →
      </Link>
    </div>
  );
};
