// Declared assets/wealth for a NON-MP official (cabinet, deputy minister, agency head,
// governor, mayor, deputy-mayor, council chair, councillor) on the merged person dashboard —
// the officials-tier counterpart to the MP declarations block (PersonMpSections). Closes the
// last gap the person-candidate merge flagged: declared wealth was only on /officials/:slug,
// never on the unified person page.
//
// person_role.ref for an official IS the Court-of-Audit declaration slug, so this joins by
// person_id → ref → the same per-slug shard OfficialProfileScreen reads. Self-gating: it
// renders nothing for a declarant with no asset-bearing filing on record.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, ExternalLink } from "lucide-react";
import { useOfficialDeclarations } from "@/data/officials/useOfficial";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import {
  declarationTotals,
  latestAssetDeclaration,
  priorAssetDeclaration,
} from "@/lib/declarations";

export const PersonOfficialAssets: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const { declarations } = useOfficialDeclarations(slug);

  const summary = useMemo(() => {
    // The newest filing is frequently an incompatibility declaration, which
    // carries no asset tables at all. Reading the wealth off `declarations[0]`
    // hid this block outright for 28% of officials — ask instead for the newest
    // filing that actually declares something.
    const latest = latestAssetDeclaration(declarations);
    if (!latest) return null;
    const cur = declarationTotals(latest.assets);
    const prevDecl = priorAssetDeclaration(declarations, latest);
    const prev = prevDecl ? declarationTotals(prevDecl.assets) : null;
    return {
      year: latest.declarationYear,
      sourceUrl: latest.sourceUrl,
      assets: cur.assetsEur,
      debts: cur.debtsEur,
      net: cur.netEur,
      deltaNet: prev ? cur.netEur - prev.netEur : null,
      // Label the comparison by the FISCAL year the prior filing covers — see
      // priorAssetDeclaration for why the filing year alone is not enough.
      prevYear: prevDecl
        ? (prevDecl.fiscalYear ?? prevDecl.declarationYear)
        : null,
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
