// Which bucket a declarant belongs to, from the verbatim `Category Name` in
// register.cacbg.bg's list.xml.
//
// Kept out of ./index.ts on purpose, for the same reason as ./merge.ts: that
// module calls `run(...)` at import time, so importing it from a test would
// execute the whole network ingest.
//
// The register publishes 53 categories under ЗПКОНПИ. This map used to cover
// four substrings — cabinet, state agencies, regional governors — i.e. 446 of
// the ~15,900 declarants in a cycle. The rest were fetched by nobody, which is
// why six `person_source` facets (president, mep, academic, diplomat, media,
// professional) were declared in the schema with zero rows in them, and why the
// regulator roster was hand-curated on the premise that no machine-readable
// feed existed. It does: these same filings carry the Constitutional Court, the
// ЦИК, БНБ, КЕВР, КРС, СЕМ, КЗК, КЗД, КФН and the Сметна палата, with a
// statutory obligation behind them.
//
// Two tiers stay OUT of this map because they have their own ingests:
//   - "Кметове…" (6402/yr) → scripts/officials/municipal.ts
//   - "Народни представители" (253/yr) → scripts/declarations/index.ts
// and the judiciary ("Председатели на ВКС и на ВАС…") stays out because the
// ИВСС register covers it with richer per-magistrate data (`magistrate`).

import type { OfficialCategoryKind } from "../../src/data/dataTypes";

// Substring match against the verbatim `Category Name`. Each entry is chosen to
// be unambiguous against every OTHER category name in the register — several
// share long legal preambles, so the discriminating fragment is usually a body
// acronym rather than the opening words.
//
// Order matters: the first matching bucket wins, so more specific strings come
// before generic ones. Matching is CASE-SENSITIVE, so prefer a fragment from
// the middle of the name over its opening words — a leading "Членовете" is
// capitalised in the name and lowercase in the obvious substring, which silently
// matches nothing (caught by ./category_coverage.test.ts).
//
// MUST stay in sync with CATEGORY_SUBSTRINGS in
// scripts/watch/sources/cacbg_officials.ts — the watcher has to fingerprint
// exactly the set this ingest would process. Enforced by
// ./watcher_lockstep.test.ts.
export const CATEGORY_MAP: Array<{
  kind: OfficialCategoryKind;
  substrings: string[];
}> = [
  // ── Political executive ────────────────────────────────────────────────────
  {
    kind: "cabinet",
    substrings: ["Министър-председател", "министри и заместник-министри"],
  },
  { kind: "regional_governor", substrings: ["Областни управители"] },
  {
    kind: "political_cabinet",
    substrings: ["Началници на политическите кабинети"],
  },
  { kind: "president", substrings: ["Президент и вицепрезидент"] },
  { kind: "mep", substrings: ["Членове на ЕП от Република България"] },
  {
    kind: "party_leader",
    substrings: ["Председателите на политическите партии"],
  },

  // ── Independent bodies and regulators ("кой решава") ───────────────────────
  {
    kind: "regulator",
    substrings: [
      "Конституционния съд",
      "членовете на ЦИК",
      "членовете на КЕВР",
      "членове на КРС",
      "членове на СЕМ",
      "членовете на КЗК",
      "членовете на КЗД",
      "членовете на КФН",
      "членовете на КОНПИ",
      "членовете на НБКСРС",
      "Омбудсман",
    ],
  },

  { kind: "central_bank", substrings: ["главният секретар на БНБ"] },
  { kind: "audit_court", substrings: ["членовете на Сметната палата"] },

  // ── Administration ─────────────────────────────────────────────────────────
  { kind: "secretary_general", substrings: ["Главни секретари на НС"] },
  { kind: "inspectorate", substrings: ["Ръководителите на инспекторати"] },
  {
    kind: "agency_head",
    substrings: ["държавни агенции", "изпълнителните агенции"],
  },
  {
    kind: "regional_director",
    substrings: ["Ръководителите на ОДБХ"],
  },
  {
    kind: "procurement_officer",
    substrings: ["упълномощени по реда на Закона за обществените поръчки"],
  },
  {
    kind: "eu_funds_controller",
    substrings: ["органи за финансово управление и контрол"],
  },

  // ── Revenue, security, defence ─────────────────────────────────────────────
  {
    // "главният секретар на Агенция" alone would mean the general secretary of
    // ANY agency; anchor on the customs agency by name.
    kind: "revenue_agency",
    substrings: ["главният секретар на НАП", 'секретар на Агенция "Митници"'],
  },
  {
    kind: "security_service",
    substrings: ["ДАНС", "Главният секретар на МВР"],
  },
  { kind: "military_command", substrings: ["Началникът на отбраната"] },

  // ── Social funds and health ────────────────────────────────────────────────
  {
    kind: "social_fund",
    substrings: ["на НЗОК и директорите на РЗОК", "подуправителят на НОИ"],
  },
  {
    kind: "hospital_head",
    substrings: ["лечебните заведения за болнична помощ"],
  },

  // ── State-owned enterprises and public capital ─────────────────────────────
  {
    kind: "state_enterprise",
    substrings: [
      "икономически обособените лица",
      "държавните предприятия по Закона за горите",
      "на НЕК и на БЕХ",
      "Българската банка за развитие",
      "Български спортен тотализатор",
      // Two upstream typos ("предпиятия", "гарнтиране"). Anchor on the
      // surrounding words instead, so an upstream correction does not silently
      // drop the tier.
      "Изпълнителния съвет и на Надзорния съвет на Агенцията",
      "управителния съвет на фонда за гар",
      "Фонд затворно дело",
      "търговски дружества с държавно или общинско участие",
    ],
  },

  // ── Diplomacy, academia, media, civil society, international ───────────────
  { kind: "diplomat", substrings: ["задгранични представителства"] },
  { kind: "academic", substrings: ["Председателят на БАН"] },
  { kind: "media_head", substrings: ["Генералните директори на БНТ"] },
  { kind: "civil_society", substrings: ["БЧК"] },
  {
    kind: "international",
    substrings: [
      "Организацията на Северноатлантическия договор",
      "Членовете на Европейската комисия",
      "органи на международни организации",
    ],
  },
];

export const categoriseRaw = (raw: string): OfficialCategoryKind | null => {
  for (const bucket of CATEGORY_MAP) {
    for (const sub of bucket.substrings) {
      if (raw.includes(sub)) return bucket.kind;
    }
  }
  return null;
};

// A deputy minister and their minister share one register category
// ("Министър-председател, заместник министър-председатели, министри и
// заместник-министри"), so the category alone cannot tell them apart. The
// per-person position title can, and now that the ingest reads the right
// element it is available: the register writes "Заместник-министър" for a
// deputy minister and "Министър" / "Министър-председател" / "Заместник
// министър-председател" / "Служебен министър-председател" for the rest.
//
// Note the trap: "Заместник министър-председател" (deputy PRIME minister, a
// cabinet member) starts with the same word as "Заместник-министър" (deputy
// minister). They differ by the hyphen and by "-председател", so match the
// deputy-minister form specifically rather than on a "Заместник" prefix.
const DEPUTY_MINISTER_RE = /^заместник[\s-]*министър(?![\s-]*председател)/i;

// "Служебен" marks a CARETAKER government post — the register writes "Служебен
// министър", "Служебен заместник-министър", "Служебен министър-председател".
// It is a modifier on the office, not a different office, so it is stripped
// before the office test and reported separately.
//
// This is the distinction that made a caretaker minister indistinguishable from
// any other cabinet member on a profile page: three consecutive caretaker
// cabinets served between 2021 and 2024, and "Член на кабинета" said nothing
// about which.
const CARETAKER_RE = /^служебен\s+/i;

export const isCaretakerTitle = (title: string | null): boolean =>
  title != null && CARETAKER_RE.test(title.trim());

/** The office, with any caretaker modifier removed. */
export const officeTitle = (title: string | null): string | null =>
  title == null ? null : title.trim().replace(CARETAKER_RE, "") || null;

export const isDeputyMinisterTitle = (title: string | null): boolean => {
  const office = officeTitle(title);
  return office != null && DEPUTY_MINISTER_RE.test(office);
};

// Final category for one declarant: the category bucket, refined by the
// position title where the register lumps two distinct offices together.
export const categorise = (
  categoryRaw: string,
  positionTitle: string | null,
): OfficialCategoryKind | null => {
  const kind = categoriseRaw(categoryRaw);
  if (kind === "cabinet" && isDeputyMinisterTitle(positionTitle)) {
    return "deputy_minister";
  }
  return kind;
};
