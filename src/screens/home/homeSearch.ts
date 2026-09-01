// The global home's finder — five groups, four requests, no second index.
//
// The home page is a hub OF HUBS, so a reader who already knows what they want („Сливен",
// „Желязков", „АПИ", „кисело мляко") would otherwise have to guess which of eight tiles
// contains the page that contains it. This box is the way past that guess, and it is the
// reason the grid can stay eight tiles rather than growing a ninth for every subject.
//
// ⚠️ IT BUILDS NO NEW INDEX AND ADDS NO NEW ENDPOINT. Every group reuses an authority that
// already exists:
//
//   places        the SLIM place catalog (`buildPlaceItems`), the same rows the My-Area
//                 autocomplete uses — NOT the fat `useSearchItems`, which additionally
//                 pulls ~4.4 MB this box would immediately discard
//   people        /api/db/person-search, the source /governance uses
//   institutions  /api/db/procurement-search  ┐ ONE request, shared — see
//   companies     /api/db/procurement-search  ┘ procurementSearchSource.ts
//   products      /api/db/price-search, the endpoint the consumption hub uses
//
// So a keystroke costs three requests, not five, and the place group costs none at all.
//
// ⚠️ AND NOTHING LOADS BEFORE INTENT. The place catalog is ~980 KB and is fetched only once
// `HubSearch` arms (focus or first keystroke), which is why the screen passes `armed` down
// rather than building the index unconditionally. On the site's entry page that distinction
// is the difference between a finder and a tax on every visitor.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §8.

import { MapPin, ShoppingBasket, Users, FileText } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import type { HubSearchSource } from "@/ux/search/hubSearchSources";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  fetchProcurementAwarders,
  fetchProcurementCompanies,
} from "@/screens/components/search/procurementSearchSource";
import { positionLabel } from "@/screens/components/procurement/personSearchGroups";
import type { SearchIndexType } from "@/data/search/useSearchItems";

interface PersonHit {
  key: string;
  name: string;
  position_type: string | null;
  place_label: string | null;
  href: string;
  has_declaration: boolean;
}
interface PersonSearchResponse {
  power?: PersonHit[];
  altQuery?: string | null;
}

/** A price-search hit. ⚠️ The route returns a BARE ARRAY (`{ body: rows }` in
 *  `functions/db_routes.js`), not an envelope — `ConsumptionSearchTile` reads it the same
 *  way. Wrapping it in a `{ products }` shape that does not exist would leave this group
 *  permanently, silently empty. */
interface PriceHit {
  slug: string;
  title: string;
  brand: string | null;
  /** ⚠️ A STRING over the wire („1000"), not a number — node-postgres serialises the
   *  numeric column that way. Only ever concatenated below, so it is typed as it arrives
   *  rather than as it looks. */
  net_qty: string | number | null;
  net_unit: string | null;
}

let lastPersonAlt: { typed: string; alt: string } | null = null;

const fetchPeople = async (
  query: string,
  signal: AbortSignal,
  bg: boolean,
): Promise<SearchItem[]> => {
  const r = await fetch(
    `/api/db/person-search?q=${encodeURIComponent(query)}`,
    {
      signal,
    },
  );
  if (!r.ok) throw new Error(`person-search: ${r.status}`);
  const body = (await r.json()) as PersonSearchResponse;
  lastPersonAlt = body.altQuery ? { typed: query, alt: body.altQuery } : null;
  return (body.power ?? []).map((p) => ({
    id: p.key,
    to: p.href,
    primary: decodeEntities(p.name),
    // Role and place — what tells two people of the same name apart, and this register is
    // full of them. `positionLabel` is the one map, shared with the procurement,
    // governance and declarations boxes so the four cannot disagree.
    secondary:
      [positionLabel(p.position_type, bg), p.place_label]
        .filter(Boolean)
        .map((x) => decodeEntities(String(x)))
        .join(" · ") || undefined,
    icon: p.has_declaration ? FileText : Users,
  }));
};

const fetchProducts = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> => {
  const r = await fetch(`/api/db/price-search?q=${encodeURIComponent(query)}`, {
    signal,
  });
  if (!r.ok) throw new Error(`price-search: ${r.status}`);
  const hits = (await r.json()) as PriceHit[];
  return (Array.isArray(hits) ? hits : []).map((p) => ({
    id: `product-${p.slug}`,
    // `/product/:slug`, the route `ConsumptionSearchTile` already links to.
    to: `/product/${p.slug}`,
    primary: decodeEntities(p.title),
    secondary:
      [p.brand, p.net_qty && p.net_unit ? `${p.net_qty} ${p.net_unit}` : null]
        .filter(Boolean)
        .join(" · ") || undefined,
    icon: ShoppingBasket,
  }));
};

/**
 * ⚠️ THE DIASPORA BUCKET IS NOT A LIST OF BULGARIAN PLACES, and this is the THIRD consumer
 * of `buildPlaceItems` that has to say so. `settlements.json` carries 88 pseudo-settlements
 * at `oblast === "32"` — МИР 32, the abroad district — keyed by ISO country code
 * („Австралия" → AU, „Германия" → DE). Unfiltered, typing „Германия" returns one confident
 * result whose destination is `/governance/DE`, and `useAreaResolver` resolves that AS A
 * REAL SETTLEMENT (obshtina "EU"), rendering a full place dashboard for a country rather
 * than the unknown-place screen. `AreaSniperButton` and `MyAreaEntryScreen` both carry this
 * filter; the geo sweep in `useNearestSettlement` carries its own.
 *
 * Only `type === "s"` rows can be diaspora ones, so the lookup is scoped to them.
 */
const isDiasporaPlace = (
  i: SearchIndexType,
  oblastOf: (key: string) => string | undefined,
): boolean => i.type === "s" && oblastOf(i.key) === "32";

/** A place's destination FROM THE GLOBAL HOME.
 *
 *  ⚠️ `/governance/<id>`, not the parliamentary result. This box reuses the SLIM catalog —
 *  the same rows the My-Area autocomplete and the header crosshair use — and both of those
 *  navigate to `/governance/<id>`, the place dashboard. Sending a place to
 *  `/sections/<ekatte>` instead would answer „what is happening in Сливен" with one
 *  election's polling-section table, which is the narrow reading the root cutover exists to
 *  end.
 *
 *  `path` wins where the row carries one. ⚠️ Those are the synthetic Пловдив and Варна
 *  city rows (`/governance/<id>` set by `buildPlaceItems`), NOT София — deriving over them
 *  would mint a route that does not exist. */
const placeHref = (i: SearchIndexType): string =>
  i.path ?? `/governance/${i.key}`;

/** Coarser grains first. A reader typing „Сливен" almost always means the município or the
 *  oblast rather than one of the settlements inside it, and the region/município rows are a
 *  few hundred against thousands of settlements. */
const PLACE_RANK: Partial<Record<SearchIndexType["type"], number>> = {
  r: 3,
  m: 2,
  d: 2,
  s: 1,
};

/** The place group's index, built from the slim catalog the caller has already fetched.
 *
 *  `null` means "not built yet" — either because the box is unarmed or because the catalog
 *  is still in flight — and `HubSearch` renders that as loading rather than as empty. The
 *  two are different answers and only one of them is a state. */
export const homePlaceIndex = (
  items: SearchIndexType[] | null,
  /** `ekatte -> oblast`, for the diaspora filter. Absent means "cannot tell", and the rows
   *  are kept — a filter that silently drops real places when its lookup is missing would
   *  be worse than the thing it guards against. */
  oblastOf: (key: string) => string | undefined = () => undefined,
) =>
  items
    ? buildEntityIndex<SearchIndexType>(
        items.filter((i) => !isDiasporaPlace(i, oblastOf)),
        (i) => ({
          id: `${i.type}-${i.key}`,
          href: placeHref(i),
          label: decodeEntities(i.name),
          // The parent — „общ. Сливен", „обл. Сливен" — is what separates the fourteen
          // Bulgarian settlements that share a name from one another.
          sub: i.parentName ? decodeEntities(i.parentName) : undefined,
        }),
        // Both spellings, so a Latin-keyboard reader finds a Cyrillic place.
        (i) => [i.name, i.name_en],
        // ⚠️ A RANK IS REQUIRED HERE, NOT OPTIONAL. `buildEntityIndex` returns the first
        // `limit` matches in INPUT order, and the catalog is ~5,000 settlements against 294
        // municipalities — so without a rank, typing a município's own exact name can miss
        // it entirely behind five settlements that merely contain the string. Measured: 11
        // of 294 („Бяла", „Ново село", „Лом", „Трън" …) were unreachable by their own name.
        // Coarser grains first; ties keep input order, which is already alphabetical.
        (i) => PLACE_RANK[i.type] ?? 0,
      )
    : null;

export const homeSearchSources = (
  bg: boolean,
  placeItems: SearchIndexType[] | null,
  oblastOf: (key: string) => string | undefined,
  /** False until `HubSearch` arms. Keeps the place group in its loading state rather than
   *  claiming the catalog is empty before anyone has asked for it. */
  armed: boolean,
): HubSearchSource[] => [
  {
    id: "places",
    label: { bg: "Места", en: "Places" },
    limit: 5,
    kind: "index",
    icon: MapPin,
    index: homePlaceIndex(placeItems, oblastOf),
    // Loading only once somebody has ARMED the box. Before that there is nothing to load
    // and a spinner would be a lie about work in progress.
    loading: armed && !placeItems,
  },
  {
    id: "people",
    label: { bg: "Хора", en: "People" },
    limit: 4,
    kind: "server",
    fetch: (q, s) => fetchPeople(q, s, bg),
    // VERIFIED destination: /persons reads ?q (useUrlPersonFilters). `altQuery` because the
    // browse table runs its own search WITHOUT the shliokavitsa rewrite, so a link built
    // from what was typed advertises rows the destination cannot find.
    seeAll: (q) => ({
      label: bg ? "Виж всички хора" : "See all people",
      to: `/persons?q=${encodeURIComponent(
        lastPersonAlt && lastPersonAlt.typed === q ? lastPersonAlt.alt : q,
      )}`,
    }),
  },
  {
    id: "awarders",
    label: { bg: "Институции", en: "Institutions" },
    limit: 3,
    kind: "server",
    fetch: fetchProcurementAwarders,
    // No see-all: there is no awarders browse page that reads ?q, and a link advertising a
    // filtered destination that delivers an unfiltered one is worse than none.
  },
  {
    id: "companies",
    label: { bg: "Фирми", en: "Companies" },
    limit: 3,
    kind: "server",
    fetch: fetchProcurementCompanies,
    seeAll: (q) => ({
      label: bg ? "Виж всички фирми" : "See all companies",
      // ?pscope=all: the browse table defaults to the selected parliament's window, so a
      // company whose contracts predate it would land on zero rows.
      to: `/procurement/contractors?q=${encodeURIComponent(q)}&pscope=all`,
    }),
  },
  {
    id: "products",
    label: { bg: "Продукти", en: "Products" },
    limit: 3,
    kind: "server",
    fetch: fetchProducts,
    seeAll: (q) => ({
      label: bg ? "Виж всички продукти" : "See all products",
      to: `/consumption/products?q=${encodeURIComponent(q)}`,
    }),
  },
];
