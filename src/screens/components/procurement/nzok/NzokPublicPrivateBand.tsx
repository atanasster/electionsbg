// "Публични срещу частни болници" — the ЕК-съди-България band on the НЗОК pack.
//
// НЗОК pays private hospitals like the public ones, but Bulgarian law exempts
// private hospitals from ЗОП even when they are >50% publicly funded — which is
// exactly what the European Commission is suing Bulgaria over (Directive
// 2014/24/ЕС). This band makes those numbers a one-glance read:
//   1. a KPI row (private share of НЗОК, % over the 50% threshold, how many run
//      zero tenders, the € flowing outside procurement),
//   2. the 50%-threshold distribution as a unit chart,
//   3. a state/municipal/private comparison table,
//   4. the majority-public-but-no-tenders leaderboard (expandable to all).
//
// One precomputed fetch (useNzokPublicPrivate → public_private.json). Self-hides
// until the blob exists.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Scale,
  Building2,
  Gavel,
  TriangleAlert,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PackSection } from "@/screens/components/procurement/PackSection";
import { formatEurCompact } from "@/lib/currency";
import {
  ownershipLabel,
  ownershipChipClass,
  ownershipColor,
} from "@/lib/nzokOwnership";
import { useNzokPublicPrivate } from "@/data/budget/useBudget";
import type { NzokPublicPrivateHospital } from "@/data/budget/types";

const THRESHOLD_CORAL = "#ef4444"; // red-500 — the "no tenders" attention colour
const pct = (n: number) => `${n}%`;

export const NzokPublicPrivateBand: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const [showAll, setShowAll] = useState(false);
  const { data } = useNzokPublicPrivate();
  if (!data) return null;

  const eur = (v: number | null | undefined) => formatEurCompact(v, locale);
  const s = data.privateStats;
  const own = data.ownership;

  const zeroTenderOver50 = data.hospitals
    .filter(
      (h) => h.nzokShare != null && h.nzokShare > 0.5 && h.tenders3y === 0,
    )
    .sort((a, b) => b.nzokEur - a.nzokEur);
  const visible = showAll ? zeroTenderOver50 : zeroTenderOver50.slice(0, 6);

  // 50%-threshold unit chart segments
  const units: { cls: string; n: number }[] = [
    { cls: "bg-muted-foreground/30", n: s.belowThreshold },
    { cls: "", n: s.over50WithTender }, // amber (private)
    { cls: "coral", n: s.over50NoTender },
  ];

  const T = {
    band: bg
      ? "Частни болници и обществените поръчки"
      : "Private hospitals and public procurement",
    note: "Директива 2014/24/ЕС",
    sub: bg
      ? "НЗОК плаща на частните болници като на държавните. ЕК съди България, защото частни болници с над 50% публично финансиране не провеждат обществени поръчки."
      : "НЗОК pays private hospitals like public ones. The EC is suing Bulgaria because private hospitals with >50% public funding run no public tenders.",
    kPrivate: bg ? "Частни болници · НЗОК" : "Private hospitals · НЗОК",
    kPrivateSub: bg
      ? `${own.private.sharePct}% от парите за болнична помощ · ${own.private.count} заведения`
      : `${own.private.sharePct}% of hospital-care money · ${own.private.count} facilities`,
    kOver: bg ? "Над прага от 50%" : "Above the 50% threshold",
    kOverSub: bg
      ? `от частните болници с данни · медиана ${s.medianSharePct}%`
      : `of private hospitals with data · median ${s.medianSharePct}%`,
    kZero: bg ? "Без обществени поръчки" : "No public tenders",
    kZeroSub: bg
      ? "частни болници с 0 процедури по ЗОП (посл. 3 г.)"
      : "private hospitals with 0 ЗОП procedures (last 3y)",
    kMoney: bg ? "Пари извън конкурс" : "Money outside tender",
    kMoneySub: bg
      ? ">50% публични, но без нито една поръчка (год.)"
      : ">50% public yet zero tenders (annual)",
    thrTitle: bg
      ? "Прагът от 50% публично финансиране"
      : "The 50% public-funding threshold",
    thrLead: bg
      ? `${s.over50} от ${s.withShare} частни болници (с данни за приход) са над прага.`
      : `${s.over50} of ${s.withShare} private hospitals (with revenue data) are above the threshold.`,
    thrCoral: bg
      ? `${s.over50NoTender} от тях не обявяват никакви поръчки.`
      : `${s.over50NoTender} of them run no tenders at all.`,
    legBelow: bg
      ? `Под 50% (${s.belowThreshold})`
      : `Below 50% (${s.belowThreshold})`,
    legTender: bg
      ? `Над 50%, обявяват поръчки (${s.over50WithTender})`
      : `Above 50%, run tenders (${s.over50WithTender})`,
    legNo: bg
      ? `Над 50%, без поръчки (${s.over50NoTender})`
      : `Above 50%, no tenders (${s.over50NoTender})`,
    thrFoot: bg
      ? "Всяко квадратче е една частна болница, подредена по дял публично финансиране (НЗОК ÷ приход по ГФО). Пунктирът е прагът на Директива 2014/24/ЕС."
      : "Each square is one private hospital, ordered by public-funding share (НЗОК ÷ ГФО revenue). The dashes mark the Directive 2014/24/ЕС threshold.",
    cmpTitle: bg ? "Сравнение по собственост" : "By ownership",
    cHospitals: bg ? "Болници" : "Hospitals",
    cNzok: bg ? "НЗОК плащания" : "НЗОК payments",
    cShare: bg ? "Дял от НЗОК" : "Share of НЗОК",
    cMedian: bg ? "Мед. публично фин." : "Median public funding",
    cData: bg ? "Фин. данни" : "Financial data",
    eeof: bg ? "ЕЕОФ ¼" : "ЕЕОФ ¼",
    gfo: bg ? "ГФО год." : "ГФО yr.",
    cmpFoot: bg
      ? "Държавните/общинските подават ЕЕОФ към МЗ (тримесечно); за частните ползваме годишните ГФО от Търговския регистър."
      : "State/municipal file ЕЕОФ to МЗ (quarterly); for private ones we use annual ГФО from the Commerce Register.",
    lbTitle: bg
      ? "Над 50% публични, без нито една поръчка"
      : "Over 50% public, zero tenders",
    noTenders: bg ? "0 поръчки" : "0 tenders",
    publicWord: bg ? "публично" : "public",
    seeAll: bg
      ? `Виж всички ${zeroTenderOver50.length} →`
      : `See all ${zeroTenderOver50.length} →`,
    collapse: bg ? "Свий" : "Collapse",
    foot: bg
      ? "Източници: НЗОК (плащания по лечебно заведение) · Търговски регистър (ГФО) · корпус на обществените поръчки · собственост от МЗ ЕЕОФ."
      : "Sources: НЗОК payments · Commerce Register (ГФО) · procurement corpus · МЗ ЕЕОФ ownership.",
  };

  return (
    <PackSection
      id="nzok-public-private"
      icon={Scale}
      title={T.band}
      sub={T.sub}
      note={
        <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
          {T.note}
        </span>
      }
    >
      {/* 1. KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={
            <>
              <Building2 className="h-3.5 w-3.5" /> {T.kPrivate}
            </>
          }
        >
          <div className="text-2xl font-bold tabular-nums">
            {eur(own.private.nzokEur)}
          </div>
          <div className="mt-auto text-xs text-muted-foreground">
            {T.kPrivateSub}
          </div>
        </StatCard>
        <StatCard
          label={
            <>
              <Scale className="h-3.5 w-3.5" /> {T.kOver}
            </>
          }
        >
          <div className="text-2xl font-bold tabular-nums">
            {pct(s.over50Pct)}
          </div>
          <div className="mt-auto text-xs text-muted-foreground">
            {T.kOverSub}
          </div>
        </StatCard>
        <StatCard
          label={
            <>
              <Gavel className="h-3.5 w-3.5" /> {T.kZero}
            </>
          }
        >
          <div className="text-2xl font-bold tabular-nums">
            {s.zeroTender}
            <span className="text-base font-semibold text-muted-foreground">
              /{s.total}
            </span>
          </div>
          <div className="mt-auto text-xs text-muted-foreground">
            {T.kZeroSub}
          </div>
        </StatCard>
        <StatCard
          className="border-primary/50 bg-primary/[0.04]"
          label={
            <span className="flex items-center gap-1.5 text-primary">
              <TriangleAlert className="h-3.5 w-3.5" /> {T.kMoney}
            </span>
          }
        >
          <div className="text-2xl font-bold tabular-nums text-primary">
            {eur(s.over50NoTenderAnnualEur)}
          </div>
          <div className="mt-auto text-xs text-muted-foreground">
            {T.kMoneySub}
          </div>
        </StatCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {/* 2. 50% threshold unit chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-[15px] w-[15px] text-muted-foreground" />
              {T.thrTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 md:p-4">
            <p className="text-sm leading-snug">
              <span className="text-2xl font-bold tabular-nums">
                {s.over50}
              </span>{" "}
              <span className="text-muted-foreground">{T.thrLead}</span>{" "}
              <span
                className="font-semibold"
                style={{ color: THRESHOLD_CORAL }}
              >
                {T.thrCoral}
              </span>
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <span>{bg ? "под 50%" : "below 50%"}</span>
              <span className="h-px flex-1 border-t border-dashed border-primary/40" />
              <span>{bg ? "над 50% →" : "above 50% →"}</span>
            </div>
            <div className="flex flex-wrap gap-[3px]">
              {units.map((seg, si) =>
                Array.from({ length: seg.n }).map((_, i) => (
                  <span
                    key={`${si}-${i}`}
                    className={`h-3 w-3 rounded-[3px] ${seg.cls}`}
                    style={
                      si === 1
                        ? { background: ownershipColor("private") }
                        : si === 2
                          ? { background: THRESHOLD_CORAL }
                          : undefined
                    }
                  />
                )),
              )}
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-muted-foreground/30" />
                {T.legBelow}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-[3px]"
                  style={{ background: ownershipColor("private") }}
                />
                {T.legTender}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-[3px]"
                  style={{ background: THRESHOLD_CORAL }}
                />
                {T.legNo}
              </span>
            </div>
            <p className="border-t border-border/60 pt-2.5 text-[11px] leading-snug text-muted-foreground/80">
              {T.thrFoot}
            </p>
          </CardContent>
        </Card>

        {/* 3. ownership comparison table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Table2 className="h-[15px] w-[15px] text-muted-foreground" />
              {T.cmpTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 md:p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-2 text-left font-semibold"></th>
                    {(["state", "municipal", "private"] as const).map((o) => (
                      <th
                        key={o}
                        className="py-2 pl-2 text-right font-semibold"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-[3px]"
                            style={{ background: ownershipColor(o) }}
                          />
                          {ownershipLabel(o, bg)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label={T.cHospitals}>
                    {[own.state.count, own.municipal.count, own.private.count]}
                  </Row>
                  <Row label={T.cNzok} hiLast>
                    {[
                      eur(own.state.nzokEur),
                      eur(own.municipal.nzokEur),
                      eur(own.private.nzokEur),
                    ]}
                  </Row>
                  <Row label={T.cShare} hiLast>
                    {[
                      pct(own.state.sharePct),
                      pct(own.municipal.sharePct),
                      pct(own.private.sharePct),
                    ]}
                  </Row>
                  <Row label={T.cMedian} hiLast>
                    {["—", "—", pct(s.medianSharePct)]}
                  </Row>
                  <Row label={T.cData}>{[T.eeof, T.eeof, T.gfo]}</Row>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground/80">
              {T.cmpFoot}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 4. zero-tender leaderboard */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-[15px] w-[15px] text-muted-foreground" />
            {T.lbTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-col">
            {visible.map((h) => (
              <LeaderRow
                key={h.eik}
                h={h}
                locale={locale}
                noTenders={T.noTenders}
                publicWord={T.publicWord}
              />
            ))}
          </div>
          {zeroTenderOver50.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 flex w-full items-center justify-between rounded-lg border border-border bg-muted/[0.06] px-4 py-2.5 text-sm font-semibold transition-colors hover:border-primary/50"
            >
              <span className="text-muted-foreground">
                {bg
                  ? "Приход, дял НЗОК и брой поръчки на всяка болница"
                  : "Revenue, НЗОК share and tenders per hospital"}
              </span>
              <span className="text-primary">
                {showAll ? T.collapse : T.seeAll}
              </span>
            </button>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground/70">{T.foot}</p>
    </PackSection>
  );
};

const Row: FC<{
  label: string;
  hiLast?: boolean;
  children: React.ReactNode[];
}> = ({ label, hiLast, children }) => (
  <tr className="border-b border-border/60">
    <td className="py-2 pr-2 text-left font-medium text-muted-foreground">
      {label}
    </td>
    {children.map((c, i) => (
      <td
        key={i}
        className={`py-2 pl-2 text-right ${
          hiLast && i === children.length - 1 ? "font-bold text-primary" : ""
        }`}
      >
        {c}
      </td>
    ))}
  </tr>
);

const LeaderRow: FC<{
  h: NzokPublicPrivateHospital;
  locale: string;
  noTenders: string;
  publicWord: string;
}> = ({ h, locale, noTenders, publicWord }) => {
  const share = Math.round((h.nzokShare ?? 0) * 100);
  const ini = h.name
    .replace(/^(МБАЛ|УМБАЛ|СБАЛ|СБР|МЦ|ДКЦ|СХБАЛ)[\s-„"]*/i, "")
    .trim()
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <span
        className={`grid h-8 w-8 flex-none place-items-center rounded-md border text-[11px] font-bold ${ownershipChipClass(
          "private",
        )}`}
      >
        {ini}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to={`/company/${h.eik}`}
          className="text-sm font-semibold hover:text-primary"
        >
          {h.name}
        </Link>
      </div>
      <div className="w-28 flex-none">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted-foreground/20">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, share)}%`,
              background: ownershipColor("private"),
            }}
          />
        </div>
        <div className="mt-1 text-right text-[11px] text-muted-foreground">
          {share}% {publicWord}
        </div>
      </div>
      <div className="w-20 flex-none text-right text-sm font-semibold tabular-nums">
        {formatEurCompact(h.nzokEur, locale)}
      </div>
      <span
        className="flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
        style={{
          color: THRESHOLD_CORAL,
          borderColor: `${THRESHOLD_CORAL}55`,
          background: `${THRESHOLD_CORAL}1a`,
        }}
      >
        {noTenders}
      </span>
    </div>
  );
};
