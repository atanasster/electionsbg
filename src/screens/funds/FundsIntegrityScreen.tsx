// /funds/integrity — red-flags dashboard. Surfaces concentration metrics
// (HHI per programme, top-1 share), serial winners (beneficiaries who
// appear in multiple programmes), and the АОП debarred-supplier overlap.
//
// Reads only the slim derived/integrity.json (~50 KB) — no per-programme
// shard fetches at page load.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert, Ban, Repeat, Trophy } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useFundsIntegrityIndex } from "@/data/funds/useFundsIntegrity";
import type { HhiBand } from "@/data/funds/useFundsIntegrity";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

const hhiTone = (band: HhiBand): string => {
  if (band === "high")
    return "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200";
  if (band === "moderate")
    return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200";
};

const SkeletonCard: FC = () => (
  <div className="h-[140px] animate-pulse rounded-xl border bg-card p-4 shadow-sm">
    <div className="mb-3 h-3 w-24 rounded bg-muted" />
    <div className="h-7 w-32 rounded bg-muted" />
  </div>
);

export const FundsIntegrityScreen: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useFundsIntegrityIndex();

  const title = t("integrity_page_title") || "EU-funds red flags";
  const description =
    t("integrity_page_description") ||
    "Programme-level concentration, serial winners, and АОП debarred-supplier overlap on EU-funds beneficiaries.";

  if (isLoading) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </section>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section className="my-4">
          <p className="text-sm text-muted-foreground">
            {t("integrity_no_data") ||
              "Integrity data is unavailable. Run the funds:ingest-projects pipeline."}
          </p>
        </section>
      </>
    );
  }

  const t1 = data.totals;

  return (
    <>
      <Title description={description}>{title}</Title>
      <section className="my-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("integrity_page_intro") ||
            "Concentration of contracted funds per operational programme, beneficiaries who appear across multiple programmes, and beneficiaries currently on the АОП debarred-suppliers register. Read together with /funds/political — these are statistical red flags, not in themselves accusations of wrongdoing."}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("integrity_programmes") || "Programmes analysed"}
            hint={
              t("integrity_programmes_hint") ||
              "Operational programmes with ≥1 contract in ИСУН"
            }
          >
            <div className="flex items-baseline gap-2">
              <ShieldAlert className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.programmeCount)}
              </span>
            </div>
          </StatCard>
          <StatCard
            label={t("integrity_high_label") || "High concentration"}
            hint={
              t("integrity_high_hint") ||
              "HHI ≥ 2500 — one or two beneficiaries dominate"
            }
            className="ring-1 ring-rose-200/60 dark:ring-rose-800/40"
          >
            <div className="flex items-baseline gap-2">
              <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.highConcentrationCount)}
              </span>
            </div>
          </StatCard>
          <StatCard
            label={t("integrity_moderate_label") || "Moderate"}
            hint={t("integrity_moderate_hint") || "HHI 1500–2500"}
            className="ring-1 ring-amber-200/60 dark:ring-amber-800/40"
          >
            <div className="flex items-baseline gap-2">
              <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.moderateConcentrationCount)}
              </span>
            </div>
          </StatCard>
          <StatCard
            label={t("integrity_debarred_label") || "Debarred overlap"}
            hint={
              t("integrity_debarred_hint") ||
              "ИСУН beneficiaries currently on the АОП debarred-suppliers register"
            }
            className={
              t1.debarredOverlapCount > 0
                ? "ring-1 ring-rose-200/60 dark:ring-rose-800/40"
                : undefined
            }
          >
            <div className="flex items-baseline gap-2">
              <Ban
                className={`h-5 w-5 shrink-0 ${t1.debarredOverlapCount > 0 ? "text-rose-600" : "text-muted-foreground"}`}
              />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.debarredOverlapCount)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatEur(t1.debarredOverlapEur)}
            </div>
          </StatCard>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-amber-600" />
              {t("integrity_concentration_title") ||
                "Most concentrated programmes (Herfindahl-Hirschman index)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <p className="mb-3 text-xs text-muted-foreground">
              {t("integrity_concentration_intro") ||
                "HHI sums the squared market shares of every beneficiary in the programme. >2500 is the standard antitrust threshold for high concentration."}
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {data.topByConcentration.slice(0, 15).map((p, i) => (
                <li
                  key={p.programCode}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/funds/programme/${encodeURIComponent(p.programCode)}`}
                      className="font-medium hover:underline"
                    >
                      {p.programName}
                    </Link>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>
                        {p.fundType} · {p.period}
                      </span>
                      <span>· {numFmt.format(p.contractCount)} contracts</span>
                      <span>
                        · {numFmt.format(p.beneficiaryCount)}{" "}
                        {t("integrity_beneficiaries") || "beneficiaries"}
                      </span>
                      {p.debarredFlag ? (
                        <span className="font-semibold text-rose-700 dark:text-rose-300">
                          · {t("funds_political_debarred") || "debarred"}
                        </span>
                      ) : null}
                    </div>
                    {p.top1Name ? (
                      <div className="text-[11px] text-muted-foreground">
                        {t("integrity_top1") || "Top winner"}:{" "}
                        <span className="font-medium">{p.top1Name}</span>{" "}
                        <span className="tabular-nums">
                          ({(p.top1Share * 100).toFixed(0)}%)
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="ml-auto flex flex-col items-end">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${hhiTone(p.hhiBand)}`}
                    >
                      HHI {Math.round(p.hhi).toLocaleString("en-US")}
                    </span>
                    <span className="mt-0.5 text-sm font-medium tabular-nums">
                      {formatEur(p.totalEur)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Repeat className="h-4 w-4 text-sky-600" />
              {t("integrity_serial_title") ||
                "Serial winners — top beneficiaries across multiple programmes"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <p className="mb-3 text-xs text-muted-foreground">
              {t("integrity_serial_intro") ||
                "Beneficiaries who place in the top-10 of two or more operational programmes — single companies tapping multiple parallel funding streams."}
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {data.topSerialWinners.slice(0, 20).map((w, i) => (
                <li
                  key={`${w.eik ?? w.name}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {w.eik ? (
                      <Link
                        to={`/company/${w.eik}`}
                        className="font-medium hover:underline"
                      >
                        {w.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{w.name}</span>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {t("integrity_serial_programmes_label", {
                        count: w.programmeCount,
                      }) || `${w.programmeCount} programmes`}{" "}
                      ·{" "}
                      {w.topProgrammes
                        .slice(0, 3)
                        .map((p) => p.programName)
                        .join(", ")}
                    </div>
                  </div>
                  <span className="ml-auto text-sm font-medium tabular-nums">
                    {formatEur(w.totalEur)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {data.debarredFlagged.length > 0 ? (
          <Card className="ring-1 ring-rose-200/60 dark:ring-rose-800/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ban className="h-4 w-4 text-rose-600" />
                {t("integrity_debarred_title") || "Debarred suppliers in ИСУН"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <p className="mb-3 text-xs text-muted-foreground">
                {t("integrity_debarred_intro") ||
                  "Suppliers currently on the АОП debarred-suppliers register who also appear as EU-funds beneficiaries in ИСУН. Name-matched — verify identity before publication."}
              </p>
              <ul className="flex flex-col divide-y divide-border">
                {data.debarredFlagged.map((d) => (
                  <li
                    key={d.eik ?? d.name}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      {d.eik ? (
                        <Link
                          to={`/company/${d.eik}`}
                          className="font-medium hover:underline"
                        >
                          {d.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{d.name}</span>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        {t("integrity_serial_programmes_label", {
                          count: d.programmeCount,
                        }) || `${d.programmeCount} programmes`}
                      </div>
                    </div>
                    <span className="ml-auto text-sm font-medium tabular-nums">
                      {formatEur(d.totalEur)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-[11px] text-muted-foreground/80">
          {t("integrity_disclaimer") ||
            "HHI / serial-winner / debarred flags are statistical signals only — read together with /funds/political and the per-programme drill-down before treating any single flag as a finding."}
        </p>
      </section>
    </>
  );
};
