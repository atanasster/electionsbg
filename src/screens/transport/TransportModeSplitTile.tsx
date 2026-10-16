// "Къде отиват парите за транспорт — по вид" — the sector's ЗОП spend by MODE
// (railways, maritime & ports, aviation, road transport & safety, ministry), on
// /sector/transport/procurement#modes.
//
// TWO SPLITS, SIDE BY SIDE (D8). The bars are the RE-ATTRIBUTED split: the
// ministry awards the rail public-service contracts (CPV 6021*) and the rolling
// stock (346*) centrally, so a split by AWARDER shows МТС as a €2.4bn spender in
// its own right and rail at 57% when it is 89%. The by-awarder figure stays
// beside every bar so the reader sees both and the rule that moves one into the
// other. Σ of either split is the same total — money only moves between modes.
//
// ⚠️ NO CLAIM ABOUT WHERE THE MINISTRY'S MONEY GOES. The pack's old footnote said
// the PSO money „stays inside the group"; measured, only 40% of the ministry's €
// went to a member (A9). The in-group figure is derived on #contractors.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrainFront } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { isBg } from "@/i18n";
import {
  TRANSPORT_UNIVERSES,
  transportUniverseLabel,
  type TransportUniverse,
} from "@/lib/transportReferenceData";

// Fixed colour per mode (colour follows the entity, not its rank).
const MODE_COLOR: Record<TransportUniverse, string> = {
  ministry: "bg-slate-500",
  rail: "bg-primary",
  maritime: "bg-cyan-600",
  aviation: "bg-sky-500",
  road: "bg-amber-500",
};

export interface ModeRow {
  universe: TransportUniverse;
  /** Re-attributed € (D8). */
  eur: number;
  /** By-awarder € — what the mode's own bodies awarded. */
  rawEur: number;
}

export const TransportModeSplitTile: FC<{ modes: ModeRow[] }> = ({ modes }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const loc = bg ? "bg-BG" : "en-US";

  const { rows, total } = useMemo(() => {
    const by = new Map(modes.map((m) => [m.universe, m]));
    const rows = TRANSPORT_UNIVERSES.map((u) => by.get(u)).filter(
      (m): m is ModeRow => !!m && (m.eur > 0 || m.rawEur > 0),
    );
    return { rows, total: rows.reduce((a, m) => a + m.eur, 0) };
  }, [modes]);

  if (rows.length < 2 || total <= 0) return null;
  const max = Math.max(...rows.map((m) => Math.max(m.eur, 0)), 1);
  const pct = (v: number) =>
    `${((v / total) * 100).toLocaleString(loc, { maximumFractionDigits: 0 })}%`;
  const rail = rows.find((m) => m.universe === "rail");
  const moved = rail ? rail.eur - rail.rawEur : 0;
  const maritime = rows.find((m) => m.universe === "maritime");
  const maritimeMoved = maritime ? maritime.eur - maritime.rawEur : 0;
  const ministryLeft = rows.find((m) => m.universe === "ministry")?.eur ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrainFront className="h-4 w-4" />
          {bg
            ? "Къде отиват парите за транспорт — по вид"
            : "Where transport money goes — by mode"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2.5">
        {rows.map((m) => (
          <div key={m.universe} className="text-xs">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="font-medium">
                {transportUniverseLabel(m.universe, lang)}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatEurCompact(m.eur, lang)}
                <span className="ml-1 text-muted-foreground/70">
                  {pct(m.eur)}
                </span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${MODE_COLOR[m.universe]}`}
                style={{
                  width: `${Math.max(2, (Math.max(m.eur, 0) / max) * 100)}%`,
                }}
              />
            </div>
            {m.rawEur !== m.eur ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {bg
                  ? `по възложител: ${formatEurCompact(m.rawEur, lang)} (${pct(m.rawEur)})`
                  : `by awarder: ${formatEurCompact(m.rawEur, lang)} (${pct(m.rawEur)})`}
              </div>
            ) : null}
          </div>
        ))}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {moved > 0
            ? bg
              ? `Договорите на министерството за обществена услуга в железопътния транспорт (CPV 6021) и за подвижен състав (CPV 346) — ${formatEurCompact(moved, lang)} — са отнесени към железниците: МТС ги възлага централно, но купува жп превози и влакове. Ред „по възложител“ показва разпределението преди това.`
              : `The ministry's rail public-service contracts (CPV 6021) and rolling-stock orders (CPV 346) — ${formatEurCompact(moved, lang)} — are counted as rail: МТС awards them centrally, but they buy rail services and trains. The "by awarder" line shows the split before that.`
            : bg
              ? maritimeMoved > 0
                ? "В избрания период министерството няма договори за жп превози или подвижен състав."
                : "В избрания период министерството няма договори за жп превози или подвижен състав, затова двете разпределения съвпадат."
              : maritimeMoved > 0
                ? "In the selected window the ministry has no rail-service or rolling-stock contracts."
                : "In the selected window the ministry has no rail-service or rolling-stock contracts, so the two splits coincide."}{" "}
          {/* Only when THIS window holds such rows (review FINDING-006). */}
          {maritimeMoved > 0
            ? bg
              ? `Драгирането на Дунав и корабите за маркиране и изследвания, които министерството купува (${formatEurCompact(maritimeMoved, lang)}), са към „Море, пристанища и Дунав“. `
              : `The Danube dredging and the marker and survey boats the ministry buys (${formatEurCompact(maritimeMoved, lang)}) are counted under maritime. `
            : null}
          {ministryLeft > 0
            ? bg
              ? "Останалото в реда на министерството са главно информационни системи, кампании и издръжка на сградите — част от тях е „съобщения“, но няма чисто правило по CPV, по което да се отделят. "
              : "The rest of the ministry row is mainly IT systems, campaigns and building upkeep — some of it communications, but with no clean CPV rule to separate it. "
            : null}
          {bg
            ? "Пътната инфраструктура (АПИ) е отделен сектор и не е включена."
            : "Road infrastructure (АПИ) is a separate sector and is not included."}
        </p>
      </CardContent>
    </Card>
  );
};
