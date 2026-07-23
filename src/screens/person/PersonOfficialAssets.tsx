// Declared assets/wealth for a NON-MP official (cabinet, deputy minister, agency head,
// governor, mayor, deputy-mayor, council chair, councillor) on the merged person dashboard —
// the officials-tier counterpart to the MP declarations block (PersonMpSections). Closes the
// last gap the person-candidate merge flagged: declared wealth was only on /officials/:slug,
// never on the unified person page.
//
// person_role.ref for an official IS the Court-of-Audit declaration slug, so this joins by
// person_id → ref → the same per-slug shard OfficialProfileScreen reads. Self-gating: ~6% of
// official slugs have a declaration on file, so most people render nothing here.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, ExternalLink } from "lucide-react";
import { useOfficialDeclarations } from "@/data/officials/useOfficial";
import type { OfficialDeclaration } from "@/data/dataTypes";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";

// Same basis as OfficialProfileScreen's summary: sum non-debt categories as assets, `debt` as
// debts, net = assets − debts.
const totalsOf = (assets?: OfficialDeclaration["assets"]) => {
  let a = 0;
  let d = 0;
  for (const x of assets ?? []) {
    const v = x.valueEur ?? 0;
    if (x.category === "debt") d += v;
    else a += v;
  }
  return { assets: a, debts: d, net: a - d };
};

export const PersonOfficialAssets: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const { declarations } = useOfficialDeclarations(slug);

  const summary = useMemo(() => {
    const latest = declarations[0];
    if (!latest?.assets?.length) return null;
    const cur = totalsOf(latest.assets);
    const prev = declarations[1] ? totalsOf(declarations[1].assets) : null;
    return {
      year: latest.declarationYear,
      sourceUrl: latest.sourceUrl,
      ...cur,
      deltaNet: prev ? cur.net - prev.net : null,
      // Label the comparison by the FISCAL year each filing covers, not the year
      // it was filed. An official who files an annual and an exit declaration in
      // the same calendar year has two rows sharing a declarationYear, which
      // rendered as "+X vs 2023" on a card already headlined 2023. Their fiscal
      // years are what actually differ (2022 → 2023). Fall back to the filing
      // year, and drop the comparison if even that can't distinguish them.
      prevYear:
        declarations[1]?.fiscalYear ?? declarations[1]?.declarationYear ?? null,
    };
  }, [declarations]);

  if (!summary) return null;

  return (
    <DashboardSection
      id="declarations"
      title={t("mp_section_assets") || "Assets & declarations"}
      icon={Wallet}
      subtitle={
        <a
          href={summary.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          register.cacbg.bg · {summary.year}
          <ExternalLink className="h-3 w-3" />
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("officials_net_worth") || "Net worth"}>
          <div className="text-2xl font-bold text-foreground">
            {formatEurCompact(summary.net)}
          </div>
          {summary.deltaNet != null &&
            summary.prevYear != null &&
            summary.prevYear !== summary.year && (
              <div
                className={
                  summary.deltaNet >= 0
                    ? "mt-0.5 text-xs text-emerald-600 dark:text-emerald-400"
                    : "mt-0.5 text-xs text-red-600 dark:text-red-400"
                }
              >
                {summary.deltaNet >= 0 ? "+" : "−"}
                {formatEurCompact(Math.abs(summary.deltaNet))}{" "}
                {t("dashboard_vs")} {summary.prevYear}
              </div>
            )}
        </StatCard>
        <StatCard label={t("officials_col_assets") || "Assets (€)"}>
          <div className="text-2xl font-bold text-foreground">
            {formatEurCompact(summary.assets)}
          </div>
        </StatCard>
        <StatCard label={t("mp_decl_debts") || "Debts"}>
          <div className="text-2xl font-bold text-foreground">
            {formatEurCompact(summary.debts)}
          </div>
        </StatCard>
      </div>
    </DashboardSection>
  );
};
