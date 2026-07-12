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

import type { Contract, ContractTag } from "./types";
import { canonicalEik, isValidEik } from "./eik";
import { overrideAmount } from "./amount_overrides";
import { toEur } from "@/lib/currency";
import { normaliseOrgName } from "../lib/normalize_name";
import { disambiguateContractKeys, hashKey } from "./contract_key";

// Stable per-row BASE slug. When a release yields more than one distinct row to
// the same supplier with no distinguishing id in this tuple (e.g. several awards
// to one supplier — contractId is undefined on the award path), the tuple
// repeats; disambiguateContractKeys (called at the end of normalizeBundle)
// re-keys those collisions by award/contract id so each row gets its own URL.
const contractKey = (
  releaseId: string,
  contractId: string | undefined,
  contractorEik: string,
  tag: ContractTag,
): string =>
  hashKey(`${releaseId}::${contractId ?? ""}::${contractorEik}::${tag}`);

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
  // АОП publishes the realised bid count HERE — at release.bids.statistics[],
  // entries with measure === "bids" (one per lot) — NOT at
  // tender.numberOfTenderers / numberOfBids, which are ~0% populated in the
  // OCDS export. ~88% coverage on 2026 bundles.
  bids?: {
    statistics?: Array<{
      id?: string;
      measure?: string;
      value?: number;
      relatedLot?: string;
    }>;
  };
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

// Realised number of bidders. АОП emits this at release.bids.statistics[]
// (entries with measure === "bids"), one per lot — the tender.numberOfTenderers
// / numberOfBids fields are present in the schema but ~0% populated, so the
// single-bidder red flag never fired before we read this. When a procedure has
// multiple lots we take the minimum bid count: a single-bidder lot inside an
// otherwise-contested procedure is exactly the signal we want to surface. Falls
// back to the legacy tender fields when no bids.statistics is published.
const bidCount = (release: OcdsRelease): number | undefined => {
  const values = (release.bids?.statistics ?? [])
    .filter((s) => s.measure === "bids" && Number.isFinite(s.value))
    .map((s) => s.value as number);
  if (values.length > 0) return Math.min(...values);
  return release.tender?.numberOfTenderers ?? release.tender?.numberOfBids;
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
  // Per-row discriminator, aligned 1:1 with `rows`, applied only to rows whose
  // base key collides within this bundle (see disambiguateContractKeys below).
  const discs: string[] = [];

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
    // Realised bid count from release.bids.statistics[] (see bidCount), with a
    // fallback to the legacy tender.numberOfTenderers / numberOfBids fields.
    const numberOfTenderers = bidCount(release);
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
        // A multi-supplier contract (consortium members / parallel framework
        // winners) carries ONE total value. Crediting each supplier the full
        // amount multiplies one award's money by the supplier count, so split
        // it across the suppliers that actually emit a row (the rows then sum
        // back to the contract total — the way SIGMA reports it).
        const emittedSupplierCount =
          suppliers.filter((ref) => {
            const s = contractorFields(release, ref);
            if (!s) return false;
            if (
              s.eik === buyer.eik &&
              normaliseOrgName(s.name).toLocaleLowerCase("bg") !==
                normaliseOrgName(buyer.name).toLocaleLowerCase("bg")
            )
              return false;
            return true;
          }).length || 1;
        // Correct publisher-side amount errors on the FULL contract value, before
        // the split — the OCDS bundles republish the same corrupted figures as the
        // legacy CSV and the ЕОП flat feed. See amount_overrides.ts. OCDS releases
        // carry no УНП, so the override is keyed on the ocid.
        const contractAmount =
          overrideAmount({
            ocid: release.ocid,
            contractId: contract.id,
            amount: contract.value?.amount,
          }) ?? contract.value?.amount;
        const perAmount =
          contractAmount != null
            ? contractAmount / emittedSupplierCount
            : contractAmount;
        for (const supplierRef of suppliers) {
          const supplier = contractorFields(release, supplierRef);
          if (!supplier) {
            stats.rowsDroppedNoSupplierEik++;
            continue;
          }
          // Guard against the OCDS "self-deal" data-quality bug — when a
          // contract has buyer.id === supplier.id the supplier party never
          // had a real EIK and the feed substituted the buyer's (sometimes
          // copying the buyer's NAME too, so the names match). No body
          // procures from itself, so recording such a row attaches a bogus
          // contractor identity to the buyer's EIK, spawning a phantom
          // /company/{eik} "as a contractor" dashboard. Drop every
          // self-referential row regardless of whether the names agree.
          if (supplier.eik === buyer.eik) {
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
            amount: perAmount,
            currency: contract.value?.currency,
            amountEur: toEur(perAmount, contract.value?.currency) ?? undefined,
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
          // contract.id is usually present (so collisions are rare here); the
          // awardID + amount fallbacks cover the id-less multi-contract release.
          discs.push(
            `${contract.id ?? ""}::${contract.awardID ?? ""}::${perAmount ?? ""}`,
          );
          if (tag === "contract") stats.contractsEmitted++;
          else stats.amendmentsEmitted++;
        }
      }
    } else if (tag === "award") {
      // Awards without a paired contract release — emit so we have visibility
      // into "winner selected, not signed yet" cases.
      for (const award of release.awards ?? []) {
        // Split a multi-supplier award's value across its suppliers (see the
        // contract path above for why).
        const emittedSupplierCount =
          (award.suppliers ?? []).filter((ref) => {
            const s = contractorFields(release, ref);
            if (!s) return false;
            if (
              s.eik === buyer.eik &&
              normaliseOrgName(s.name).toLocaleLowerCase("bg") !==
                normaliseOrgName(buyer.name).toLocaleLowerCase("bg")
            )
              return false;
            return true;
          }).length || 1;
        const perAwardAmount =
          award.value?.amount != null
            ? award.value.amount / emittedSupplierCount
            : award.value?.amount;
        for (const supplierRef of award.suppliers ?? []) {
          const supplier = contractorFields(release, supplierRef);
          if (!supplier) {
            stats.rowsDroppedNoSupplierEik++;
            continue;
          }
          // Same self-deal guard as the contract path above.
          if (supplier.eik === buyer.eik) {
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
            amount: perAwardAmount,
            currency: award.value?.currency,
            amountEur:
              toEur(perAwardAmount, award.value?.currency) ?? undefined,
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
          // award.id distinguishes multiple awards to the same supplier in one
          // release (the historical collision on this path); amount is the
          // fallback when an award carries no id.
          discs.push(`${award.id ?? ""}::${perAwardAmount ?? ""}`);
          stats.awardsEmitted++;
        }
      }
    }
  }

  // Re-key the rare within-bundle collisions (multiple awards/contracts to one
  // supplier with no distinguishing id in the base tuple). Non-colliding rows
  // keep their bare base key, so existing /contract/:key URLs never move.
  disambiguateContractKeys(rows, (i) => discs[i]);

  return { rows, stats };
};
