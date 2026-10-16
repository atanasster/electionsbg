// The /sector/transport finder's sources — pure data, no JSX. Plan:
// docs/plans/transport-hub-v1.md T6.
//
// Four groups:
//
//   · bodies — a CLIENT index over the sector register (TRANSPORT_ENTITIES: name,
//     mode, EIK) plus the VERIFY body (D3), labelled as not in the totals; ranked by
//     the hub blob's per-body € once it has loaded. Sector-scoped.
//   · sections — the blob's top map features („Видин – София"), landing on the
//     contracts that name them. Sector-scoped.
//   · contractors and contracts — wholeRegisterSources(), the shared whole-register
//     groups (one request per needle, labelled as unscoped).

import { Building2, Route } from "lucide-react";
import type {
  HubSearchSource,
  IndexSource,
} from "@/ux/search/hubSearchSources";
import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";
import { wholeRegisterSources } from "@/screens/components/search/wholeRegisterSources";
import { awarderAllTimeHref } from "@/screens/components/search/procurementSearchSource";
import { TRANSPORT_CONTRACTS_PATH } from "./transportRegistry";
import type { TransportHubStats } from "@/data/transport/hubStats";
import { formatEurCompact } from "@/lib/currency";
import {
  TRANSPORT_ENTITIES,
  TRANSPORT_VERIFY,
  transportUniverseLabel,
  type TransportUniverse,
} from "@/lib/transportReferenceData";

interface BodyRow {
  eik: string;
  name: string;
  nameEn: string;
  universe: TransportUniverse | null;
}

const BODIES: BodyRow[] = [
  ...TRANSPORT_ENTITIES,
  ...TRANSPORT_VERIFY.map((v) => ({
    eik: v.eik,
    name: v.name,
    nameEn: v.nameEn,
    universe: null,
  })),
];

/** Every body in the register, plus the VERIFY body. Ranked by whole-corpus € when
 *  the blob is in; each row links to the awarder page on the all-time window, the
 *  same window its € was measured on. */
export const transportBodiesIndex = (
  s: TransportHubStats | null | undefined,
  lang: string,
  bg: boolean,
): EntityIndex => {
  const eurOf = new Map(
    [...(s?.bodyIndex ?? []), ...(s?.verifyIndex ?? [])].map((b) => [
      b.eik,
      b.eur,
    ]),
  );
  return buildEntityIndex(
    BODIES,
    (b) => {
      const eur = eurOf.get(b.eik);
      const parts = [
        b.universe
          ? transportUniverseLabel(b.universe, lang)
          : bg
            ? "извън сумите — принципалът не е потвърден"
            : "outside the totals — principal unconfirmed",
        eur != null ? formatEurCompact(eur, lang) : null,
      ].filter(Boolean);
      return {
        id: b.eik,
        label: bg ? b.name : b.nameEn,
        sub: parts.join(" · "),
        href: awarderAllTimeHref(b.eik),
      };
    },
    (b) => [
      b.name,
      b.nameEn,
      b.eik,
      b.universe ? transportUniverseLabel(b.universe, "bg") : null,
      b.universe ? transportUniverseLabel(b.universe, "en") : null,
    ],
    s ? (b) => eurOf.get(b.eik) ?? 0 : undefined,
  );
};

/** The blob's top map features, landing on the contracts that name both places. */
export const transportSectionsIndex = (
  s: TransportHubStats | null | undefined,
  lang: string,
): EntityIndex =>
  buildEntityIndex(
    s?.topSegments ?? [],
    (g) => ({
      id: `${g.aTown}|${g.bTown}`,
      label: `${g.aTown} – ${g.bTown}`,
      sub: formatEurCompact(g.eur, lang),
      href: `${TRANSPORT_CONTRACTS_PATH}&q=${encodeURIComponent(`${g.aTown} ${g.bTown}`)}`,
    }),
    (g) => [g.aTown, g.bTown, `${g.aTown} ${g.bTown}`],
    (g) => g.eur,
  );

export const transportSearchSources = (
  s: TransportHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubSearchSource[] => [
  {
    kind: "index",
    id: "bodies",
    label: { bg: "Структури на МТС", en: "MTC bodies" },
    icon: Building2,
    limit: 6,
    index: transportBodiesIndex(s, lang, bg),
  } as IndexSource,
  {
    kind: "index",
    id: "sections",
    label: { bg: "Жп участъци на картата", en: "Rail sections on the map" },
    icon: Route,
    limit: 4,
    index: transportSectionsIndex(s, lang),
  } as IndexSource,
  ...wholeRegisterSources(bg),
];
