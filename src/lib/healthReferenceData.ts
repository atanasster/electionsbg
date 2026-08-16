// Dependency-free reference data for the Здравеопазване (Health) sector — the
// two national health principals: the Национална здравноосигурителна каса (НЗОК)
// and the Министерство на здравеопазването (МЗ). Imported by the sector registry,
// the generic /sector/health dashboard config and the ?sector=nzok browse pack.
//
// ⚠️ NOT imported by scripts/db/gen_procurement/sector_stats.ts, and that is
// deliberate — see "the headline is НЗОК alone" below. This is the ONE sector
// whose EIK-set and whose hub headline describe different things on purpose, so
// the generator must not pick this set up by reflex.
//
// ---------------------------------------------------------------------------
// Why the set has two members
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
// return exactly these two EIKs and nothing else. МЗ has no alias EIK.
//
// Deliberately OUT — the SECOND-LEVEL МЗ family: the 28 Центрове за спешна
// медицинска помощ, the 28 Регионални здравни инспекции and НЦОЗА, together
// **54 bodies / 2,467 contracts / €86.6m**. Each is its own legal person with
// its own Булстат and its own /awarder page; they are second-level разпоредители
// under МЗ rather than parts of it, so adding them is a separate decision about
// what the tile claims to cover — not an oversight to be quietly corrected.
// Adding them would also roughly double the member roster, which crosses
// MEMBER_SEARCH_MIN and changes how the dashboard renders.
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
//  · that argument does NOT reach them. They are commercial ЕАД/ООД, not
//    разпоредители, so "second-level under МЗ" is not why they are excluded;
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

/** Министерство на здравеопазването. */
export const MZ_EIK = "000695317";

export { NZOK_EIK };

export interface HealthEntity {
  eik: string;
  name: { bg: string; en: string };
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
  },
  {
    eik: MZ_EIK,
    name: {
      bg: "Министерство на здравеопазването",
      en: "Ministry of Health",
    },
  },
];

/** The awarder EIK-set for the Health sector — the one definition the dashboard
 *  config and the browse pack both read, so they cannot drift apart. */
export const HEALTH_SECTOR_EIKS: readonly string[] = HEALTH_ENTITIES.map(
  (e) => e.eik,
);
