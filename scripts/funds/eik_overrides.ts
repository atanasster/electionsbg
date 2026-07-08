// Manual corrections for known ИСУН (2020.eufunds.bg) source data-entry errors
// where the public exports recorded the wrong EIK / organisation name. Both the
// beneficiary-rollup ingest (./ingest.ts) and the per-project ingest
// (./projects_ingest.ts) consult these before writing any shard, so a single
// place documents the correction and every downstream artifact (per-EIK/-муни/
// -program/-contract shards, the index top lists, PG `fund_beneficiaries` /
// `fund_projects`, and the `institution_identity` name fallback) stays
// consistent.
//
// Keep this list tiny and each entry documented with the evidence — these are
// upstream typos we cannot fix at the source, NOT a general renaming layer.
//
// ── Case: EIK 121100421 mislabelled "АЛФА-3-2004 ЕООД" ─────────────────────────
// EIK 121100421 is Държавен фонд „Земеделие" — the CAP paying agency. It appears
// across our data as a €98.9M procurement BUYER ("Държавен фонд \"Земеделие\"
// /Дфз/" in awarder_search) and is genuinely a ~€40M beneficiary of ПРСР
// technical-assistance funds; it has NO row in the commercial register
// (tr_companies), because a state fund is not a company.
//
// But ИСУН's "Бенефициенти" export collapses all 38 contracts it filed under
// 121100421 into a single row NAMED "АЛФА-3-2004 ЕООД" — the real АЛФА-3-2004
// ЕООД is EIK 131375049 (present, correctly, in both tr_companies and under its
// own beneficiary/project rows). So ИСУН split АЛФА-3-2004 across two EIKs and
// stamped one batch with the paying agency's number. Downstream,
// institution_identity(121100421) preferred that beneficiary name and showed the
// ДФ „Земеделие" page as "АЛФА-3-2004 ЕООД" + a "Бенефициент по ЕС" badge.
//
// Two independent corrections restore correctness:
//   1. EIK_NAME_OVERRIDES  — force 121100421's canonical beneficiary name (and
//      the wrong "Общинска администрация" org-kind) back to ДФЗ, so every name
//      surface resolves the true institution.
//   2. CONTRACT_EIK_OVERRIDES — the one genuine АЛФА-3-2004 project ИСУН filed
//      under 121100421 (a terminated dairy-plant build) is re-attached to
//      131375049, where АЛФА-3-2004's other two projects already live.
//
// NOTE (left as-is, on purpose): the same 121100421 batch also carries a handful
// of other private beneficiaries ИСУН misfiled under the paying agency's EIK
// (e.g. "ИНТЕР-УНИВЕРС - Иван Василев ЕТ", "Деляна Жекова Маркова", "Община
// Самоков"). Their true EIKs are not recoverable from the export, so they are
// NOT reassigned — each project row still shows its own beneficiaryName, and the
// page header is now correctly ДФЗ. Only the АЛФА-3-2004 project, whose correct
// EIK we DO know, is moved.

import type { FundsBeneficiary } from "./types";
import type { FundsProject } from "./projects_types";

// Per-EIK canonical-identity override for the beneficiary rollup. Applied to
// EVERY parsed beneficiary row carrying the EIK (before sharding / aggregation),
// so the per-EIK rollup header, the index top lists, and PG `fund_beneficiaries`
// all carry the corrected name. `orgKind` is optional — only override the fields
// ИСУН got wrong.
export const EIK_NAME_OVERRIDES: Record<
  string,
  { name: string; orgKind?: string }
> = {
  "121100421": {
    name: 'Държавен фонд "Земеделие"',
    orgKind: "Други държавни администрации",
  },
};

// Per-contract beneficiary-EIK reassignment for individual projects ИСУН filed
// under the wrong EIK. Keyed by contractNumber → correct EIK.
export const CONTRACT_EIK_OVERRIDES: Record<string, string> = {
  // АЛФА-3-2004 ЕООД dairy-plant build, mis-filed under ДФЗ's paying-agency EIK
  // 121100421; АЛФА-3-2004 is EIK 131375049 (its other two projects live there).
  "BG06RDNP001-4.015-0311": "131375049",
};

// Apply EIK_NAME_OVERRIDES to a parsed beneficiary corpus (mutates in place and
// returns it, for a fluent `applyBeneficiaryEikOverrides(parseBeneficiaries(buf))`).
export const applyBeneficiaryEikOverrides = (
  rows: FundsBeneficiary[],
): FundsBeneficiary[] => {
  for (const r of rows) {
    if (!r.eik) continue;
    const ov = EIK_NAME_OVERRIDES[r.eik];
    if (!ov) continue;
    r.name = ov.name;
    if (ov.orgKind) r.orgKind = ov.orgKind;
  }
  return rows;
};

// Apply CONTRACT_EIK_OVERRIDES to a parsed project corpus (mutates in place and
// returns it). Only the beneficiaryEik is rewritten — the row's beneficiaryName
// already carries the correct organisation, so it lands under the right EIK shard.
export const applyProjectEikOverrides = (
  rows: FundsProject[],
): FundsProject[] => {
  for (const r of rows) {
    const eik = CONTRACT_EIK_OVERRIDES[r.contractNumber];
    if (eik) r.beneficiaryEik = eik;
  }
  return rows;
};
