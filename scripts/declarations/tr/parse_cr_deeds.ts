/**
 * Layer 2 of the CR Deeds capture (docs/plans/cr-deeds-capture-v1.md §2): parse a
 * cached raw deed body into typed records. Re-runnable offline over the raw store,
 * so adding a field later costs zero fetches.
 *
 * ⚠️ This is a NEW scraper, NOT an adapter over parse_daily_filing. §0a of the plan
 * settled it: the CR Deeds body is RENDERED HTML keyed by opaque nameCode/fieldIdent
 * codes, not the egov feed's structured XML, so PERSON_SECTION_TO_ROLE /
 * META_FIELD_TO_KIND / parseShareAmount do not apply. It is also CURRENT STATE with
 * no history and no erasure marker — every present, non-empty field is in force
 * (fieldOperation ∈ {1,3} does NOT distinguish active vs erased; op-2 records carry
 * an empty body and are skipped).
 *
 * Field map (measured across EOOD/OOD/AD/EAD/ET/ЮЛНЦ/bankrupt fixtures):
 *   persons/entities — one <p class='field-text'> per record, split by <hr>:
 *     CR_F_7_L → управител · CR_F_9_L/CR_F_10_L → board member · CR_F_10a_L → ЮЛНЦ
 *     board · CR_F_19_L → съдружник · CR_F_23_L → едноличен собственик · CR_F_550_L
 *     → ЗМИП действителен собственик. A record may be a natural person OR a legal
 *     entity (ЕИК/ПИК or Идентификация inline) — the ownership chain (plan §8 A3).
 *   company meta — single value:
 *     CR_F_2_L name · CR_F_3_L legal form · CR_F_5_L/CR_F_5a_L seat · CR_F_6_L
 *     предмет на дейност · CR_F_6a_L НКИД (parsed to a NACE code + 2-digit
 *     division, the grain the CPV mismatch flag keys on) · CR_F_31_L капитал.
 */

import { isDeedTree, minEntryDate } from "./lib/crDeedsClient";

/** The roles this scraper recognises. A subset of TrRole (see types.ts) — the
 * ones the CR Deeds body carries — so projected rows drop straight into the
 * existing person model. */
export type CrDeedRole =
  | "sole_owner"
  | "partner"
  | "manager"
  | "director"
  | "ngo_board"
  | "actual_owner";

const FIELD_TO_ROLE: Record<string, CrDeedRole> = {
  CR_F_7_L: "manager", // управител (ООД/ЕООД)
  // NB: CR_F_9 folds supervisory-board (надзорен съвет) members into `director`
  // alongside CR_F_10's съвет на директорите — a coarse mapping the current TrRole
  // set does not distinguish; a `director` here may be a supervisory-board member.
  CR_F_9_L: "director", // член на управителен/надзорен орган (АД, кооперация)
  CR_F_10_L: "director", // съвет на директорите / член (АД/ЕАД)
  CR_F_10a_L: "ngo_board", // управителен орган на ЮЛНЦ
  CR_F_19_L: "partner", // съдружник (ООД)
  CR_F_23_L: "sole_owner", // едноличен собственик на капитала (ЕООД/ЕАД)
  CR_F_550_L: "actual_owner", // ЗМИП действителен собственик
};

/** One person or legal entity attached to a company, as read from the deed. */
export type CrDeedParty = {
  role: CrDeedRole;
  name: string;
  /** True when the party is a legal entity (община, state body, company, foreign
   * legal person) rather than a natural person — MUST NOT feed the person graph.
   * Detection is marker-based (inline ЕИК/ПИК · Идентификация · "юридическо лице" ·
   * a trailing legal-form token like ООД/АД/ОБЩИНА); a legal entity rendered with
   * none of those reads as false. Treat false as *probably*, not *certainly*, a
   * natural person, and never as licence to skip the name-only caveat downstream. */
  isLegalEntity: boolean;
  /** The entity's own ЕИК/identification when it is a legal entity — the walkable
   * ownership chain (plan §8 A3). null for natural persons. */
  eik: string | null;
  country: string | null;
  positionLabel: string | null;
  /** CR's own fieldIdent — used to namespace the projected company_persons row. */
  fieldIdent: string;
  /** fieldEntryDate (YYYY-MM-DD) — when the currently-in-force value was entered. */
  entryDate: string | null;
};

export type CrDeedParsed = {
  uic: string;
  companyName: string | null;
  legalFormCode: number | null;
  deedStatus: number | null;
  /** min(fieldEntryDate) — the founding date (earliest surviving current entry). */
  foundingDate: string | null;
  parties: CrDeedParty[];
  seat: string | null;
  capitalAmount: number | null;
  capitalCurrency: string | null;
  subjectOfActivity: string | null;
  /** Raw CR_F_6a_L text ("Група по НКИД: 86.10 Клас по НКИД: …"). */
  nkid: string | null;
  /** Parsed НКИД/КИД-2008 (NACE) code, e.g. "86.10" — null when absent/unparsable. */
  naceCode: string | null;
  /** The 2-digit NACE division, e.g. "86" — the grain the CPV crosswalk keys on. */
  naceDivision: string | null;
};

/**
 * Parse the НКИД code + 2-digit division out of a CR_F_6a_L text. The register
 * writes the code two ways — dotted "86.10" and undotted "8690" — both of which
 * reduce to division "86" (the first two digits). Returns nulls when no code is
 * present (the description-only or empty forms).
 */
export const parseNace = (
  text: string,
): { code: string | null; division: string | null } => {
  const m = text.match(/Група по НКИД:\s*([0-9][0-9.]*)/);
  if (!m) return { code: null, division: null };
  const code = m[1].replace(/\.$/, ""); // drop a trailing dot
  // Division is the 2-digit NACE prefix — taken from the part BEFORE any dot so a
  // malformed "8.10" reduces to "8" (→ null), never to the wrong "81".
  const head = code.split(".")[0].replace(/\D/g, "");
  const division = head.length >= 2 ? head.slice(0, 2) : null;
  return { code: division ? code : null, division };
};

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: " ",
  apos: "'",
  laquo: "«",
  raquo: "»",
};

// An out-of-range numeric reference (&#9999999999;) throws RangeError from
// String.fromCodePoint. parseCrDeed's contract is "never throw on a hostile body",
// and htmlData is external, so guard the conversion and leave a bad reference
// verbatim rather than crashing the whole parse.
const safeFromCodePoint = (cp: number): string | null => {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return null;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return null;
  }
};

/** Decode the HTML entities the CR renderer emits (&quot;, &#039;, &nbsp;, …). */
export const decodeEntities = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (m, n) => safeFromCodePoint(Number(n)) ?? m)
    .replace(
      /&#x([0-9a-f]+);/gi,
      (m, n) => safeFromCodePoint(parseInt(n, 16)) ?? m,
    )
    // Named entities are conventionally lower-case; fold case so &QUOT; resolves too.
    .replace(
      /&([a-z]+);/gi,
      (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m,
    );

/** Strip tags, decode entities, collapse whitespace. */
export const stripHtml = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/**
 * One text per record. The CR renderer wraps every record in a
 * `<p class='field-text'>…</p>` (a multi-person field is several of them, split by
 * `<hr>`); falling back to the whole stripped field keeps single-value meta fields
 * working even if the wrapper ever changes. NB the fallback is meant for
 * single-value meta: if the wrapper ever vanished from a multi-party role field it
 * would merge the parties into one record — measured data always carries the `<p>`.
 */
export const fieldRecords = (html: string): string[] => {
  const out: string[] = [];
  const re = /<p[^>]*class=['"]field-text['"][^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text) out.push(text);
  }
  if (out.length === 0) {
    const whole = stripHtml(html);
    if (whole) out.push(whole);
  }
  return out;
};

// A trailing Bulgarian legal-form / institution token marks a party as a legal
// entity even when the render carries no ЕИК/Идентификация (FINDING-002). ЕТ is
// deliberately excluded: an едноличен търговец is a natural person trading under a
// firm name, so its record should still resolve to the person.
const LEGAL_FORM_TOKEN =
  /(?:^|\s|")(?:ЕООД|ООД|ЕАД|АД|КДА|КД|СД|ДЗЗД|ЮЛНЦ|СНЦ|ФОНДАЦИЯ|СДРУЖЕНИЕ|КООПЕРАЦИЯ|ОБЩИНА|МИНИСТЕРСТВО|АГЕНЦИЯ|ДЪРЖАВНО)\.?(?:,|$|\s)/;

/** Parse one person/entity record text: "NAME, Държава: X[, Длъжност: Y][ ЕИК/ПИК N]". */
export const parseParty = (
  text: string,
  role: CrDeedRole,
  fieldIdent: string,
  entryDate: string | null,
): CrDeedParty => {
  // Cut the name at the comma that introduces a known key, NOT the first comma —
  // a quoted entity name ("АБВ, ГД" ООД) contains its own comma (FINDING-003).
  const name = text
    .split(
      /,\s*(?=ЕИК\/ПИК|Идентификаци[яи]|Държава|Длъжност|Чуждестранно|Вид|Данни)/,
    )[0]
    .trim();
  const eikM = text.match(/(?:ЕИК\/ПИК|Идентификаци[яи])\s*([0-9]{6,})/);
  const eik = eikM ? eikM[1] : null;
  const isLegalEntity =
    eik !== null ||
    /юридическо лице/i.test(text) ||
    LEGAL_FORM_TOKEN.test(name);
  const countryM = text.match(
    /Държава:\s*([^,]+?)(?=,|\s+(?:Държава на|Длъжност|Вид|Данни|ЕИК)|$)/,
  );
  const country = countryM ? countryM[1].trim() : null;
  const posM = text.match(/Длъжност:\s*(.+?)\s*$/);
  return {
    role,
    name,
    isLegalEntity,
    eik,
    country,
    positionLabel: posM ? posM[1].trim() : null,
    fieldIdent,
    entryDate,
  };
};

const CURRENCY: Array<[RegExp, string]> = [
  [/€|EUR|евро/i, "EUR"],
  [/лв|BGN/i, "BGN"],
];

/** "5112918.81 €" → { amount: 5112918.81, currency: "EUR" }. Handles both decimal
 * conventions — "1,000,000.00" and "5 000,00" — by treating the LAST separator as
 * the decimal point and stripping the other as a thousands grouping. */
export const parseCapital = (
  text: string,
): { amount: number | null; currency: string | null } => {
  const raw = text.replace(/\s/g, "").match(/-?[\d.,]+/)?.[0];
  let amount: number | null = null;
  if (raw) {
    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");
    const norm =
      lastComma > lastDot
        ? raw.replace(/\./g, "").replace(",", ".") // comma is the decimal
        : raw.replace(/,/g, ""); // dot is the decimal (or none)
    const n = Number(norm);
    amount = Number.isFinite(n) ? n : null;
  }
  let currency: string | null = null;
  for (const [re, code] of CURRENCY)
    if (re.test(text)) {
      currency = code;
      break;
    }
  return { amount, currency };
};

const dateSlice = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d\d-\d\d/.test(v) ? v.slice(0, 10) : null;

/** An array-valued property of an unknown object, or [] — the sections→subDeeds→
 * groups→fields walk is four of these. */
const arrayProp = <T = unknown>(obj: unknown, key: string): T[] => {
  const v = (obj as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
};

type DeedField = {
  nameCode?: string;
  htmlData?: string;
  fieldIdent?: string;
  fieldEntryDate?: string;
};

/**
 * Parse a raw CR Deeds body (the exact HTTP string stored in Layer 1). Returns
 * null for a non-answer / empty-200 / non-deed body — the caller must never
 * project from a null.
 */
export const parseCrDeed = (body: string | null): CrDeedParsed | null => {
  if (!body || !body.trim()) return null;
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isDeedTree(root)) return null;
  const d = root as Record<string, unknown>;

  const out: CrDeedParsed = {
    uic: typeof d.uic === "string" ? d.uic : String(d.uic ?? ""),
    companyName: typeof d.companyName === "string" ? d.companyName : null,
    legalFormCode: Number.isFinite(Number(d.legalForm))
      ? Number(d.legalForm)
      : null,
    deedStatus: Number.isFinite(Number(d.deedStatus))
      ? Number(d.deedStatus)
      : null,
    foundingDate: minEntryDate(root),
    parties: [],
    seat: null,
    capitalAmount: null,
    capitalCurrency: null,
    subjectOfActivity: null,
    nkid: null,
    naceCode: null,
    naceDivision: null,
  };

  for (const sec of arrayProp(d, "sections")) {
    for (const sd of arrayProp(sec, "subDeeds")) {
      for (const g of arrayProp(sd, "groups")) {
        for (const f of arrayProp<DeedField>(g, "fields")) {
          const code = f.nameCode;
          const html = f.htmlData ?? "";
          if (!code || !html) continue;
          const entry = dateSlice(f.fieldEntryDate);
          const ident = f.fieldIdent ?? code;

          const role = FIELD_TO_ROLE[code];
          if (role) {
            for (const rec of fieldRecords(html))
              out.parties.push(parseParty(rec, role, ident, entry));
            continue;
          }
          // Company meta — take the first record's text (single-value fields).
          const text = fieldRecords(html)[0] ?? "";
          if (!text) continue;
          switch (code) {
            case "CR_F_2_L":
              out.companyName ??= text;
              break;
            case "CR_F_5_L":
            case "CR_F_5a_L":
              out.seat ??= text;
              break;
            case "CR_F_6_L":
              out.subjectOfActivity ??= text;
              break;
            case "CR_F_6a_L": {
              if (out.nkid == null) {
                out.nkid = text;
                const nace = parseNace(text);
                out.naceCode = nace.code;
                out.naceDivision = nace.division;
              }
              break;
            }
            case "CR_F_31_L": {
              // Record the currency only alongside a real amount — never a
              // currency with a null amount (FINDING-007).
              const { amount, currency } = parseCapital(text);
              if (amount != null) {
                out.capitalAmount ??= amount;
                out.capitalCurrency ??= currency;
              }
              break;
            }
          }
        }
      }
    }
  }
  return out;
};
