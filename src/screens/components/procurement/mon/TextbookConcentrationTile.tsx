// "Учебникарският пазар" — textbook-publisher market concentration + the
// by-provider risk read, merged into one tile. It reads the €51M textbook
// procurement slice (CPV 22112) and shows who dominates: an HHI gauge with DOJ
// threshold bands, the top-2/CR-4 ratios, and a per-publisher-group table that
// doubles as the concentration bars AND the provider drill-down — each group
// ranked by its contribution to the HHI (its share², the points it adds to the
// index), expandable to its legal entities with a standalone /company/:eik link
// apiece, and the buyer split (schools, not МОН, buy the books).
//
// FRAMING: textbooks are awarded under чл.79 direct award to the copyright
// holder, so every contract is single-bidder by law — the tile says so, and the
// site-wide single-bid red flag is not applied here. High share is market power,
// not a procedure irregularity; the signal is market share.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Library, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  publisherGroupLabel,
  hhiBandLabel,
  hhiBand,
  HHI_BAND_COLOR,
} from "@/lib/textbookPublishers";
import type {
  TextbookMarketFile,
  TextbookMarketSlice,
} from "@/data/education/useTextbookMarket";

// Share-bar colour: the two dominant groups get strong hues, distributors a
// neutral tone (they resell mixed publishers), the tail fades out.
const GROUP_COLOR: Record<string, string> = {
  klett: "bg-sky-500",
  prosveta: "bg-primary",
  distributor: "bg-muted-foreground/40",
  arhimed: "bg-violet-500",
  pedagog6: "bg-amber-500",
  domino: "bg-emerald-500",
  bit: "bg-teal-500",
  riva: "bg-rose-400",
  kolibri: "bg-indigo-400",
  other: "bg-muted-foreground/30",
};

const BUYER_LABEL: Record<string, { bg: string; en: string }> = {
  school: { bg: "Училища", en: "Schools" },
  municipality: { bg: "Общини", en: "Municipalities" },
  ministry: { bg: "Министерства", en: "Ministries" },
  other: { bg: "Други", en: "Other" },
};

export const TextbookConcentrationTile: FC<{
  market: TextbookMarketFile;
  /** Drop the card's own title when the pack band already names it. */
  hideTitle?: boolean;
  /** When set, show that calendar year's slice instead of the full corpus —
   *  the tile's response to the host's "Години" scope pill. */
  year?: number | null;
}> = ({ market, hideTitle, year }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Scope the whole view to the selected calendar year when one is asked for and
  // the market has spend that year; otherwise the full corpus. A year with no
  // textbook spend (e.g. pre-2022) renders a notice rather than a NaN gauge.
  const yearSlice = year != null ? market.yearly?.[String(year)] : undefined;
  const view: TextbookMarketSlice = yearSlice ?? market;
  const yearsWithSpend = market.byYear
    .filter((b) => b.eur > 0)
    .map((b) => b.year);
  const corpusPeriod = yearsWithSpend.length
    ? `${Math.min(...yearsWithSpend)}–${Math.max(...yearsWithSpend)}`
    : "";
  const periodLabel = year != null ? String(year) : corpusPeriod;

  const { concentration: c, total } = view;
  // Rank groups by market share (= descending €), the order the HHI is driven
  // by. The payload is already sorted this way; sort defensively so a future
  // payload change can't silently reorder the concentration reading.
  const groups = [...view.groups].sort((a, b) => b.eur - a.eur);
  const maxPct = groups[0]?.pct || 1;
  // Each group's contribution to the market HHI is its share² — the points it
  // adds to the concentration index the gauge headlines. Compute the share from
  // the raw euros (not the already-rounded `g.pct`) so the column sums to the
  // same rounding the gauge's `hhiGroup` uses — otherwise squaring a rounded
  // share drifts a few points from the headline the column claims to explain.
  const hhiPoints = (eurValue: number) =>
    total.eur > 0 ? Math.round(Math.pow((100 * eurValue) / total.eur, 2)) : 0;
  const band = hhiBand(c.hhiGroup);
  // Peak/2024 captions describe the WHOLE corpus, so only show them on the
  // full-corpus view — under a single-year scope they'd be non-sequiturs.
  const peak =
    year == null && market.byYear.length
      ? market.byYear.reduce(
          (a, b) => (b.eur > a.eur ? b : a),
          market.byYear[0],
        )
      : null;
  const covers2024 = year == null && market.byYear.some((b) => b.year === 2024);

  // Asked for a year the market has no spend in — say so plainly.
  if (year != null && !yearSlice) {
    return (
      <Card>
        {!hideTitle && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Library className="h-5 w-5 text-muted-foreground" />
              {bg ? "Учебникарският пазар" : "The textbook market"}
            </CardTitle>
          </CardHeader>
        )}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {bg
              ? `Няма възложени учебници по ЗОП през ${year} г. (данните покриват ${corpusPeriod}). Изберете друга година или „Всички години“.`
              : `No textbooks awarded via procurement in ${year} (data covers ${corpusPeriod}). Pick another year or "All years".`}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {!hideTitle && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Library className="h-5 w-5 text-muted-foreground" />
            {bg ? "Учебникарският пазар" : "The textbook market"}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-5">
        {/* Headline: HHI gauge + the duopoly ratio */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <div className="text-xs text-muted-foreground">
              {bg ? "Концентрация (HHI)" : "Concentration (HHI)"}
            </div>
            <div
              className={`text-3xl font-bold tabular-nums ${HHI_BAND_COLOR[band]}`}
            >
              {c.hhiGroup.toLocaleString("bg-BG")}
            </div>
            <div className={`text-xs font-medium ${HHI_BAND_COLOR[band]}`}>
              {hhiBandLabel(c.hhiGroup, lang)}
            </div>
            {/* Threshold scale, positioned LINEARLY over 0–10,000 so the marker
                and the DOJ band labels (1500 / 2500) agree with the number. */}
            <div className="relative mt-2 h-2 w-full rounded-full bg-gradient-to-r from-emerald-500/60 via-amber-500/60 to-rose-500/70">
              <span
                className="absolute -top-0.5 block h-3 w-1 -translate-x-1/2 rounded bg-foreground"
                style={{
                  left: `${Math.min(100, (c.hhiGroup / 10000) * 100)}%`,
                }}
              />
            </div>
            <div className="relative mt-1 h-3 text-[10px] text-muted-foreground/70">
              <span className="absolute left-0">0</span>
              <span
                className="absolute -translate-x-1/2"
                style={{ left: "15%" }}
              >
                1500
              </span>
              <span
                className="absolute -translate-x-1/2"
                style={{ left: "25%" }}
              >
                2500
              </span>
              <span className="absolute right-0">10k</span>
            </div>
          </div>
          <div className="sm:col-span-2 grid grid-cols-3 gap-3 self-center">
            <Stat
              value={`${c.top2Pct}%`}
              label={bg ? "топ 2 групи" : "top 2 groups"}
            />
            <Stat
              value={`${c.cr4Pct}%`}
              label={bg ? "топ 4 (CR4)" : "top 4 (CR4)"}
            />
            <Stat
              value={eur(total.eur)}
              label={
                bg
                  ? `${periodLabel} · ${total.schoolBuyers} училища`
                  : `${periodLabel} · ${total.schoolBuyers} schools`
              }
            />
          </div>
        </div>

        {/* Publisher-group table — the concentration bars AND the provider
            drill-down in one. Groups ranked by share; "Принос HHI" = share²
            (points added to the index above); each row expands to its legal
            entities, every one linking to its own /company/:eik page. */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {bg
              ? `Издателските групи, подредени по пазарен дял (${year != null ? `${year} г.` : `общо ${periodLabel}`}). „Принос HHI“ е делът на квадрат — точките, които групата добавя към индекса по-горе. Разгънете ред, за да видите юридическите лица и да отворите страницата на всяко.`
              : `Publisher groups ranked by market share (${year != null ? year : `${periodLabel} total`}). “HHI points” is the group's share² — the points it adds to the index above. Expand a row for its legal entities and open each provider's own page.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-2 text-left font-normal">
                    {bg ? "Доставчик (група)" : "Provider (group)"}
                  </th>
                  <th
                    className="py-1.5 pr-2 text-right font-normal"
                    title={
                      bg
                        ? year != null
                          ? `Оборот за ${year} г.`
                          : `Общо за периода ${periodLabel}`
                        : undefined
                    }
                  >
                    {bg ? (year != null ? "Оборот" : "Общо") : "Spend"}
                  </th>
                  <th className="py-1.5 pr-2 text-right font-normal">
                    {bg ? "Дял" : "Share"}
                  </th>
                  <th
                    className="py-1.5 text-right font-normal"
                    title={
                      bg
                        ? "Принос към индекса на концентрация (HHI) = дял²"
                        : "Contribution to the concentration index (HHI) = share²"
                    }
                  >
                    {bg ? "Принос HHI" : "HHI points"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {groups.map((g) => {
                  const isOpen = open[g.id];
                  const isDistributor = g.id === "distributor";
                  const linkable = g.entities.filter((e) => e.eik);
                  return [
                    <tr
                      key={g.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))
                      }
                    >
                      <td className="py-1.5 pr-2">
                        <span className="flex items-center gap-1 font-medium">
                          <ChevronRight
                            className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                              isOpen ? "rotate-90" : ""
                            }`}
                          />
                          <span
                            className={`inline-block h-2 w-2 shrink-0 rounded-full ${GROUP_COLOR[g.id] ?? "bg-muted-foreground/40"}`}
                            aria-hidden
                          />
                          <span className="truncate">
                            {publisherGroupLabel(g.id, lang)}
                          </span>
                          {isDistributor && (
                            <span className="ml-1 shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase text-amber-700 dark:text-amber-400">
                              {bg ? "препродажба" : "resale"}
                            </span>
                          )}
                        </span>
                        <span className="ml-4 block text-[10px] text-muted-foreground">
                          {bg
                            ? `${g.entityCount} ${g.entityCount === 1 ? "фирма" : "фирми"} · ${g.contracts} договора`
                            : `${g.entityCount} ${g.entityCount === 1 ? "company" : "companies"} · ${g.contracts} contracts`}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                        {eur(g.eur)}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span
                            className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:inline-block"
                            aria-hidden
                          >
                            <span
                              className={`block h-full rounded-full ${GROUP_COLOR[g.id] ?? "bg-muted-foreground/40"}`}
                              style={{
                                width: `${Math.max(3, (g.pct / maxPct) * 100)}%`,
                              }}
                            />
                          </span>
                          <span className="w-10 tabular-nums font-medium">
                            {g.pct}%
                          </span>
                        </div>
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {hhiPoints(g.eur).toLocaleString(
                          bg ? "bg-BG" : "en-US",
                        )}
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${g.id}-ents`} className="bg-muted/20">
                        <td colSpan={4} className="px-2 py-1.5">
                          {linkable.length === 0 && g.entities.length > 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              {bg
                                ? "Без разпознат ЕИК за отделна страница."
                                : "No matched EIK for a standalone page."}
                            </p>
                          )}
                          <ul className="space-y-1">
                            {g.entities.map((e, i) => (
                              <li
                                key={`${e.eik ?? "x"}-${i}`}
                                className="flex items-center justify-between gap-2 text-[11px]"
                              >
                                {e.eik ? (
                                  <Link
                                    to={`/company/${e.eik}`}
                                    className="min-w-0 flex-1 truncate text-accent hover:underline"
                                    onClick={(ev) => ev.stopPropagation()}
                                  >
                                    {decodeEntities(e.name)}
                                  </Link>
                                ) : (
                                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                    {decodeEntities(e.name)}
                                  </span>
                                )}
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {eur(e.eur)}
                                </span>
                              </li>
                            ))}
                            {/* The tail beyond the top 6 as one row, so the
                                expanded list reconciles to the group total. */}
                            {g.entityCount > g.entities.length && (
                              <li className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground/80">
                                <span className="min-w-0 flex-1 truncate italic">
                                  {bg
                                    ? `+ още ${g.entityCount - g.entities.length} фирми`
                                    : `+ ${g.entityCount - g.entities.length} more companies`}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {eur(g.restEur)}
                                </span>
                              </li>
                            )}
                          </ul>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Buyer split */}
        <div className="flex flex-wrap gap-2 text-xs">
          {view.byBuyerType.map((b) => (
            <span
              key={b.type}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1"
            >
              <span className="font-medium">
                {bg ? BUYER_LABEL[b.type]?.bg : BUYER_LABEL[b.type]?.en}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {eur(b.eur)} · {b.buyers}
              </span>
            </span>
          ))}
        </div>

        {/* Framing caveat — the legal basis, so direct award isn't misread */}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          {bg
            ? "Учебниците се възлагат пряко на притежателя на авторските права (чл. 79, ал. 1, т. 3 ЗОП) — всеки договор е с една оферта по закон. Затова тук не показваме „червен флаг за една оферта“: висок дял означава пазарна сила, не нередност в процедурата. Дистрибуторите препродават учебници на различни издатели, така че редът им е сигнал за надценка/препродажба, а реалната концентрация при издателите е дори по-висока от показаната."
            : "Textbooks are awarded directly to the copyright holder (art. 79 ЗОП) — every contract is single-bidder by law. We therefore do not apply the single-bid red flag here: high share is market power, not a procedure irregularity. Distributors resell titles from many publishers, so their row is a markup/resale signal and the real publisher concentration is even higher than shown."}
          {peak && (
            <>
              {" "}
              {bg
                ? `Пик през ${peak.year} г. (${eur(peak.eur)}).`
                : `Peaked in ${peak.year} (${eur(peak.eur)}).`}
            </>
          )}
          {covers2024 && (
            <>
              {" "}
              {bg
                ? "От 2024 г. учебниците за 1–12 клас са безплатни — оттам и по-високите разходи в последните години."
                : "Since 2024 textbooks for grades 1–12 are free — hence the elevated spend in recent years."}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const Stat: FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className="rounded-lg border bg-card p-2 text-center">
    <div className="text-lg font-bold tabular-nums">{value}</div>
    <div className="text-[11px] text-muted-foreground">{label}</div>
  </div>
);
