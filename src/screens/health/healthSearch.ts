// The /sector/health finder's sources — pure data, no JSX (the edu finder's
// shape).
//
// Four groups:
//
//   · bodies — a CLIENT index over the whole roster (HEALTH_ENTITIES: НЗОК, МЗ
//     and the second-level МЗ bodies, one row per institution — a retired EIK is
//     a search key of its successor, never a row of its own). Ranked by the hub
//     blob's per-body € once it has loaded; each row lands on the all-time
//     awarder page, the window its € was measured on. The sector's excluded list
//     is two CLASSES (hospitals, РЗОК), not EIKs, so there is nothing more to list.
//   · hospitals — the НЗОК payments payload, one row per EIK → /company/:eik.
//   · molecules — the quarterly drug payload, every INN → /molecule/:inn.
//   · contractors and contracts — wholeRegisterSources(), labelled as unscoped.
//
// The two НЗОК groups ride payloads the hub does NOT fetch, so the hub requests
// them only on `onArm`: a reader who never searches pays nothing.

import { Building2, Pill, Stethoscope } from "lucide-react";
import type {
  HubSearchSource,
  IndexSource,
} from "@/ux/search/hubSearchSources";
import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";
import { wholeRegisterSources } from "@/screens/components/search/wholeRegisterSources";
import { awarderAllTimeHref } from "@/screens/components/search/procurementSearchSource";
import type { HealthHubStats } from "@/data/health/hubStats";
import { formatEurCompact } from "@/lib/currency";
import {
  HEALTH_ENTITIES,
  HEALTH_UNIVERSE_LABEL,
  type HealthUniverse,
} from "@/lib/healthReferenceData";
import {
  MZ_SECOND_LEVEL_BODIES,
  mzBodySearchKeys,
} from "@/lib/mzSecondLevelBodies";

interface BodyRow {
  eik: string;
  name: { bg: string; en: string };
  /** Extra search keys: a retired EIK and its old name find the successor;
   *  a second-level body also answers to its family noun (ЦСМП, РЗИ…). */
  aliases: (string | null | undefined)[];
  universe: HealthUniverse;
}

const MZ_BODY = new Map(MZ_SECOND_LEVEL_BODIES.map((b) => [b.eik, b]));

const BODIES: BodyRow[] = HEALTH_ENTITIES.filter((e) => !e.retiredEikOf).map(
  (e) => {
    const mz = MZ_BODY.get(e.eik);
    return {
      eik: e.eik,
      name: e.name,
      aliases: [
        ...HEALTH_ENTITIES.filter((r) => r.retiredEikOf === e.eik).flatMap(
          (r) => [r.eik, r.name.bg],
        ),
        ...(mz ? mzBodySearchKeys(mz) : []),
      ],
      universe: e.universe,
    };
  },
);

/** Every roster institution. Ranked by the blob's € when it is in. */
export const healthBodiesIndex = (
  s: HealthHubStats | null | undefined,
  lang: string,
  bg: boolean,
): EntityIndex => {
  const eurOf = new Map((s?.bodyIndex ?? []).map((b) => [b.eik, b.eur]));
  return buildEntityIndex(
    BODIES,
    (b) => {
      const eur = eurOf.get(b.eik);
      const label = HEALTH_UNIVERSE_LABEL[b.universe];
      return {
        id: b.eik,
        label: bg ? b.name.bg : b.name.en,
        sub: [
          bg ? label.bg : label.en,
          eur != null ? formatEurCompact(eur, lang) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: awarderAllTimeHref(b.eik),
      };
    },
    (b) => [
      b.name.bg,
      b.name.en,
      b.eik,
      ...b.aliases,
      HEALTH_UNIVERSE_LABEL[b.universe].bg,
      HEALTH_UNIVERSE_LABEL[b.universe].en,
    ],
    s ? (b) => eurOf.get(b.eik) ?? 0 : undefined,
  );
};

export const healthSearchSources = (args: {
  stats: HealthHubStats | null | undefined;
  hospitals: EntityIndex | null;
  hospitalsLoading: boolean;
  molecules: EntityIndex | null;
  moleculesLoading: boolean;
  lang: string;
  bg: boolean;
}): HubSearchSource[] => [
  {
    kind: "index",
    id: "bodies",
    label: {
      bg: "Институции в здравеопазването",
      en: "Health institutions",
    },
    icon: Building2,
    limit: 8,
    index: healthBodiesIndex(args.stats, args.lang, args.bg),
  } as IndexSource,
  {
    kind: "index",
    id: "hospitals",
    label: {
      bg: "Болници — плащания от НЗОК",
      en: "Hospitals — NHIF payments",
    },
    icon: Stethoscope,
    limit: 6,
    index: args.hospitals,
    loading: args.hospitalsLoading,
  } as IndexSource,
  {
    kind: "index",
    id: "molecules",
    label: { bg: "Лекарства (INN)", en: "Medicines (INN)" },
    icon: Pill,
    limit: 6,
    index: args.molecules,
    loading: args.moleculesLoading,
  } as IndexSource,
  ...wholeRegisterSources(args.bg),
];
