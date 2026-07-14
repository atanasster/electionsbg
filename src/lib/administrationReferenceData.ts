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
// buyer_name, 2026-07-14), the three bodies that have held the e-government
// mandate across time (МЕУ folds ИА ИЕУ + legacy ДАЕУ so the history is whole):
//   180680495 Министерство на електронното управление (МЕУ)  — lead, policy seat
//   180742160 ИА „Инфраструктура на електронното управление" — the infrastructure buyer
//   177098809 Държавна агенция „Електронно управление" (ДАЕУ) — legacy predecessor
//
// ⚠ CURATED BY EIK ALLOWLIST, NEVER BY NAME REGEX. A sweep on "електронно
// управление" false-positives every municipality's e-government department.

export const MEU_EIK = "180680495"; // Министерство на електронното управление
export const IAIEU_EIK = "180742160"; // ИА „Инфраструктура на електронното управление"
export const DAEU_EIK = "177098809"; // Държавна агенция „Електронно управление" (legacy)

/** The group anchor the sector keys on (lead + /sector/administration slug).
 *  A landing on МЕУ's /awarder page suppresses its pack and links here. */
export const ADMIN_GROUP_EIK = MEU_EIK;

/** The e-government procurement group folded by awarder_group_model. Lead first. */
export const ADMIN_SECTOR_EIKS: readonly string[] = [
  MEU_EIK,
  IAIEU_EIK,
  DAEU_EIK,
];

/** First year the annual Доклад (data/budget/personnel.json `national`) covers. */
export const ADMIN_FIRST_YEAR = 2017;

export interface AdminEntity {
  eik: string;
  name: { bg: string; en: string };
  role: { bg: string; en: string };
}

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
    role: { bg: "инфраструктура", en: "infrastructure" },
  },
  {
    eik: DAEU_EIK,
    name: {
      bg: "Държавна агенция „Електронно управление“",
      en: "State e-Government Agency (legacy)",
    },
    role: { bg: "предшественик", en: "predecessor" },
  },
];

// byMinistry (personnel.json) carries the МФ admin slug in `adminId`/`nameBg`,
// not a display name — hand-map the ~9 ministries that publish a programme
// budget so the cost-per-FTE tile reads in real names. Fallback prettifies the
// slug (§ G4). Extend when a new ministry's programme budget lands.
export const MINISTRY_NAMES: Record<string, { bg: string; en: string }> = {
  "admin-ministerstvoto-na-finansite": { bg: "Финанси", en: "Finance" },
  "admin-ministerstvoto-na-ikonomikata-i-industriyata": {
    bg: "Икономика и индустрия",
    en: "Economy and Industry",
  },
  "admin-ministerstvoto-na-inovatsiite-i-rastezha": {
    bg: "Иновации и растеж",
    en: "Innovation and Growth",
  },
  "admin-ministerstvoto-na-okolnata-sreda-i-vodite": {
    bg: "Околна среда и води",
    en: "Environment and Water",
  },
  "admin-ministerstvoto-na-truda-i-sotsialnata-politika": {
    bg: "Труд и социална политика",
    en: "Labour and Social Policy",
  },
  "admin-ministerstvoto-na-turizma": { bg: "Туризъм", en: "Tourism" },
  "admin-ministerstvoto-na-vanshnite-raboti": {
    bg: "Външни работи",
    en: "Foreign Affairs",
  },
  "admin-ministerstvoto-na-zdraveopazvaneto": {
    bg: "Здравеопазване",
    en: "Health",
  },
  "admin-ministerstvoto-na-zemedelieto": {
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
