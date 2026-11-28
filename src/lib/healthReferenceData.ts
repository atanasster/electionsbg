// Reference data for the Здравеопазване (Health) sector — the two national
// health principals, the Национална здравноосигурителна каса (НЗОК) and the
// Министерство на здравеопазването (МЗ), plus МЗ's second-level budget units
// (ЦСМП, РЗИ, НЦОЗА; roster in mzSecondLevelBodies.ts). Imported by the sector
// registry, the /sector/health hub, the dashboard config and the ?sector=nzok
// browse pack. Its one import is that roster — itself import-free.
//
// ---------------------------------------------------------------------------
// The four lists (sector-dashboard skill §1), decided 2026-11-20.
//
//   roll-up   НЗОК (`nzok`), МЗ (`mz`) and the 55 second-level EIKs
//             (`mz_bodies`, 53 institutions). Principal = МЗ for all of them.
//   verify    none.
//   adjacent  none.
//   excluded  the hospitals (a CLASS, not an EIK list — see `HEALTH_EXCLUDED`)
//             and the РЗОК (branches of НЗОК under its own Булстат).
//
// Measured 2026-11-20, local PG, `tag = 'contract'`, 2011-01-05 → 2026-11-18:
//   МЗ        5,611 contracts  €2,838.4M  (of which €1,311.3M is 34 framework
//                                          CEILINGS — hub plan D3, never spend)
//   НЗОК      1,713 contracts     €84.5M
//   mz_bodies 2,481 contracts     €86.9M  (55 EIKs / 53 institutions; the
//                                          figure is 2026-08-26's, see the roster)
//
// ⚠️ NOT imported by scripts/db/gen_procurement/sector_stats.ts, and that is
// deliberate — see "the headline is НЗОК alone" below. This is the ONE sector
// whose EIK-set and whose hub headline describe different things on purpose, so
// the generator must not pick this set up by reflex.
//
// ---------------------------------------------------------------------------
// Why both НЗОК and МЗ
//
// The tile was НЗОК-only until 2026-08-16 and titled „Здравна каса", which was
// honest but left the largest health-domain buyer in the corpus unrepresented
// ANYWHERE in the sectors hub: МЗ is €2.84bn across 5,771 contracts, 34× НЗОК's
// entire €84.0M ЗОП line. It sat in no other sector's EIK-set either, so folding
// it in double-counts against nothing.
//
// The two are genuinely one sector and genuinely different instruments: НЗОК
// PAYS for care (reimbursement, ~98.5% of its money never touching ЗОП), while
// МЗ BUILDS and equips it (hospitals, ambulances, vaccines, national programmes)
// — which is why МЗ's money shows up as procurement and НЗОК's does not.
//
// ---------------------------------------------------------------------------
// The headline is НЗОК alone, and stays that way
//
// `sector_stats.json` keeps basis='payout' from НЗОК's B1 cash execution. Do NOT
// "complete" it by adding МЗ's budget:
//
//  · it would MIX BASES — cash execution plus an enacted appropriation;
//  · it would DOUBLE-COUNT. The state budget transfers money to НЗОК, so part of
//    МЗ's line reappears inside НЗОК's execution. Same trap the МОСВ note in
//    sector_stats.ts documents for the ОПОС billions, which are disbursed by
//    municipalities and ВиК.
//
// A single-body headline over a multi-body group is the house pattern, not an
// exception: environment (МОСВ node / 28 EIKs), regional (МРРБ / group),
// security (МВР / 73) and social (МТСП / group) all do exactly this. НЗОК's
// €4.72bn also dwarfs МЗ's €646M, so it remains the sector's dominant money.
//
// ---------------------------------------------------------------------------
// Anti-allowlist — verified 2026-08-15 against the whole awarder corpus
//
// Sweeps for `%министерство на здрав%` and `%здравноосигурителна%` / `%РЗОК%`
// return exactly НЗОК and МЗ. МЗ has no alias EIK.
//
// The SECOND-LEVEL МЗ family (ЦСМП, РЗИ, НЦОЗА) was OUT until 2026-11-20 and
// reachable from the finder only. It is IN since then (hub plan D1): each body is
// a second-level разпоредител with МЗ as its budget principal, i.e. part of the
// administrative apparatus the rule below admits — the opposite of a hospital.
// ⚠ It counts in the PROCUREMENT figures only. The hub headline is НЗОК's B1
// cash expenditure and none of this family's money is in it.
//
// The roster and its figures live in `mzSecondLevelBodies.ts` — read the count
// from there. An older version of this paragraph printed „28 ЦСМП, 28 РЗИ … 54
// bodies", wrong three ways at once (28+28+1 ≠ 54; the sweep missed РИОКОЗ
// Бургас 000053451; only 23 oblasts have РЗИ procurement).
//
// Also OUT, and further away: the РЗОК are BRANCHES of НЗОК sharing its Булстат
// (which is why the corpus carries one contract with НЗОК on both sides — a
// register artifact worth €191, not a body to add).
//
// Also OUT, and the largest neighbour by far — the state and university
// HOSPITALS (МБАЛ / УМБАЛ / СБАЛ / диспансери): **234 bodies, 84,481 contracts,
// €10.6bn**, i.e. 3.7× the МЗ line this widening was made for, with single
// bodies at €0.7–0.9bn each. Two reasons they need saying out loud rather than
// being left to the second-level argument above:
//
//  · the second-level argument that admits ЦСМП/РЗИ does NOT reach them. They
//    are commercial ЕАД/ООД, not разпоредители;
//  · МЗ holding the state's shares in them is NOT the test. They are the payees
//    НЗОК reimburses, so a set holding both the payer and the payees counts the
//    same care twice — the МОСВ/ОПОС trap this file already cites, in its
//    sharpest form. Their procurement belongs to the hospital pages.
//
// Widen only to bodies that are part of the МЗ/НЗОК administrative apparatus
// itself — never to bodies МЗ merely OWNS or FUNDS. (An earlier draft of this
// rule said "whose principal is verifiably the Minister of Health", which reads
// as a yes to €10.6bn of hospitals.) See docs/plans/sector-health-audit-v1.md (F4).
//
// ---------------------------------------------------------------------------
// Scope of "single source of truth"
//
// This file is the one definition of the sector's EIK-SET. It is NOT the origin
// of the НЗОК EIK literal — that is nzokBenchmarks.ts, re-exported here (and by
// nzokAttributes.ts / useNzok.tsx) on the house re-export pattern.

import { NZOK_EIK } from "./nzokBenchmarks";
import {
  MZ_SECOND_LEVEL_BODIES,
  MZ_SECOND_LEVEL_INSTITUTION_COUNT,
} from "./mzSecondLevelBodies";

/** Министерство на здравеопазването. */
export const MZ_EIK = "000695317";

export { NZOK_EIK };

/** МЗ's node in the budget tree (`useBudgetMinistryRollup`) — the ministry's own
 *  appropriation, which /sector/health/money shows beside НЗОК's execution and
 *  never sums with it (part of it is the transfer that funds НЗОК). */
export const MZ_BUDGET_NODE = "admin-ministerstvo-na-zdraveopazvaneto";

/** Which part of the sector a member belongs to. Groups the dashboard roster
 *  today; the hub's `?universe=` filter reads it too. */
export type HealthUniverse = "nzok" | "mz" | "mz_bodies";

export interface HealthEntity {
  eik: string;
  name: { bg: string; en: string };
  universe: HealthUniverse;
  /** Set on a RETIRED row: the EIK of the successor the institution now files
   *  under (the РИОКОЗ→РЗИ reissue), carried over from the second-level
   *  roster. Rendered as `aliasOf` on the dashboard member. */
  retiredEikOf?: string;
}

/** The sector's member institutions, lead first. НЗОК leads because it holds the
 *  sector's money and owns the pack the dashboard renders (getSectorPack keys on
 *  leadEik), NOT because it outranks МЗ administratively. */
export const HEALTH_ENTITIES: readonly HealthEntity[] = [
  {
    eik: NZOK_EIK,
    name: {
      bg: "Национална здравноосигурителна каса",
      en: "National Health Insurance Fund",
    },
    universe: "nzok",
  },
  {
    eik: MZ_EIK,
    name: {
      bg: "Министерство на здравеопазването",
      en: "Ministry of Health",
    },
    universe: "mz",
  },
  // The second-level bodies carry no English name on purpose (the РИОСВ
  // precedent — see mzSecondLevelBodies.ts, „Naming").
  ...MZ_SECOND_LEVEL_BODIES.map(
    (b): HealthEntity => ({
      eik: b.eik,
      name: { bg: b.name, en: b.name },
      universe: "mz_bodies",
      ...(b.retiredEikOf ? { retiredEikOf: b.retiredEikOf } : {}),
    }),
  ),
];

/** The awarder EIK-set for the Health sector — the one definition the dashboard
 *  config and the browse pack both read, so they cannot drift apart. */
export const HEALTH_SECTOR_EIKS: readonly string[] = HEALTH_ENTITIES.map(
  (e) => e.eik,
);

/** Institutions, not EIKs — the two retired РИОКОЗ rows are the same two
 *  institutions as their successors. Quote THIS in reader-facing copy. */
export const HEALTH_INSTITUTION_COUNT = 2 + MZ_SECOND_LEVEL_INSTITUTION_COUNT;

export const HEALTH_UNIVERSES: readonly HealthUniverse[] = [
  "nzok",
  "mz",
  "mz_bodies",
];

export const HEALTH_UNIVERSE_LABEL: Record<
  HealthUniverse,
  { bg: string; en: string }
> = {
  nzok: { bg: "Здравна каса", en: "Health insurance fund" },
  mz: { bg: "Министерство", en: "Ministry" },
  mz_bodies: {
    bg: "Ведомства на МЗ",
    en: "Ministry of Health bodies",
  },
};

export const healthUniverseOf = (eik: string): HealthUniverse | undefined =>
  HEALTH_ENTITIES.find((e) => e.eik === eik)?.universe;

/** The excluded list. Unlike education's it is CLASSES, not EIKs: the
 *  лечебни заведения are commercial companies a name rule identifies (234
 *  hospitals on 2026-11-20; 283 by a looser name match),
 *  and the РЗОК share НЗОК's own Булстат. `namePattern` is a Postgres regex
 *  (`~*`): health_register.data.test.ts and sector_stats.data.test.ts sweep the
 *  corpus with it, and mzSecondLevelBodies.test.ts checks no roster name
 *  matches it.
 *
 *  ⚠️ The `hospitals` class is every лечебно заведение, not only „болница":
 *  the T9 sweep (2026-11-21) found ~40 ДКЦ and „Център за психично здраве"
 *  ЕООД (the former dispensaries, renamed — €16M+ of procurement) outside a
 *  pattern that read „болница|МБАЛ|УМБАЛ|СБАЛ|диспансер". Same class, same
 *  reason: НЗОК pays them. */
export const HEALTH_EXCLUDED: ReadonlyArray<{
  id: "hospitals" | "rzok" | "research";
  namePattern: string;
  reason: { bg: string; en: string };
}> = [
  {
    id: "hospitals",
    namePattern:
      "болница|МБАЛ|УМБАЛ|СБАЛ|диспансер|психично здраве|диагностично[- ]*консултативен|ДКЦ|медицински център|МЦСМП|лечебн",
    reason: {
      bg: "Болниците и другите лечебни заведения (ДКЦ, центрове за психично здраве, медицински центрове) са търговски дружества, на които НЗОК плаща. Събирането им с платеца би отчело едни и същи пари два пъти.",
      en: "Hospitals and other medical establishments (diagnostic centres, mental-health centres, medical centres) are companies the health fund pays. Adding them to the payer would count the same money twice.",
    },
  },
  {
    id: "research",
    namePattern: "трансфер на знания",
    reason: {
      bg: "Научноизследователски консорциуми с „здравни технологии“ в името — не са здравни органи.",
      en: "Research consortia with „health technologies“ in the name — not health bodies.",
    },
  },
  {
    id: "rzok",
    namePattern: "районна здравноосигурителна|РЗОК",
    reason: {
      bg: "РЗОК са поделения на НЗОК със същия ЕИК.",
      en: "The regional funds are branches of the NHIF under its own EIK.",
    },
  },
];
