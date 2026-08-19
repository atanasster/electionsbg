// Държавна администрация / e-government reference data — the hand-curated EIK
// universe behind the bespoke /sector/administration screen, mirroring
// energyReferenceData.ts / defenseReferenceData.ts (a TS constant, not a
// generated crosswalk). See docs/plans/administration-view-v1.md §2.
//
// The "sector" is really two things fused on one screen: (1) the INSTITUTION —
// the whole state administration (~590 structures, 145k staff) whose size, cost
// and workforce come from data/budget/personnel.json (the annual Доклад за
// състоянието на администрацията), NOT from procurement; and (2) the MONEY —
// the e-government procurement group below, folded server-side by
// awarder_group_model, because e-gov spend is the one procurement story МЕУ's
// own thin corpus can't tell alone.
//
// e-gov procurement group — EIKs resolved from the LIVE corpus (buyer_eik /
// buyer_name, 2026-07-14; ЕСМИС and МДААР added 2026-08-19). FIVE bodies,
// measured per EIK over `contracts` (tag='contract'):
//
//   131516795 ДАИТС → ИА „Електронни съобщителни мрежи и информационни системи“
//                                        2011–2017   €20.24M /  40 contracts
//   131509441 Министерство на държавната администрация и административната
//             реформа (МДААР) — ministry tier, legacy buyer record
//                                        2011–2011    €6.43M /   1 contract
//   177098809 Държавна агенция „Електронно управление“ (ДАЕУ)
//                                        2017–2023   €29.67M / 156 contracts
//   180742160 ИА „Инфраструктура на електронното управление“ (ИА ИЕУ)
//                                        2022–2025  €120.59M / 103 contracts
//   180680495 Министерство на електронното управление (МЕУ) — lead, policy seat
//                                        2022–2026  €166.23M / 117 contracts
//
// ⚠ EVERY SPAN ABOVE IS „first and last year WE HOLD A CONTRACT FOR", NEVER a
// tenure — and 2011 is the `contracts` CORPUS FLOOR (15,745 rows that year,
// all awarders), not ДАИТС's start. The body procured before it; those years
// are simply not held. So adding ЕСМИС moves „Възложени по година"'s left edge
// from 2017 to 2011 rather than removing the boundary: both edges are coverage
// artifacts, and the 2011 one is not even about this sector. That is why the
// chips below say „поръчки 2011–2017" rather than a bare range — the caveat
// has to travel with the number, since the chip is rendered verbatim to
// readers and this header is not.
//
// ⚠ THE GROUP IS TWO SUCCESSIONS, ONE CONCURRENT PAIR AND ONE ORPHAN — not a
// single baton pass, which is why the years above overlap:
//
//   ЕСМИС → ДАЕУ    a clean handover at MONTH grain: ЕСМИС's last contract is
//                   2017-06-19, ДАЕУ's first is 2017-07-31. They DO share the
//                   year 2017 (4 vs 14 contracts) — do not restate this as
//                   „no overlapping year", which the table above refutes.
//   ДАЕУ → ИЕУ+МЕУ  ДАЕУ trails off through 2023-11 while both successors run.
//   ИЕУ  ∥ МЕУ      CONCURRENT by design (an agency and its ministry),
//                   interleaved every year 2022–2025. Not a succession, and
//                   not a defect.
//   МДААР           NEITHER, and do not draw a fifth arrow. Its one row
//                   (2011-08) lands INSIDE ЕСМИС's run rather than before or
//                   after it, so it hands over to nobody and receives from
//                   nobody — it is a ministry-tier record that happens to hold
//                   the only e-gov contract the corpus has at that tier.
//
// ⚠ ЕСМИС WAS MISSING UNTIL 2026-08-19, and its absence was invisible because
// nothing about the group looked short: every figure reconciled, the EIK-set
// copies agreed, and the hub headline is headcount so it could not move. What
// it cost was 6.4% of the all-time total (€316.5M → €336.7M) and, more
// importantly, the SHAPE — the spend chart began at 2017.
//
// ⚠ The succession is established from THIS CORPUS, not from the ПМС that
// effected it: `awarder_name` for 131516795 literally carries „Старо
// наименование - Държавна агенция за информационни технологии и съобщения
// /ДАИТС/", and the handover has no overlapping month. That is enough to place
// it in the group and is deliberately not stated on the page as a legal claim.
//
// ⚠ МДААР IS A LEGACY BUYER RECORD, NOT A BODY THAT WAS PROCURING IN 2011 —
// and the page renders its name, so the distinction has to live here. Its one
// row's `contract_id` is „МС 76": the contract is the COUNCIL OF MINISTERS',
// filed against the record of a ministry abolished in 2009 whose functions МС
// absorbed. Measured 2026-08-19 — 1 contract, €6,426,068, 2011-08-02, CPV
// 72000000, „Доставка на софтуерни продукти на Майкрософт за нуждите на
// държавната администрация на Република България", contractor ЦАПК „Прогрес"
// ООД (000638693). It is in the group because it is the only row the corpus
// holds for the MINISTRY-tier mandate between МДААР's abolition and ДАЕУ's
// creation — a span neither ЕСМИС (agency) nor ДАЕУ covers.
//
// ⚠⚠ DO NOT „FINISH THE JOB" BY ADDING THE COUNCIL OF MINISTERS. The reasoning
// above („МС held the e-gov mandate 2009–2016") reads like an argument for
// `000695025`, and it is not: that awarder holds **603 contracts / €138.2M**,
// almost none of it e-government — the МВР-into-defense shape at ministry
// scale, and ~40% of the group's own €343.2M. `131509441` is safe precisely
// because it is a dead record holding exactly one e-gov row; `000695025` is a
// live buyer holding a ministry's entire procurement. The two are not the same
// judgment. `sector_stats_administration.data.test.ts` pins МС's ABSENCE as an
// anti-allowlist for this reason.
//
// ⚠ CURATED BY EIK ALLOWLIST, NEVER BY NAME REGEX. A sweep on „електронно
// управление" false-positives every municipality's e-government department.

export const MEU_EIK = "180680495"; // Министерство на електронното управление
export const IAIEU_EIK = "180742160"; // ИА „Инфраструктура на електронното управление"
export const DAEU_EIK = "177098809"; // Държавна агенция „Електронно управление" (legacy)
export const ESMIS_EIK = "131516795"; // ИА ЕСМИС / ex-ДАИТС (legacy infrastructure)
export const MDAAR_EIK = "131509441"; // МДААР (legacy buyer record, ministry tier)

export interface AdminEntity {
  eik: string;
  name: { bg: string; en: string };
  role: { bg: string; en: string };
}

/** The e-government procurement group, LEAD FIRST. This is the ONE membership
 *  list — `ADMIN_SECTOR_EIKS` and `ADMIN_GROUP_EIK` are derived from it, so the
 *  member set and the chips a reader sees cannot drift apart. Before 2026-08-19
 *  they were two hand-maintained copies, and drift was silent in both
 *  directions: an EIK with no entity folds into every KPI with nothing naming
 *  it, and an entity outside the set is a chip linking to an /awarder page
 *  whose totals disagree with the sector.
 *
 *  `role` is rendered verbatim as a chip (AdministrationScreen). Periods are
 *  stated as OBSERVED PROCUREMENT („поръчки YYYY–YYYY"), never as a tenure —
 *  see the corpus-floor warning in the header. ИА ИЕУ deliberately gets no end
 *  year: it has no 2026 rows, but so does an ingest lag, and the corpus cannot
 *  tell the two apart. */
export const ADMIN_ENTITIES: AdminEntity[] = [
  {
    eik: MEU_EIK,
    name: {
      bg: "Министерство на електронното управление",
      en: "Ministry of e-Government",
    },
    role: { bg: "водещо · политика", en: "lead · policy" },
  },
  {
    eik: IAIEU_EIK,
    name: {
      bg: "ИА „Инфраструктура на електронното управление“",
      en: "Executive Agency for e-Government Infrastructure",
    },
    role: { bg: "инфраструктура · от 2022", en: "infrastructure · since 2022" },
  },
  {
    eik: DAEU_EIK,
    name: {
      bg: "Държавна агенция „Електронно управление“",
      en: "State e-Government Agency (legacy)",
    },
    role: {
      bg: "предшественик · поръчки 2017–2023",
      en: "predecessor · contracts 2017–2023",
    },
  },
  {
    eik: ESMIS_EIK,
    name: {
      bg: "ИА „Електронни съобщителни мрежи и информационни системи“",
      en: "Executive Agency for Electronic Communication Networks and Information Systems",
    },
    role: {
      bg: "предшественик · поръчки 2011–2017",
      en: "predecessor · contracts 2011–2017",
    },
  },
  {
    eik: MDAAR_EIK,
    name: {
      bg: "Министерство на държавната администрация и административната реформа",
      en: "Ministry of State Administration and Administrative Reform",
    },
    role: {
      bg: "предшественик · министерско ниво · поръчки 2011",
      en: "predecessor · ministry tier · contracts 2011",
    },
  },
];

/** The e-government procurement group folded by awarder_group_model, lead
 *  first. DERIVED from ADMIN_ENTITIES — never hand-edit; add the entity. */
export const ADMIN_SECTOR_EIKS: readonly string[] = ADMIN_ENTITIES.map(
  (e) => e.eik,
);

/** The group anchor the sector keys on (lead + /sector/administration slug).
 *  A landing on МЕУ's /awarder page suppresses its pack and links here, and
 *  `SECTOR_DASHBOARDS.administration.leadEik` re-exports this rather than
 *  re-typing the digits. */
export const ADMIN_GROUP_EIK = ADMIN_SECTOR_EIKS[0];

/** PUBLIC-BODY CONTRACTORS — suppliers to this group that are themselves state
 *  or municipal organisations, so the money never leaves government. The
 *  „Топ изпълнители" tile labels these („държавно"); it never drops them, and
 *  they stay in every total, because they are real public procurements.
 *
 *  The one that matters is „Информационно обслужване" АД at **24.15% of the
 *  group's all-time money and 34.64% of 2025** (€81,321,665; measured
 *  2026-08-19 over `contracts` at tag='contract', denominator = the FOUR-body
 *  ADMIN_SECTOR_EIKS, €336,731,123) — the sector's #1 „изпълнител",
 *  and a company whose принципал is МЕУ, the ministry that LEADS this sector.
 *  Unlabelled it reads as a private IT vendor winning a quarter of Bulgarian
 *  e-government. It is also the state's designated системен интегратор under
 *  ЗЕУ, which is why 52 of its 64 awards here carry no procurement method and
 *  the other 12 are single-bid `limited`: those are in-house awards required by
 *  statute, not a competition failure — and the `tenders` join returns no
 *  `legal_basis` for any of them, so the page cannot source that ground and
 *  states it in the chip's tooltip rather than rendering it as data.
 *
 *  ⚠ CURATED BY EIK, and it CANNOT be derived. The obvious probe — "is this
 *  contractor an awarder somewhere in the corpus" — over-captures, because
 *  ЗОП's utilities regime makes private regulated companies contracting
 *  authorities: on this group it also returns Балкангаз 2000 (130203228) and
 *  Севлиевогаз-2000 (107063552), private gas distributors that are deliberately
 *  NOT here. Checked by ownership, not by that probe.
 *
 *  ⚠ EVERY SHARE ABOVE NAMES ITS DENOMINATOR AND ITS DATE, and that is not
 *  bookkeeping: the first draft of this block said „25.7%", which was the share
 *  against the THREE-body group as it stood before ЕСМИС was added — to this
 *  same file, on the same day, eleven lines above. A bare percentage in a
 *  member-set file silently re-bases itself every time the set changes, and
 *  nothing fails. Re-derive on the next membership change.
 *
 *  Kept in step with SOCIAL_STATE_BODY_CONTRACTORS, which already carries the
 *  same EIK for the same reason — a reader must not meet it labelled on one
 *  sector page and bare on another. `administrationReferenceData.test.ts`
 *  asserts that, so dropping it from either side fails. */
export const ADMIN_STATE_BODY_CONTRACTORS: readonly string[] = [
  "831641791", // „Информационно обслужване" АД — majority state (принципал МЕУ)
];

/** First year the annual Доклад (data/budget/personnel.json `national`) covers
 *  — the INSTITUTION half of this screen.
 *
 *  ⚠ NOT the money floor. The e-gov procurement group has contracts from 2011,
 *  which is itself the `contracts` corpus floor rather than any body's start.
 *  Two defensible answers to „the sector's first year" live in this file; using
 *  the wrong one silently truncates a chart or a scope resolve by six years. */
export const ADMIN_DOKLAD_FIRST_YEAR = 2017;

// byMinistry (personnel.json) carries the МФ admin slug in `adminId`/`nameBg`,
// not a display name — hand-map the ~9 ministries that publish a programme
// budget so the cost-per-FTE tile reads in real names. Fallback prettifies the
// slug (§ G4). Extend when a new ministry's programme budget lands.
export const MINISTRY_NAMES: Record<string, { bg: string; en: string }> = {
  "admin-ministerstvo-na-finansite": { bg: "Финанси", en: "Finance" },
  "admin-ministerstvo-na-ikonomikata-i-industriyata": {
    bg: "Икономика и индустрия",
    en: "Economy and Industry",
  },
  "admin-ministerstvo-na-inovatsiite-i-rastezha": {
    bg: "Иновации и растеж",
    en: "Innovation and Growth",
  },
  "admin-ministerstvo-na-okolnata-sreda-i-vodite": {
    bg: "Околна среда и води",
    en: "Environment and Water",
  },
  "admin-ministerstvo-na-truda-i-sotsialnata-politika": {
    bg: "Труд и социална политика",
    en: "Labour and Social Policy",
  },
  "admin-ministerstvo-na-turizma": { bg: "Туризъм", en: "Tourism" },
  "admin-ministerstvo-na-vanshnite-raboti": {
    bg: "Външни работи",
    en: "Foreign Affairs",
  },
  "admin-ministerstvo-na-zdraveopazvaneto": {
    bg: "Здравеопазване",
    en: "Health",
  },
  "admin-ministerstvo-na-zemedelieto": {
    bg: "Земеделие",
    en: "Agriculture",
  },
};

/** Display name for a byMinistry `adminId` slug — hand-mapped where known, else
 *  a best-effort prettification of the slug so nothing renders raw. */
export const ministryName = (adminId: string, bg: boolean): string => {
  const hit = MINISTRY_NAMES[adminId];
  if (hit) return bg ? hit.bg : hit.en;
  return adminId.replace(/^admin-/, "").replace(/-/g, " ");
};
