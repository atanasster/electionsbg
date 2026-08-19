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
import { isSpouseHolder } from "@/lib/declarations";
import { summariseProperties } from "@/lib/propertyKind";
import { cn } from "@/lib/utils";
import { assetRowParts } from "./assetRowText";
import { PersonCryptoHoldings } from "./PersonCryptoHoldings";
import { PersonHeldAbroad } from "./PersonHeldAbroad";
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

  // The property summary needs the ROWS, and only declaration_detail carries them — the
  // filing list has assetCount and no breakdown. Unlike the crypto block, which gates on
  // `cryptoCount` off the list and so costs ~56.8k people nothing, this asks for the detail
  // on every non-bare render. Two things make that acceptable rather than merely admitted:
  // `useDeclarationDetail` now shares one promise per filing id, so this is the SAME request
  // the expander and the crypto block make rather than a third; and it is a
  // single-declaration join.
  //
  // What it still costs is a request for the ~50% of people whose latest filing declares no
  // property at all (measured: 9,622 of 19,188), for whom the card never renders. Making
  // that free needs a property count on the LIST payload (090) — a migration, not a client
  // change.
  //
  // NOT rendered in bare mode, because the MP path already has it: MpAssetsSummary sits
  // directly above and now prints the same breakdown inside its real-estate tile, off rows
  // it had already fetched. Rendering here too would say it twice. Both use
  // `summariseProperties`, so they cannot disagree — that shared fold is the only reason
  // two surfaces answering the same question is acceptable.
  const headlineDetail = useDeclarationDetail(
    !bare && summary ? summary.latest.id : null,
  );
  const propertySummary = useMemo(() => {
    const owned = (headlineDetail?.assets ?? []).filter(
      (a) => a.isHolding !== false && a.category === "real_estate",
    );
    if (owned.length === 0) return null;
    return summariseProperties(owned.map((a) => a.description));
  }, [headlineDetail]);

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
      <div
        className={cn(
          "grid grid-cols-2 gap-3 sm:grid-cols-3",
          // A conditional 4th card gives 3+1 at sm/md — a lone card under a full
          // row. At grid-cols-2 it is 2+2 and fine either way.
          propertySummary && "lg:grid-cols-4",
        )}
      >
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
        {/* WHAT THE HOLDING IS, beside what it is worth. The € cards answer „how much" and
            for property they frequently answer €0 — 38.6% of declared properties carry no
            stated price — so a declarant with nine ниви and a house can headline as almost
            nothing owned. The count and the kind are known regardless, and they are the
            part a reader came for.

            Same fold as the comparison card (`summariseProperties`): two surfaces counting
            one person's properties must not answer differently.

            ⚠️ Rows, not buildings. A house filed as dwelling + terrace + basement + garage
            is four, and the register carries nothing that folds them back — hence
            „декларирани имота", which must not be shortened to „имота". Rented (чуждо)
            property is excluded: it is not the declarant's to hold.

            ⚠️ And rows, not only properties: 1,520 owned real-estate rows corpus-wide are
            RIGHTS rather than things — „право на строеж" (667), „право на ползване" (471)
            — which propertyKind.ts's own header calls out as not properties at all. They
            are counted here, deliberately: the register files them under real estate, they
            surface honestly as „N други имота" in the breakdown, and dropping them would
            make the headline disagree with the rows a reader can expand and count. */}
        {propertySummary && (
          <StatCard label={t("pp_decl_prop_card")}>
            <div className="text-2xl font-bold text-foreground">
              {propertySummary.total}
            </div>
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {/* Through `t`, keyed on the KIND — never `part.label`. PROPERTY_KIND_LABEL
                  is Bulgarian by design (it was written for the BG-only social card), so
                  reading it here printed „9 земеделски имота" under an English „Declared
                  properties", one line above sibling rows that translate correctly via
                  `asset_category_*`. The kind is the translation seam; the label stays the
                  script side's constant. */}
              {propertySummary.parts
                .map((p) => t(`pp_prop_kind_${p.kind}`, { count: p.n }))
                .join(" · ")}
            </div>
          </StatCard>
        )}
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

  // `isHolding` false only for tables 1.2 / 3.4. A shard loaded before the provenance
  // existed carries no tableNum and 089 reads that as a holding, so on such a database
  // every row lands in `ownedAssets` — i.e. exactly today's page, unchanged.
  const ownedAssets = detail.assets.filter((a) => a.isHolding !== false);
  const usedAssets = detail.assets.filter((a) => a.isHolding === false);
  // Shown only when the filing actually pairs a чуждо VEHICLE with a lease debt — the
  // caveat explains a specific arithmetic outcome, so printing it on a filing that merely
  // rents a flat would be noise that trains readers to skip it.
  const usedLeaseCaveat =
    usedAssets.some((a) => a.category === "vehicle") &&
    detail.assets.some(
      (a) =>
        a.category === "debt" &&
        /лизинг/i.test(`${a.description ?? ""} ${a.legalBasis ?? ""}`),
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
            {/* Numeric shape (the citation line is dense), so this cannot use
                @/lib/formatDate — but it needs that module's UTC pin. `filedAt` is a PG
                `date` rendered inside jsonb, so it arrives as a bare day ("2025-05-14");
                formatting it in the reader's zone backdates the filing by one day west of
                Greenwich, on a line that exists to make the figures checkable. */}
            {t("pp_decl_cite_filed", {
              date: new Date(detail.filedAt).toLocaleDateString(locale, {
                timeZone: "UTC",
              }),
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
      {/* The filing's rows, split by whether they are the declarant's to own.
          `isHolding` is server-derived (is_declared_holding, 089) — the client must not
          re-derive it from tableNum, or the site gains a second definition of wealth that
          can drift from the one the totals are computed on.

          Both halves render. Excluding чуждо from the money is the correction; DROPPING it
          from the page would lose the finding — Пеевски's 2025 annual files tables 1 and 3
          as „not declared" and lists eight rented houses and five provided cars, which is
          only visible if we show them. */}
      {ownedAssets.length > 0 && (
        <div>
          {ownedAssets.map((a, i) => (
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
      {/* Sibling of the „ползва" block below: both take rows OUT of the plain asset list
          and say something specific about them. Self-suppressing when the filing declares
          nothing abroad — which is 95% of them. */}
      <PersonHeldAbroad assets={detail.assets} />
      {usedAssets.length > 0 && (
        <div className="border-t border-border pt-1">
          <div className="mb-0.5 font-medium">
            {t("pp_decl_used") || "Ползва, но не притежава"}
          </div>
          {/* The note is NOT optional chrome. The figures below look exactly like the ones
              above and mean something else — „Цена по договор", what the use costs — so a
              reader who takes them for asset values has been misled by the layout. */}
          <div className="mb-1 text-[11px] leading-snug text-muted-foreground">
            {t("pp_decl_used_note")}
          </div>
          {/* THE ASYMMETRY, named where it happens. Table 3.4's dominant use is a LEASED
              vehicle — 1,014 of 1,826 filings carrying a 3.4 row also carry a лизинг debt —
              and the lease liability sits in table 7, which stays counted. So excluding the
              car while keeping the debt can push a net worth below zero: 103 people flip
              from a published positive figure to a negative one, 70 of them on exactly this
              pairing. The arithmetic is right and unexplained it reads as an accusation, so
              the page says why rather than leaving a reader to discover it. */}
          {usedLeaseCaveat && (
            <div className="mb-1 text-[11px] leading-snug text-muted-foreground">
              {t("pp_decl_used_lease")}
            </div>
          )}
          {usedAssets.map((a, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-2 py-0.5"
            >
              <span className="truncate">
                <span className="text-muted-foreground">
                  {t(`asset_category_${a.category}`)}
                </span>{" "}
                {assetRowParts(a, locale, t("pp_decl_units") || "бр.")}
                {/* „договор за наем" / „лизинг" — without it the row is just a flat with a
                    price beside it, which is the reading this block exists to prevent. */}
                {a.legalBasis && (
                  <span className="ml-1 text-muted-foreground">
                    · {a.legalBasis}
                  </span>
                )}
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
              {/* NOT `truncate`. `overflow:hidden` clips from the END, and the holder
                  chip is both the last child and the longest thing on the line (a
                  three-part Bulgarian name is ~25-30 chars against ~19 for „Дийонима
                  ЕООД · 1/1"). On a 375px viewport that clips exactly the marker saying
                  „this is not his company" — the feature failing in the case it exists
                  for, on the devices most readers arrive on. Wrapping costs a line. */}
              <span className="min-w-0 flex-1">
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
                {/* WHOSE company it is. Unmarked, the row reads as this person's
                    company under their own profile: Николай Копринков's page showed
                    „Дийонима ЕООД · 1/1" for a company the filing puts in his wife's
                    name, directly above a companies block naming a different firm. The
                    asset rows have carried this marker all along; the stake rows did
                    not, because `declaration_stake` has no is_spouse column and nobody
                    derived one. We name the holder rather than assert a relationship —
                    the register's own column is „Собственик или титуляр на правото".
                    For how often this fires, and the directorship rows it cannot reach,
                    see the measured split on `isSpouseHolder`. */}
                {isSpouseHolder(s.holderName, detail.declarantName) && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {s.holderName}
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
