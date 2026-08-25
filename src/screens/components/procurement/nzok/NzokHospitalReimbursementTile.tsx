// "НЗОК плащания за болнична помощ" — shown on a hospital's own /company/:eik page.
// The mirror image of the procurement tiles on the same page: those show what the
// hospital SPENDS through ЗОП (money out), this shows what НЗОК PAYS it for
// inpatient care (money in) — the far larger flow, and one that never appears in
// the contract ledger. Fed by the Рег.№→EIK crosswalk (useNzokHospitalByEik); the
// tile renders nothing unless this EIK is a matched hospital, so it's safe to drop
// on every company page. One EIK can run several ЛЗ facilities (ВМА, Сърце и
// Мозък) — those are listed and summed.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  useNzokHospitalByEik,
  useNzokHospitalMomentumByEik,
} from "@/data/budget/useBudget";
import { decodeEntities } from "@/lib/decodeEntities";
import { monthYearLabel } from "@/lib/monthNames";
import { ownershipChipClass, ownershipLabel } from "@/lib/nzokOwnership";
import { appointingAuthority } from "@/lib/nzokGovernance";
import { NzokPeerGrowthStrip } from "./NzokPeerGrowthStrip";
import type { NzokPaymentStream } from "@/data/budget/types";

/** The three streams in render order, as (payload key, stream id).
 *
 *  ONE list, driving both the split below and the mixed-months caveat above it.
 *  They were two hard-coded lists 110 lines apart: adding a fourth stream to the
 *  render array and not to the other silently drops it from the caveat's test, so
 *  the page would render a lagging stream's figure and stay quiet about it. */
const ROWS = [
  ["bmpEur", "bmp"],
  ["drugsEur", "drugs"],
  ["devicesEur", "devices"],
] as const;

/** Total by construction: a stream added to `ROWS` without a label here is a
 *  compile error, not a blank cell. */
const STREAM_LABELS: Record<NzokPaymentStream, { bg: string; en: string }> = {
  bmp: { bg: "Болнична помощ", en: "Inpatient care" },
  drugs: { bg: "Лекарства", en: "Drugs" },
  devices: {
    bg: "Медицински изделия",
    en: "Medical devices",
  },
};

export const NzokHospitalReimbursementTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data: entry } = useNzokHospitalByEik(eik);
  const { data: momentum } = useNzokHospitalMomentumByEik(eik);
  if (!entry || entry.totalCumulativeEur <= 0) return null;

  // asOf is the report month-end ("2026-05-31"); derive the period label from it.
  const month = Number(entry.asOf.slice(5, 7));
  const year = Number(entry.asOf.slice(0, 4));
  const period = monthYearLabel(month, year, i18n.language);
  // The headline month, as "YYYY-MM", to compare each stream against.
  const headline = entry.asOf.slice(0, 7);
  /** A stream's own month when it DIFFERS from the headline anchor, else null.
   *
   *  ⚠️ The three НЗОК reports publish on their own cadences and each is taken at
   *  its own latest month, so the total above can mix them — deliberately, because
   *  pinning them to one date would silently DROP a lagging stream's money from a
   *  hospital's income. The cost of keeping the total whole is that a figure can be
   *  dated differently from the heading beside it, and the only honest fix is to
   *  say which. Measured before the parser work: devices lagged БМП by five
   *  months, so every hospital's devices figure was February's under a July heading.
   *
   *  ⚠️ BOTH directions, and the second is the one an "older than" test misses.
   *  The headline is the БМП anchor (`nzok_latest_period()` = max period over
   *  LOADED bmp rows), so a refused bmp month leaves the anchor BEHIND its
   *  siblings. Measured on this corpus: five periods carry drugs and/or devices
   *  rows and no bmp row at all — 2023-01, 2023-02, 2023-03, 2025-01 and 2026-01,
   *  the last of which is in this plan's own rejection table. On the day a LATEST
   *  bmp month is refused, `p < headline` renders every hospital's newer money
   *  under an older date with both caveats silent — the same defect this footnote
   *  exists to end, mirrored. */
  const offAnchorPeriod = (stream: NzokPaymentStream): string | null => {
    const p = entry.periodByStream?.[stream];
    return p && p !== headline ? p : null;
  };
  // Already ordered by the DB function (cumulative desc, reg_no tiebreak).
  const facilities = entry.facilities;

  return (
    <Card className="border-rose-300/50 dark:border-rose-900/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          {bg
            ? "НЗОК плащания за болнична помощ"
            : "НЗОК inpatient-care reimbursement"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatEurCompact(entry.totalCumulativeEur, i18n.language)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `изплатени от НЗОК (натрупано до ${period})`
              : `paid by НЗОК (cumulative to ${period})`}
          </span>
          {/* ⚠️ The total mixes months whenever a stream lags, so the heading above
              is the БМП anchor rather than the as-of of every euro in it. Saying so
              once, beside the total, is what stops the figure being read as a
              single-month claim; the per-stream dates below say which. */}
          {ROWS.some(([, stream]) => offAnchorPeriod(stream)) && (
            <span className="w-full text-xs text-amber-700 dark:text-amber-500">
              {bg
                ? "Сумата е от различни месеци — НЗОК публикува трите отчета по различен график; вижте датите по-долу."
                : "The total is from different months — НЗОК publishes the three reports on different schedules; see the dates below."}
            </span>
          )}
        </div>

        {/* Governance: ownership + the office that appoints the director. The
            authority is derived from ownership (no scrape); the caveat is explicit
            that this is the appointing office, not the director's party. */}
        {entry.ownership &&
          (() => {
            const gov = appointingAuthority(entry.ownership, eik);
            const caveat = gov ? (bg ? gov.caveat.bg : gov.caveat.en) : "";
            return (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span
                  className={`rounded-full border px-1.5 py-px text-[10px] font-medium leading-none ${ownershipChipClass(
                    entry.ownership,
                  )}`}
                >
                  {ownershipLabel(entry.ownership, bg)}
                </span>
                {gov && (
                  <span className="text-muted-foreground">
                    {bg ? "Назначаващ орган: " : "Appointing authority: "}
                    <span className="font-medium text-foreground">
                      {bg ? gov.authority.bg : gov.authority.en}
                    </span>
                    {/* Focusable + labelled so the caveat reaches keyboard and
                        screen-reader users, not just a mouse hover; the glyph
                        itself is decorative. */}
                    <button
                      type="button"
                      aria-label={caveat}
                      title={caveat}
                      className="ml-0.5 cursor-help align-middle text-muted-foreground/60 hover:text-foreground"
                    >
                      <span aria-hidden="true">ⓘ</span>
                    </button>
                  </span>
                )}
              </div>
            );
          })()}

        {/* The three streams НЗОК pays a hospital through. Shown as a split rather
            than one figure because the headline used to BE the БМП stream alone,
            which understated every facility by its drugs + devices money — see
            migration 050. */}
        <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
          {ROWS.map(([key, stream]) => {
            const off = offAnchorPeriod(stream);
            const offLabel =
              off &&
              monthYearLabel(
                Number(off.slice(5, 7)),
                Number(off.slice(0, 4)),
                i18n.language,
              );
            // Which way the figure sits relative to the heading. Both happen —
            // see offAnchorPeriod — and calling a NEWER report "по-стар" would be
            // a second wrong claim rather than a missing one.
            const older = off ? off < headline : false;
            return (
              <li
                key={key}
                className="flex items-baseline justify-between gap-2 rounded border px-2 py-1.5"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {bg ? STREAM_LABELS[stream].bg : STREAM_LABELS[stream].en}
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-medium tabular-nums">
                    {/* ⚠️ The null arm is currently unreachable — 065 emits all
                        three as ROUND(SUM(COALESCE(…, 0)))::bigint. Kept, not
                        deleted, because it is the rendering a stream absent from
                        `periodByStream` arguably wants: such a company has no row
                        in that stream's latest month, so its figure is UNKNOWN
                        rather than zero. Deciding that needs the source read (does
                        absence from a cumulative listing mean no YTD payment, or
                        only no listing?) and is a payload change, so it is not
                        guessed here. */}
                    {entry[key] == null
                      ? "—"
                      : formatEurCompact(entry[key], i18n.language)}
                  </span>
                  {/* The figure is from a different month than the heading above
                      it. Said here, beside the number, rather than in a footnote —
                      a reader comparing two hospitals reads the number, not the
                      small print. */}
                  {off && (
                    <span className="block text-[10px] leading-tight text-amber-700 dark:text-amber-500">
                      {bg
                        ? `към ${offLabel} — ${older ? "по-стар" : "по-нов"} отчет`
                        : `as of ${offLabel} — ${older ? "older" : "newer"} report`}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Transparent peer-comparison — where this hospital's YoY spend growth
            sits in the national distribution (published formula, not a black box).
            Pinned to the БМП stream (migration 050): the drugs/devices series is
            shorter, so a three-stream YoY would compare unlike years. */}
        {momentum && <NzokPeerGrowthStrip m={momentum} />}

        {facilities.length > 1 && (
          <ul className="divide-y text-xs">
            {facilities.map((f) => (
              <li
                key={f.regNo}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {decodeEntities(f.name)}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatEurCompact(f.cumulativeEur, i18n.language)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Източник: трите месечни отчета на НЗОК по лечебни заведения — за БМП, за лекарствени продукти и за медицински изделия. Плаща се извън обществените поръчки — за разлика от сумите по-долу, които тази болница ХАРЧИ по ЗОП. Отчетите излизат по различен график, затова последният месец на трите отчета може да се различава.`
            : `Source: НЗОК's three monthly per-hospital reports — inpatient care, drugs applied in hospital, and medical devices. Paid outside public procurement, unlike the amounts below, which this hospital SPENDS through ЗОП. The three reports are published on their own cadences, so their latest month can differ.`}
        </p>
      </CardContent>
    </Card>
  );
};
