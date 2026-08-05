// The search box at the top of /sector/health — four groups over the НЗОК
// corpus: hospitals, molecules, medicine packs and clinical pathways.
//
// It exists because the pack below is a stack of top-N tiles: 12 of 3,333 packs,
// 12 of 427 procedures, TOP_N of 266 hospitals. Every destination already has a
// page; none of them was reachable from the page they belong to.
//
// EVERY SOURCE IS A PAYLOAD THE PACK ALREADY FETCHES, so the box adds no request
// to page load — the perf rule the plan calls R1. The indexes are built on first
// focus (`onArm`), so a reader who never searches pays nothing for the ~4,600
// folded rows.

import { FC, useMemo, useState } from "react";
import { Building2, Pill, Package, Stethoscope } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  useNzokDrugQuarterly,
  useNzokDrugPackIndex,
  useNzokHospitalPayments,
  useNzokProcedureIndex,
  useNzokProcedureNames,
} from "@/data/budget/useBudget";
import { resolveProcedureName } from "@/lib/nzokProcedures";
import { packHref, moleculeHref } from "./drugLinks";

export const NzokSearchBox: FC = () => {
  const [armed, setArmed] = useState(false);

  const { data: payments } = useNzokHospitalPayments();
  const { data: quarterly } = useNzokDrugQuarterly();
  // Gated on `armed`: the pack index is the one source the pack does NOT
  // already fetch, so it must not be part of page load.
  const { data: packIndex } = useNzokDrugPackIndex(armed);
  // Gated on `armed`, like the pack index: neither is fetched by the pack, so
  // neither may join page load.
  const { data: procIndex } = useNzokProcedureIndex(armed);
  const { data: procedureNames } = useNzokProcedureNames();

  // Hospitals. The facility list carries 381 rows but only 266 have an EIK, and
  // /company/:eik is the only destination — FacilityLink already renders the
  // other 115 as plain text for exactly that reason. They are EXCLUDED rather
  // than offered as dead rows; the footnote says so.
  const hospitals = useMemo(() => {
    if (!armed || !payments) return null;
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
      // A company can run several ЛЗ facilities: sum the money, label with the
      // BIGGEST facility. `top` tracks that separately — comparing against the
      // running SUM would let the largest lose once a company has three sites,
      // and it only looked right because the source happens to arrive sorted.
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
        href: `/company/${h.eik}`,
      }),
      (h) => [h.name, h.place, h.eik],
      (h) => h.eur,
    );
  }, [armed, payments]);

  // Molecules (INN). All 610 resolve since the two-tier widening of
  // nzok_drug_molecule_detail(); before that only 30 did.
  const molecules = useMemo(() => {
    if (!armed || !quarterly) return null;
    const totalByInn = new Map<string, number>();
    for (const t of quarterly.top) totalByInn.set(t.inn, t.totalEur);
    return buildEntityIndex(
      quarterly.allInns,
      (inn) => ({ id: inn, label: inn, href: moleculeHref(inn) }),
      (inn) => [inn],
      (inn) => totalByInn.get(inn) ?? 0,
    );
  }, [armed, quarterly]);

  // Packs — trade name is what a reader actually knows ("Keytruda"), so it is
  // the label and the INN is the sub-line.
  const packs = useMemo(() => {
    // `packIndex?.packs`, not `!packIndex`: missingMigrationEmpty degrades an
    // absent function to `[]`, which is TRUTHY — so a database that has not run
    // this migration would reach buildEntityIndex with `packs === undefined`
    // and throw during render, with no ErrorBoundary anywhere in src/.
    if (!packIndex?.packs) return null;
    return buildEntityIndex(
      packIndex.packs,
      (p) => ({
        id: `${p.nationalNo}|${p.nzokCode}`,
        label: decodeEntities(p.tradeName) || p.nzokCode,
        sub: p.inn,
        href: packHref(p.inn, p.nationalNo, p.nzokCode),
      }),
      (p) => [p.tradeName, p.inn, p.nzokCode, p.nationalNo, p.form],
      (p) => p.totalEur,
    );
  }, [packIndex]);

  // Clinical pathways. Built from the ACTIVITY corpus (the servable set), with
  // names decorated on — never from the name dictionary, which carries 80
  // rollup codes with no activity rows behind them.
  const procedures = useMemo(() => {
    if (!procIndex?.procedures) return null;
    // resolveProcedureName, NOT a raw dictionary probe: 171 of the 571 codes
    // (30%) carry an A99/B1/E billing modifier the name table does not key on,
    // so a raw lookup left them as bare codes — unfindable by name, while their
    // own /procedure page displays the full name.
    return buildEntityIndex(
      procIndex.procedures,
      (p) => ({
        id: p.procedure,
        label: resolveProcedureName(procedureNames, p.procedure) ?? p.procedure,
        sub: `${p.procType} · ${p.procedure}`,
        href: `/procedure/${encodeURIComponent(p.procedure)}`,
      }),
      (p) => [
        resolveProcedureName(procedureNames, p.procedure),
        p.procedure,
        p.procType,
      ],
      (p) => p.cases,
    );
  }, [procIndex, procedureNames]);

  const groups = useMemo(
    () => [
      entityGroup("hosp", "Болници", "Hospitals", hospitals, {
        loading: armed && !payments,
        icon: Building2,
      }),
      entityGroup("proc", "Клинични пътеки", "Clinical pathways", procedures, {
        loading: armed && !procIndex,
        icon: Stethoscope,
      }),
      entityGroup("mol", "Молекули (INN)", "Molecules (INN)", molecules, {
        loading: armed && !quarterly,
        icon: Pill,
      }),
      entityGroup("pack", "Лекарства", "Medicines", packs, {
        loading: armed && !packIndex,
        icon: Package,
      }),
    ],
    [
      hospitals,
      procedures,
      molecules,
      packs,
      armed,
      payments,
      procIndex,
      quarterly,
      packIndex,
    ],
  );

  return (
    <SectorEntitySearch
      idPrefix="nzok-search"
      groups={groups}
      onArm={() => setArmed(true)}
      title={{
        bg: "Намери в здравната каса",
        en: "Find in the health fund",
      }}
      placeholder={{
        bg: "болница, лекарство, молекула или клинична пътека…",
        en: "hospital, medicine, molecule or clinical pathway…",
      }}
      hint={{
        bg: "Търси по име, ЕИК, търговско име, INN или код на пътека — приема и изписване на латиница. Лечебните заведения без ЕИК не се търсят: за тях няма отделна страница.",
        en: "Search by name, EIK, trade name, INN or pathway code — Latin-typed queries work too. Facilities without an EIK are not searchable: they have no page of their own.",
      }}
    />
  );
};
