// The search box at the top of /sector/health — four groups over the НЗОК
// corpus (hospitals, molecules, medicine packs and clinical pathways) plus a
// fifth over the second-level МЗ bodies, which take no НЗОК money at all.
//
// That fifth group is here because the four above are the whole of what this
// page could find, and a reader does not know the boundary. Typing „Национален
// център по обществено здраве и анализи" returned „Няма съвпадения" — for a body
// with 77 contracts and a served /awarder page — because НЦОЗА is funded from the
// state budget and has no row in nzok_hospital_payments. The empty state then
// reads as „this institution does not exist in health" rather than „it is not in
// the НЗОК corpus". See docs/plans/health-mz-bodies-search-v1.md.
//
// It exists because the pack below is a stack of top-N tiles: 12 of 3,333 packs,
// 12 of 427 procedures, TOP_N of 266 hospitals. Every destination already has a
// page; none of them was reachable from the page they belong to.
//
// NO SOURCE ADDS A REQUEST TO PAGE LOAD — the perf rule the plan calls R1 — but
// by three different mechanisms, and the differences matter to anyone changing
// one. Hospitals and molecules ride payloads the pack already fetches; packs and
// pathways are the two the pack does NOT fetch, so they are requested only on
// `onArm` and a reader who never searches pays nothing for the ~4,600 folded
// rows; the МЗ roster is a static import with nothing to fetch, so it is folded
// on mount (55 rows, well under a millisecond) and gating it would cost more
// than it saves. Do not "tidy" that third case into the second.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Pill, Package, Stethoscope, Landmark } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import {
  MZ_SECOND_LEVEL_BODIES,
  MZ_SECOND_LEVEL_INSTITUTION_COUNT,
  MZ_UNIVERSE_LABEL,
  mzBodySearchKeys,
} from "@/lib/mzSecondLevelBodies";
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
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

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

  // Ведомства на МЗ — the one group that is NOT НЗОК money, and the only one
  // needing no fetch and no `armed` gate (see the R1 note in the header).
  //
  // ⚠ `buildEntityIndex` directly rather than `buildMembersIndex`, unlike
  // DefenseSearchBox. That helper uses ONE string for both the visible sub-line
  // and a search key, and here those want opposite things: the sub-line should
  // be short (the group heading sits directly above it), while the key set has
  // to carry both grammatical numbers plus the ministry's name. Routing through
  // it printed all of that on every row. The roster keeps the two apart, so this
  // call site does too. Its `noAwarderPage` filter is not needed either —
  // MzSecondLevelBody carries no such field and all 55 bodies land.
  const mzBodies = useMemo(
    () =>
      buildEntityIndex(
        MZ_SECOND_LEVEL_BODIES,
        (b) => ({
          id: b.eik,
          label: b.name,
          sub: bg
            ? MZ_UNIVERSE_LABEL[b.universe].bg
            : MZ_UNIVERSE_LABEL[b.universe].en,
          href: `/awarder/${b.eik}`,
        }),
        mzBodySearchKeys,
      ),
    [bg],
  );

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
      // ⚠ The heading and MZ_UNIVERSE_LABEL's „Ведомства на МЗ" prefix must stay
      // in step — that prefix exists so this heading finds its own rows, and
      // `latinSkeleton` does not fold a singular into a plural. Rename one and
      // the other stops matching.
      entityGroup(
        "mz",
        "Ведомства на МЗ",
        "Ministry of Health bodies",
        mzBodies,
        {
          icon: Landmark,
          // 29 ЦСМП and 25 РЗИ each match their own family noun, so the default
          // 8 hides two thirds of a family — and, the roster being alphabetical
          // and unranked, always the SAME two thirds: ЦСМП София-град (the
          // largest body here) is never shown for „ЦСМП". 12 does not make 29
          // fit; the hint below states the population so a truncated list reads
          // as one. The dropdown scrolls, so a taller group does not push the
          // other four off screen.
          limit: 12,
        },
      ),
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
      mzBodies,
    ],
  );

  return (
    <SectorEntitySearch
      idPrefix="nzok-search"
      groups={groups}
      onArm={() => setArmed(true)}
      title={{
        bg: "Намери в здравеопазването",
        en: "Find in health",
      }}
      // Three of the five subjects, not five. ⚠ THIS LINE HAS A MEASURED BYTE
      // BUDGET: at 375px the input offers 283px of text room, and the tail is
      // where the newest subject sits, so an overlong placeholder clips exactly
      // the thing this tier added. Measured in the running app at 14px Inter —
      // BG 277px, EN 229px, against 283. Naming all five was 430px. Re-measure
      // before adding a word; the hint below is where the full list belongs.
      placeholder={{
        bg: "болница, лекарство, ведомство на МЗ…",
        en: "hospital, medicine, ministry body…",
      }}
      // Order: how to search → what is covered, with its boundary → the caveat.
      // A caveat belongs last; between the two coverage sentences it read as a
      // correction to a correction.
      //
      // ⚠ THE COUNT IS `MZ_SECOND_LEVEL_INSTITUTION_COUNT` (53 institutions),
      // never `MZ_SECOND_LEVEL_BODIES.length` (55 EIKs) — two РЗИ ship both
      // halves of their РИОКОЗ→РЗИ history, so EIKs would publish two
      // institutions that do not exist. The roster's own header states the rule.
      //
      // ⚠ AND IT IS INDEFINITE — „53 ведомства", never „53-те". The definite
      // article turns „this is how many the box can find" into „this is how many
      // there are", and the roster deliberately omits five РЗИ that have no
      // procurement. It is the same institutions-vs-EIKs over-claim, one level up.
      //
      // The middle sentence is the boundary the box could not draw before. It is
      // about the MONEY on the destination page rather than about how these
      // bodies are funded: what this page can show is that their € comes from
      // their own procurement, so a reader landing on ЦСМП Пловдив's €6.9m does
      // not read it as health-fund spending. „Their budget contains no НЗОК
      // money at all" is almost certainly true and is not what we measured.
      hint={{
        bg: `Търси по име, ЕИК, търговско име, INN или код на пътека — приема и изписване на латиница. Включва и ${MZ_SECOND_LEVEL_INSTITUTION_COUNT} ведомства на МЗ (спешна помощ, здравни инспекции, НЦОЗА) — техните суми са от собствени обществени поръчки, а не от НЗОК. Лечебните заведения без ЕИК нямат отделна страница и не се търсят.`,
        en: `Search by name, EIK, trade name, INN or pathway code — Latin-typed queries work too. Also covers ${MZ_SECOND_LEVEL_INSTITUTION_COUNT} Ministry of Health bodies (emergency care, health inspectorates, NCPHA) — their figures come from their own procurement, not from the NHIF. Facilities without an EIK have no page of their own and are not searchable.`,
      }}
    />
  );
};
