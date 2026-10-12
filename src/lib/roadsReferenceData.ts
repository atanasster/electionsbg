// The ROADS sector register — which buyers ARE the republican road network.
//
// Universe rule (docs/plans/roads-hub-v1.md D1, accepted 2026-10-12): the
// buyers of the republican road network, with АПИ as principal. The ~28 ОПУ
// regional directorates are not separate bodies here — they file under АПИ's
// one EIK as awarder-name variants (awarder_identity.ts), and the 2026-10-12
// sweep found no alias EIK carrying an АПИ or ОПУ name.
//
// Four declared lists (sector-dashboard skill §1), and one more that is NOT a
// buyer list:
//
//   roll-up   the sector proper — every € on the page means these
//   verify    principal genuinely unsettled (none today)
//   adjacent  a real road-adjacent body that answers to ANOTHER sector's roll-up
//   excluded  matched by a roads name stem, not a roads body at all — kept so a
//             name match cannot re-admit it
//   in-house  ROADS_INHOUSE_CONTRACTORS — a state company that is a SUPPLIER to
//             the sector, never a buyer in it (see below)
//
// ⚠ Import this module only from lazy code (sector screens, scripts, tests).
// src/entryGraph.test.ts forbids every *ReferenceData module on the entry path;
// routes.tsx takes its roads constants from the import-free roadsAwarder.ts.

import { API_EIK } from "./roadsAwarder";

export interface RoadsBody {
  eik: string;
  name: { bg: string; en: string };
  /** One clause on why the body sits in its list. */
  why: string;
}

export const ROADS_ROLLUP: readonly RoadsBody[] = [
  {
    eik: API_EIK,
    name: {
      bg: "Агенция „Пътна инфраструктура“",
      en: "Road Infrastructure Agency",
    },
    why: "principal buyer of the republican road network; the ОПУ file under it",
  },
  {
    // D5, accepted 2026-10-12. A state company that procured АМ „Струма" lots
    // 3.1/3.3 and their rescue archaeology for МРРБ, 2013–2019: €220.7M over 40
    // contracts. Leaving it out made Струма's construction history start
    // mid-way. It has no contract after 2019, so no window from the 2019
    // parliament on moves; the 2013, 2014 and 2017 windows and y:2013–2019 do.
    eik: "202062287",
    name: {
      bg: "Национална компания „Стратегически инфраструктурни проекти“",
      en: "National Company Strategic Infrastructure Projects",
    },
    why: "procured АМ „Струма“ lots for МРРБ, 2013–2019",
  },
];

export const ROADS_VERIFY: readonly RoadsBody[] = [];

export const ROADS_ADJACENT: readonly (RoadsBody & {
  /** The sector whose roll-up holds it — every adjacent body must be in
   *  exactly one other sector's roll-up, or it is in no sector at all. */
  rollupOf: string;
})[] = [
  {
    eik: "177344399",
    name: {
      bg: "Държавна агенция „Безопасност на движението по пътищата“",
      en: "State Agency for Road Safety",
    },
    why: "road safety — in transport's roll-up (МТС remit), not road building",
    rollupOf: "transport",
  },
];

/** Bodies a roads name stem matches that are not roads bodies. Each was found
 *  by the 2026-10-12 sweep (plan §2 R3). */
export const ROADS_EXCLUDED: readonly RoadsBody[] = [
  {
    eik: "130823243",
    name: {
      bg: "НК „Железопътна инфраструктура“",
      en: "National Railway Infrastructure Company",
    },
    why: "„железо-ПЪТНА инфраструктура“ — rail, €3.47bn",
  },
  {
    eik: "175405647",
    name: {
      bg: "„БДЖ – Пътнически превози“ ЕООД",
      en: "BDZ Passenger Services",
    },
    why: "„ПЪТНически“ — rail passenger carrier",
  },
  {
    eik: "202311429",
    name: {
      bg: "„Пътнически превози“ ЕООД – Сливен",
      en: "Patnicheski prevozi, Sliven",
    },
    why: "„ПЪТНически“ — bus carrier",
  },
  {
    eik: "829054071",
    name: {
      bg: "„Пътнически превози“ ЕАД – Сливен",
      en: "Patnicheski prevozi, Sliven (predecessor)",
    },
    why: "„ПЪТНически“ — bus carrier",
  },
  {
    eik: "107027467",
    name: {
      bg: "„Общински пътнически транспорт“ ЕООД – Габрово",
      en: "Gabrovo municipal transport",
    },
    why: "„ПЪТНически“ — municipal bus carrier",
  },
  {
    eik: "129010171",
    name: { bg: "Сухопътни войски", en: "Land Forces" },
    why: "„СухоПЪТНИ“ — defence",
  },
  {
    eik: "000454845",
    name: {
      bg: "ЦСОП – Пловдив",
      en: "Special education support centre, Plovdiv",
    },
    why: "a school the ОПУ stem matched",
  },
];

/** The sector's state in-house CONTRACTOR — a supplier, never a buyer.
 *  „Автомагистрали" ЕАД won €982.9M from АПИ over 19 contracts (11.0% of the
 *  sector all-time) and spent €1.0M as a buyer. Putting it in the roll-up would
 *  count its €983M twice — once as АПИ's spend, once as its own. Every surface
 *  that ranks it labels it „държавно дружество, in-house (чл. 14 ЗОП)" (D7);
 *  none filters it out. */
export const ROADS_INHOUSE_CONTRACTORS: readonly RoadsBody[] = [
  {
    eik: "831646048",
    name: { bg: "„Автомагистрали“ ЕАД", en: "Avtomagistrali EAD" },
    why: "state company, in-house contractor to АПИ (чл. 14 ЗОП)",
  },
];

/** The roll-up EIK set — what every roads € is summed over. */
export const ROADS_SECTOR_EIKS: readonly string[] = ROADS_ROLLUP.map(
  (b) => b.eik,
);

export const isRoadsInhouse = (eik: string | undefined): boolean =>
  !!eik && ROADS_INHOUSE_CONTRACTORS.some((b) => b.eik === eik);
