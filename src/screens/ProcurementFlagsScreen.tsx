// /procurement/flags — public red-flag feed. Surfaces the procurement risk
// signals we already compute, aggregated into one accountability view: debarred
// suppliers still winning work, buyers whose spend is concentrated on a single
// supplier, and the largest MP-tied contractor relationships. Built entirely
// from committed derived files (debarred.json, awarder_concentration.json,
// mp_connected.json) — no pipeline build, no backend.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Ban, AlertTriangle, Link as LinkIcon } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useDebarred } from "@/data/procurement/useDebarred";
import { dataUrl } from "@/data/dataUrl";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");
const pctFmt = (frac: number, lang: string) =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(frac);

type RiskFeedFile = {
  topConcentration: Array<{
    awarderEik: string;
    awarderName: string;
    contractorEik: string;
    contractorName: string;
    sharePct: number;
    pairTotalEur: number;
  }>;
  topMpTied: Array<{
    mpId: number;
    mpName: string;
    contractorEik: string;
    contractorName: string;
    totalEur: number;
  }>;
};

// One slim file (~28 KB) instead of awarder_concentration.json (≈1 MB) +
// mp_connected.json — the page only ever shows the top rows.
const useRiskFeed = () =>
  useQuery({
    queryKey: ["procurement", "risk_feed"] as const,
    queryFn: async () => {
      const r = await fetch(dataUrl("/procurement/derived/risk_feed.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as RiskFeedFile;
    },
    staleTime: Infinity,
  });

export const ProcurementFlagsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { debarred } = useDebarred();
  const { data: feed } = useRiskFeed();

  const today = new Date().toISOString().slice(0, 10);
  // Debarred suppliers whose ban is still active.
  const activeDebarred = debarred.list
    .filter((d) => !d.debarredUntil || d.debarredUntil >= today)
    .sort((a, b) => (a.debarredUntil < b.debarredUntil ? 1 : -1))
    .slice(0, 20);

  const topConcentration = (feed?.topConcentration ?? []).slice(0, 20);
  const topMp = (feed?.topMpTied ?? []).slice(0, 20);

  return (
    <>
      <Title
        description={
          t("flags_desc") ||
          "Procurement red flags across the corpus: debarred suppliers, single-supplier concentration, and MP-tied contractors."
        }
      >
        {t("flags_title") || "Procurement red flags"}
      </Title>
      <section aria-label="procurement flags" className="my-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          {t("flags_intro") ||
            "Signals worth a second look — each is a public-record fact, not an accusation."}
        </p>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              {t("flags_concentration") || "Single-supplier concentration"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <ul className="flex flex-col">
              {topConcentration.map((e) => (
                <li
                  key={`${e.awarderEik}|${e.contractorEik}`}
                  className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
                >
                  <span className="rounded bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shrink-0">
                    {pctFmt(e.sharePct, lang)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <Link
                      to={`/awarder/${e.awarderEik}`}
                      className="hover:underline"
                    >
                      {e.awarderName}
                    </Link>
                    <span className="text-muted-foreground"> → </span>
                    <Link
                      to={`/company/${e.contractorEik}`}
                      className="hover:underline"
                    >
                      {e.contractorName}
                    </Link>
                  </span>
                  <span className="tabular-nums text-xs shrink-0">
                    {formatEur(e.pairTotalEur)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-amber-600" />
              {t("flags_mp_tied") || "Largest MP-tied contractors"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <ul className="flex flex-col">
              {topMp.map((e) => (
                <li
                  key={`${e.mpId}|${e.contractorEik}`}
                  className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
                >
                  <Link
                    to={`/company/${e.contractorEik}`}
                    className="min-w-0 flex-1 truncate hover:underline font-medium"
                  >
                    {e.contractorName}
                  </Link>
                  <Link
                    to={`/candidate/mp-${e.mpId}/procurement`}
                    className="text-xs text-muted-foreground shrink-0 hover:underline hidden sm:inline"
                  >
                    {e.mpName}
                  </Link>
                  <span className="tabular-nums text-xs shrink-0 min-w-[90px] text-right font-medium">
                    {formatEur(e.totalEur)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Ban className="h-4 w-4 text-red-600" />
              {t("flags_debarred") || "Debarred suppliers (active ban)"}
              <span className="text-xs text-muted-foreground font-normal">
                {numFmt.format(activeDebarred.length)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            {activeDebarred.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("flags_debarred_empty") || "No active debarments on record."}
              </p>
            ) : (
              <ul className="flex flex-col">
                {activeDebarred.map((d, idx) => (
                  <li
                    key={`${d.nameNormalized}-${idx}`}
                    className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {t("flags_debarred_until") || "until"}{" "}
                      {d.debarredUntil || "—"}
                    </span>
                    {d.detailsUrl ? (
                      <a
                        href={d.detailsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline shrink-0"
                      >
                        {t("flags_debarred_decision") || "decision"}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
};
