// Съдебна власт (judiciary) sector-pack reference data — the EIK set, the alias
// merges and the functional taxonomy, kept in one place so the tiles and the
// classifier can't drift.
//
// SCOPE NOTE: `JUDICIAL_BODIES` + `COURT_COUNT` drive the "as a buyer" tile on
// /judiciary, which links each central body to its `/awarder/<eik>` dashboard.
// `JUDICIAL_EIKS` (the full 59) is the EIK-set behind the judiciary entry of
// `SECTOR_BROWSE_PACKS` (sectorPacks.tsx) — i.e. the `?sector=judiciary` filter on
// /procurement/contracts and /procurement/tenders. That seam is BUILT and live, so
// a missing EIK here really does cost that filter a court; see the CORPUS AUDIT
// note below, where exactly that happened. („not yet consumed / seam unbuilt" was
// true when this file was written and stopped being true well before 2026-08-19 —
// it read as „a membership error here is inert", the precise opposite of the truth.)
//
// BUNDLE COST: `COURT_COUNT` derives from `COURT_LEVEL`, so the 59-entry map DOES
// ship (≈1 KB pre-gzip). That is deliberate — a hardcoded court count would
// silently drift from the corpus, and a kilobyte is cheaper than a wrong number.
// The literal is quoted as a SYMBOL rather than a number on purpose: this very
// paragraph shipped „a hardcoded `50`" while the map held 51, i.e. refuted its own
// argument by example.
//
// CORPUS AUDIT: 2026-08-19, against `contracts` ∪ `tenders` in local Postgres.
// The map DOES drift as new judicial awarders appear, and the first re-audit
// proved it: the 2026-07-10 cut missed Районен съд — Разлог (000025110), which
// published its first tender on 2026-08-13, four weeks later. It was invisible
// to the hub tile (budget basis — see below) and cost the browse pack's
// `?sector=judiciary` filter one court.
//
// TWO GATES NOW COVER IT, and they cover different halves — neither is redundant:
//
//  · `scripts/db/tests/sector_stats_justice.data.test.ts` sweeps the corpus for
//    judicial buyers absent from this map, which is the Разлог shape exactly. It
//    carries a REPLAY of that defect (drop 000025110 and the sweep must name it),
//    so it cannot go vacuous. Needs Postgres, and SKIPS without it.
//  · `vssReferenceData.test.ts` beside this file holds the map's INTERNAL
//    invariants — tier headers vs block sizes, duplicate keys, alias collapse —
//    the shape a hand-edit breaks. Pure TS, so it still guards on a fresh clone
//    and on a database-less CI leg, where the sweep above is skipping.
//
// So: `npm run test:data` for completeness, `npm run test:unit` for shape. The
// plan doc's (§2) manual query is no longer the only thing standing between this
// map and the next new court.
//
// The judiciary is a MULTI-BODY sector (like the ВиК holding), not a single
// buyer. Resolved from the local procurement corpus (contracts ∪ tenders):
// 59 judicial EIKs · 1,642 contracts · ~€203.3M (2011-2026). ВСС alone is ~43%.
//
// ⚠ THE HUB TILE DOES NOT READ THIS SET. `/governance/sectors`' „Съдебна власт"
// is BUDGET-basis — the ПРБ node named by `VSS_BUDGET_NODE` below — so a wrong or
// missing EIK here moves it by exactly nothing. What the set does drive is the browse
// pack, the awarders tile's court count and any group roll-up — which is why a
// membership defect here can never be caught by reconciling the headline.
//
// Three structural facts drive the design:
//
//  1. Прокуратурата is ONE legal entity. EIK 121817309 covers every prosecution
//     unit — районни / окръжни / апелативни / военно-окръжни прокуратури AND the
//     Национална следствена служба. A per-unit prosecution split is therefore
//     possible only via `awarder_name`, never via EIK.
//  2. Two alias pairs must be merged before any roll-up, or the headline
//     understates: 181092349 → ВСС (the 2024 "Съдийска колегия… изпълняваща
//     функциите на ВСС" interim-mandate registration) and 000695064 → ПРБ (the
//     legacy Главна прокуратура EIK, used in 2011 only).
//     AS IMPLEMENTED: only the ВСС pair is merged, in `useVss` (which fans its
//     query out over VSS_EIK + VSS_ALIAS_EIKS and footnotes the €7.2M the merge
//     adds). The ПРБ pair has no consumer yet — there is no ПРБ pack — so
//     PRB_ALIAS_EIKS exists to be read by the next roll-up, not by this one.
//     The generic /awarder/:eik header above the pack is a per-EIK DB rollup and
//     stays un-merged by design; the pack says so rather than letting the two
//     numbers silently disagree.
//  3. Конституционният съд is NOT part of съдебната власт (чл. 147 КРБ) and the
//     Министерство на правосъдието / ГД "Охрана" / ГД "Изпълнение на наказанията"
//     are executive bodies. All are deliberately excluded from the set below.

/** The ПРБ node the /governance/sectors „Съдебна власт" tile reads — the
 *  generator's `BUDGET_SECTOR_NODE.justice`, under data/budget/ministries/.
 *
 *  Exported so the tile's generator and the regression net share ONE import site,
 *  matching `MVR_BUDGET_NODE` / `MOSV_BUDGET_NODE` / `EDU_BUDGET_NODE`. That tree
 *  is gitignored, so a test that hard-codes the slug SKIPS on a rename instead of
 *  failing — the node file simply stops existing and „no pipeline run yet" and
 *  „somebody renamed the node" become the same green. */
export const VSS_BUDGET_NODE = "admin-sadebnata-vlast";

/** Висш съдебен съвет — the pack anchor and the /awarder/:eik route param. */
export const VSS_EIK = "121513231";

/** "Съдийската колегия на ВСС, изпълняваща функциите на ВСС" (2024, пар. 23 ПЗР
 *  на ЗИД на КРБ). Same institution, separate registration → merge into ВСС. */
export const VSS_ALIAS_EIKS = ["181092349"] as const;

/** Прокуратура на Република България — one EIK for the whole prosecution + НСлС. */
export const PRB_EIK = "121817309";
/** "Главна прокуратура на РБ /ГПРБ/" — legacy EIK, 2011 only → merge into ПРБ. */
export const PRB_ALIAS_EIKS = ["000695064"] as const;

export const VKS_EIK = "121268006"; // Върховен касационен съд
export const VAS_EIK = "121267370"; // Върховен административен съд
export const IVSS_EIK = "175451413"; // Инспекторат към ВСС
export const NIP_EIK = "131177220"; // Национален институт на правосъдието

export type CourtLevel =
  | "vss"
  | "ivss"
  | "vks"
  | "vas"
  | "prb"
  | "nip"
  | "apelativen"
  | "administrativen"
  | "okrazhen"
  | "rayonen";

/** eik → level. The 51 courts carry their tier; the six central bodies (EIGHT
 *  keys — two are alias registrations) carry their own id.
 *
 *  The per-EIK LEVEL is currently unread: it is the input for a planned court-level
 *  column on the judiciary browse pack, which ships no `Section` yet (only `water`
 *  and `defense` do). Today only the key set and `COURT_COUNT` below are consumed —
 *  said plainly so nobody goes hunting for a rendered column. */
export const COURT_LEVEL: Record<string, CourtLevel> = {
  // central bodies — the aliases collapse onto their principal, sourced from the
  // alias constants above so the merge can't drift from the fact that names it.
  [VSS_EIK]: "vss",
  ...Object.fromEntries(VSS_ALIAS_EIKS.map((e) => [e, "vss" as CourtLevel])),
  [IVSS_EIK]: "ivss",
  [VKS_EIK]: "vks",
  [VAS_EIK]: "vas",
  [PRB_EIK]: "prb",
  ...Object.fromEntries(PRB_ALIAS_EIKS.map((e) => [e, "prb" as CourtLevel])),
  [NIP_EIK]: "nip",
  // апелативни (2)
  "121654463": "apelativen", // Апелативен съд — София (bare name in the corpus)
  "102180174": "apelativen", // Бургас
  // административни (11)
  "160078385": "administrativen", // Пловдив
  "118581706": "administrativen", // Силистра
  "113586518": "administrativen", // Перник
  "175200279": "administrativen", // София-град
  "101749078": "administrativen", // Благоевград
  "148076820": "administrativen", // Варна
  "104681629": "administrativen", // Велико Търново
  "117675942": "administrativen", // Русе
  "123739574": "administrativen", // Стара Загора
  "109600905": "administrativen", // Кюстендил
  "119667813": "administrativen", // Сливен
  // окръжни + Софийски градски съд (14)
  "000696532": "okrazhen", // Софийски градски съд
  "000530739": "okrazhen", // Русе
  "000057389": "okrazhen", // Бургас
  "000970521": "okrazhen", // Ямбол
  "000852989": "okrazhen", // Добрич
  "000818150": "okrazhen", // Стара Загора
  "000093741": "okrazhen", // Варна
  "000025078": "okrazhen", // Благоевград
  "000351953": "okrazhen", // Пазарджик
  "000931760": "okrazhen", // Шумен
  "126004302": "okrazhen", // Хасково
  "000134056": "okrazhen", // Велико Търново
  "000386833": "okrazhen", // Перник
  "000590768": "okrazhen", // Сливен
  // районни (24)
  "831462482": "rayonen", // Софийски районен съд
  "000471778": "rayonen", // Пловдив
  "000093759": "rayonen", // Варна
  "000134070": "rayonen", // Горна Оряховица
  "000025092": "rayonen", // Гоце Делчев
  "816076609": "rayonen", // Козлодуй
  "000216037": "rayonen", // Дряново
  "000590794": "rayonen", // Нова Загора
  "000506065": "rayonen", // Разград
  "000471792": "rayonen", // Карлово
  "000134063": "rayonen", // Велико Търново
  "000216215": "rayonen", // Трявна
  "000216044": "rayonen", // Севлиево
  "000818168": "rayonen", // Стара Загора
  "126133788": "rayonen", // Хасково
  "000818175": "rayonen", // Казанлък
  "000852996": "rayonen", // Добрич
  "000904037": "rayonen", // Свиленград
  "000931785": "rayonen", // Нови пазар
  "108001913": "rayonen", // Ардино
  "000025085": "rayonen", // Благоевград
  "000321038": "rayonen", // Лом (tenders only)
  "000291787": "rayonen", // Луковит (tenders only)
  "000025110": "rayonen", // Разлог (tenders only)
};

/** The full judicial sector set (59 EIKs) — the `eiks` list for the judiciary
 *  sector browse pack and the consolidated group roll-up. */
export const JUDICIAL_EIKS: readonly string[] = Object.keys(COURT_LEVEL);

/** The central judicial bodies that procure in their own name, in budget order.
 *  Each links to its generic awarder dashboard at `/awarder/<eik>`; only the ВСС
 *  carries a domain sector pack. Aliases (181092349 → ВСС, 000695064 → ПРБ) are
 *  deliberately omitted — they are the same institutions under a second
 *  registration and would show up twice.
 *
 *  The 51 individual courts also procure, but sparsely (most have 1-3 contracts
 *  ever — the judiciary buys centrally through the ВСС), so they are counted
 *  rather than listed. */
export const JUDICIAL_BODIES: {
  eik: string;
  bg: string;
  en: string;
  /** True when /awarder/<eik> renders a domain-specific sector pack. */
  hasPack?: boolean;
  /** A caveat the reader needs to trust the number on the other side. */
  noteBg?: string;
  noteEn?: string;
}[] = [
  {
    eik: VSS_EIK,
    bg: "Висш съдебен съвет",
    en: "Supreme Judicial Council",
    hasPack: true,
    noteBg: "бюджет по органи · възлага централно за системата",
    noteEn: "budget by body · procures centrally for the system",
  },
  {
    eik: PRB_EIK,
    bg: "Прокуратура на Република България",
    en: "Prosecutor's Office",
    noteBg: "един ЕИК за цялата прокуратура и НСлС",
    noteEn: "one EIK for the whole prosecution and the investigation service",
  },
  {
    eik: VAS_EIK,
    bg: "Върховен административен съд",
    en: "Supreme Administrative Court",
  },
  {
    eik: VKS_EIK,
    bg: "Върховен касационен съд",
    en: "Supreme Court of Cassation",
  },
  {
    eik: IVSS_EIK,
    bg: "Инспекторат към Висшия съдебен съвет",
    en: "Inspectorate to the Supreme Judicial Council",
  },
  {
    eik: NIP_EIK,
    bg: "Национален институт на правосъдието",
    en: "National Institute of Justice",
  },
];

/** How many individual courts sit in the EIK set beyond the central bodies. */
export const COURT_COUNT = Object.values(COURT_LEVEL).filter((l) =>
  ["apelativen", "administrativen", "okrazhen", "rayonen"].includes(l),
).length;

// -------------------------------------------------------- budget body ids ---

/** The eight rows of the ЗДБРБ „Органи на съдебната власт" table, in law order.
 *  Canonically defined next to the artifact it describes; re-exported here so the
 *  tiles have one import site. */
export type { JudiciaryBodyId } from "@/data/budget/types";
import type { JudiciaryBodyId } from "@/data/budget/types";

/** Bar colour per budget body — the courts and the prosecution dominate. */
export const BODY_COLOR: Record<JudiciaryBodyId, string> = {
  courts: "bg-primary",
  prb: "bg-emerald-500",
  vss: "bg-sky-500",
  vas: "bg-violet-500",
  vks: "bg-amber-500",
  ivss: "bg-rose-500",
  nip: "bg-teal-500",
  reserve: "bg-muted-foreground/50",
};

// ------------------------------------------------------ CPV → function -----

export type VssCategory =
  | "buildings"
  | "it"
  | "energy"
  | "services"
  | "furnishing"
  | "other";

// CPV division (first two digits) → judiciary operating function. Derived from
// what the ВСС actually contracts (measured in local PG): courthouse
// construction & repair leads (div 45, ~€22M), then energy (09), the e-justice
// IT backbone (72/32/30), insurance & financial services (66), furnishings (39).
const CPV_TO_CATEGORY: Record<string, VssCategory> = {
  // Сгради и строителство — съдебни палати: build, repair, architecture, estate
  "45": "buildings",
  "70": "buildings",
  "71": "buildings",
  // ИТ и системи — ЕИСС, e-justice, licences, computing & network hardware
  "72": "it",
  "48": "it",
  "30": "it",
  "32": "it",
  "31": "it",
  // Енергия и горива
  "09": "energy",
  // Услуги, охрана и застраховане (insurance of magistrates lives in div 66)
  "66": "services",
  "79": "services",
  "50": "services",
  "90": "services",
  "98": "services",
  "80": "services",
  "64": "services",
  "63": "services",
  "60": "services",
  // Обзавеждане и консумативи
  "39": "furnishing",
  "44": "furnishing",
  "22": "furnishing",
};

export const categoryOfCpv = (cpv: string | undefined): VssCategory => {
  const d = String(cpv ?? "").slice(0, 2);
  return CPV_TO_CATEGORY[d] ?? "other";
};

export const VSS_CATEGORY_LABEL: Record<
  VssCategory,
  { bg: string; en: string }
> = {
  buildings: { bg: "Сгради и строителство", en: "Buildings & construction" },
  it: { bg: "ИТ и електронно правосъдие", en: "IT & e-justice" },
  energy: { bg: "Енергия и горива", en: "Energy & fuel" },
  services: { bg: "Услуги и застраховане", en: "Services & insurance" },
  furnishing: { bg: "Обзавеждане и консумативи", en: "Furnishings & supplies" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (c: VssCategory, lang: string): string =>
  lang === "bg" ? VSS_CATEGORY_LABEL[c].bg : VSS_CATEGORY_LABEL[c].en;

/** Suppliers whose lack of competition is set by statute, not procurement
 *  choice — surfaced as a context chip so a legal mandate isn't misread as a red
 *  flag. Информационно обслужване АД is the state's declared systems integrator
 *  (ЗЕУ, 2019); it builds the judiciary's ЕИСС/e-justice systems directly. */
export const VSS_SUPPLIER_CONTEXT: Record<
  string,
  { kind: "statutory"; bg: string; en: string }
> = {
  "831641791": {
    kind: "statutory",
    bg: "Системен интегратор на държавата по закон (ЗЕУ, 2019) — системите за електронно правосъдие се възлагат пряко, извън открита процедура",
    en: "Statutory national systems integrator (2019) — the e-justice systems are awarded directly, outside open tender",
  },
};

/** Display-trim for a registered supplier name: drop the legal-form/address tail. */
export const cleanSupplierName = (name: string): string =>
  name.split(/\s[-–—]\s|[,/]/)[0].trim();
