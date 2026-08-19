// The unified declaration list for a person (090 person_declarations), served via
// /api/db/person-declarations. One payload spanning every tier the person filed in
// (MP / executive / municipal / magistrate) — this is what lets ONE block replace the
// three divergent per-tier renderers (audit T3.3, retiring D9). declaration_detail(id)
// backs the per-filing drill-down.
//
// All money is rounded server-side (090); the client never recomputes a figure. The list
// also arrives in byRecency order (the comparator person_wealth_year ranks by), so the
// consumer selects the representative filing rather than re-deriving the sort.

import { useEffect, useState } from "react";

export type DeclarationListItem = {
  id: number;
  tier: string;
  /** The year the filing was LODGED (declaration_year). */
  year: number;
  fiscalYear: number | null;
  /** The year the filing SPEAKS FOR — `fiscalYear ?? year`, served by 090 so the
   *  client does not keep a second copy of the COALESCE. This is the wealth
   *  chart's x-axis and the year this row is labelled with; `year` differs from it
   *  by one on every annual, which is filed the May after the year it closes. */
  periodYear: number;
  type: string; // Annualy | Entry | Vacate | Other
  institution: string | null;
  positionTitle: string | null;
  filedAt: string | null;
  sourceUrl: string;
  assetsEur: number;
  debtsEur: number;
  /** assets − debts, computed server-side on the same basis as person_wealth_year so
   *  the block and the chart cannot publish different figures. */
  netEur: number;
  assetCount: number;
  stakeCount: number;
  eventCount: number;
  /** How many declared asset rows 090 left OUT of `assetsEur`/`netEur` because their value
   *  exceeded `asset_row_ceiling_eur()` (€50m) — an implausible figure is almost always a
   *  units typo, and totalling it would publish a billionaire. Non-zero means the sums on
   *  this row UNDERSTATE by an unknown amount and must be marked, never presented as whole
   *  ("no silent caps", 090's header). `/officials/assets` and the `/persons` money column
   *  already honour it. */
  excludedAssetRows: number;
  /** Declared CRYPTO rows on this filing, and their summed declared value. Carried on the
   *  LIST so the profile can decide whether to mount the „Криптоактиви" block without
   *  fetching any filing detail — ~56.8k people hold none, and none of them should pay a
   *  request to find that out. Classified server-side by `is_crypto_asset` (090), so this
   *  block and /declarations/crypto cannot disagree about what counts. */
  cryptoCount: number;
  cryptoEur: number;
  /** Rows from tables 1.2 / 3.4 — property and vehicles the declarant USES but does not
   *  own (rented, or provided by a third party). They contribute to NONE of the figures
   *  above; `usedContractEur` is the summed „Цена по договор", i.e. what the use costs,
   *  and may never be added to `assetsEur`. Carried so the block can say „ползва" instead
   *  of the rows silently vanishing from a filing that sometimes has nothing else in it —
   *  Пеевски's 2025 annual declares no property and no vehicle of his own at all. */
  usedAssetRows: number;
  usedContractEur: number;
};

export const usePersonDeclarations = (
  slug: string,
): DeclarationListItem[] | undefined => {
  const [rows, setRows] = useState<DeclarationListItem[] | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setRows(undefined);
    if (!slug) {
      setRows([]);
      return;
    }
    fetch(`/api/db/person-declarations?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: DeclarationListItem[]) => {
        if (live) setRows(Array.isArray(j) ? j : []);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [slug]);
  return rows;
};

export type DeclarationDetail = {
  id: number;
  tier: string;
  declarantName: string;
  year: number;
  fiscalYear: number | null;
  type: string;
  institution: string | null;
  positionTitle: string | null;
  filedAt: string | null;
  /** The register's own reference for this filing („вх. № Г4937"), and its control hash.
   *  Citation anchors: a reporter naming a figure needs to name the document it came from,
   *  not only link to it. */
  entryNumber: string | null;
  controlHash: string | null;
  sourceUrl: string;
  assets: {
    category: string;
    description: string | null;
    detail: string | null;
    location: string | null;
    municipality: string | null;
    areaSqm: number | null;
    acquiredYear: number | null;
    share: string | null;
    valueEur: number | null;
    holderName: string | null;
    isSpouse: boolean;
    /** The unit the declarant wrote on the row, verbatim. Needed by the renderer to tell a
     *  `detail` that adds something (a coin, a car make, a share issuer) from one that
     *  merely restates this — bank and cash rows store `detail = currency`. */
    currency: string | null;
    /** HOW MUCH of the thing, in its own unit, and that unit — „30 Етериум", „518 000"
     *  shares. Resolved server-side (090) because WHICH declaration column holds the count
     *  depends on the filing shape: table 8 puts it in `amount` with the coin as the
     *  currency, table 9 puts it in `share` and uses `amount` for the leva price. A NULL
     *  `quantityUnit` with a non-null `quantity` means a BARE COUNT — the client supplies
     *  its own localised „бр.", which is why the word is not in the migration. Unrounded:
     *  0.017 BTC and 0.38 ETH are real declared holdings that round to zero. */
    quantity: number | null;
    quantityUnit: string | null;
    /** Server-classified (`is_crypto_asset`, 090). See the type note on cryptoCount. */
    isCrypto: boolean;
    /** Which form table the row came from, canonical (2018-form) numbering. */
    tableNum: string | null;
    /** Is this the declarant's own? FALSE for tables 1.2 / 3.4 — see the note on
     *  `usedAssetRows`. Derived server-side by `is_declared_holding` (089) so the UI
     *  cannot become a second, drifting definition of what counts as wealth. */
    isHolding: boolean;
    /** „Правно основание" — how it was acquired, or for a чуждо row how it is USED
     *  („договор за наем", „лизинг"). The „ползва" block is not self-explanatory
     *  without it. */
    legalBasis: string | null;
  }[];
  income: {
    category: string | null;
    eurDeclarant: number | null;
    eurSpouse: number | null;
  }[];
  stakes: {
    tableNum: string;
    companyName: string | null;
    companySlug: string | null;
    holderName: string | null;
    transfereeName: string | null;
    /** WHAT the row is — a shareholding, a management/board role, or a sole-tradership.
     *  The block is headed "Дялове в дружества", so a role row must be marked. */
    stakeKind: "share" | "role" | "sole_trader" | null;
    itemType: string | null;
    shareSize: string | null;
    valueEur: number | null;
    registeredOffice: string | null;
  }[];
  events: {
    kind: string;
    description: string | null;
    detail: string | null;
    location: string | null;
    municipality: string | null;
    valueEur: number | null;
    legalBasis: string | null;
  }[];
} | null;

// One in-flight-or-settled entry per filing id. THREE components ask for the same id in
// the common case — the property card and the crypto block on page load, and FilingDetail
// when the reader expands that same top filing — and without this each pays its own round
// trip for a byte-identical payload. Module scope and never evicted: a published filing is
// immutable, and one session touches a handful of ids.
//
// Deliberately caches the PROMISE, not the resolved value, so two components mounting in
// the same tick share one request rather than racing two.
const detailCache = new Map<number, Promise<DeclarationDetail>>();

/** Drop every cached filing. Exists for TESTS: the map is module-scoped, so it outlives
 *  `vi.unstubAllGlobals()` and a second case asking for the same id would silently receive
 *  the first case's payload. Nothing in the app calls this — a published filing does not
 *  change, which is the whole reason the cache is safe in the first place. */
export const clearDeclarationDetailCache = (): void => detailCache.clear();

const fetchDetail = (id: number): Promise<DeclarationDetail> => {
  let p = detailCache.get(id);
  if (!p) {
    p = fetch(`/api/db/declaration-detail?id=${id}`)
      .then((r) => r.json())
      .then((j: DeclarationDetail) => j ?? null)
      .catch(() => null);
    detailCache.set(id, p);
  }
  return p;
};

// Fetched lazily only when some consumer asks for a specific filing — the detail join is
// heavier than the list, so it stays off the initial render for anyone who needs none.
export const useDeclarationDetail = (
  id: number | null,
): DeclarationDetail | undefined => {
  const [detail, setDetail] = useState<DeclarationDetail | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setDetail(undefined);
    if (id == null) return;
    fetchDetail(id).then((j) => live && setDetail(j));
    return () => {
      live = false;
    };
  }, [id]);
  return detail;
};
