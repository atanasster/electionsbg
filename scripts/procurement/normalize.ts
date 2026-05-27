// Flatten one OCDS bundle into Contract[] rows.
//
// Upstream is OCDS 1.1 with EU + eForms extensions. Each `release` is one
// snapshot of one procurement procedure (identified by `ocid`). A single
// procurement progresses through tag values: `tender` → `award` → `contract`
// → `contractAmendment`. We ingest the latter three:
//
//   - `award`              → who won, before signing. Money may be on the
//                            award itself or absent (final value comes with
//                            the contract release).
//   - `contract`           → signed contract with value + dateSigned.
//   - `contractAmendment`  → change to a previously-signed contract (e.g.
//                            duration extension, value increase). One row per
//                            amendment so the SPA can show the timeline.
//
// Suppliers and buyers reference `parties[].id` (local to the release). EIK
// lives on `parties[].identifier` when scheme === "BG-EIK". 99%+ of records
// in the fortnight bundles we sampled carry an EIK; rows without an EIK on
// the contractor side are dropped (they can't be cross-referenced and they're
// almost always non-BG suppliers / placeholder rows).

import { createHash } from "crypto";
import type { Contract, ContractTag } from "./types";
import { canonicalEik, isValidEik } from "./eik";
import { toEur } from "@/lib/currency";
import { normaliseOrgName } from "../lib/normalize_name";

// Stable per-row slug. Mirrors the dedupe key used by writeMonthShards in
// ingest.ts so a row's URL persists across re-runs.
const contractKey = (
  releaseId: string,
  contractId: string | undefined,
  contractorEik: string,
  tag: ContractTag,
): string =>
  createHash("sha256")
    .update(`${releaseId}::${contractId ?? ""}::${contractorEik}::${tag}`)
    .digest("hex")
    .slice(0, 12);

interface OcdsParty {
  id: string;
  name?: string;
  roles?: string[];
  identifier?: { id?: string; legalName?: string; scheme?: string };
  address?: {
    region?: string;
    locality?: string;
    postalCode?: string;
    streetAddress?: string;
    countryName?: string;
  };
}

interface OcdsRelease {
  ocid: string;
  id: string;
  date: string;
  tag?: string[];
  language?: string;
  tender?: {
    title?: string;
    description?: string;
    mainProcurementCategory?: string;
    procurementMethod?: string;
    procurementMethodRationale?: string;
    numberOfTenderers?: number;
    numberOfBids?: number;
    tenderPeriod?: { startDate?: string; endDate?: string };
    items?: Array<{
      classification?: { id?: string; scheme?: string };
      relatedLot?: string;
    }>;
  };
  awards?: Array<{
    id: string;
    title?: string;
    status?: string;
    suppliers?: Array<{ id: string; name?: string }>;
    value?: { amount?: number; currency?: string };
    date?: string;
  }>;
  contracts?: Array<{
    id: string;
    awardID?: string;
    title?: string;
    status?: string;
    value?: { amount?: number; currency?: string };
    dateSigned?: string;
    period?: { startDate?: string; endDate?: string };
  }>;
  parties?: OcdsParty[];
  buyer?: { id: string; name?: string };
}

export interface OcdsBundle {
  uri?: string;
  publishedDate?: string;
  publisher?: { name?: string };
  releases: OcdsRelease[];
}

const truncateDate = (iso?: string): string => {
  if (!iso) return "";
  return iso.slice(0, 10);
};

const firstCpv = (release: OcdsRelease): string | undefined => {
  for (const item of release.tender?.items ?? []) {
    if (item.classification?.scheme === "CPV" && item.classification.id) {
      return item.classification.id;
    }
  }
  return undefined;
};

const resolveParty = (
  release: OcdsRelease,
  ref: { id: string; name?: string } | undefined,
): OcdsParty | undefined => {
  if (!ref) return undefined;
  return (release.parties ?? []).find((p) => p.id === ref.id);
};

// Returns the canonical buyer fields for the release. Falls back to the
// buyer reference's `name` if the parties[] entry is missing — some releases
// publish the buyer via the top-level ref alone.
const buyerFields = (
  release: OcdsRelease,
): {
  eik: string;
  eikFull?: string;
  name: string;
  region?: string;
  locality?: string;
  postal?: string;
  street?: string;
} | null => {
  const party = resolveParty(release, release.buyer);
  const rawEik = party?.identifier?.id;
  const canon = canonicalEik(rawEik);
  if (!isValidEik(canon)) return null;
  const rawName =
    party?.identifier?.legalName ?? party?.name ?? release.buyer?.name ?? "";
  const addr = party?.address;
  return {
    eik: canon,
    eikFull: rawEik && rawEik !== canon ? rawEik : undefined,
    // АОП OCDS emits awarder names in ALL CAPS verbatim from the source
    // registry. Normalise here so the on-disk per-EIK awarder shards match
    // the same entity's casing in the funds + officials trees.
    name: normaliseOrgName(rawName),
    region: addr?.region,
    locality: addr?.locality,
    postal: addr?.postalCode,
    street: addr?.streetAddress,
  };
};

// Returns the canonical contractor fields for a supplier ref.
const contractorFields = (
  release: OcdsRelease,
  ref: { id: string; name?: string },
): { eik: string; eikFull?: string; name: string } | null => {
  const party = resolveParty(release, ref);
  const rawEik = party?.identifier?.id;
  const canon = canonicalEik(rawEik);
  if (!isValidEik(canon)) return null;
  const rawName = party?.identifier?.legalName ?? party?.name ?? ref.name ?? "";
  return {
    eik: canon,
    eikFull: rawEik && rawEik !== canon ? rawEik : undefined,
    name: normaliseOrgName(rawName),
  };
};

const releaseSourceUrl = (release: OcdsRelease, datasetUuid: string): string =>
  // No per-release permalink at АОП. Best we can do is link to the dataset
  // view on data.egov.bg + carry the release id so the user can locate the
  // record in the published JSON. The dataset link is the source-of-truth
  // citation that satisfies the editorial guardrail.
  `https://data.egov.bg/data/view/${datasetUuid}#${encodeURIComponent(release.id)}`;

// АОП frequently emits a single release with tag ["award","contract"] — one
// event announcing both the winner pick and the signed contract. We pick the
// most specific tag in priority order so the row carries the contract-level
// money (which is on `contracts[].value`, not `awards[].value`). Amendments
// take precedence over base contracts because they re-state the current value
// post-amendment.
const TAG_PRIORITY: ContractTag[] = ["contractAmendment", "contract", "award"];

const pickTag = (release: OcdsRelease): ContractTag | null => {
  const tags = new Set(release.tag ?? []);
  for (const t of TAG_PRIORITY) {
    if (tags.has(t)) return t;
  }
  return null;
};

export interface NormalizeStats {
  releasesSeen: number;
  releasesSkippedNoTag: number;
  releasesSkippedNoBuyer: number;
  contractsEmitted: number;
  awardsEmitted: number;
  amendmentsEmitted: number;
  rowsDroppedNoSupplierEik: number;
  // Self-deal rows: buyer.eik === supplier.eik but the names differ. The
  // OCDS feed substitutes the buyer's EIK on the supplier ref when the
  // real one is missing. See the guard in normalizeBundle.
  rowsDroppedSelfDeal: number;
}

export const normalizeBundle = (
  bundle: OcdsBundle,
  datasetUuid: string,
): { rows: Contract[]; stats: NormalizeStats } => {
  const stats: NormalizeStats = {
    releasesSeen: 0,
    releasesSkippedNoTag: 0,
    releasesSkippedNoBuyer: 0,
    contractsEmitted: 0,
    awardsEmitted: 0,
    amendmentsEmitted: 0,
    rowsDroppedNoSupplierEik: 0,
    rowsDroppedSelfDeal: 0,
  };
  const rows: Contract[] = [];

  for (const release of bundle.releases ?? []) {
    stats.releasesSeen++;
    const tag = pickTag(release);
    if (!tag) {
      stats.releasesSkippedNoTag++;
      continue;
    }
    const buyer = buyerFields(release);
    if (!buyer) {
      stats.releasesSkippedNoBuyer++;
      continue;
    }
    const date = truncateDate(release.date);
    const cpv = firstCpv(release);
    const procurementMethod = release.tender?.procurementMethod;
    const procurementMethodRationale =
      release.tender?.procurementMethodRationale;
    // Prefer numberOfTenderers (publishers most often set this); fall back to
    // numberOfBids when the publisher used that field instead. Both refer to
    // the bid count in OCDS spec.
    const numberOfTenderers =
      release.tender?.numberOfTenderers ?? release.tender?.numberOfBids;
    const tenderPeriodStartDate = release.tender?.tenderPeriod?.startDate
      ? truncateDate(release.tender.tenderPeriod.startDate)
      : undefined;
    const tenderPeriodEndDate = release.tender?.tenderPeriod?.endDate
      ? truncateDate(release.tender.tenderPeriod.endDate)
      : undefined;
    const category = release.tender?.mainProcurementCategory;
    const sourceUrl = releaseSourceUrl(release, datasetUuid);

    if (tag === "contract" || tag === "contractAmendment") {
      // One row per (contract, supplier). Resolve the matching award (via
      // awardID) to find the supplier list — `contracts[]` doesn't carry
      // suppliers directly in OCDS. Fall back to all awards' suppliers if
      // awardID is missing.
      for (const contract of release.contracts ?? []) {
        const award = (release.awards ?? []).find(
          (a) => a.id === contract.awardID,
        );
        const suppliers =
          award?.suppliers ??
          // No matching award → union of every award's suppliers in the
          // release. Better to over-attribute than to drop a signed contract.
          (release.awards ?? []).flatMap((a) => a.suppliers ?? []);
        if (suppliers.length === 0) {
          stats.rowsDroppedNoSupplierEik++;
          continue;
        }
        for (const supplierRef of suppliers) {
          const supplier = contractorFields(release, supplierRef);
          if (!supplier) {
            stats.rowsDroppedNoSupplierEik++;
            continue;
          }
          // Guard against the OCDS "self-deal" data-quality bug — when a
          // contract has buyer.id === supplier.id BUT the buyer and
          // supplier names disagree, the supplier party never had a real
          // EIK and the feed substituted the buyer's. Recording such a
          // row would attach the contractor name to the buyer's EIK on
          // disk, breaking name resolution on /company/{eik}. Drop the
          // row; the contract still survives on the awarder side via
          // /awarder/{eik}/contracts (which uses buyer.eik directly).
          if (
            supplier.eik === buyer.eik &&
            normaliseOrgName(supplier.name).toLocaleLowerCase("bg") !==
              normaliseOrgName(buyer.name).toLocaleLowerCase("bg")
          ) {
            stats.rowsDroppedSelfDeal += 1;
            continue;
          }
          rows.push({
            key: contractKey(release.id, contract.id, supplier.eik, tag),
            ocid: release.ocid,
            releaseId: release.id,
            contractId: contract.id,
            tag,
            date,
            dateSigned: contract.dateSigned
              ? truncateDate(contract.dateSigned)
              : undefined,
            awarderEik: buyer.eik,
            awarderName: buyer.name,
            awarderRegion: buyer.region,
            awarderLocality: buyer.locality,
            awarderPostal: buyer.postal,
            awarderStreet: buyer.street,
            contractorEik: supplier.eik,
            contractorEikFull: supplier.eikFull,
            contractorName: supplier.name,
            amount: contract.value?.amount,
            currency: contract.value?.currency,
            amountEur:
              toEur(contract.value?.amount, contract.value?.currency) ??
              undefined,
            title: contract.title ?? release.tender?.title ?? "",
            cpv,
            procurementMethod,
            procurementMethodRationale,
            numberOfTenderers,
            tenderPeriodStartDate,
            tenderPeriodEndDate,
            category,
            bundleUuid: datasetUuid,
            sourceUrl,
          });
          if (tag === "contract") stats.contractsEmitted++;
          else stats.amendmentsEmitted++;
        }
      }
    } else if (tag === "award") {
      // Awards without a paired contract release — emit so we have visibility
      // into "winner selected, not signed yet" cases.
      for (const award of release.awards ?? []) {
        for (const supplierRef of award.suppliers ?? []) {
          const supplier = contractorFields(release, supplierRef);
          if (!supplier) {
            stats.rowsDroppedNoSupplierEik++;
            continue;
          }
          // Same self-deal guard as the contract path above.
          if (
            supplier.eik === buyer.eik &&
            normaliseOrgName(supplier.name).toLocaleLowerCase("bg") !==
              normaliseOrgName(buyer.name).toLocaleLowerCase("bg")
          ) {
            stats.rowsDroppedSelfDeal += 1;
            continue;
          }
          rows.push({
            key: contractKey(release.id, undefined, supplier.eik, tag),
            ocid: release.ocid,
            releaseId: release.id,
            tag,
            date,
            awarderEik: buyer.eik,
            awarderName: buyer.name,
            awarderRegion: buyer.region,
            awarderLocality: buyer.locality,
            awarderPostal: buyer.postal,
            awarderStreet: buyer.street,
            contractorEik: supplier.eik,
            contractorEikFull: supplier.eikFull,
            contractorName: supplier.name,
            amount: award.value?.amount,
            currency: award.value?.currency,
            amountEur:
              toEur(award.value?.amount, award.value?.currency) ?? undefined,
            title: award.title ?? release.tender?.title ?? "",
            cpv,
            procurementMethod,
            procurementMethodRationale,
            numberOfTenderers,
            tenderPeriodStartDate,
            tenderPeriodEndDate,
            category,
            bundleUuid: datasetUuid,
            sourceUrl,
          });
          stats.awardsEmitted++;
        }
      }
    }
  }

  return { rows, stats };
};
