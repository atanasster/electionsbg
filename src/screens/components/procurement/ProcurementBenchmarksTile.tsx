// Competition vs the EU's official red lines — the two Single Market
// Scoreboard indicators we can compute from the contract corpus, each drawn on
// a green/amber/red scale with a marker at the window's value:
//
//   single-bidder share (competitive procedures with a known bid count):
//     green ≤10%, red >20%
//   no-call-for-bids share (direct negotiation / no prior publication):
//     green ≤5%, red ≥10%
//
// Grain caveat: the Scoreboard counts procedures; we count signed contracts
// (incl. framework mini-orders), and bid counts only exist on the ЦАИС-era
// feed — the coverage line under each bar keeps that honest.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useProcurementBenchmarks,
  type ProcurementBenchmarksFile,
} from "@/data/procurement/useProcurementBenchmarks";

const IndicatorBar: FC<{
  label: string;
  hint: string;
  value: number; // 0..1
  green: number; // green ≤ this (fraction)
  red: number; // red > this (fraction)
  coverage: string;
  lang: string;
}> = ({ label, hint, value, green, red, coverage, lang }) => {
  const { t } = useTranslation();
  // Scale tops out just past the value or 2× the red line, whichever is
  // bigger, so the marker always fits and the zones stay readable.
  const max = Math.max(red * 2, Math.min(1, value * 1.15), 0.25);
  const pct = (v: number) =>
    (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";
  const zone = value <= green ? "green" : value <= red ? "amber" : "red";
  const zoneColor =
    zone === "green"
      ? "text-emerald-700 dark:text-emerald-400"
      : zone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : "text-red-700 dark:text-red-400";
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className={`text-lg font-bold tabular-nums ${zoneColor}`}>
          {pct(value)}
        </span>
      </div>
      <div className="mt-1 relative h-2.5 rounded-full overflow-hidden bg-muted">
        <div
          className="absolute inset-y-0 left-0 bg-emerald-200 dark:bg-emerald-900/50"
          style={{ width: `${(green / max) * 100}%` }}
        />
        <div
          className="absolute inset-y-0 bg-amber-200 dark:bg-amber-900/50"
          style={{
            left: `${(green / max) * 100}%`,
            width: `${((red - green) / max) * 100}%`,
          }}
        />
        <div
          className="absolute inset-y-0 bg-red-200 dark:bg-red-900/50"
          style={{
            left: `${(red / max) * 100}%`,
            right: 0,
          }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: `${Math.min(99.5, (value / max) * 100)}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-x-2 text-[11px] text-muted-foreground">
        <span>
          {(t("procurement_bm_thresholds") || "EU: green ≤{{g}} · red >{{r}}")
            .replace("{{g}}", pct(green))
            .replace("{{r}}", pct(red))}
        </span>
        <span>{coverage}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>
    </div>
  );
};

// National mode (no `data`) self-fetches the window totals; entity mode is fed a
// pre-built {total, singleBidder, noCall} from the awarder/company rollup so the
// same green/amber/red bars work on /awarder/:eik and /company/:eik.
export const ProcurementBenchmarksTile: FC<{
  data?: ProcurementBenchmarksFile | null;
  /** Heading override for the entity view ("this buyer" vs the national feed). */
  title?: string;
}> = ({ data: entityData, title }) => {
  const { t, i18n } = useTranslation();
  // Only the national mode needs the fetch; in entity mode the query is disabled
  // so /company/:eik and /awarder/:eik don't fire a discarded Cloud SQL call.
  const national = useProcurementBenchmarks(entityData === undefined);
  // Entity mode passes `data` explicitly (may be null → nothing to show);
  // national mode reads the hook. `entityData === undefined` = not entity mode.
  const data = entityData !== undefined ? entityData : national.data;
  if (!data) return null;
  const sb = data.singleBidder;
  const nc = data.noCall;
  // Too few measured contracts → shares are noise, skip the tile.
  if (sb.known < 100 || nc.methodKnown < 100) return null;

  const lang = i18n.language;
  const numFmt = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4 text-muted-foreground" />
          {title ||
            t("procurement_bm_title") ||
            "Competition vs the EU thresholds"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0 divide-y divide-border/40">
        <IndicatorBar
          label={t("procurement_bm_single") || "Single-bidder contracts"}
          hint={
            t("procurement_bm_single_hint") ||
            "Share of contracts under competitive procedures where exactly one tenderer bid."
          }
          value={sb.known > 0 ? sb.single / sb.known : 0}
          green={0.1}
          red={0.2}
          coverage={(
            t("procurement_bm_coverage") ||
            "bid count known for {{known}} of {{total}} contracts"
          )
            .replace("{{known}}", numFmt.format(sb.known))
            .replace("{{total}}", numFmt.format(data.total))}
          lang={lang}
        />
        <IndicatorBar
          label={t("procurement_bm_nocall") || "No call for bids"}
          hint={
            t("procurement_bm_nocall_hint") ||
            "Direct negotiation or procedures without prior publication, as a share of all contracts with a known procedure type."
          }
          value={nc.methodKnown > 0 ? nc.noCall / nc.methodKnown : 0}
          green={0.05}
          red={0.1}
          coverage={(
            t("procurement_bm_method_coverage") ||
            "procedure type known for {{known}} of {{total}}"
          )
            .replace("{{known}}", numFmt.format(nc.methodKnown))
            .replace("{{total}}", numFmt.format(data.total))}
          lang={lang}
        />
        <p className="pt-2 text-[11px] text-muted-foreground/80">
          {t("procurement_bm_source") ||
            "Thresholds: EU Single Market Scoreboard. Computed from signed contracts (the Scoreboard counts procedures), so levels are indicative."}
        </p>
      </CardContent>
    </Card>
  );
};
