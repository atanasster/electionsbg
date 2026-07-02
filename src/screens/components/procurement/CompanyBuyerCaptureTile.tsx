// Buyer-CAPTURE tile for the DB company page. The companion to the
// buyer-CONCENTRATION tile: concentration asks "how much of THIS COMPANY's
// revenue comes from one buyer?" (a dependency lens on the supplier); capture
// asks the reverse — "how much of the BUYER's total spend does this company
// win?" (a market-power / capture lens on the buyer). A firm that takes 60% of
// a municipality's entire procurement is the single strongest single-supplier
// capture signal, and it needs the buyer's grand total — which the byAwarder
// rollup lacks. Fed by company_buyer_relationships() (PG), which precomputes
// each buyer's total across ALL contractors. See 017_company_relationships.sql.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Crosshair } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";

export interface BuyerRelationship {
  eik: string;
  name: string | null;
  myEur: number;
  myCount: number;
  buyerEur: number;
  buyerCount: number;
  captureShare: number | null; // myEur / buyerEur
  revenueShare: number | null; // myEur / this company's total
  firstDate: string | null;
  lastDate: string | null;
}
export interface BuyerRelationships {
  buyerCount: number;
  totalEur: number;
  hhi: number;
  top1Share: number;
  top3Share: number;
  relationships: BuyerRelationship[];
}

// Ignore tiny buyers — "100% of a €8k buyer" is noise, not capture.
const MIN_BUYER_EUR = 500_000;
// Only surface the tile when at least one buyer is meaningfully captured.
const MIN_CAPTURE = 0.15;
const SHOWN = 8;

const bandClass = (s: number): string =>
  s >= 0.5
    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    : s >= 0.25
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-muted text-muted-foreground";

export const CompanyBuyerCaptureTile: FC<{ data: BuyerRelationships }> = ({
  data,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fmtPct = (frac: number): string =>
    (frac * 100).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", {
      maximumFractionDigits: frac >= 0.1 ? 0 : 1,
    }) + "%";

  const captured = data.relationships
    .filter(
      (r) =>
        r.captureShare != null &&
        r.buyerEur >= MIN_BUYER_EUR &&
        r.captureShare >= MIN_CAPTURE,
    )
    .sort((a, b) => (b.captureShare ?? 0) - (a.captureShare ?? 0))
    .slice(0, SHOWN);

  if (captured.length === 0) return null;
  const top = captured[0];

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Crosshair className="h-4 w-4" />
          {t("company_capture_title") || "Пазарна тежест при възложители"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("company_capture_subtitle") ||
              "Дял от поръчките на възложителя, спечелен от тази фирма"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("company_capture_lead", {
            share: fmtPct(top.captureShare ?? 0),
            buyer: top.name ?? `ЕИК ${top.eik}`,
            defaultValue: "Печели {{share}} от всички поръчки на {{buyer}}.",
          })}
        </p>
        <div className="space-y-2">
          {captured.map((r) => (
            <div key={r.eik} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  to={`/awarder/${r.eik}`}
                  className="text-sm hover:underline truncate max-w-[70%]"
                  title={r.name ?? undefined}
                >
                  {r.name ?? `ЕИК ${r.eik}`}
                </Link>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${bandClass(
                    r.captureShare ?? 0,
                  )}`}
                >
                  {fmtPct(r.captureShare ?? 0)}
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary/70"
                  style={{
                    width: `${Math.min(100, (r.captureShare ?? 0) * 100)}%`,
                  }}
                />
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatEur(r.myEur, lang)} {t("company_capture_of") || "от"}{" "}
                {formatEur(r.buyerEur, lang)} ·{" "}
                {r.myCount.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB")}{" "}
                {t("company_capture_contracts") || "договора"}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
