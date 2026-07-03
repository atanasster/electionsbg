/**
 * Parse one data.egov.bg TR daily-filing JSON into a flat list of typed
 * ChangeEvents. Pure / sync / no I/O. See ./types.ts for the event shape and
 * docs/plans/mp-financial-connections-slice3-tr-design.md for schema details.
 */

import type {
  TrChangeEvent,
  TrCompanyMetaField,
  TrPersonAddedEvent,
  TrPersonSectionErasedEvent,
  TrRole,
} from "./types";

// data.egov.bg's JSON wraps every leaf scalar in `{ "_": "value" }` and every
// collection in an array. These tiny helpers undo that.
type Wrapped = { _?: string; $?: Record<string, string>; [k: string]: unknown };
type Arr<T> = T[] | undefined;

const text = (w: Wrapped | undefined): string | null => {
  if (!w) return null;
  const v = w._;
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
};

const firstText = (xs: Arr<Wrapped>): string | null =>
  xs && xs[0] ? text(xs[0]) : null;

const attr = (
  w: { $?: Record<string, string> } | undefined,
  k: string,
): string | null => {
  if (!w?.$) return null;
  const v = w.$[k];
  return v == null || v === "" ? null : v;
};

// Section names inside a SubDeed that wrap arrays of person records.
const PERSON_SECTION_TO_ROLE: Record<string, TrRole> = {
  Managers: "manager",
  Representatives: "representative",
  BoardOfDirectors: "director",
  BoardOfManagers: "board_of_managers",
  ControllingBoard: "controlling_board",
  Procurators: "procurator",
  BranchManagers: "branch_manager",
  Liquidators: "liquidator",
  Partners: "partner",
  SoleCapitalOwner: "sole_owner",
  ForeignTraders: "foreign_trader",
  ActualOwners: "actual_owner",
  // ЮЛНЦ (non-profit) governing bodies. These nest one level deeper
  // (section → record wrapper → Subject/Person), but eventsFromPersonGroup +
  // the PERSON_RECORD_KEYS / subject-fallback below already handle that.
  ManagementBodies12d: "ngo_board", // управителен съвет (чл.18 ал.1 т.3)
  Representatives103: "ngo_representative", // представляващи
  BoardOfTrusties13g: "trustee", // читалищно настоятелство
  VerificationCommission15b: "verifier", // проверителна комисия
};

// Non-person ЮЛНЦ metadata sections, keyed by their SubDeed element name
// (the value lives on the group's text or a nested Text child).
const NGO_META_SECTION_TO_KIND: Record<string, TrCompanyMetaField> = {
  Objectives: "objectives", // 00062
  MeansOfAchievingTheObjectives: "means", // 00063
  DesignatedToPerformPublicBenefit: "public_benefit", // 00171 (value "1")
  DesignatedToCarryOutPrivateActivity: "private_benefit", // 00174 (value "1")
  CessationOfNonProfitLegalEntity: "cessation", // 00261 → status ceased
};

const META_FIELD_TO_KIND: Record<string, TrCompanyMetaField> = {
  "00010": "name", // UIC field carries no value content; keep the field-event hook only
  "00020": "name",
  "00030": "legal_form",
  "00050": "seat",
  "00310": "funds",
  "00320": "deposited_funds",
  "00260": "cessation",
  "00270": "addemption",
  "09010": "bankruptcy_open",
  "09100": "bankruptcy_declared",
  "05010": "liquidation",
};

// Wrapper element names that contain individual person records inside a
// section (e.g. inside Managers we have Manager[]; inside Partners we have
// Partner[]). Subject is the wrapper used by SoleCapitalOwner and a few
// others where there's no domain-specific element name.
const PERSON_RECORD_KEYS = [
  "Partner",
  "Manager",
  "Representative",
  "Director",
  "Procurator",
  "BranchManager",
  "Liquidator",
  "Subject",
  "ActualOwner",
  "ForeignTrader",
  "Controller",
  "BoardMember",
  // ЮЛНЦ record wrappers (each nests a Subject or Person leaf).
  "ManagementBody12d",
  "Representative103",
  "Trustee13g",
  "CommissionMember15b",
];

// Cell-level helpers. The partner/owner capital share lives on the record's
// `$.share` as an ABSOLUTE amount (e.g. "3825") + `$.currency` — not a percent.
const parseShareAmount = (raw: string | null | undefined): number | null => {
  if (!raw) return null;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const formatFilingDate = (a: Record<string, string> | undefined): string => {
  // Prefer FieldEntryDate (when registered), fall back to FieldActionDate.
  const d = a?.FieldEntryDate || a?.FieldActionDate || "";
  // Sometimes "2026-04-29T07:33:19+03:00" — keep as-is, valid ISO.
  return d;
};

const extractPersonName = (
  subject: Wrapped,
): {
  name: string | null;
  position: string | null;
  country: string | null;
} => {
  // We deliberately do NOT extract the source `Indent` element here. It holds
  // a hash+salt of the person's EGN — sensitive personal data that we treat
  // the same as the EGN itself: never extracted, never stored, never displayed.
  // Joins across filings rely on the normalized plain-text `Name`.
  const name = firstText(subject.Name as Arr<Wrapped>);
  const position = attr(subject as { $?: Record<string, string> }, "Position");
  // Country is a jurisdiction, not an identifier — prefer the human-readable
  // CountryName child ("БЪЛГАРИЯ"), fall back to the ISO CountryCode attr.
  const country =
    firstText(subject.CountryName as Arr<Wrapped>) ??
    attr(subject as { $?: Record<string, string> }, "CountryCode");
  return { name, position, country };
};

const eventsFromPersonGroup = (
  group: Wrapped,
  role: TrRole,
  uic: string,
  companyName: string | null,
): TrChangeEvent[] => {
  const groupAttrs = group.$;
  const operation = groupAttrs?.FieldOperation;
  const fieldIdent = groupAttrs?.FieldIdent ?? "";
  const filingDate = formatFilingDate(groupAttrs);

  // Erase is section-level: the group carries no inner records; the semantics
  // are "wipe all records of this FieldIdent for this UIC". A subsequent Add
  // (often arriving later in the same file with a fresh GroupID) reseeds.
  if (operation === "Erase") {
    const ev: TrPersonSectionErasedEvent = {
      kind: "person_section_erased",
      uic,
      fieldIdent,
      filingDate,
    };
    return [ev];
  }

  // Add: collect all individual person records inside this group.
  const records: Wrapped[] = [];
  for (const key of PERSON_RECORD_KEYS) {
    const list = group[key] as Arr<Wrapped>;
    if (Array.isArray(list)) records.push(...list);
  }

  const out: TrChangeEvent[] = [];
  // Most sections nest a per-record wrapper (Manager[], ActualOwner[], …) that
  // carries `$.RecordID` itself. A few sections — notably SoleCapitalOwner —
  // are flatter: the group's child is Subject[] with no per-record RecordID,
  // and the RecordID/GroupID live on the group's `$`. Fall back to those when
  // the record-level attrs are missing.
  for (const record of records) {
    const recordAttrs = record.$ ?? {};
    const recordId = recordAttrs.RecordID || groupAttrs?.RecordID || "";
    if (!recordId) continue;

    // The "subject-like" child node is one of Subject (most sections),
    // Person (Managers, BranchManagers, …), LegalEntity (corporate partners).
    // Fall back to the record itself.
    const subject =
      (record.Subject as Arr<Wrapped>)?.[0] ??
      (record.Person as Arr<Wrapped>)?.[0] ??
      (record.LegalEntity as Arr<Wrapped>)?.[0] ??
      record;
    const { name, position, country } = extractPersonName(subject);
    if (!name) continue;

    const shareAmount = parseShareAmount(recordAttrs.share);
    const shareCurrency = recordAttrs.currency ?? null;

    const ev: TrPersonAddedEvent = {
      kind: "person_added",
      uic,
      companyName,
      role,
      personName: name,
      positionLabel: position,
      country,
      shareAmount,
      shareCurrency,
      filingDate,
      recordId,
      groupId: recordAttrs.GroupID ?? groupAttrs?.GroupID ?? null,
      fieldIdent,
    };
    out.push(ev);
  }
  return out;
};

// Some sections (Funds, Seat, Company) carry their value as text on the group
// itself (e.g., Funds._ = "3100.00"). Others nest deeper. This handler covers
// the simple cases.
const eventsFromMetaGroup = (
  group: Wrapped,
  field: TrCompanyMetaField,
  uic: string,
): TrChangeEvent[] => {
  const groupAttrs = group.$ ?? {};
  const operation = groupAttrs.FieldOperation;
  const fieldIdent = groupAttrs.FieldIdent ?? "";
  const filingDate = formatFilingDate(groupAttrs);
  const recordId = groupAttrs.RecordID ?? null;

  if (operation === "Erase") {
    if (!recordId) return [];
    return [
      {
        kind: "company_meta_erased",
        uic,
        recordId,
        fieldIdent,
        filingDate,
      },
    ];
  }

  // For Funds and Company name, value is in the group's text content. For
  // LegalForm it's in `$.Text` (the human-readable label, e.g. "Дружество с
  // ограничена отговорност").
  let value: string | null = null;
  if (field === "legal_form") {
    value = groupAttrs.Text ?? null;
  } else if (typeof group._ === "string" && group._ !== "") {
    value = group._;
  }
  // ЮЛНЦ цели/средства: the text sometimes sits on a nested <Text> child
  // rather than on the group itself.
  if (!value && (field === "objectives" || field === "means")) {
    value = firstText(group.Text as Arr<Wrapped>);
  }
  // Try common nested structures
  if (!value) {
    if (field === "seat") {
      const addr = (group.Address as Arr<Wrapped>)?.[0];
      // Address has many sub-fields; flatten to a one-line string
      if (addr) {
        const lines: string[] = [];
        for (const k of [
          "Country",
          "Settlement",
          "DistrictName",
          "MunicipalityName",
          "PostCode",
          "Address",
          "AddressBg",
        ]) {
          const v = firstText(addr[k] as Arr<Wrapped>);
          if (v) lines.push(v);
        }
        value = lines.length > 0 ? lines.join(", ") : null;
      }
    }
  }

  return [
    {
      kind: "company_meta",
      uic,
      field,
      value,
      filingDate,
      recordId,
      fieldIdent,
    },
  ];
};

const handleSubDeed = (
  sub: Wrapped,
  uic: string,
  companyName: string | null,
): TrChangeEvent[] => {
  const out: TrChangeEvent[] = [];
  for (const [key, val] of Object.entries(sub)) {
    if (key === "$" || key === "_") continue;
    if (!Array.isArray(val)) continue;

    // PERSON SECTIONS: each section's array contains 1+ "groups", each with
    // a FieldOperation/FieldIdent on $ and Person records inside.
    const role = PERSON_SECTION_TO_ROLE[key];
    if (role) {
      for (const group of val) {
        if (typeof group === "object" && group !== null) {
          out.push(
            ...eventsFromPersonGroup(group as Wrapped, role, uic, companyName),
          );
        }
      }
      continue;
    }

    // ЮЛНЦ META SECTIONS: identified by their element name (цели/средства/
    // обществена-частна полза/прекратяване), value on the group text/child.
    const ngoMetaKind = NGO_META_SECTION_TO_KIND[key];
    if (ngoMetaKind) {
      for (const group of val) {
        if (typeof group === "object" && group !== null) {
          out.push(...eventsFromMetaGroup(group as Wrapped, ngoMetaKind, uic));
        }
      }
      continue;
    }

    // META SECTIONS: identified by FieldIdent on the group itself.
    for (const group of val) {
      if (typeof group !== "object" || group === null) continue;
      const g = group as Wrapped;
      const fieldIdent = g.$?.FieldIdent;
      if (!fieldIdent) continue;
      const metaKind = META_FIELD_TO_KIND[fieldIdent];
      if (metaKind) {
        out.push(...eventsFromMetaGroup(g, metaKind, uic));
      }
    }
  }
  return out;
};

export const parseTrDailyFiling = (json: unknown): TrChangeEvent[] => {
  if (typeof json !== "object" || json === null) return [];
  const root = json as { Message?: Wrapped[] };
  const msg = root.Message?.[0];
  if (!msg) return [];
  const body = (msg.Body as Arr<Wrapped>)?.[0];
  if (!body) return [];
  const deedsWrapper = (body.Deeds as Arr<Wrapped>)?.[0];
  if (!deedsWrapper) return [];
  const deeds = (deedsWrapper.Deed as Arr<Wrapped>) ?? [];

  const out: TrChangeEvent[] = [];
  for (const deed of deeds) {
    const deedAttrs = deed.$ ?? {};
    const uic = deedAttrs.UIC;
    if (!uic) continue;
    const companyName = deedAttrs.CompanyName ?? null;
    const legalForm = deedAttrs.LegalForm ?? null;

    // The Body-level Deed `$` has a CreateDate stamp on the Header; reuse the
    // earliest plausible filing timestamp from the SubDeed events for the
    // synthetic deed-level meta events. Falling back to the empty string is
    // fine — sort treats it as "earliest".
    let earliestFilingDate = "";

    const subDeeds = (deed.SubDeed as Arr<Wrapped>) ?? [];
    const subEvents: TrChangeEvent[] = [];
    for (const sub of subDeeds) {
      subEvents.push(...handleSubDeed(sub, uic, companyName));
    }
    for (const e of subEvents) {
      if ("filingDate" in e && e.filingDate) {
        if (!earliestFilingDate || e.filingDate < earliestFilingDate) {
          earliestFilingDate = e.filingDate;
        }
      }
    }

    // Synthesize deed-level meta events. These ALWAYS fire when we see a deed,
    // even if the daily file doesn't include a LegalForm/Company SubDeed event.
    // They use the earliest filingDate so they don't overwrite later real
    // events on the same company.
    if (companyName) {
      out.push({
        kind: "company_meta",
        uic,
        field: "name",
        value: companyName,
        filingDate: earliestFilingDate,
        recordId: null,
        fieldIdent: "deed-level",
      });
    }
    if (legalForm) {
      out.push({
        kind: "company_meta",
        uic,
        field: "legal_form",
        value: legalForm,
        filingDate: earliestFilingDate,
        recordId: null,
        fieldIdent: "deed-level",
      });
    }
    out.push(...subEvents);
  }
  return out;
};
