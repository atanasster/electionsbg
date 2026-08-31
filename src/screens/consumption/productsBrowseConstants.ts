import type {
  RegistrySearchLabels,
  SearchFieldLabel,
} from "@/screens/components/RegistrySearchField";
import type { RegistryChipLabels } from "@/screens/components/RegistryActiveFilters";

// The /consumption/products screen's exported strings and pure rules.
//
// They live outside the screen for the mechanical reason `personsBrowseConstants.ts` and
// `companiesBrowseConstants.ts` do — exporting a non-component from a component file breaks
// Fast Refresh (`react-refresh/only-export-components`) — and for the one that matters: they
// have to be EXPORTED so a test can pin the KEYS, and a rendered assertion cannot. With no i18n
// instance mounted, react-i18next's `t` returns `defaultValue` without ever reading the key, and
// several fallbacks here are byte-identical to their /persons and /companies twins („Търси",
// „Изчисти търсенето", „например"). So wiring a component to a SIBLING PAGE's label set renders
// identically and passes every rendered assertion. The keys are the only thing that differs.

/** ⚠️ THE HINT NAMES ONLY WHAT THE RESOURCE SEARCHES, and for `price_products` that is exactly
 *  ONE column: `title`, through the `price_products_trgm` gin index. It does NOT search the
 *  brand (that column is NULL on all 124,120 rows), the chain, the category or the settlement —
 *  so „търсете по верига" would teach a query the engine answers with nothing.
 *
 *  The placeholder keeps the wording the page already shipped, now as a key rather than an
 *  inline `T(bg, en)` pair, because the shared field resolves its strings through `t()`. */
export const PRODUCTS_SEARCH_LABELS: RegistrySearchLabels = {
  label: { key: "products_search_label", fallback: "Търсене на продукт" },
  placeholder: {
    key: "products_search_placeholder",
    fallback: "търси продукт, напр. мляко Верея, олио…",
  },
  hint: {
    key: "products_search_hint",
    fallback:
      "Търсете по име на продукта, както е изписано в касовата бележка — марка, вид, грамаж.",
  },
  clear: { key: "products_search_clear", fallback: "Изчисти търсенето" },
  examples: { key: "products_search_examples", fallback: "например" },
  submit: { key: "products_search_submit", fallback: "Търси" },
  pending: {
    key: "products_search_pending",
    fallback: "Натиснете „Търси“, за да видите резултатите.",
  },
};

export const PRODUCTS_CHIP_LABELS: RegistryChipLabels = {
  intro: { key: "products_active_filters", fallback: "Показани са само:" },
  remove: { key: "products_remove_filter", fallback: "Премахни филтъра" },
  // ⚠️ A CONTRACTS KEY, deliberately reused rather than duplicated: „Изчисти филтрите" is the
  // same sentence on every browser and was already translated for /procurement/contracts. Both
  // sibling registries reuse the same one.
  clearAll: { key: "contracts_clear_filters", fallback: "Изчисти филтрите" },
};

export const PRODUCTS_FILTER_BAR_LABEL: SearchFieldLabel = {
  key: "products_filters_label",
  fallback: "Филтри",
};

/** Prefixes every element id the shared components generate on this page. Not collision
 *  prevention — `useId()` already guarantees that — but LEGIBILITY: an id naming its page and
 *  its dimension (`products-filter-group-«r3»`) is greppable in a DOM dump and gives a test a
 *  stable hook for „is this the products bar", which is the one thing a rendered assertion can
 *  check about a wrapper whose i18n fallbacks match its siblings'. */
export const PRODUCTS_REGISTRY_ID_PREFIX = "products";

/** The `net_unit` picker's labels, keyed by the canonical unit.
 *
 *  ⚠️ THE UNIT IS THE *NET QUANTITY'S* UNIT, not a price basis — `g` means the title parsed to a
 *  weight, not that the product is sold by the kilogram. The loose-produce question is the
 *  separate `unit_priced` toggle, and conflating the two would put „на килограм" on 19,686 rows
 *  of packaged goods.
 *
 *  There is deliberately NO entry for the empty string (11,105 browsable rows, canon's `null`):
 *  Radix refuses an empty `SelectItem` value, and the honest label would be „не се разчете от
 *  името", which is not a category anybody browses by. The screen drops that bucket from the
 *  options rather than labelling it. */
export const PRODUCT_UNIT_LABELS: Record<
  string,
  { key: string; fallback: string }
> = {
  g: { key: "products_unit_g", fallback: "Грамаж (g)" },
  ml: { key: "products_unit_ml", fallback: "Обем (ml)" },
  pc: { key: "products_unit_pc", fallback: "Брой (бр.)" },
};

/** The `?trend` picker's labels.
 *
 *  ⚠️ „ОТ ЕВРОТО" IS THE COLUMN'S OWN FRAME AND MUST STAY ON THE CONTROL. `pct_since_euro` is
 *  measured against euro-day (1 Jan 2026), not against last month and not against a year ago,
 *  and this is a MONITORING basket rather than the official ИПЦ — so a control labelled merely
 *  „Поскъпнали" would read as a claim about inflation. */
export const PRODUCT_TREND_LABELS: Record<
  string,
  { key: string; fallback: string }
> = {
  up: { key: "products_trend_up", fallback: "Поскъпнали" },
  down: { key: "products_trend_down", fallback: "Поевтинели" },
};
