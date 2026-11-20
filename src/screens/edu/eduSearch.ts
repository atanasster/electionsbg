// The /sector/edu finder's sources — pure data, no JSX. Plan:
// docs/plans/edu-hub-v1.md T6 (the transport T6 shape).
//
// Three groups:
//
//   · bodies — a CLIENT index over ALL FOUR lists: the roll-up register
//     (EDU_ENTITIES, one row per institution — a retired EIK is a search key of
//     its successor, never a row of its own, A5/A6), the VERIFY centres (D3), the
//     ADJACENT bodies under another principal (D4) and the state higher schools
//     counted in another sector (A2). The last three are labelled as outside the
//     totals, so a reader who finds one is told it is not summed. Ranked by the
//     hub blob's per-body € once it has loaded. Sector-scoped.
//   · contractors and contracts — wholeRegisterSources(), the shared
//     whole-register groups (one request per needle, labelled as unscoped).

import { Building2 } from "lucide-react";
import type {
  HubSearchSource,
  IndexSource,
} from "@/ux/search/hubSearchSources";
import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";
import { wholeRegisterSources } from "@/screens/components/search/wholeRegisterSources";
import { awarderAllTimeHref } from "@/screens/components/search/procurementSearchSource";
import type { EduHubStats } from "@/data/edu/hubStats";
import { formatEurCompact } from "@/lib/currency";
import {
  EDU_ADJACENT,
  EDU_ENTITIES,
  EDU_VERIFY,
  EDUCATION_EXTERNAL_HIGHER_SCHOOLS,
  educationUniverseLabel,
  type EducationUniverse,
} from "@/lib/educationReferenceData";
import { EXTERNAL_SECTOR_NAME } from "./eduSectorData";

type Outside =
  | { list: "verify" }
  | { list: "adjacent"; principal: string }
  | { list: "external"; sector: keyof typeof EXTERNAL_SECTOR_NAME };

interface BodyRow {
  eik: string;
  name: string;
  /** Extra search keys: a retired EIK and its old name find the successor. */
  aliases: string[];
  universe: EducationUniverse | null;
  outside: Outside | null;
}

const BODIES: BodyRow[] = [
  ...EDU_ENTITIES.filter((e) => !e.retiredEikOf).map((e) => ({
    eik: e.eik,
    name: e.name,
    aliases: EDU_ENTITIES.filter((r) => r.retiredEikOf === e.eik).flatMap(
      (r) => [r.eik, r.name],
    ),
    universe: e.universe,
    outside: null,
  })),
  ...EDU_VERIFY.map((v) => ({
    eik: v.eik,
    name: v.name,
    aliases: [],
    universe: null,
    outside: { list: "verify" } as const,
  })),
  ...EDU_ADJACENT.map((a) => ({
    eik: a.eik,
    name: a.name,
    aliases: [],
    universe: null,
    outside: { list: "adjacent", principal: a.principal } as const,
  })),
  ...EDUCATION_EXTERNAL_HIGHER_SCHOOLS.map((x) => ({
    eik: x.eik,
    name: x.name,
    aliases: [],
    universe: null,
    outside: { list: "external", sector: x.sector } as const,
  })),
];

const outsideLabel = (o: Outside, bg: boolean): string =>
  o.list === "verify"
    ? bg
      ? "извън сумите — принципалът не е уточнен"
      : "outside the totals — principal unsettled"
    : o.list === "adjacent"
      ? bg
        ? `извън сумите — към ${o.principal}`
        : `outside the totals — under ${o.principal}`
      : bg
        ? `извън сумите — в сектор ${EXTERNAL_SECTOR_NAME[o.sector].bg}`
        : `outside the totals — in the ${EXTERNAL_SECTOR_NAME[o.sector].en} sector`;

/** Every body on the four lists. Ranked by whole-corpus € when the blob is in;
 *  each row links to the awarder page on the all-time window, the window its €
 *  was measured on. The external schools carry no € here — it is counted on
 *  their own sector's page. */
export const eduBodiesIndex = (
  s: EduHubStats | null | undefined,
  lang: string,
  bg: boolean,
): EntityIndex => {
  const eurOf = new Map(
    [
      ...(s?.bodyIndex ?? []),
      ...(s?.verifyIndex ?? []),
      ...(s?.adjacentIndex ?? []),
    ].map((b) => [b.eik, b.eur]),
  );
  return buildEntityIndex(
    BODIES,
    (b) => {
      const eur = b.outside?.list === "external" ? undefined : eurOf.get(b.eik);
      const parts = [
        b.universe
          ? educationUniverseLabel(b.universe, lang)
          : b.outside
            ? outsideLabel(b.outside, bg)
            : null,
        eur != null ? formatEurCompact(eur, lang) : null,
      ].filter(Boolean);
      return {
        id: b.eik,
        label: b.name,
        sub: parts.join(" · "),
        href: awarderAllTimeHref(b.eik),
      };
    },
    (b) => [
      b.name,
      b.eik,
      ...b.aliases,
      b.universe ? educationUniverseLabel(b.universe, "bg") : null,
      b.universe ? educationUniverseLabel(b.universe, "en") : null,
    ],
    s
      ? (b) => (b.outside?.list === "external" ? 0 : (eurOf.get(b.eik) ?? 0))
      : undefined,
  );
};

export const eduSearchSources = (
  s: EduHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubSearchSource[] => [
  {
    kind: "index",
    id: "bodies",
    label: {
      bg: "Институции в образованието и науката",
      en: "Education and science institutions",
    },
    icon: Building2,
    limit: 6,
    index: eduBodiesIndex(s, lang, bg),
  } as IndexSource,
  ...wholeRegisterSources(bg),
];
