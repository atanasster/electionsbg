// The two НЗОК-corpus search indexes a finder can build from payloads it already
// has: hospitals (from the hospital-payments payload) and molecules (from the
// quarterly drug payload). Pure data, no JSX. Shared by NzokSearchBox and the
// /sector/health hub finder, so the fold rules live once.

import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";
import { decodeEntities } from "@/lib/decodeEntities";
import { companyAllTimeHref } from "@/screens/components/search/procurementSearchSource";
import type {
  NzokDrugQuarterlyFile,
  NzokHospitalPaymentsFile,
} from "@/data/budget/types";
import { moleculeHref } from "./drugLinks";

/** Hospitals, one row per legal entity (EIK).
 *
 *  The facility list carries rows without an EIK, and /company/:eik is the only
 *  destination — FacilityLink renders those as plain text for the same reason.
 *  They are EXCLUDED rather than offered as dead rows; the caller's hint says so.
 *
 *  A company can run several ЛЗ facilities: the money is summed and the row is
 *  labelled with the BIGGEST facility. `top` tracks that separately — comparing
 *  against the running SUM would let the largest lose once a company has three
 *  sites, and only looked right because the source happens to arrive sorted.
 *
 *  ⚠️ ALL-TIME href, because that is what this row IS: it is ranked by
 *  `cumulativeEur`, the facility's whole НЗОК history, and a bare /company/:eik
 *  lands on the selected parliament's window. */
export const nzokHospitalIndex = (
  payments: Pick<NzokHospitalPaymentsFile, "hospitals">,
): EntityIndex => {
  const byEik = new Map<
    string,
    { eik: string; name: string; place: string; eur: number; top: number }
  >();
  for (const h of payments.hospitals) {
    if (!h.eik) continue;
    const eur = h.cumulativeEur ?? 0;
    const prev = byEik.get(h.eik);
    if (!prev) {
      byEik.set(h.eik, {
        eik: h.eik,
        name: decodeEntities(h.name),
        place: h.rzokName ?? "",
        eur,
        top: eur,
      });
      continue;
    }
    prev.eur += eur;
    if (eur > prev.top) {
      prev.top = eur;
      prev.name = decodeEntities(h.name);
      prev.place = h.rzokName ?? "";
    }
  }
  return buildEntityIndex(
    [...byEik.values()],
    (h) => ({
      id: h.eik,
      label: h.name,
      sub: h.place,
      href: companyAllTimeHref(h.eik),
    }),
    (h) => [h.name, h.place, h.eik],
    (h) => h.eur,
  );
};

/** Molecules (INN). Every INN in `allInns` resolves to a /molecule page (the
 *  two-tier nzok_drug_molecule_detail()); ranked by total reimbursement where
 *  the payload's top list carries one. */
export const nzokMoleculeIndex = (
  quarterly: Pick<NzokDrugQuarterlyFile, "allInns" | "top">,
): EntityIndex => {
  const totalByInn = new Map<string, number>();
  for (const t of quarterly.top) totalByInn.set(t.inn, t.totalEur);
  return buildEntityIndex(
    quarterly.allInns,
    (inn) => ({ id: inn, label: inn, href: moleculeHref(inn) }),
    (inn) => [inn],
    (inn) => totalByInn.get(inn) ?? 0,
  );
};
