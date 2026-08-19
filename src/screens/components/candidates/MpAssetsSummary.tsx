import { FC, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Banknote,
  Car,
  Coins,
  CreditCard,
  ExternalLink,
  FileText,
  HandCoins,
  Home as HomeIcon,
  Landmark,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpAssets } from "@/data/parliament/useMpAssets";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import type { MpAsset, MpAssetCategory } from "@/data/dataTypes";
import { formatEur, formatEurSigned, toEur } from "@/lib/currency";
import { incomeTotals, isDeclaredHolding } from "@/lib/declarations";
import { summariseProperties } from "@/lib/propertyKind";
import { HolderChip } from "@/screens/person/HolderChip";

type Props = { name: string; linkSlug?: string };

const CATEGORY_ICONS: Record<
  MpAssetCategory,
  React.ComponentType<{ className?: string }>
> = {
  real_estate: HomeIcon,
  vehicle: Car,
  cash: Banknote,
  bank: Landmark,
  receivable: HandCoins,
  debt: AlertCircle,
  credit_limit: CreditCard,
  investment: TrendingUp,
  security: FileText,
};

const CATEGORY_KEYS: Record<MpAssetCategory, string> = {
  real_estate: "asset_category_real_estate",
  vehicle: "asset_category_vehicle",
  cash: "asset_category_cash",
  bank: "asset_category_bank",
  receivable: "asset_category_receivable",
  debt: "asset_category_debt",
  credit_limit: "asset_category_credit_limit",
  investment: "asset_category_investment",
  security: "asset_category_security",
};

const CATEGORY_FALLBACKS: Record<MpAssetCategory, string> = {
  real_estate: "Real estate",
  vehicle: "Vehicles",
  cash: "Cash",
  bank: "Bank accounts",
  receivable: "Receivables",
  debt: "Debts",
  credit_limit: "Credit limits",
  investment: "Investments",
  security: "Securities & shares",
};

const ORDER: MpAssetCategory[] = [
  "real_estate",
  "bank",
  "cash",
  "security",
  "investment",
  "vehicle",
  "receivable",
  "debt",
];

/** How many unvalued items show before the list collapses. Everything past this is one
 *  click away, not a separate page: the items are already in the rollup, so expanding
 *  costs no request. */
const UNVALUED_PREVIEW = 12;

export const MpAssetsSummary: FC<Props> = ({ name, linkSlug }) => {
  const { t, i18n } = useTranslation();
  const { rollup, isLoading: assetsLoading } = useMpAssets(name);
  const { declarations, isLoading: declsLoading } = useMpDeclarations(name);
  // Scoped to the FILING, not to the component instance. None of the three render sites
  // passes a `key`, and neither /person/:slug nor /candidate/:id remounts on a param
  // change — React Router reconciles the same element position. A plain boolean therefore
  // survives a person→person navigation whenever the target is already in the React Query
  // cache (staleTime: Infinity repo-wide, i.e. every back/forward), and the next person's
  // card renders pre-expanded from a click the reader made on somebody else.
  // `sourceUrl` is already this component's join key for picking the declaration, so it is
  // the identity the disclosure belongs to — it also collapses when the same person's
  // rollup moves to a newer filing.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  if (!rollup) {
    // Reserve the typical card height while data is in flight so the
    // candidate page doesn't shift down when this drops in. After the
    // queries resolve, render nothing if there are no assets to show.
    if (assetsLoading || declsLoading) {
      return (
        <Card className="my-4" aria-hidden>
          <CardContent>
            <div className="min-h-[80px] sm:min-h-[260px]" />
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  const lang = i18n.language;
  const declarantName = declarations[0]?.declarantName ?? null;
  // Pull the asset rows from the declaration the rollup covers so we can list
  // unvalued items underneath the header.
  // Join on sourceUrl, not the year: the rollup now covers the newest filing
  // that DECLARES assets, and a declarant can have an asset-less filing sharing
  // that same year (an incompatibility filing alongside an annual). Matching by
  // year could resolve to that sibling and render an empty breakdown. The URL is
  // unique per filing.
  const latestDecl = declarations.find((d) => d.sourceUrl === rollup.sourceUrl);
  const unvaluedItems: MpAsset[] = (latestDecl?.assets ?? []).filter(
    (a) =>
      // The list caveats the HEADER, which counts holdings only — so a чуждо row with no
      // declared contract price is not a missing piece of it. Those render in their own
      // „ползва" block instead.
      isDeclaredHolding(a) &&
      a.category !== "debt" &&
      a.category !== "credit_limit" &&
      a.valueEur == null,
  );
  const showAllUnvalued = expandedFor === rollup.sourceUrl;
  // One id per card, so two of these on one page cannot both claim `#mp-assets-unvalued`.
  const unvaluedListId = `mp-assets-unvalued-${linkSlug ?? name}`;
  const incomeHeadingId = `mp-income-heading-${linkSlug ?? name}`;

  // Income from Table 12 of the same declaration. Only rows where at least
  // one party (declarant or spouse) has a non-zero amount are kept.
  const {
    rows: incomeRows,
    declarantEur: incomeTotalDeclarant,
    spouseEur: incomeTotalSpouse,
  } = incomeTotals(latestDecl?.income ?? []);

  // WHAT the property is, not just how many rows. The real-estate tile says „10 items · 10
  // unvalued", which on a filing that prices nothing is the whole of what a reader learns —
  // and 38.6% of declared properties carry no price. Nine ниви and a house is knowable
  // regardless, and it is the part somebody came to find out.
  //
  // Same fold as /person's card and the comparison card (`summariseProperties`): three
  // surfaces counting one person's properties must not answer differently. Costs no request
  // — these rows are already here for the unvalued list above.
  //
  // ⚠️ Rows, not buildings: a house filed as dwelling + terrace + basement + garage is four,
  // and the register carries nothing that folds them back. Чуждо rows are excluded — they
  // are not the declarant's to hold.
  const propertyParts = summariseProperties(
    (latestDecl?.assets ?? [])
      .filter((a) => a.category === "real_estate" && isDeclaredHolding(a))
      .map((a) => a.description),
  ).parts;

  const delta = rollup.previous
    ? {
        absolute: rollup.netWorthEur - rollup.previous.netWorthEur,
        previousYear: rollup.previous.year,
      }
    : null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Wallet className="h-4 w-4" />
          {t("mp_assets_title") || "Declared assets"}
          <span className="text-xs font-normal text-muted-foreground">
            ·{" "}
            {rollup.fiscalYear
              ? `${t("fiscal_year") || "fiscal year"} ${rollup.fiscalYear}`
              : `${rollup.latestDeclarationYear}`}
          </span>
          <Link
            to={`/candidate/${linkSlug ?? encodeURIComponent(name)}/assets`}
            className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline normal-case"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_assets_total") || "Total assets"}
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatEur(rollup.totalAssetsEur, lang)}
            </div>
          </div>
          {rollup.totalDebtsEur > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("mp_assets_debts") || "Debts"}
              </div>
              <div className="text-lg font-semibold tabular-nums text-red-600">
                −{formatEur(rollup.totalDebtsEur, lang)}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_assets_net_worth") || "Net worth"}
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatEur(rollup.netWorthEur, lang)}
            </div>
          </div>
          {delta && delta.absolute !== 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("mp_assets_yoy") || "vs"} {delta.previousYear}
              </div>
              <div
                className={`text-lg font-semibold tabular-nums inline-flex items-center gap-1 ${
                  delta.absolute > 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {delta.absolute > 0 ? (
                  <ArrowUp className="h-4 w-4" />
                ) : (
                  <ArrowDown className="h-4 w-4" />
                )}
                {delta.absolute > 0 ? "+" : "−"}
                {formatEur(Math.abs(delta.absolute), lang)}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {ORDER.filter((c) => rollup.byCategory[c].count > 0).map((c) => {
            const r = rollup.byCategory[c];
            const Icon = CATEGORY_ICONS[c];
            const isDebt = c === "debt";
            return (
              <div
                key={c}
                className="rounded-md border bg-muted/30 p-2 flex items-start gap-2"
              >
                <Icon
                  className={`h-4 w-4 shrink-0 mt-0.5 ${isDebt ? "text-red-600" : "text-muted-foreground"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                    {t(CATEGORY_KEYS[c]) || CATEGORY_FALLBACKS[c]}
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {r.totalEur > 0 ? formatEur(r.totalEur, lang) : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.count}{" "}
                    {r.count === 1
                      ? t("mp_assets_item") || "item"
                      : t("mp_assets_items") || "items"}
                    {r.count > r.valuedCount &&
                      ` · ${r.count - r.valuedCount} ${t("mp_assets_unvalued") || "unvalued"}`}
                  </div>
                  {c === "real_estate" && propertyParts.length > 0 && (
                    <div className="text-[11px] leading-snug text-muted-foreground">
                      {propertyParts
                        .map((p) => t(`pp_prop_kind_${p.kind}`, { count: p.n }))
                        .join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {incomeRows.length > 0 && (
          <div className="mt-4 pt-3 border-t">
            <div className="text-xs font-medium mb-2 flex items-center gap-2">
              <Coins className="h-3.5 w-3.5" />
              <span id={incomeHeadingId}>
                {t("mp_income_heading") || "Annual income"}
              </span>
              {/* NOT a single total. The two columns are two PEOPLE — summing them
                  produced a „Общо" that reads as the declarant's own income: Йотова's
                  card said EUR 163,255 where her declared income is EUR 104,975 and the
                  rest is her spouse's. Name each side instead; the spouse only appears
                  when there is spouse income to show. */}
              <span
                data-testid="income-totals"
                className="text-muted-foreground font-normal"
              >
                · {t("mp_income_declarant") || "Declarant"}{" "}
                {formatEur(incomeTotalDeclarant, lang)}
                {/* `!== 0`, matching the row filter: a tax base can be negative, and a
                    `> 0` guard hid the spouse here while the table below still showed
                    them — the summary would contradict the rows it summarises. */}
                {incomeTotalSpouse !== 0 && (
                  <>
                    {" · "}
                    {t("mp_income_spouse") || "Spouse"}{" "}
                    {formatEurSigned(incomeTotalSpouse, lang)}
                  </>
                )}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table
                className="w-full text-xs"
                aria-labelledby={incomeHeadingId}
              >
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="text-left font-normal py-1 pr-2">
                      {t("mp_income_category") || "Category"}
                    </th>
                    <th
                      scope="col"
                      className="text-right font-normal py-1 px-2 tabular-nums"
                    >
                      {t("mp_income_declarant") || "Declarant"}
                    </th>
                    <th
                      scope="col"
                      className="text-right font-normal py-1 pl-2 tabular-nums"
                    >
                      {t("mp_income_spouse") || "Spouse"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {incomeRows.map((r, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-2">{r.category ?? "—"}</td>
                      <td className="py-1 px-2 text-right tabular-nums font-mono">
                        {r.amountEurDeclarant
                          ? formatEur(r.amountEurDeclarant, lang)
                          : "—"}
                      </td>
                      <td className="py-1 pl-2 text-right tabular-nums font-mono">
                        {r.amountEurSpouse
                          ? formatEur(r.amountEurSpouse, lang)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {unvaluedItems.length > 0 && (
          <div className="mt-4 pt-3 border-t">
            <div className="text-xs font-medium mb-1.5">
              {t("mp_assets_unvalued_heading") ||
                "Items declared without value"}
            </div>
            <ul
              id={unvaluedListId}
              className="text-xs text-muted-foreground space-y-0.5"
            >
              {(showAllUnvalued
                ? unvaluedItems
                : unvaluedItems.slice(0, UNVALUED_PREVIEW)
              ).map((a, i) => {
                const parts: string[] = [];
                // Real estate has rich description; cash/bank/investment
                // rows usually have only a category and currency, so fall
                // back to a category label so the bullet is never empty.
                if (a.description) {
                  parts.push(a.description);
                } else {
                  parts.push(
                    t(CATEGORY_KEYS[a.category]) ||
                      CATEGORY_FALLBACKS[a.category],
                  );
                }
                if (a.detail && a.detail !== a.description)
                  parts.push(a.detail);
                if (a.location) parts.push(a.location);
                if (a.areaSqm) parts.push(`${a.areaSqm} m²`);
                if (a.amount != null && a.currency && a.currency !== "BGN") {
                  parts.push(`${a.amount} ${a.currency}`);
                } else if (a.amount != null && a.currency === "BGN") {
                  // Euro since 2026-01-01 — show the BGN declaration converted.
                  parts.push(
                    formatEur(toEur(Number(a.amount), "BGN") ?? 0, lang),
                  );
                }
                if (a.share) parts.push(`(${a.share})`);
                if (a.acquiredYear) parts.push(`${a.acquiredYear}`);
                const Icon = CATEGORY_ICONS[a.category];
                return (
                  <li key={i} className="flex items-start gap-2">
                    <Icon className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/60" />
                    <span className="flex-1">{parts.join(" · ")}</span>
                    {declarantName && (
                      <HolderChip asset={a} className="italic shrink-0" />
                    )}
                  </li>
                );
              })}
              {/* The overflow used to be a dead italic line reading "+3 още" — wrong word
                  order in Bulgarian, and unclickable, although the items were already in
                  memory. The only way to the rest of the list was the card's "Виж детайли"
                  link to another page. */}
              {unvaluedItems.length > UNVALUED_PREVIEW && (
                <li>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedFor((v) =>
                        v === rollup.sourceUrl ? null : rollup.sourceUrl,
                      )
                    }
                    aria-expanded={showAllUnvalued}
                    aria-controls={unvaluedListId}
                    className="italic text-primary hover:underline"
                  >
                    {showAllUnvalued
                      ? t("mp_assets_show_less") || "Show less"
                      : t("mp_assets_show_more", {
                          count: unvaluedItems.length - UNVALUED_PREVIEW,
                          defaultValue: "Show {{count}} more items",
                        })}
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="text-xs text-muted-foreground mt-3 pt-3 border-t flex flex-wrap items-center gap-x-2">
          <a
            href={rollup.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {/* The PERIOD the filing covers, not the year it was lodged — the axis the card
                header above already uses and the axis every filing row beneath this card
                uses. `periodYear` in 090's vocabulary; reconstructed from two fields the
                type already carries, since an annual is filed the May after the year it
                closes. Left on `latestDeclarationYear`, the same document was labelled 2025
                here and 2024 one line below (measured on mp-1588). */}
            register.cacbg.bg ·{" "}
            {rollup.fiscalYear ?? rollup.latestDeclarationYear}
            <ExternalLink className="h-3 w-3" />
          </a>
          <span>
            ·{" "}
            {t("mp_assets_source_note") ||
              "Combined declarant and spouse holdings; source: Court of Audit."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
