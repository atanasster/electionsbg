// "Учебникарският пазар" — textbook-publisher market concentration. The pack's
// standout: it reads the €51M textbook procurement slice (CPV 22112) and shows
// who dominates — an HHI gauge with DOJ threshold bands, the top-2/CR-4 ratios,
// per-publisher-group share bars (Просвета's 3 EIKs and Klett's Анубис+Булвест
// merge rolled up), and the buyer split (schools, not МОН, buy the books).
//
// FRAMING: textbooks are awarded under чл.79 direct award to the copyright
// holder, so every contract is single-bidder by law — the tile says so, and the
// site-wide single-bid red flag is not applied here. The signal is market share.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Library } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  publisherGroupLabel,
  hhiBandLabel,
  hhiBand,
  HHI_BAND_COLOR,
} from "@/lib/textbookPublishers";
import type { TextbookMarketFile } from "@/data/education/useTextbookMarket";

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

export const TextbookConcentrationTile: FC<{ market: TextbookMarketFile }> = ({
  market,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const { concentration: c, total, groups } = market;
  const band = hhiBand(c.hhiGroup);
  // Peak spend year, derived from the payload (not hardcoded) so a corpus
  // refresh that shifts the peak can't leave a stale figure in the caption.
  const peak = market.byYear.length
    ? market.byYear.reduce((a, b) => (b.eur > a.eur ? b : a), market.byYear[0])
    : null;
  // 2024 was the first year of free textbooks for grades 1–12 — a standing fact
  // about the spend, shown whenever the corpus covers 2024, independent of which
  // year happens to be the peak (so it doesn't blink out if the peak moves).
  const covers2024 = market.byYear.some((b) => b.year === 2024);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Library className="h-5 w-5 text-muted-foreground" />
          {bg ? "Учебникарският пазар" : "The textbook market"}
        </CardTitle>
      </CardHeader>
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
                  ? `пазар · ${total.schoolBuyers} училища`
                  : `market · ${total.schoolBuyers} schools`
              }
            />
          </div>
        </div>

        {/* Publisher-group share bars */}
        <div className="space-y-1.5">
          {groups
            .filter((g) => g.pct >= 0.4)
            .map((g) => (
              <div key={g.id} className="flex items-center gap-2 text-sm">
                <div
                  className="w-40 shrink-0 truncate"
                  title={publisherGroupLabel(g.id, lang)}
                >
                  {publisherGroupLabel(g.id, lang)}
                </div>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                  <div
                    className={`h-full ${GROUP_COLOR[g.id] ?? "bg-muted-foreground/40"}`}
                    style={{ width: `${Math.max(1, g.pct)}%` }}
                  />
                </div>
                <div className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                  {eur(g.eur)} · {g.pct}%
                </div>
              </div>
            ))}
        </div>

        {/* Buyer split */}
        <div className="flex flex-wrap gap-2 text-xs">
          {market.byBuyerType.map((b) => (
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
            ? "Учебниците се възлагат пряко на притежателя на авторските права (чл. 79, ал. 1, т. 3 ЗОП) — всеки договор е с една оферта по закон. Затова тук не показваме „червен флаг за една оферта“: концентрацията се вижда в пазарния дял на издателите, не в самата процедура. Дистрибуторите препродават учебници на различни издатели, така че реалната концентрация при издателите е дори по-висока от показаната."
            : "Textbooks are awarded directly to the copyright holder (art. 79 ЗОП) — every contract is single-bidder by law. We therefore do not apply the single-bid red flag here: the concentration shows in publishers' market share, not in the procedure. Distributors resell titles from many publishers, so the real publisher concentration is even higher than shown."}
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
