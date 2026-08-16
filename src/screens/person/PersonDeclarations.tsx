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
import { ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { DeclarationsSection } from "./DeclarationsSection";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { assetRowParts } from "./assetRowText";
import { PersonCryptoHoldings } from "./PersonCryptoHoldings";
import {
  usePersonDeclarations,
  useDeclarationDetail,
  type DeclarationDetail,
  type DeclarationListItem,
} from "./usePersonDeclarations";

// Some register filings declare the role lowercase (the 2016 presidency filing lodged
// "вицепрезидент"), later ones capitalise it. Upper-case the first letter for display
// consistency across a person's years; the underlying declared text is untouched.
const capitalizeFirst = (s: string): string =>
  s.length === 0 ? s : s[0].toLocaleUpperCase("bg-BG") + s.slice(1);

const declTypeKey = (type: string): string =>
  ({
    Annualy: "pp_decl_type_annual",
    Entry: "pp_decl_type_entry",
    Vacate: "pp_decl_type_vacate",
    Other: "pp_decl_type_other",
  })[type] ?? "pp_decl_type_other";

export const PersonDeclarations: FC<{
  slug: string;
  /** Mounted INSIDE the MP assets section, which already owns the `#declarations`
   *  heading, the register link and the net-worth headline. Renders the filing list
   *  alone — no `DeclarationsSection`, no stat cards — so an MP gets one section rather
   *  than two with the same DOM id. The caveat rides WITH the list, which is where it
   *  belongs; the MP section above carries a different, source-level note
   *  (`mp_assets_source_note`), so no text is repeated.
   *
   *  It also drops the asset-bearing requirement: bare mode's job is the LIST, and a
   *  person whose only filings are assetless (an incompatibility shell) still has a
   *  record worth showing under a headline somebody else supplied. */
  bare?: boolean;
}> = ({ slug, bare }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const rows = usePersonDeclarations(slug);

  const summary = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    // Newest asset-bearing filing = the wealth snapshot (not rows[0], which is often an
    // assetless incompatibility filing — the D2 bug).
    //
    // The ORDER comes from the server: person_declarations (090) already sorts by
    // byRecency — the PERIOD COVERED, filed_at, filing type, then the stable tie-breaks —
    // the SAME comparator person_wealth_year ranks by. So the first asset-bearing row IS
    // the representative filing, and this block cannot drift from the wealth chart.
    // Re-deriving the comparator here is what made the two disagree once already; don't.
    const withAssets = rows.filter((r) => r.assetCount > 0);
    if (withAssets.length === 0) return null;
    // Within the newest period, prefer the filing that puts a NUMBER on something —
    // person_wealth_year's has_valued_assets tier (090), which the server sort cannot
    // express because it ranks across every year at once. `assetsEur > 0 || debtsEur > 0`
    // is that tier exactly: declared values are non-negative magnitudes, so a positive
    // sum and a `value_eur > 0` row are the same condition. Without it the block took the
    // first asset-bearing row outright and quoted a different net worth from the chart
    // for 23 declarants — an incompatibility shell with one empty row outranking the real
    // filing it shares a period with.
    const newest = withAssets.filter(
      (r) => r.periodYear === withAssets[0].periodYear,
    );
    const latest =
      newest.find((r) => r.assetsEur > 0 || r.debtsEur > 0) ?? newest[0];
    // The prior snapshot is the newest asset-bearing filing covering a DIFFERENT
    // period — periodYear, the same key the sort above and priorAssetDeclaration
    // (src/lib/declarations.ts) use. An annual and an exit filing lodged in one calendar
    // year cover different periods, so keying on the filing year alone would skip a real
    // year-over-year comparison and label the delta against the wrong year.
    const prior =
      withAssets.find((r) => r.periodYear !== latest.periodYear) ?? null;
    return {
      latest,
      net: latest.netEur,
      deltaNet: prior ? latest.netEur - prior.netEur : null,
      priorYear: prior ? prior.periodYear : null,
    };
  }, [rows]);

  // Narrowed ONCE, above both exits, so neither branch needs a non-null assertion to hand
  // `rows` to FilingList. (The standalone path could lean on "summary != null implies rows
  // is non-empty", but that invariant lives fifty lines away and survives refactors that
  // break it.)
  if (!rows || rows.length === 0) return null;

  // The crypto block rides BOTH branches. Bare mode is the MP path, and MPs are not a
  // special case here — Борис Михайлов is the largest declared crypto holding in the
  // corpus. It hangs off `summary.latest` in both, so the coins shown are always the
  // filing whose € the section headlines.
  if (bare)
    return (
      <>
        {summary && <PersonCryptoHoldings filing={summary.latest} />}
        <FilingList rows={rows} locale={locale} />
      </>
    );
  if (!summary) return null;
  const { latest } = summary;

  return (
    <DeclarationsSection
      subtitle={
        <a
          href={latest.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          register.cacbg.bg · {latest.periodYear}
          <ExternalLink className="h-3 w-3" />
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={t("officials_net_worth") || "Net worth"}>
          <div className="text-2xl font-bold text-foreground">
            {formatEurCompact(summary.net, locale)}
            <IncompleteMark row={latest} />
          </div>
          {summary.deltaNet != null &&
            summary.priorYear != null &&
            summary.priorYear !== latest.periodYear && (
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

      <PersonCryptoHoldings filing={latest} />

      <FilingList rows={rows} locale={locale} />
    </DeclarationsSection>
  );
};

/** The "this total is known to be incomplete" marker. 090 drops any asset row above
 *  `asset_row_ceiling_eur()` (€50m) out of the sums rather than publishing an obvious typo
 *  as wealth, and reports how many it dropped — "no silent caps". `/officials/assets` and
 *  the `/persons` money column already render it; this block, which is where the individual
 *  filing is actually shown, was the one staying silent.
 *
 *  Zero filings hit the ceiling in today's corpus, so this renders nowhere yet. That is the
 *  reason to wire it now rather than later: the day a €3.58bn typo lands, the page either
 *  marks it or asserts a capped figure as whole. */
const IncompleteMark: FC<{ row: DeclarationListItem }> = ({ row }) => {
  const { t } = useTranslation();
  if (!row.excludedAssetRows) return null;
  const label = t("pp_decl_excluded_rows", {
    count: row.excludedAssetRows,
    defaultValue:
      "{{count}} декларирани позиции с неправдоподобна стойност не са включени в сбора.",
  });
  return (
    <span className="align-super text-xs text-muted-foreground" title={label}>
      *<span className="sr-only">{label}</span>
    </span>
  );
};

/** Every filing on record, newest first, each expandable to its detail. Shared by the
 *  standalone block and by `bare` mode, so an MP and an official see one list built by one
 *  renderer — the divergence this component was created to end (audit T3.3). */
const FilingList: FC<{ rows: DeclarationListItem[]; locale: string }> = ({
  rows,
  locale,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {rows.map((r) => (
          <FilingRow key={r.id} row={r} locale={locale} />
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("pp_wealth_caveat")}
      </p>
    </>
  );
};

const FilingRow: FC<{ row: DeclarationListItem; locale: string }> = ({
  row,
  locale,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The row is a disclosure widget: the button mounts/unmounts FilingDetail below. Without
  // the pair a screen reader announces only "button" — no indication that a panel exists,
  // opened or collapsed — and in `bare` mode this list is the ONLY route to per-filing
  // detail for an MP.
  const panelId = `filing-${row.id}`;

  return (
    <li>
      <div className="flex items-center hover:bg-muted/40">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {/* The period the filing covers, not the year it was lodged — the same axis
              the wealth chart plots, so a row and its point carry one year label. */}
          <span className="w-12 shrink-0 font-semibold tabular-nums">
            {row.periodYear}
          </span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
            {t(declTypeKey(row.type))}
          </span>
          {/* Lead with the ROLE the person held (position_title), not the body
              (institution). For the presidency the register labels the body "Президент"
              in the older cycles (later "Президентство"), so an institution-first row
              read as "was president" for a vice-president — the position title
              ("Вицепрезидент") is unambiguous. Fall back to the institution for tiers
              that carry no position (MP filings name only "Народно събрание"), and keep
              the body as muted context when both are present. */}
          <span className="flex-1 truncate">
            <span className="text-foreground">
              {capitalizeFirst(row.positionTitle ?? row.institution ?? "")}
            </span>
            {row.positionTitle && row.institution && (
              <span className="text-muted-foreground">
                {" · "}
                {row.institution}
              </span>
            )}
          </span>
          {/* An incompatibility (Other) filing carries no asset tables at all, so it has
              no net worth — printing €0 would read as a collapse in declared wealth, which
              is the D2 bug in miniature. Show a dash. */}
          <span className="shrink-0 tabular-nums">
            {row.assetCount > 0 ? formatEurCompact(row.netEur, locale) : "—"}
            {row.assetCount > 0 && <IncompleteMark row={row} />}
          </span>
        </button>
        {/* Every filing links to its own XML on the register, not just the section
            header — a reader auditing one year lands on that exact declaration. */}
        <a
          href={row.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`register.cacbg.bg · ${row.periodYear}`}
          aria-label={`register.cacbg.bg · ${row.periodYear}`}
          className="shrink-0 px-3 py-2 text-muted-foreground hover:text-primary"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      {open && (
        <div id={panelId}>
          <FilingDetail id={row.id} locale={locale} />
        </div>
      )}
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
      {/* CITATION LINE. The numbers below are quoted by reporters, and the two facts that
          make a quote checkable were only in the XML: WHICH period the filing speaks for,
          and WHICH document it is. The period matters most — this filing sits in the
          register's 2026 folder but declares fiscal 2025, so "the 2026 declaration" is the
          natural miswrite and it is off by a year. Both years are named, then the register's
          own entry number, the filing date, and the link. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border pb-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">
          {t("pp_decl_cite_period", {
            year: detail.fiscalYear ?? detail.year,
          })}
        </span>
        {detail.entryNumber && (
          <span>{t("pp_decl_cite_entry", { entry: detail.entryNumber })}</span>
        )}
        {detail.filedAt && (
          <span>
            {t("pp_decl_cite_filed", {
              date: new Date(detail.filedAt).toLocaleDateString(locale),
            })}
          </span>
        )}
        <span>{t("pp_decl_cite_register", { year: detail.year })}</span>
        <a
          href={detail.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {t("pp_decl_cite_source")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
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
                {/* description + the coin / car make / share issuer + the size of the
                    holding + the location, as one sentence. The middle two were dropped
                    before, which is why four different coins rendered as four identical
                    „Инвестиции €66 030" lines. */}
                {assetRowParts(a, locale, t("pp_decl_units") || "бр.")}
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
                {/* The heading above says "Дялове в дружества". Since the интереси
                    forms are parsed, a row here can also be a DIRECTORSHIP or a
                    sole-tradership — "БЕТА АД · управител" under a stakes heading
                    asserts ownership the row does not support. Ownership is the
                    unmarked case; the other two are marked. */}
                {s.stakeKind && s.stakeKind !== "share" && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {t(`pp_stake_kind_${s.stakeKind}`)}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {s.valueEur != null ? formatEur(s.valueEur, locale) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* Two groups, because they answer different questions and a shared heading
          would mislabel one of them: estate events are what left the estate or was
          paid for by somebody else; interests are the separate интереси filing's
          contracts, related persons and early-repaid debts. */}
      <EventGroup
        title={t("pp_decl_events")}
        events={detail.events.filter((e) => !INTEREST_EVENT_KINDS.has(e.kind))}
        locale={locale}
      />
      <EventGroup
        title={t("pp_decl_interests")}
        events={detail.events.filter((e) => INTEREST_EVENT_KINDS.has(e.kind))}
        locale={locale}
      />
    </div>
  );
};

/** The kinds that come off the INTERESTS forms rather than the asset form —
 *  see DeclarationEventKind (src/data/dataTypes.ts). */
const INTEREST_EVENT_KINDS = new Set([
  "interest_contract",
  "related_person",
  "early_repayment",
]);

const EventGroup: FC<{
  title: string;
  events: NonNullable<DeclarationDetail>["events"];
  locale: string;
}> = ({ title, events, locale }) => {
  const { t } = useTranslation();
  if (events.length === 0) return null;
  return (
    <div className="border-t border-border pt-1">
      <div className="mb-0.5 font-medium">{title}</div>
      {events.map((e, i) => (
        <div key={i} className="flex justify-between gap-2 py-0.5">
          <span className="truncate">
            {t(`pp_decl_event_${e.kind}`)}: {e.description}
            {/* The counterparty / holder, then how it happened. On an early
                repayment that basis is the ORIGIN OF THE FUNDS ("дарение") —
                the single field the whole table exists to record, so dropping
                it would keep the row as uninformative as the misparse it
                replaces. */}
            {e.detail ? ` · ${e.detail}` : ""}
            {e.legalBasis && (
              <span className="ml-1 text-muted-foreground">
                ({e.legalBasis})
              </span>
            )}
          </span>
          {/* An interests row states a fact, not a price — only the early-repayment
              table carries money at all. A dash says "not stated" rather than €0,
              which would read as a debt settled for nothing. */}
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {e.valueEur != null ? formatEur(e.valueEur, locale) : "—"}
          </span>
        </div>
      ))}
    </div>
  );
};
