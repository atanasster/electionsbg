// The unified declaration block (audit T3.3 / 3.3): ONE component that renders the
// declared assets for every tier — MP, executive, municipal, magistrate — off a single
// Postgres payload (person_declarations / declaration_detail, 090). It retires D9 and the
// three divergent net-worth definitions: net worth is assetsEur − debtsEur, both rounded
// server-side, so there is no client arithmetic to diverge.
//
// The headline is the latest ASSET-BEARING filing (an incompatibility filing carries no
// assets and must not read as €0 — the D2 bug this block also fixes). Below it, every
// filing on record, each expandable to its full asset / income / stake / event detail.
//
// Defamation-safe: declared, not audited; spouse rows are attributed (is_spouse), never
// folded into the declarant's own holding (family-data parity, T3.0).

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  usePersonDeclarations,
  useDeclarationDetail,
  type DeclarationListItem,
} from "./usePersonDeclarations";

const declTypeKey = (type: string): string =>
  ({
    Annualy: "pp_decl_type_annual",
    Entry: "pp_decl_type_entry",
    Vacate: "pp_decl_type_vacate",
    Other: "pp_decl_type_other",
  })[type] ?? "pp_decl_type_other";

export const PersonDeclarations: FC<{ slug: string }> = ({ slug }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const rows = usePersonDeclarations(slug);

  const summary = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    // Newest asset-bearing filing = the wealth snapshot (not rows[0], which is often an
    // assetless incompatibility filing — the D2 bug).
    //
    // The ORDER comes from the server: person_declarations (090) already sorts by
    // byRecency — year, filed_at, filing type, then the stable tie-breaks — the SAME
    // comparator person_wealth_year ranks by. So the first asset-bearing row IS the
    // representative filing, and this block cannot drift from the wealth chart. Re-deriving
    // the comparator here is what made the two disagree once already; don't.
    const withAssets = rows.filter((r) => r.assetCount > 0);
    if (withAssets.length === 0) return null;
    const latest = withAssets[0];
    // The prior snapshot is the newest asset-bearing filing covering a DIFFERENT
    // period. Keyed on fiscalYear ?? year, matching the shared priorAssetDeclaration
    // selector (src/lib/declarations.ts) — an annual and an exit filing in one calendar
    // year share a declarationYear but cover different fiscal years, so keying on the
    // calendar year alone would skip a real year-over-year comparison and label the
    // delta against the wrong year (the /officials page keys on the fiscal year).
    const period = (r: DeclarationListItem) => r.fiscalYear ?? r.year;
    const prior = withAssets.find((r) => period(r) !== period(latest)) ?? null;
    return {
      latest,
      net: latest.netEur,
      deltaNet: prior ? latest.netEur - prior.netEur : null,
      priorYear: prior ? period(prior) : null,
    };
  }, [rows]);

  if (!summary) return null;
  const { latest } = summary;

  return (
    <DashboardSection
      id="declarations"
      title={t("mp_section_assets") || "Assets & declarations"}
      icon={Wallet}
      subtitle={
        <a
          href={latest.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          register.cacbg.bg · {latest.year}
          <ExternalLink className="h-3 w-3" />
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={t("officials_net_worth") || "Net worth"}>
          <div className="text-2xl font-bold text-foreground">
            {formatEurCompact(summary.net, locale)}
          </div>
          {summary.deltaNet != null &&
            summary.priorYear != null &&
            summary.priorYear !== (latest.fiscalYear ?? latest.year) && (
              <div
                className={cn(
                  "mt-0.5 text-xs",
                  summary.deltaNet >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400",
                )}
              >
                {summary.deltaNet >= 0 ? "+" : "−"}
                {formatEurCompact(Math.abs(summary.deltaNet), locale)}{" "}
                {t("dashboard_vs")} {summary.priorYear}
              </div>
            )}
        </StatCard>
        <StatCard label={t("officials_col_assets") || "Assets (€)"}>
          <div className="text-2xl font-bold text-foreground">
            {formatEurCompact(latest.assetsEur, locale)}
          </div>
        </StatCard>
        <StatCard label={t("mp_decl_debts") || "Debts"}>
          <div className="text-2xl font-bold text-foreground">
            {formatEurCompact(latest.debtsEur, locale)}
          </div>
        </StatCard>
      </div>

      {/* Every filing on record, newest first, each expandable to its detail. */}
      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {rows!.map((r) => (
          <FilingRow key={r.id} row={r} locale={locale} />
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("pp_wealth_caveat")}
      </p>
    </DashboardSection>
  );
};

const FilingRow: FC<{ row: DeclarationListItem; locale: string }> = ({
  row,
  locale,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="w-12 shrink-0 font-semibold tabular-nums">
          {row.year}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {t(declTypeKey(row.type))}
        </span>
        <span className="flex-1 truncate text-muted-foreground">
          {row.institution ?? row.positionTitle ?? ""}
        </span>
        {/* An incompatibility (Other) filing carries no asset tables at all, so it has
            no net worth — printing €0 would read as a collapse in declared wealth, which
            is the D2 bug in miniature. Show a dash. */}
        <span className="shrink-0 tabular-nums">
          {row.assetCount > 0 ? formatEurCompact(row.netEur, locale) : "—"}
        </span>
      </button>
      {open && <FilingDetail id={row.id} locale={locale} />}
    </li>
  );
};

const FilingDetail: FC<{ id: number; locale: string }> = ({ id, locale }) => {
  const { t } = useTranslation();
  const detail = useDeclarationDetail(id);
  if (detail === undefined)
    return (
      <div className="px-9 py-2 text-xs text-muted-foreground">
        {t("loading") || "…"}
      </div>
    );
  if (!detail)
    return (
      <div className="px-9 py-2 text-xs text-muted-foreground">
        {t("pp_decl_no_detail") || "—"}
      </div>
    );

  return (
    <div className="space-y-2 bg-muted/20 px-9 py-3 text-xs">
      {detail.assets.length > 0 && (
        <div>
          {detail.assets.map((a, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-2 py-0.5"
            >
              <span className="truncate">
                <span className="text-muted-foreground">
                  {t(`asset_category_${a.category}`)}
                </span>{" "}
                {a.description}
                {a.location ? ` · ${a.location}` : ""}
                {a.isSpouse && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {t("pp_decl_spouse") || "съпруг/а"}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {a.valueEur != null ? formatEur(a.valueEur, locale) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
      {detail.stakes.length > 0 && (
        <div className="border-t border-border pt-1">
          <div className="mb-0.5 font-medium">{t("pp_decl_stakes")}</div>
          {detail.stakes.map((s, i) => (
            <div key={i} className="flex justify-between gap-2 py-0.5">
              <span className="truncate">
                {s.companyName} {s.shareSize ? `· ${s.shareSize}` : ""}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {s.valueEur != null ? formatEur(s.valueEur, locale) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
      {detail.events.length > 0 && (
        <div className="border-t border-border pt-1">
          <div className="mb-0.5 font-medium">{t("pp_decl_events")}</div>
          {detail.events.map((e, i) => (
            <div key={i} className="flex justify-between gap-2 py-0.5">
              <span className="truncate">
                {t(`pp_decl_event_${e.kind}`)}: {e.description}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {e.valueEur != null ? formatEur(e.valueEur, locale) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
