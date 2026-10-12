// The /water finder's sources — pure data, no JSX. Plan: docs/plans/water-hub-v1.md T5.
//
// Three groups:
//
//   · operators — a CLIENT index over the sector register (WATER_OPERATORS: the
//     name, oblast, EIK, type and the aliases nobody would guess), ranked by the
//     hub blob's per-operator € once it has loaded. This group IS sector-scoped.
//   · contractors and contracts — wholeRegisterSources(), the shared
//     whole-register groups (one request per needle, labelled as unscoped).
//
// Replaces the old WaterSearchBox, which carried the operator index alone.

import { Droplets } from "lucide-react";
import type {
  HubSearchSource,
  IndexSource,
} from "@/ux/search/hubSearchSources";
import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";
import { companyAllTimeHref } from "@/screens/components/search/procurementSearchSource";
import { wholeRegisterSources } from "@/screens/components/search/wholeRegisterSources";
import type { WaterHubStats } from "@/data/water/hubStats";
import { formatEurCompact } from "@/lib/currency";
import {
  WATER_OPERATORS,
  operatorStatusLabel,
  type WaterOperatorType,
} from "@/lib/vikReferenceData";

/** Reading order for the type label — the holding parent and the concession are
 *  not the same kind of thing as a regional monopoly, and the reader can see it.
 *
 *  Keyed on the UNION, not `string`: an unlabelled type folds to `undefined`,
 *  which `buildEntityIndex` drops silently, so a new operator kind would become
 *  unsearchable by its type name with nothing red anywhere. */
const TYPE_LABEL: Record<WaterOperatorType, { bg: string; en: string }> = {
  holding_parent: { bg: "Холдинг", en: "Holding" },
  holding_sub: { bg: "Регионално ВиК", en: "Regional operator" },
  concession: { bg: "Концесия", en: "Concession" },
  irrigation: { bg: "Напоителни системи", en: "Irrigation" },
  dams: { bg: "Язовири", en: "Dams" },
  municipal: { bg: "Общинско", en: "Municipal" },
};

/** Every body in the sector register. Ranked by whole-corpus € when the blob is
 *  in, so a query that fills the cap („Пазарджик" — five operators) shows the
 *  largest first; before it loads, declaration order. A defunct operator says so
 *  on its own row, and a liquidated one links to its SUCCESSOR: 822106665 has no
 *  Commerce Registry record, so its own company page would show nothing. */
export const waterOperatorsIndex = (
  s: WaterHubStats | null | undefined,
  lang: string,
  bg: boolean,
): EntityIndex => {
  const eurOf = new Map((s?.operatorIndex ?? []).map((o) => [o.eik, o.eur]));
  return buildEntityIndex(
    WATER_OPERATORS,
    (o) => {
      const status = operatorStatusLabel(o.status, bg);
      // A row that links to a SUCCESSOR shows no € of its own: the destination
      // states the successor's figure, and a dead company's € beside it would
      // read as the page's number. It names where the link goes instead.
      const successor = o.successorEik
        ? WATER_OPERATORS.find((x) => x.eik === o.successorEik)
        : undefined;
      const eur = o.successorEik ? undefined : eurOf.get(o.eik);
      const parts = [
        o.oblast,
        status,
        successor ? `→ ${successor.name}` : null,
        eur != null ? formatEurCompact(eur, lang) : null,
      ].filter(Boolean);
      return {
        id: o.eik,
        label: o.name,
        sub: parts.join(" · "),
        // All-time scope: the row shows a whole-corpus €, so the destination
        // must open on the same window rather than the reader's parliament.
        href: companyAllTimeHref(o.successorEik ?? o.eik),
      };
    },
    (o) => [
      o.name,
      o.oblast,
      o.eik,
      TYPE_LABEL[o.type].bg,
      TYPE_LABEL[o.type].en,
      ...(o.aliases ?? []),
    ],
    s ? (o) => (o.successorEik ? 0 : (eurOf.get(o.eik) ?? 0)) : undefined,
  );
};

export const waterSearchSources = (
  s: WaterHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubSearchSource[] => [
  {
    kind: "index",
    id: "operators",
    label: { bg: "ВиК оператори", en: "Water operators" },
    icon: Droplets,
    limit: 6,
    index: waterOperatorsIndex(s, lang, bg),
  } as IndexSource,
  ...wholeRegisterSources(bg),
];
