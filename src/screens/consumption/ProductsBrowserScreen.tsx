// /consumption/products — browse & search all ~124k products.
//
// The feature the whole migration exists to enable: the old pipeline kept only the 101 КЗП
// group codes and discarded every real SKU name. This is a server-side DbDataTable over
// price_products (the canonical, cross-chain catalogue). Rows deep-link to /product/:slug. See
// docs/plans/consumption-pg-v1.md §9.
//
// ⚠️ IT IS NOW A REGISTRY BROWSER, on the shared shape /persons and /companies adopted — a
// committed-term hero search field, a labelled filter bar OUTSIDE the table, removable chips,
// and every narrowing in the URL. Plan: docs/plans/products-browse-registry-v1.md. What that
// replaced: the term lived in `DbDataTable`'s own uncontrolled toolbar input and the group
// picker was a bare `useState`, so a reader who filtered to a group and searched „верея" had a
// URL that said `/consumption/products` and nothing else — unshareable, unlinkable from an
// article, and reset by Back and by a refresh alike.
//
// ⚠️ AND IT KEEPS ITS TABLE, unlike both siblings, which render none until something is
// searched. That is a decision rather than an omission (plan §1): their defaults were a list
// nobody asked for, while `chain_count desc` here is „the most widely stocked products in the
// КЗП basket", every column renders a value for every row, and the prerendered body and the
// sitemap `<loc>` both describe a catalogue. The cost is that `RegistrySearchField` shows its
// example chips only on an empty state it never reaches, so the placeholder carries them.

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import {
  DbDataTable,
  type DbColumnFilter,
  type DbTableResponse,
} from "@/ux/data_table/DbDataTable";
import { SEARCH_MIN_CHARS } from "@/ux/data_table/searchTerm";
import { usePriceDict } from "@/data/prices/usePrices";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import {
  useUrlProductFilters,
  PRODUCT_FILTER_ALL,
  PRODUCT_UNITS,
  PRODUCT_TRENDS,
  PRODUCT_TREND_RANGE,
} from "@/data/prices/useUrlProductFilters";
import { useProductFacets } from "@/data/prices/useProductFacets";
import { facetKey } from "@/data/registry/useRegistryFacets";
import type { RegistryFilterOption } from "@/screens/components/RegistryFilterSelect";
import { useRegistryDraft } from "@/screens/components/useRegistryDraft";
import { ProductsSearchField } from "@/screens/consumption/ProductsSearchField";
import { ProductsFilterBar } from "@/screens/consumption/ProductsFilterBar";
import { ProductsActiveFilters } from "@/screens/consumption/ProductsActiveFilters";
import {
  PRODUCT_UNIT_LABELS,
  PRODUCT_TREND_LABELS,
} from "@/screens/consumption/productsBrowseConstants";
import {
  buildProductColumns,
  type ProductRow,
} from "@/screens/consumption/productColumns";

export const ProductsBrowserScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const locale = bg ? "bg-BG" : "en-US";
  const fmtInt = (n: number) => n.toLocaleString(locale);
  const { data: dict } = usePriceDict();

  const f = useUrlProductFilters();

  // ── THE TERM: a draft in the box, a committed term in ?q ─────────────────────────────────
  //
  // The rule lives once, in `useRegistryDraft` — nothing downstream sees a keystroke until the
  // reader submits, so there is no per-character engine request on the way to „мляко" and `?q`
  // is written exactly once.
  const { draft, setDraft, onSubmitQuery, onClearAll } = useRegistryDraft(
    f.query,
    f.setQuery,
    f.clearFilters,
  );

  // The full catalogue only carries a national current-min price; per-place pricing is
  // settlement-grain and lives on the product page. So the browser stays national and instead
  // carries the ?area= anchor onto each product link (client-only — the prerendered/canonical
  // page is unchanged) so the product page opens with the pinned place's local prices.
  const anchor = useAreaAnchor();
  const area = useAreaResolver(anchor?.id);
  const placeName =
    area?.kind === "settlement"
      ? bg
        ? area.settlement.name
        : area.settlement.name_en
      : area?.kind === "municipality"
        ? bg
          ? area.municipality.name
          : area.municipality.name_en
        : null;

  // ── FILTERS SENT TO THE ENGINE ───────────────────────────────────────────────────────────
  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const out: DbColumnFilter[] = [];
    if (f.group !== PRODUCT_FILTER_ALL)
      out.push({ id: "pid", value: [Number(f.group)] });
    if (f.unit !== PRODUCT_FILTER_ALL)
      out.push({ id: "net_unit", value: [f.unit] });
    if (f.trend !== PRODUCT_FILTER_ALL)
      // BOTH bounds — the outer one keeps `euroPctSafe`'s „—" artifacts out of a „поскъпнали"
      // view, the inner one is the same threshold the cell paints red/green at. See
      // PRODUCT_TREND_RANGE.
      out.push({ id: "pct_since_euro", ...PRODUCT_TREND_RANGE[f.trend] });
    // ⚠️ A SECOND `chain_count` PREDICATE, not a replacement for the floor below. The engine
    // ANDs every entry in `filters.columns` independently, so `>= 1` and `>= 2` compose — and
    // the floor must stay in `fixedFilters`, where a reader cannot remove it.
    if (f.multiChain) out.push({ id: "chain_count", min: 2 });
    if (f.looseOnly) out.push({ id: "unit_priced", value: true });
    return out;
  }, [f.group, f.unit, f.trend, f.multiChain, f.looseOnly]);

  // Retired products (chain_count = 0) keep their frozen slug so old /product/:slug URLs still
  // resolve, but must never appear in the browser or its count. Server-enforced: the registry
  // validates `chain_count` as a range filter, so the user cannot remove this.
  // (rebuild_catalog zeroes chain_count when a canon_key vanishes — see §4.5 / step 5b.)
  const fixedFilters = useMemo<DbColumnFilter[]>(
    () => [{ id: "chain_count", min: 1 }],
    [],
  );

  // ── WHAT THE COMMITTED SEARCH RETURNED ───────────────────────────────────────────────────
  //
  // ⚠️ THIS EXISTS BECAUSE AN EXPLICIT SUBMIT SETS AN EXPECTATION A LIVE SEARCH DID NOT. Under
  // the old per-keystroke box there was nothing to confirm; now a reader activates a button and,
  // without this, a screen reader hears NOTHING — the field's live region goes from „натиснете
  // Търси" to "", and an emptying live region is not announced. `DbDataTable` has no `aria-live`
  // of its own and its „N реда" is plain text, so this is the only place the outcome can be
  // spoken. The field cannot build the sentence: it counts nothing.
  const [agg, setAgg] = useState<{ count?: number; term?: string }>({});
  const handleData = useCallback(
    (resp: DbTableResponse<ProductRow>, request: Record<string, unknown>) => {
      const filters = request.filters as { global?: string } | undefined;
      setAgg({
        count: resp.aggregates?.count ?? resp.total,
        // The term the figure was ACTUALLY computed under — the table's own value, not whatever
        // is in the box this millisecond. Announcing a count from the PREVIOUS term the moment
        // the box and the URL agree again is worse than silence.
        term: filters?.global,
      });
    },
    [],
  );
  // The filters moved and the figure has not. `DbDataTable` keeps the previous page while
  // refetching, so without this a chip click would announce the OLD count as the new search's
  // result. Silence is the honest state while a request is in flight.
  useEffect(() => setAgg({}), [extraFilters]);

  // ── FACETS ───────────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ ONE SPEC PER DIMENSION, EACH EXCLUDING ITS OWN FILTER. Otherwise picking „Мляко"
  // collapses the Група dropdown to just „Мляко" and the reader cannot switch without clearing
  // first. `without` drops by filter id, which is the id each picker owns.
  //
  // ⚠️ AND EVERY SPEC CARRIES THE FLOOR. `useRegistryFacets` sends only `filters` — it has no
  // `fixedFilters` channel — so the retired-product floor has to be folded in here or the
  // counts describe a DIFFERENT population from the table beneath them. Measured 2026-08-31:
  // 124,120 rows in `price_products` against 46,682 at `chain_count >= 1`, so an unfloored
  // „Мляко (2 412)" would promise 2.7× the rows a click returns — and retired products are
  // exactly the ones a click can never show, since the floor is `fixedFilters` and a reader
  // cannot remove it.
  const without = (id: string) => [
    ...fixedFilters,
    ...extraFilters.filter((x) => x.id !== id),
  ];
  const { merged } = useProductFacets({
    // No column is faceted twice on this page, so the flat merge is safe to read — see
    // useProductFacets' header for what would have to change if a KPI band ever lands here.
    group: { columns: ["pid"], filters: without("pid") },
    unit: { columns: ["net_unit"], filters: without("net_unit") },
  });
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of merged.pid ?? []) m.set(facetKey(b.value), b.count);
    return m;
  }, [merged.pid]);
  const unitCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of merged.net_unit ?? []) m.set(facetKey(b.value), b.count);
    return m;
  }, [merged.net_unit]);

  // ⚠️ THE VOCABULARY IS THE DICT, THE COUNTS ARE THE FACET, and the join is deliberate. The
  // facet returns `pid` integers and nothing else, so a facet-only picker would offer 101
  // numbers; the dict is the only place the reader-facing group names live. A group the facet
  // does not answer for is dropped rather than shown at „(0)" — the browsable floor
  // (chain_count >= 1) can legitimately empty one, and an option that returns nothing is a
  // promise a click would not keep.
  // ⚠️ THE DICT'S OWN ORDER, NEVER ALPHABETICAL. `products.json` is ordered by `id`, which runs
  // in `cat` order — bread, dairy, fats, … and the 14th category, the ATC medicine groups,
  // last. So the list reads as the КЗП basket's own structure. Sorting by label instead puts
  // every „(A02) Лекарства за …" group at the top and pushes хляб and мляко below the fold,
  // which is the first thing this picker is opened for. (Shipped that way for one commit; the
  // dropdown opened on antihistamines.)
  const groupOptions = useMemo<RegistryFilterOption[]>(
    () =>
      (dict?.products ?? [])
        .map((p) => ({
          value: String(p.id),
          label: p[lang],
          count: groupCounts.get(String(p.id)),
        }))
        .filter((o) => o.count == null || o.count > 0),
    [dict, lang, groupCounts],
  );

  // ⚠️ THE EMPTY-STRING BUCKET IS DROPPED, and it is the largest one after `g`/`ml` — 11,105 of
  // the browsable rows carry canon's `null` net unit. Radix refuses an empty `SelectItem` value
  // outright, and „no unit" means „the net quantity did not parse from the title", not a
  // category anybody browses by. Built from PRODUCT_UNITS (the producer's own closed union)
  // rather than from the facet's keys, so an unlabelled value can never reach a trigger.
  const unitOptions = useMemo<RegistryFilterOption[]>(
    () =>
      PRODUCT_UNITS.map((u) => ({
        value: u,
        label: t(PRODUCT_UNIT_LABELS[u].key, {
          defaultValue: PRODUCT_UNIT_LABELS[u].fallback,
        }),
        count: unitCounts.get(u),
      })).filter((o) => o.count == null || o.count > 0),
    [t, unitCounts],
  );

  // No counts: `/api/db/facets` groups by a column, and `pct_since_euro` is a continuous one —
  // a facet over it would enumerate individual percentages, not the two buckets this control
  // offers. `RegistryFilterOption.count` is optional precisely for this case, and a count that
  // under-promises what clicking returns is worse than no count.
  const trendOptions = useMemo<RegistryFilterOption[]>(
    () =>
      PRODUCT_TRENDS.map((v) => ({
        value: v,
        label: t(PRODUCT_TREND_LABELS[v].key, {
          defaultValue: PRODUCT_TREND_LABELS[v].fallback,
        }),
      })),
    [t],
  );

  // ⚠️ ONE CHIP PER NARROWING PARAM — the contract `PRODUCT_NARROWING_PARAMS` states and
  // `ProductsBrowserScreen.test.tsx` iterates. A narrowing with no chip is a table filtered by
  // something the page names nowhere, which is reachable from any hand-built or shared URL.
  const chips = [
    f.group !== PRODUCT_FILTER_ALL && {
      id: "group",
      dimension: t("products_group_label", { defaultValue: "Група" }),
      // Resolved through the SAME dictionary the picker uses, falling back to the raw id rather
      // than to nothing: a deep link naming a group the dict has not loaded (or no longer
      // carries) still shows the reader what is applied.
      label:
        (dict?.products ?? []).find((p) => String(p.id) === f.group)?.[lang] ??
        f.group,
      onRemove: () => f.setGroup(PRODUCT_FILTER_ALL),
    },
    f.unit !== PRODUCT_FILTER_ALL && {
      id: "unit",
      dimension: t("products_unit_label", { defaultValue: "Мерна единица" }),
      label: t(PRODUCT_UNIT_LABELS[f.unit].key, {
        defaultValue: PRODUCT_UNIT_LABELS[f.unit].fallback,
      }),
      onRemove: () => f.setUnit(PRODUCT_FILTER_ALL),
    },
    f.trend !== PRODUCT_FILTER_ALL && {
      id: "trend",
      dimension: t("products_trend_label", {
        defaultValue: "Промяна от еврото",
      }),
      label: t(PRODUCT_TREND_LABELS[f.trend].key, {
        defaultValue: PRODUCT_TREND_LABELS[f.trend].fallback,
      }),
      onRemove: () => f.setTrend(PRODUCT_FILTER_ALL),
    },
    f.multiChain && {
      id: "multi",
      label: t("products_filter_multi", {
        defaultValue: "в поне 2 вериги",
      }),
      onRemove: () => f.setMultiChain(false),
    },
    f.looseOnly && {
      id: "loose",
      label: t("products_filter_loose", {
        defaultValue: "на килограм (насипни)",
      }),
      onRemove: () => f.setLooseOnly(false),
    },
  ].filter(Boolean) as {
    id: string;
    dimension?: string;
    label: string;
    onRemove: () => void;
  }[];

  const columns = useMemo(
    () => buildProductColumns(T, lang, anchor?.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bg, lang, anchor?.id],
  );

  return (
    <>
      <SEO
        title={T("Продукти и цени", "Products and prices")}
        description={T(
          "Търси и сравнявай цените на хиляди продукти по вериги в България от въвеждането на еврото.",
          "Search and compare prices of thousands of products across chains in Bulgaria since the euro.",
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Продукти", "Products")}
        className="mt-4 mb-2"
      />
      <Title>{T("Продукти", "Products")}</Title>

      {anchor && placeName ? (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="size-3.5 shrink-0 text-primary" />
          <span>
            {T(
              `Отворете продукт, за да видите цените за ${placeName}.`,
              `Open a product to see prices for ${placeName}.`,
            )}
          </span>
        </div>
      ) : null}

      <ProductsSearchField
        className="mb-4"
        value={draft}
        onChange={setDraft}
        onSubmit={onSubmitQuery}
        // The term the RESULTS came from, so the field can say „натиснете Търси" when the box
        // has moved past them. `?q` rather than the table's echo of it: a response-derived
        // value would announce a disagreement for the length of every request that the reader
        // has already resolved.
        applied={f.query}
        minChars={SEARCH_MIN_CHARS}
        // ALWAYS TRUE on this page — the table is never hidden, so the field defers its
        // guidance line to the table body (which carries the same sentence) except while the
        // box and the results disagree. See the component's `visibleHint` priority order.
        tableVisible
        // The outcome of the submit, through the field's live region. Withheld until the
        // aggregate describes the term now in `?q` — see `handleData`.
        resultSummary={
          agg.count != null && (agg.term ?? "") === f.query.trim()
            ? t("products_search_results", {
                defaultValue: "Намерени са {{n}} продукта.",
                n: fmtInt(agg.count),
              })
            : undefined
        }
        // Only for a reader who arrived clean. A `?q` or filter deep link means they asked for
        // a list, and parking the cursor in a search box jumps a screen reader past the h1.
        autoFocus={!f.query && !f.hasNarrowingFilters}
      />

      <ProductsFilterBar
        selects={[
          {
            key: "group",
            label: t("products_group_label", { defaultValue: "Група" }),
            allLabel: t("products_all_groups", {
              defaultValue: "Всички групи",
            }),
            value: f.group,
            options: groupOptions,
            onChange: f.setGroup,
            locale,
          },
          {
            key: "unit",
            label: t("products_unit_label", {
              defaultValue: "Мерна единица",
            }),
            allLabel: t("products_all_units", {
              defaultValue: "Всички единици",
            }),
            value: f.unit,
            // The hook types this `(v: ProductOrAll<ProductUnit>) => void` on purpose — a typo'd
            // literal must not compile — while the shared spec is `(v: string) => void`, because
            // other pages' dimensions are open vocabularies. What arrives here always comes from
            // the options above, and `readOneOf` refuses anything else on the next read anyway.
            options: unitOptions,
            onChange: f.setUnit as (v: string) => void,
            locale,
          },
          {
            key: "trend",
            // ⚠️ „ОТ ЕВРОТО" IS ON THE CONTROL, not in a footnote. `pct_since_euro` is measured
            // against euro-day (1 Jan 2026) over a КЗП MONITORING basket, not the official ИПЦ —
            // a control labelled merely „Поскъпнали" would read as a claim about inflation.
            label: t("products_trend_label", {
              defaultValue: "Промяна от еврото",
            }),
            allLabel: t("products_all_trends", {
              defaultValue: "Всякаква промяна",
            }),
            value: f.trend,
            options: trendOptions,
            onChange: f.setTrend as (v: string) => void,
            locale,
          },
        ]}
        toggles={[
          {
            key: "multi",
            label: t("products_filter_multi", {
              defaultValue: "в поне 2 вериги",
            }),
            // ⚠️ THE CAVEAT BELONGS ON THE CONTROL THAT CREATES THE SET. Measured 2026-08-31:
            // 40,457 of the 46,682 browsable products (86.7%) are stocked in exactly ONE chain,
            // so for those „най-ниска цена" is the only price anybody observed rather than the
            // best of several. This toggle is what makes that column a comparison.
            hint: t("products_filter_multi_hint", {
              defaultValue:
                "само продуктите, за които има цена от повече от една верига",
            }),
            checked: f.multiChain,
            onChange: f.setMultiChain,
          },
          {
            key: "loose",
            label: t("products_filter_loose", {
              defaultValue: "на килограм (насипни)",
            }),
            hint: t("products_filter_loose_hint", {
              defaultValue: "плодове, зеленчуци и месо с цена за килограм",
            }),
            checked: f.looseOnly,
            onChange: f.setLooseOnly,
          },
        ]}
      />

      <ProductsActiveFilters chips={chips} onClearAll={onClearAll} />

      <section aria-label={T("Продукти", "Products")}>
        <DashboardSection id="products">
          <DbDataTable<ProductRow>
            resource="price_products"
            columns={columns}
            fixedFilters={fixedFilters}
            extraFilters={extraFilters}
            defaultSort={[{ id: "chain_count", desc: true }]}
            // CONTROLLED, input hidden — the hero field above owns the box — and it is the
            // COMMITTED term, so the table's own 250 ms debounce is skipped. The
            // SEARCH_MIN_CHARS floor stays in the table, which is what keeps a sub-floor term
            // from reaching the engine as a 400.
            search={f.query}
            hideSearchInput
            searchIsCommitted
            onData={handleData}
            renderAggregates={(_agg, total, totalExact) => (
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {totalExact ? "" : "≈"}
                  {fmtInt(Number(total ?? 0))}
                </span>{" "}
                {T("продукта", "products")}
              </span>
            )}
          />
        </DashboardSection>
      </section>
    </>
  );
};
