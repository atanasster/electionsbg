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
 *     CR_F_2_L name · CR_F_3_L legal form · CR_F_5_L seat (CR_F_5a_L is the
 *     CORRESPONDENCE address and loses to it explicitly — see the switch) · CR_F_6_L
 *     предмет на дейност · CR_F_6a_L НКИД (parsed to a NACE code + 2-digit
 *     division, the grain the CPV mismatch flag keys on) · CR_F_31_L капитал.
 */

import { isDeedTree, minEntryDate } from "./lib/crDeedsClient";
import { naceDivisionFromLabel } from "../../../src/lib/naceLabel";

/** The roles this scraper recognises. A subset of TrRole (see types.ts) — the
 * ones the CR Deeds body carries — so projected rows drop straight into the
 * existing person model. */
export type CrDeedRole =
  | "sole_owner"
  | "sole_trader"
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
  // Физическо лице търговец (ЕТ). The code↔fieldIdent pairing is VERIFIED rather than
  // inferred from the CR_F_<n>_L ↔ 00<n>0 pattern: the committed et.json capture carries
  // `{ nameCode: "CR_F_18_L", fieldIdent: "00180" }`, and 00180 is the same field the
  // daily feed's `PhysicalPersonTrader` section rides on (parse_daily_filing.ts). The
  // guess would have been right, but naming a person as the owner of a business is not a
  // claim to make on a pattern.
  //
  // ⚠️ Currently reaches nothing: 0 of the 29,777 captures are ЕТ (the crawl tiers are
  // contractor-first), so this maps a field the store does not yet hold. It is here so
  // that a tier-2/3 capture carries the trader on arrival instead of silently dropping
  // them the way the daily feed did.
  CR_F_18_L: "sole_trader", // физическо лице търговец (ЕТ)
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
  /**
   * The seat EXACTLY as CR renders it — a labelled block, phone/fax/e-mail included. Kept
   * DELIBERATELY even though nothing stores it: it is the only witness to what
   * `seatCanonical` was derived from, so an "unused field" sweep must not take it.
   * `seatCanonical` is the field with consumers.
   */
  seat: string | null;
  /**
   * The same seat rewritten into the DAILY FEED's shape („БЪЛГАРИЯ, гр. Разлог, 2760"),
   * which is the only form anything downstream can read. See `crSeatToFeedForm`.
   */
  seatCanonical: string | null;
  capitalAmount: number | null;
  capitalCurrency: string | null;
  subjectOfActivity: string | null;
  /** Raw CR_F_6a_L text ("Група по НКИД: 86.10 Клас по НКИД: …"). */
  nkid: string | null;
  /** Raw НКИД code as written, e.g. "86.10" or "8690" — provenance/display only.
   *  ⚠️ NOT usable to derive the division: the field mixes НКИД-2003 (NACE Rev.1.1)
   *  and КИД-2008 (Rev.2) codes, which reuse the same division numbers for different
   *  sectors — see src/lib/naceLabel.ts. */
  naceCode: string | null;
  /** The КИД-2008 (Rev.2) 2-digit division the CPV crosswalk keys on, classified
   *  from the LABEL text (naceDivisionFromLabel), NOT the ambiguous code. Null when
   *  the label yields no confident sector. */
  naceDivision: string | null;
};

/**
 * Rewrite a CR seat into the shape the daily feed writes — „БЪЛГАРИЯ, гр. Разлог, 2760".
 *
 * ⚠️ THE RAW CR SEAT IS UNREADABLE DOWNSTREAM, AND FAILS SILENTLY RATHER THAN LOUDLY.
 * `parseSeat` (`scripts/db/load_tr_company_place_pg.ts`) splits the feed's string on commas
 * and takes field 1 as the locality; the CR string is a LABELLED BLOCK, so on
 * „Държава: БЪЛГАРИЯ Област: Благоевград, Община: Разлог Населено място: гр. Разлог, п.к.
 * 2760 …" that field is „Община: Разлог Населено място: гр. Разлог". The resolver then
 * matches nothing (or, worse, something) and the company is simply never placed — with the
 * seat column full and every row count reconciling. So the projection stores THIS, not the
 * raw text, and `seat` keeps the original for provenance.
 *
 * ⚠️ AND THE RAW CARRIES CONTACT DETAILS THE COLUMN HAS NEVER HELD — „Телефон:", „Факс:",
 * „Адрес на електронна поща:" (7,867 of 29,417 captures carry one with a non-empty value;
 * 7,899 carry an „@" anywhere in the block — the predicate is named so the next
 * re-measurement is comparable), „Интернет страница:". `seat` is
 * rendered on `/company/:eik` and is a `companies` browse column; quietly widening it into a
 * contact field is a second change nobody asked for, on a page about named businesses.
 * Canonicalising drops them.
 *
 * The structure is exactly regular across the whole capture set (measured 2026-09-06 over
 * 29,417 seats): every one carries Държава / Област / Община / Населено място, and 28,974
 * (98.5%) carry a п.к. TOKEN — but 144 of those carry an unusable VALUE („п.к. .", „п.к. --",
 * and truncated forms like „п.к. 900" for 9000), which the 4–5 digit requirement correctly
 * refuses rather than turning into a wrong postal match. So **587** canonical outputs are the
 * two-field string, not 443: `parseSeat` accepts those (the feed itself has 4,059) and the
 * resolver's name arm still places them.
 *
 * VALIDATED AGAINST AN INDEPENDENT SOURCE rather than against its own fixtures: on the 3,247
 * companies where BOTH the capture and the daily feed carry a seat, the canonicalised CR form
 * and the feed's own resolve to the SAME EKATTE for 3,216 (99.05%). The 31 that differ are
 * companies that MOVED between the capture and the feed (Несебър→Равда, София→Пловдив), which
 * is the measurement behind the projection's fill-if-null precedence — not a parse error.
 *
 * Returns null when the block names no locality; the caller then stores nothing.
 */
export const crSeatToFeedForm = (raw: string): string | null => {
  const country = raw.match(/Държава:\s*(.+?)\s+Област:/)?.[1]?.trim();
  // The locality runs to whichever of these comes first. Only „Телефон:" is `<label>:`
  // shaped, which is why this is an explicit alternation rather than „up to the next
  // capitalised word followed by a colon".
  //
  // ⚠️ `ж.к.` AND `бл.` ARE IN THE SET BECAUSE OF A MEASURED RESIDUE, not for symmetry. The
  // usual block puts the postcode, then the district, then the street after the locality, and
  // stopping at any of those covers 29,377 of 29,417 captures. The other 40 carry NONE of
  // them and go straight from the locality to the neighbourhood, so the match ran to the end
  // of the string and produced „гр. София ж.к. КВ. МАНАСТИРСКИ ЛИВАДИ-ЗАПАД" — which places
  // nobody, at a filled column.
  const locality = raw
    .match(
      /Населено място:\s*(.+?)(?:,\s*п\.к\.|\s+р-н\s|\s+бул\.\/ул\.|\s+ж\.к\.|\s+бл\.|\s+Телефон:|$)/,
    )?.[1]
    // A locality that ran to `$` can end on the comma that separated it from whatever
    // followed; `parseSeat` splits on commas, so a trailing one becomes an empty field.
    ?.replace(/[,\s]+$/, "")
    .trim();
  if (!country || !locality) return null;
  // Matched over the WHOLE block rather than scoped to the locality. ⚠️ THE GUARANTEE IS
  // ORDER, NOT UNIQUENESS, and an earlier draft of this comment claimed the latter: 7 captures
  // DO carry a second „п.к." — always a PO box in the street part („…, п.к.132", „вх. п.к.176")
  // — and none of them is reached, because the locality's п.к. is always the FIRST occurrence
  // and this match is non-global. (No capture carries a second „Област:"; that half was right.)
  // Do not lean on the PO boxes staying short: none is 4–5 digits today, which is luck, while
  // the ordering is the property. Scoping to the locality would also drop the postcode whenever
  // the locality match stopped at „бул./ул." — so re-measure before tightening this.
  //
  // Pinned by „takes the locality's postcode, not a PO box in the street part".
  const postcode = raw.match(/п\.к\.\s*(\d{4,5})/)?.[1];
  return postcode
    ? `${country}, ${locality}, ${postcode}`
    : `${country}, ${locality}`;
};

/**
 * Extract the RAW НКИД code out of a CR_F_6a_L text, for provenance/display only
 * (`naceCode`). The register writes it dotted ("86.10") or undotted ("8690").
 *
 * ⚠️ The code's 2-digit prefix is DELIBERATELY NOT used as the division: the field
 * mixes НКИД-2003 (NACE Rev.1.1) and КИД-2008 (Rev.2) codes and the two reuse
 * division numbers for different sectors (45 = construction vs motor-trade; 51 =
 * wholesale vs air transport). The division is classified from the LABEL instead —
 * see naceDivisionFromLabel (src/lib/naceLabel.ts). Returns null when no code is
 * present (the description-only or empty forms).
 */
export const parseNace = (text: string): { code: string | null } => {
  const m = text.match(/Група по НКИД:\s*([0-9][0-9.]*)/);
  if (!m) return { code: null };
  const code = m[1].replace(/\.$/, ""); // drop a trailing dot
  // Require at least a 2-digit head so a stray single digit is not stored as a code.
  const head = code.split(".")[0].replace(/\D/g, "");
  return { code: head.length >= 2 ? code : null };
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
    seatCanonical: null,
    capitalAmount: null,
    capitalCurrency: null,
    subjectOfActivity: null,
    nkid: null,
    naceCode: null,
    naceDivision: null,
  };

  // Which field `out.seat` came from — see the CR_F_5_L / CR_F_5a_L case below.
  let seatFrom: string | null = null;

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
            // ⚠️ CR_F_5_L IS THE SEAT; CR_F_5a_L IS NOT THE SAME ADDRESS. Measured
            // 2026-09-06: 6,735 captures carry BOTH, 5,137 of those differ in raw text and
            // **2,198 canonicalise to a different address** — sometimes a different oblast
            // (010951366 is Девня 9160 against Варна 9000). 5a is the correspondence address,
            // not a synonym, and this now flows into `tr_company_place`, the governance
            // „фирми, регистрирани тук" tiles and the flyover arcs rather than into one text
            // field.
            //
            // ⚠️ SO THE PRECEDENCE IS STATED, NOT INHERITED FROM DOCUMENT ORDER. CR_F_5_L
            // is rendered first on all 6,735 today, so a plain first-wins guard picks the
            // right one — but that is a property of the register's output, not a rule, and
            // if it ever changed those 2,198 companies would move to their correspondence
            // address silently, at a 200, in the place layer. Writing the rule down costs one
            // local and removes the dependence: 5_L overrides a value taken from 5a, whatever
            // order they arrive in. Pinned by „prefers CR_F_5_L over CR_F_5a_L even when 5a
            // comes first in the document", whose fixture puts 5a first — with 5_L first the
            // test would pass against either implementation and prove nothing.
            //
            // ⚠️ DO NOT RELAX THE NULL ARM TO `out.seatCanonical == null`. It looks strictly
            // more robust (it would let 5a fill in when 5_L failed to canonicalise) and is
            // the one change that would prefer the correspondence address, in exactly the
            // cases nobody is watching. Measured: `crSeatToFeedForm` returns null for 0 of
            // the 29,417 seats, so the branch it would enable buys nothing and costs that.
            case "CR_F_5_L":
            case "CR_F_5a_L":
              // Explicit precedence, NOT first-wins: CR_F_5_L overrides a value already taken
              // from CR_F_5a_L, whatever order the two arrive in.
              if (
                out.seat == null ||
                (code === "CR_F_5_L" && seatFrom !== code)
              ) {
                out.seat = text;
                out.seatCanonical = crSeatToFeedForm(text);
                seatFrom = code;
              }
              break;
            case "CR_F_6_L":
              out.subjectOfActivity ??= text;
              break;
            case "CR_F_6a_L": {
              if (out.nkid == null) {
                out.nkid = text;
                out.naceCode = parseNace(text).code; // raw code, provenance only
                out.naceDivision = naceDivisionFromLabel(text); // Rev.2, from label
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
