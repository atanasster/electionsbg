// /officials/:slug — single-official profile. Lighter than the MP profile:
// no roll-call section. Surfaces role + institution header, latest-
// declaration headline numbers (net worth, by-category breakdown), a
// business-connections section (companies + connected MPs/officials, shown
// when the official appears in the connections graph), and a timeline of
// every filing on record with a deep link to the source XML.

import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Calendar,
  ExternalLink,
  Landmark,
  MapPin,
  Receipt,
  Wallet,
} from "lucide-react";
import { Title } from "@/ux/Title";
import {
  useOfficial,
  useOfficialDeclarations,
} from "@/data/officials/useOfficial";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { ErrorSection } from "./components/ErrorSection";
import { OfficialConnectionsSection } from "./components/OfficialConnectionsSection";
import type {
  MpAssetCategory,
  OfficialCategoryKind,
  OfficialDeclaration,
} from "@/data/dataTypes";

const CATEGORY_ICONS: Record<OfficialCategoryKind, typeof Briefcase> = {
  cabinet: Landmark,
  deputy_minister: Landmark,
  agency_head: Briefcase,
  regional_governor: MapPin,
};

const CATEGORY_CHIP_CLASS: Record<OfficialCategoryKind, string> = {
  cabinet:
    "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  deputy_minister:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100",
  agency_head:
    "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100",
  regional_governor:
    "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
};

const ASSET_CATEGORY_ORDER: MpAssetCategory[] = [
  "real_estate",
  "bank",
  "cash",
  "security",
  "investment",
  "vehicle",
  "receivable",
  "debt",
];

const fmtEur = (n: number, lang: string): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return `€${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  )}`;
};

export const OfficialProfileScreen: FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const { official, isLoading: officialLoading } = useOfficial(slug);
  const { declarations, isLoading: declsLoading } =
    useOfficialDeclarations(slug);
  const { nameForBg } = useCandidateName();

  const latest = declarations[0] ?? null;

  // Per-category totals from the latest declaration. Mirrors the MP-side
  // rollup so the visual reads identically. `debt` is folded into the same
  // ordered list — the UI surfaces it as a negative pill.
  const byCategory = useMemo(() => {
    if (!latest?.assets) return null;
    const totals: Record<MpAssetCategory, { count: number; totalEur: number }> =
      {
        real_estate: { count: 0, totalEur: 0 },
        vehicle: { count: 0, totalEur: 0 },
        cash: { count: 0, totalEur: 0 },
        bank: { count: 0, totalEur: 0 },
        receivable: { count: 0, totalEur: 0 },
        debt: { count: 0, totalEur: 0 },
        investment: { count: 0, totalEur: 0 },
        security: { count: 0, totalEur: 0 },
      };
    for (const a of latest.assets) {
      const bucket = totals[a.category];
      if (!bucket) continue;
      bucket.count += 1;
      bucket.totalEur += a.valueEur ?? 0;
    }
    return totals;
  }, [latest]);

  // Headline net-worth numbers + YoY delta, computed from the declarations.
  // The executive rankings file precomputes these, but municipal officials
  // have no rankings entry — computing here makes the page work for both.
  const summary = useMemo(() => {
    if (!latest?.assets) return null;
    const totalsOf = (assets: OfficialDeclaration["assets"]) => {
      let a = 0;
      let d = 0;
      let reUnvalued = 0;
      for (const x of assets ?? []) {
        const v = x.valueEur ?? 0;
        if (x.category === "debt") d += v;
        else a += v;
        if (x.category === "real_estate" && x.valueEur == null) reUnvalued += 1;
      }
      return { assets: a, debts: d, net: a - d, reUnvalued };
    };
    const cur = totalsOf(latest.assets);
    const prevDecl = declarations[1];
    const prev = prevDecl ? totalsOf(prevDecl.assets) : null;
    return {
      totalAssetsEur: cur.assets,
      totalDebtsEur: cur.debts,
      netWorthEur: cur.net,
      realEstateUnvalued: cur.reUnvalued,
      delta:
        prev && prevDecl
          ? {
              previousYear: prevDecl.declarationYear,
              absoluteEur: cur.net - prev.net,
              pct:
                prev.net === 0
                  ? null
                  : (cur.net - prev.net) / Math.abs(prev.net),
            }
          : null,
    };
  }, [latest, declarations]);

  if (officialLoading || declsLoading) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-8" aria-hidden>
        <div className="min-h-[400px]" />
      </div>
    );
  }

  if (!official && !latest) {
    return (
      <ErrorSection
        title={t("official_not_found_title") || "Official not found"}
        description={
          t("official_not_found_desc") ||
          "No declarations on file under this slug. The official may be from a category we don't ingest, or the slug is wrong."
        }
      />
    );
  }

  // Display fields fall back to the latest declaration — municipal officials
  // have no executive rankings entry, so `official` is null for them.
  const displayName = official?.name ?? latest?.declarantName ?? "";
  const institution = official?.institution ?? latest?.institution ?? "";
  const positionTitle =
    official?.positionTitle ?? latest?.positionTitle ?? null;
  const latestYear =
    official?.latestDeclarationYear ?? latest?.declarationYear ?? null;
  const delta = summary?.delta ?? null;

  const Icon = official ? CATEGORY_ICONS[official.category] : Landmark;
  const categoryLabel = official
    ? {
        cabinet: t("officials_cat_cabinet") || "Cabinet",
        deputy_minister:
          t("officials_cat_deputy_minister") || "Deputy minister",
        agency_head: t("officials_cat_agency_head") || "Agency head",
        regional_governor:
          t("officials_cat_regional_governor") || "Regional governor",
      }[official.category]
    : null;

  const assetCategoryLabel = (cat: MpAssetCategory): string => {
    const keyMap: Record<MpAssetCategory, string> = {
      real_estate: "asset_category_real_estate",
      vehicle: "asset_category_vehicle",
      cash: "asset_category_cash",
      bank: "asset_category_bank",
      receivable: "asset_category_receivable",
      debt: "asset_category_debt",
      investment: "asset_category_investment",
      security: "asset_category_security",
    };
    const fallbacks: Record<MpAssetCategory, string> = {
      real_estate: "Real estate",
      vehicle: "Vehicles",
      cash: "Cash",
      bank: "Bank accounts",
      receivable: "Receivables",
      debt: "Debts",
      investment: "Investments",
      security: "Securities & shares",
    };
    return t(keyMap[cat]) || fallbacks[cat];
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-12 space-y-6">
      <Title description={positionTitle ?? institution}>
        {nameForBg(displayName)}
      </Title>

      <section className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {official ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                CATEGORY_CHIP_CLASS[official.category]
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {categoryLabel}
            </span>
          ) : positionTitle ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-900 dark:border-teal-900 dark:bg-teal-900/40 dark:text-teal-100">
              <Icon className="h-3.5 w-3.5" />
              {positionTitle}
            </span>
          ) : null}
          <span className="text-sm text-muted-foreground">{institution}</span>
        </div>
        {official && positionTitle ? (
          <p className="text-sm">
            <span className="text-muted-foreground">
              {t("official_position") || "Position"}:
            </span>{" "}
            {positionTitle}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t("official_source_note") ||
            "Source: register.cacbg.bg (Bulgarian Court of Audit). Asset values declared by the official."}
        </p>
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
          <Wallet className="h-4 w-4" />
          {t("official_assets_title") || "Latest declared assets"}
          <span className="text-xs text-muted-foreground font-normal">
            · {latestYear}
          </span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("officials_col_assets") || "Assets (€)"}
            </div>
            <div className="text-xl font-bold tabular-nums">
              {fmtEur(summary?.totalAssetsEur ?? 0, i18n.language)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("officials_col_debts") || "Debts (€)"}
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                (summary?.totalDebtsEur ?? 0) > 0
                  ? "text-red-600"
                  : "text-muted-foreground"
              }`}
            >
              {(summary?.totalDebtsEur ?? 0) > 0
                ? fmtEur(summary?.totalDebtsEur ?? 0, i18n.language)
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("officials_col_net") || "Net (€)"}
            </div>
            <div className="text-xl font-bold tabular-nums">
              {fmtEur(summary?.netWorthEur ?? 0, i18n.language)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("official_yoy") || "YoY change"}
            </div>
            <div className="text-xl font-bold tabular-nums">
              {delta ? (
                <span
                  className={`inline-flex items-center gap-1 ${
                    delta.absoluteEur > 0
                      ? "text-green-600"
                      : delta.absoluteEur < 0
                        ? "text-red-600"
                        : "text-muted-foreground"
                  }`}
                >
                  {delta.absoluteEur > 0 ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                  {delta.pct != null
                    ? `${Math.abs(delta.pct * 100).toFixed(0)}%`
                    : fmtEur(Math.abs(delta.absoluteEur), i18n.language)}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </div>

        {byCategory ? (
          <div className="border-t pt-3 space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {t("official_assets_breakdown") || "Breakdown by category"}
            </h3>
            {ASSET_CATEGORY_ORDER.filter(
              (c) => (byCategory[c]?.count ?? 0) > 0,
            ).map((c) => {
              const bucket = byCategory[c];
              return (
                <div
                  key={c}
                  className="flex items-center justify-between text-sm"
                >
                  <span>
                    {assetCategoryLabel(c)}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({bucket.count})
                    </span>
                  </span>
                  <span
                    className={`tabular-nums font-mono ${
                      c === "debt" ? "text-red-600" : ""
                    }`}
                  >
                    {bucket.totalEur > 0
                      ? fmtEur(bucket.totalEur, i18n.language)
                      : "—"}
                  </span>
                </div>
              );
            })}
            {(summary?.realEstateUnvalued ?? 0) > 0 ? (
              <p className="text-xs text-muted-foreground pt-2 border-t mt-2">
                {t("official_assets_unvalued_footnote", {
                  count: summary?.realEstateUnvalued ?? 0,
                }) ||
                  `${summary?.realEstateUnvalued ?? 0} real-estate item(s) declared without a value.`}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {slug ? <OfficialConnectionsSection slug={slug} /> : null}

      {declarations.length > 0 ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
            <Receipt className="h-4 w-4" />
            {t("official_declarations_title") || "Declarations on file"}
            <span className="text-xs text-muted-foreground font-normal">
              · {declarations.length}
            </span>
          </h2>
          <ul className="divide-y text-sm">
            {declarations.map((d) => (
              <li
                key={`${d.declarationYear}-${d.entryNumber ?? d.controlHash ?? "0"}`}
                className="flex items-center gap-3 py-2"
              >
                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="tabular-nums">
                    {d.declarationYear}
                    {d.fiscalYear != null && d.fiscalYear !== d.declarationYear
                      ? ` (${t("official_for_fy") || "fiscal year"} ${d.fiscalYear})`
                      : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {d.declarationType}
                    {d.filedAt ? ` · ${d.filedAt}` : ""}
                  </div>
                </div>
                <a
                  href={d.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  {t("official_source_link") || "Source"}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="text-xs text-muted-foreground">
        <Link to="/officials/assets" className="text-primary hover:underline">
          ← {t("official_back_to_list") || "Back to all officials"}
        </Link>
      </div>
    </div>
  );
};
