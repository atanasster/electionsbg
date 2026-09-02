// The /culture finder's sources — pure data, no JSX.
//
// Built on HubSearch + hubSearchSources, and that is a FORK decision worth
// stating: /culture already had a search box (`CultureSearchBox`, on
// `SectorEntitySearch` + `buildMembersIndex`), which is the mechanism every other
// sector dashboard uses. The hub has four subjects rather than one entity list,
// which is past what an entity index does — so the hub moves to HubSearch and
// keeps the roster as an INDEX SOURCE inside it. Nothing is thrown away: the rows
// below are the same register `CultureSearchBox` folded. `/culture` therefore no
// longer renders a SectorEntitySearch; the sector dashboards keep theirs.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHAT IS SECTOR-SCOPED AND WHAT IS NOT, SAID OUT LOUD.
//
// The plan (§1.8) designs four subjects each split into „in culture" / „elsewhere"
// pairs via `scopedSources()`. Only the FIRST is built that way here, and the
// reason is a route, not a preference: `/api/db/procurement-search` and
// `/api/db/person-search` take no sector argument, so a „culture only" server
// group cannot be asked for. Faking the split client-side by filtering a ranked
// result set is precisely what `scopedSources()`' own header forbids — a partition
// over one ranked set silently becomes a filter, and the out-of-scope half gets
// starved by an in-scope prefix.
//
// So the institutions group is genuinely culture-scoped (it searches the register
// itself), and the two server groups say in their labels that they search the
// whole corpus. A group that cannot be scoped is labelled, never quietly
// presented as scoped. Adding `?sector=` to those two routes is what turns them
// into pairs; until then this file must not claim a narrowing it does not do.
// ═══════════════════════════════════════════════════════════════════════════════

import { Landmark, FileText, Users } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import type {
  HubSearchSource,
  IndexSource,
  ServerSource,
} from "@/ux/search/hubSearchSources";
import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";
import {
  awarderAllTimeHref,
  contractItems,
  awarderItems,
  type ProcurementSearchResponse,
} from "@/screens/components/search/procurementSearchSource";
import {
  CULTURE_BODIES,
  STATE_CULTURE_INSTITUTES,
  ART_SCHOOLS,
  DKI_CONFIRMED_INSTITUTES,
  NFC_EIK,
} from "@/lib/kulturaReferenceData";

// ⚠️ THE SHARED ROW TYPES, NOT LOCAL RE-DECLARATIONS. A narrow local `ContractHit` naming
// only the four fields this file reads is exactly where the dead link below hid: it made it
// easy to forget WHICH CORPUS `key` belongs to (a procurement contract hash, not an ИСУН
// contract number). The fetch itself stays local — this call site passes its own `&limit`,
// which `sharedProcurementSearch` does not offer.
type ProcurementResponse = Pick<
  ProcurementSearchResponse,
  "awarders" | "contracts"
>;
interface PersonHit {
  slug: string;
  name: string;
  summary?: string | null;
}
interface PersonResponse {
  people?: PersonHit[];
}

/** The register, folded once. НФЦ is deliberately absent as a DESTINATION: it is a
 *  Bulstat entity with a zero procurement footprint, so `/awarder/000695833`
 *  renders „no company with this EIK". A group whose row cannot land does not ship
 *  that row — the rule applies per ROW, not only per group, and this is the one
 *  row it catches. */
/** Rows shown per kind in the mixed procurement group — see the quota note on that source. */
const PROCUREMENT_QUOTA = 3;

export const cultureRosterIndex = (): EntityIndex => {
  const seen = new Set(CULTURE_BODIES.map((b) => b.eik));
  return buildEntityIndex(
    [
      ...CULTURE_BODIES.filter((b) => b.eik !== NFC_EIK).map((b) => ({
        eik: b.eik,
        name: b.bg,
      })),
      // Institutes and art schools are proper nouns with no separate EN form —
      // the awarders tile already renders them that way.
      ...[
        ...STATE_CULTURE_INSTITUTES,
        ...ART_SCHOOLS,
        ...DKI_CONFIRMED_INSTITUTES,
      ]
        .filter((i) => !seen.has(i.eik))
        .map((i) => ({ eik: i.eik, name: i.bg })),
    ],
    (row) => ({
      id: row.eik,
      label: row.name,
      sub: row.eik,
      // ⚠️ THE SAME DESTINATION AS THE SERVER ROWS BELOW. One dropdown can show the same
      // institution twice — once from this register index, once from „Поръчки и възложители"
      // — and a bare `/awarder/:eik` navigates with an EMPTY query string, i.e. onto the
      // selected parliament's window, while the server row lands on all-time. Only 3.8% of
      // contract money sits inside that default window, so the index row is the one that
      // would usually say „Няма договори за избрания период." for the very body it names.
      href: awarderAllTimeHref(row.eik),
    }),
    // Both the name and the EIK are search keys: a reader who has a number in
    // front of them (from a contract, a filing) types the number.
    (row) => [row.name, row.eik],
  );
};

export const cultureSearchSources = (bg: boolean): HubSearchSource[] => [
  {
    kind: "index",
    id: "institutions",
    label: { bg: "Културни институции", en: "Culture institutions" },
    icon: Landmark,
    limit: 6,
    index: cultureRosterIndex(),
  } as IndexSource,
  {
    kind: "server",
    id: "procurement",
    // „в целия регистър" is load-bearing: this route searches every sector, and a
    // label implying otherwise would make the first non-culture hit read as a bug.
    label: {
      bg: "Поръчки и възложители — в целия регистър",
      en: "Contracts and buyers — across the whole register",
    },
    icon: FileText,
    // ⚠️ A PER-KIND QUOTA, NOT ONE FLAT LIMIT, AND THE TWO NUMBERS MUST AGREE.
    // `HubSearch` caps a group with `items.slice(0, limit)` over the CONCATENATION, so a
    // group returning `[...awarders, ...contracts]` under a flat cap shows contracts only
    // when the awarder arm comes back short: at the previous `limit: 5` / `&limit=4`, four
    // matching buyers left room for exactly ONE contract and five left none — under a label
    // that promises both. `hubSearchSources`' own header warns about this shape.
    limit: PROCUREMENT_QUOTA * 2,
    fetch: async (q: string, signal: AbortSignal): Promise<SearchItem[]> => {
      const res = await globalThis.fetch(
        `/api/db/procurement-search?q=${encodeURIComponent(q)}&limit=${PROCUREMENT_QUOTA}`,
        { signal },
      );
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as ProcurementResponse;
      // ⚠️ `contractItems`, NOT a local `/funds/contract/:key`. These rows come from
      // `search_contract_titles()`, so `key` is the PROCUREMENT contract hash
      // (`hash(releaseId::contractId::contractorEik::tag)`) — `/funds/contract/:number` is
      // the ИСУН project page, keyed by a contract NUMBER from a different corpus with no
      // shared key. Every contract row in this box used to render „не е намерен" at a 200,
      // silently and for all of them, because no procurement hash can ever be an ИСУН
      // number. The shared builder also encodes the key and names the contractor.
      return [
        ...awarderItems(j)
          .slice(0, PROCUREMENT_QUOTA)
          .map((a) => ({ ...a, secondary: bg ? "възложител" : "buyer" })),
        ...contractItems(j).slice(0, PROCUREMENT_QUOTA),
      ];
    },
    seeAll: (q: string) => ({
      label: bg ? "Всички поръчки в културата" : "All culture contracts",
      to: `/procurement/contracts?sector=culture&q=${encodeURIComponent(q)}`,
    }),
  } as ServerSource,
  {
    kind: "server",
    id: "persons",
    label: { bg: "Хора", en: "People" },
    icon: Users,
    limit: 5,
    fetch: async (q: string, signal: AbortSignal): Promise<SearchItem[]> => {
      const res = await globalThis.fetch(
        `/api/db/person-search?q=${encodeURIComponent(q)}&limit=5`,
        { signal },
      );
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as PersonResponse;
      return (j.people ?? []).map((p) => ({
        id: p.slug,
        to: `/person/${p.slug}`,
        primary: p.name,
        secondary: p.summary ?? undefined,
        icon: Users,
      }));
    },
    seeAll: (q: string) => ({
      label: bg ? "Всички хора" : "All people",
      to: `/persons?q=${encodeURIComponent(q)}`,
    }),
  } as ServerSource,
];
