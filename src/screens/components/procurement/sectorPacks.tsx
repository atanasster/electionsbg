// Sector-pack registry — the seam that lets the generic awarder dashboard
// (/awarder/:eik) grow domain-specific analytics for a handful of high-profile
// buyers without special-casing the screen. A pack is a lazily-loaded component
// keyed by awarder EIK; when one is registered, the awarder page renders it as
// a hero section (below the generic KPIs) and downloads the buyer's contract
// corpus for the client-side classification the pack needs.
//
// The generic path stays cheap: awarders with no pack render purely from the
// server-aggregated jsonb (no row download). Only packed buyers pay for the
// corpus fetch — see RoadsPack / useRoads.
//
// To add a pack (e.g. НОИ/ДОО): write a <Pack eik window /> component with its
// own classifier + tiles and register its EIK below.

import { lazy, type ComponentType } from "react";
// API_EIK from the import-free @/lib/roadsAwarder rather than from the
// roadAttributes engine that re-exports it — this file is imported by screens
// only, but the EIK is also read by routes.tsx, and that edge used to drag
// every import below into the ENTRY chunk. See src/entryGraph.test.ts.
import { API_EIK } from "@/lib/roadsAwarder";
import { NOI_EIK } from "@/lib/noiBenchmarks";
import { NZOK_EIK, HEALTH_SECTOR_EIKS } from "@/lib/healthReferenceData";
import { VSS_EIK, JUDICIAL_EIKS } from "@/lib/vssReferenceData";
import { MON_EIK } from "@/lib/monBenchmarks";
import { EDU_SECTOR_EIKS } from "@/lib/educationReferenceData";
import { KULTURA_EIK, CULTURE_GROUP_EIKS } from "@/lib/kulturaReferenceData";
import { VIK_HOLDING_EIK, WATER_SECTOR_EIKS } from "@/lib/vikReferenceData";
import { MOD_EIK, DEFENSE_SECTOR_EIKS } from "@/lib/defenseReferenceData";
import { NAP_EIK, NAP_AWARDER_PATH } from "@/lib/napReferenceData";
import { CUSTOMS_EIK, CUSTOMS_AWARDER_PATH } from "@/lib/customsReferenceData";
import { AGRI_PAYER_EIK } from "@/data/agri/constants";
import { AGRI_SECTOR_EIKS, AGRI_LEAD_EIK } from "@/lib/agriReferenceData";
import { ENERGY_SECTOR_EIKS } from "@/lib/energyReferenceData";
import {
  TRANSPORT_EIK,
  TRANSPORT_SECTOR_EIKS,
} from "@/lib/transportReferenceData";
import { MOSV_EIK, ENV_SECTOR_EIKS } from "@/lib/environmentReferenceData";
import {
  REGIONAL_EIK,
  REGIONAL_SECTOR_EIKS,
} from "@/lib/regionalReferenceData";
import { ADMIN_SECTOR_EIKS } from "@/lib/administrationReferenceData";
import { TOURISM_SECTOR_EIKS } from "@/lib/tourismReferenceData";
import { MVR_EIK, SECURITY_SECTOR_EIKS } from "@/lib/securityReferenceData";
import { SOCIAL_LEAD_EIK, SOCIAL_SECTOR_EIKS } from "@/lib/socialReferenceData";
import type { ScopeWindow } from "@/data/procurement/useAwarderContracts";

export interface SectorPackProps {
  eik: string;
  /** [from, to) window inherited from the host's scope control. Named
   *  `scopeWindow` (not `window`) so it can't shadow the global `window`. */
  scopeWindow: ScopeWindow;
}

// Canonical paths to the packed awarder dashboards. Single source for the nav
// surfaces (procurement pill, report menu) so re-keying a pack — or giving a
// pack a pill — can't drift the hardcoded EIK.
//
// ROADS_AWARDER_PATH is the exception and does NOT live here: routes.tsx needs
// it for the /procurement/roads redirect, and routes.tsx is entry code, so the
// import made this registry — and the ~20 reference-data modules below — a
// static import of the entry chunk. It lives in @/lib/roadsAwarder, which
// imports nothing. Don't re-export it here for symmetry; that only re-opens
// the door. Gated by src/entryGraph.test.ts.
export const MON_AWARDER_PATH = `/awarder/${MON_EIK}`;
// NOTE: there is deliberately no VSS_AWARDER_PATH export. Its one live sibling
// here (MON_AWARDER_PATH → EducationScreen.tsx) is consumed by a nav surface,
// but both ВСС surfaces point at the /judiciary dashboard instead — the ВСС
// buyer page is reached from there. Don't "fix" the omission.
//
// NOI_/NZOK_AWARDER_PATH used to sit here and were removed 2026-08-16: both had
// zero consumers anywhere, and this note asserted they were read by
// reportMenus.ts and ProcurementNav.tsx, which was not true of any sibling. The
// note's whole job is to stop someone "fixing" the ВСС omission, so it cannot
// rest on a consumer list that has gone stale. Both bodies graduated to their
// own dashboards (/pensions, /sector/health), which is what orphaned them.
// ДФ „Земеделие" DOES have a SectorPack as of 2026-08-20 (AgriPack, below) — this
// note said it did not until then. The awarder page still shows the generic awarder
// dashboard plus the administering-agency subsidies card (gated on AGRI_PAYER_EIK in
// CompanyDbScreen); the pack renders on /sector/agri, whose lead this EIK is.
export const DFZ_AWARDER_PATH = `/awarder/${AGRI_PAYER_EIK}`;
// Revenue-agency packs (НАП / Митници) — collectors, not spenders. Pack-only
// (no standalone view yet), so the nav points straight at the awarder page.
export { NAP_AWARDER_PATH, CUSTOMS_AWARDER_PATH };

const RoadsPack = lazy(() =>
  import("./roads/RoadsPack").then((m) => ({ default: m.RoadsPack })),
);
const NoiPack = lazy(() =>
  import("./noi/NoiPack").then((m) => ({ default: m.NoiPack })),
);
const NzokPack = lazy(() =>
  import("./nzok/NzokPack").then((m) => ({ default: m.NzokPack })),
);
const VssPack = lazy(() =>
  import("./vss/VssPack").then((m) => ({ default: m.VssPack })),
);
const MonPack = lazy(() =>
  import("./mon/MonPack").then((m) => ({ default: m.MonPack })),
);
// No KULTURA_AWARDER_PATH export (deliberately, like ВСС): the culture view's
// home is the /culture dashboard, which the nav points at; the МК awarder page
// is reached from there. The pack still registers by EIK below.
const KulturaPack = lazy(() =>
  import("./kultura/KulturaPack").then((m) => ({ default: m.KulturaPack })),
);
// No VIK_AWARDER_PATH export (deliberately, like ВСС/culture): the water view's
// home will be the /water dashboard (plan §0b.4); the ВиК-холдинг awarder page is
// reached from there. The Phase-1 pack still registers by EIK below and renders
// off the existing corpus (consolidated group + by-function) with no new ingest.
const VikPack = lazy(() =>
  import("./vik/VikPack").then((m) => ({ default: m.VikPack })),
);
// No DEFENSE_AWARDER_PATH export (deliberately, like ВСС/culture/water): the
// defense view's home will be the /defense dashboard (plan Phase 2); the МО
// awarder page is reached from there. The pack registers by EIK below and renders
// off the existing corpus (25-unit group roll-up) with no new ingest.
const DefensePack = lazy(() =>
  import("./defense/DefensePack").then((m) => ({ default: m.DefensePack })),
);
// No MVR_AWARDER_PATH export (deliberately, like ВСС/culture/defense): the МВР
// view's home is the /sector/security dashboard, which the nav points at; the МВР
// awarder page is reached from there. The pack registers by EIK below and renders
// off the existing corpus (74-unit group roll-up) with no new ingest.
const MvrPack = lazy(() =>
  import("./security/MvrPack").then((m) => ({ default: m.MvrPack })),
);
// No TRANSPORT_AWARDER_PATH export (deliberately, like ВСС/culture/defense/МВР): the
// transport view's home is the /sector/transport dashboard, which the nav points at;
// the МТС awarder page is reached from there. The pack registers by EIK below and
// renders off the existing corpus (11-unit group roll-up) with no new ingest. Road
// building (АПИ) is a SEPARATE sector — the pack cross-links to it, never folds it.
const TransportPack = lazy(() =>
  import("./transport/TransportPack").then((m) => ({
    default: m.TransportPack,
  })),
);
// No ENV_AWARDER_PATH export (deliberately, like transport/МВР): the environment
// view's home is the /sector/environment dashboard, which the nav points at; the МОСВ
// awarder page is reached from there. The pack registers by EIK below and renders off
// the existing corpus (27-unit group roll-up) plus the already-ingested air / EU-funds
// / budget / COFOG assets — no new procurement ingest.
const EnvironmentPack = lazy(() =>
  import("./environment/EnvironmentPack").then((m) => ({
    default: m.EnvironmentPack,
  })),
);
const NapPack = lazy(() =>
  import("./nap/NapPack").then((m) => ({ default: m.NapPack })),
);
const CustomsPack = lazy(() =>
  import("./customs/CustomsPack").then((m) => ({ default: m.CustomsPack })),
);
// No SOCIAL_AWARDER_PATH export (deliberately, like transport/МВР): the social
// view's home is the /sector/social dashboard, which the nav points at; the МТСП
// awarder page is reached from there. The pack registers by EIK below and leads
// with the disbursement iceberg + poverty outcome (the inversion) off the existing
// corpus + already-ingested budget/COFOG/SILC — no new procurement ingest.
const SocialPack = lazy(() =>
  import("./social/SocialPack").then((m) => ({ default: m.SocialPack })),
);
// No REGIONAL awarder-path export (like transport/environment): the regional view's
// home is the /sector/regional dashboard; the МРРБ awarder page is reached from there.
// The pack registers by EIK below and leads with the pass-through / cohesion-absorption
// story off the existing corpus + already-ingested cohesion/budget/COFOG — no new ingest.
const RegionalPack = lazy(() =>
  import("./regional/RegionalPack").then((m) => ({ default: m.RegionalPack })),
);

// No AGRI_AWARDER_PATH export (deliberately, like transport/МВР/environment): the
// agri view's home is the /sector/agri dashboard, which the hub tile points at; the
// ДФЗ awarder page is reached from there. The pack registers by EIK below and leads
// with the CAP PAYOUT — the €1.59bn the hub tile promises — off the already-served
// agri_payloads + agri_hub_stats, with the МЗХ group's procurement as one band
// beneath it. No new ingest.
const AgriPack = lazy(() =>
  import("./agri/AgriPack").then((m) => ({ default: m.AgriPack })),
);

const PACKS: Record<string, ComponentType<SectorPackProps>> = {
  [AGRI_LEAD_EIK]: AgriPack,
  [API_EIK]: RoadsPack,
  [NOI_EIK]: NoiPack,
  [NZOK_EIK]: NzokPack,
  [VSS_EIK]: VssPack,
  [MON_EIK]: MonPack,
  [KULTURA_EIK]: KulturaPack,
  [VIK_HOLDING_EIK]: VikPack,
  [MOD_EIK]: DefensePack,
  [MVR_EIK]: MvrPack,
  [TRANSPORT_EIK]: TransportPack,
  [MOSV_EIK]: EnvironmentPack,
  [REGIONAL_EIK]: RegionalPack,
  [SOCIAL_LEAD_EIK]: SocialPack,
  [NAP_EIK]: NapPack,
  [CUSTOMS_EIK]: CustomsPack,
};

export const getSectorPack = (
  eik: string,
): ComponentType<SectorPackProps> | null => PACKS[eik] ?? null;

// --- Sector browse packs ----------------------------------------------------
// The awarder sector-pack generalized to the corpus-wide browse pages
// (/procurement/contracts, /procurement/tenders): keyed on a sector id → an
// EIK-set, so a multi-entity sector (the ~26 ВиК operators, the 59 judicial
// bodies) can restrict + enrich the shared table via ?sector=. This is the
// shared seam docs/plans/water-view-v1.md §4.3 designs; the judiciary plan is
// blocked on it too. Requires contracts.awarder_eik to be filter:"in" (done in
// functions/db_table.js) so the EIK-set can be an IN fixedFilter.

/** The recipient-side corpora a sector filter could be pointed at. */
export type BeneficiaryCorpus =
  | "fund_projects"
  | "agri_subsidies"
  | "interreg_partners";

export interface SectorBrowseSectionProps {
  /** [from, to) window inherited from the browse page's scope control. */
  scope: ScopeWindow;
  /** The sector's awarder EIK-set (== the table's filter) — so the enrichment
   *  strip rolls up exactly the operators the browse page is showing. */
  eiks: readonly string[];
}

export interface SectorBrowsePack {
  id: string;
  label: { bg: string; en: string };
  /** The awarder EIKs whose contracts the browse table is restricted to. */
  eiks: readonly string[];
  /** The beneficiary corpora this EIK set may be filtered on — PER CORPUS, not
   *  a single „is it also a recipient" flag.
   *
   *  A one-flag version of this shipped first and was wrong: culture is
   *  genuinely „both", yet of the three recipient corpora its 45 EIKs reach
   *  exactly ONE. Measured 2026-08-18:
   *
   *      fund_projects   ∩ CULTURE_GROUP_EIKS →  40 rows / €94,075,904   ✅
   *      agri_subsidies  ∩ CULTURE_GROUP_EIKS →   0 rows                 ❌
   *      interreg_partners ∩ CULTURE_GROUP_EIKS → 0 rows                 ❌
   *
   *  and in both zero cases the sector DOES receive that money — €18.3m of ДФЗ
   *  to народни читалища, ~€11m of Interreg to culture organisations — under
   *  identities the roll-up does not carry (a name population, and partner rows
   *  that mostly have no EIK at all). So an empty result is not „nothing here";
   *  it is „not answerable this way", and the two must not look alike.
   *
   *  Omit for a pure buyer set: every pack predates the funds arm and is one. */
  beneficiaryCorpora?: readonly BeneficiaryCorpus[];
  /** Recipient corpora this EIK set DOES match, and is deliberately not filtered
   *  on anyway. Distinct from simply omitting the corpus above, which means „it
   *  matches nothing there".
   *
   *  Needed because „matches nothing" and „matches something unrepresentative"
   *  are different states that a row count alone cannot tell apart, and only the
   *  first is self-evidently safe to leave undeclared. A withholding says the
   *  match was looked at and judged worse than silence.
   *
   *  `rowsAtDecision` is what makes it expire rather than be inherited: the gate
   *  fails once the match grows past it, so a judgement made about 2 rows cannot
   *  quietly go on standing for 200. */
  beneficiaryWithheld?: readonly {
    corpus: BeneficiaryCorpus;
    reason: string;
    rowsAtDecision: number;
  }[];
  /** Optional enrichment strip rendered above the table. Only water ships one
   *  in v1; the other sectors are filter-only until their Section is built. */
  Section?: ComponentType<SectorBrowseSectionProps>;
}

const VikBrowseSection = lazy(() =>
  import("./vik/VikBrowseSection").then((m) => ({
    default: m.VikBrowseSection,
  })),
);
const DefenseBrowseSection = lazy(() =>
  import("./defense/DefenseBrowseSection").then((m) => ({
    default: m.DefenseBrowseSection,
  })),
);

export const SECTOR_BROWSE_PACKS: Record<string, SectorBrowsePack> = {
  water: {
    id: "water",
    label: { bg: "Води (ВиК)", en: "Water (ВиК)" },
    eiks: WATER_SECTOR_EIKS,
    Section: VikBrowseSection,
  },
  roads: {
    id: "roads",
    label: { bg: "Пътища (АПИ)", en: "Roads (АПИ)" },
    eiks: [API_EIK],
  },
  noi: {
    id: "noi",
    label: { bg: "Осигуряване (НОИ)", en: "Social security (НОИ)" },
    eiks: [NOI_EIK],
  },
  // The pack id stays `nzok` even though the set is now НЗОК + МЗ: it is a URL
  // value (`?sector=nzok`) carried by live deep links, so renaming it would
  // break them for no reader-visible gain. The LABEL is what a reader sees.
  nzok: {
    id: "nzok",
    label: {
      bg: "Здравеопазване (МЗ + НЗОК)",
      en: "Health (МЗ + НЗОК)",
    },
    eiks: [...HEALTH_SECTOR_EIKS],
  },
  // The 2026-08-20 audit widened this from ДФЗ alone to the 66-EIK МЗХ roster
  // (agriReferenceData.ts): БАБХ (€217.6M), the ministry (€107.6M) and the whole
  // forestry administration (€73.3M) were in no sector at all, so `?sector=agri`
  // narrowed the browse table to the paying agency's own €131.1M. The label names
  // МЗХ rather than ДФЗ because the set is now the principal, not the agency — the
  // `single`-vs-group caption rule in SectorDashboardScreen turns on exactly that
  // distinction.
  agri: {
    id: "agri",
    label: { bg: "Земеделие (МЗХ)", en: "Agriculture (МЗХ)" },
    eiks: AGRI_SECTOR_EIKS,
  },
  // JUDICIAL_EIKS ALREADY carries VSS_EIK and its alias, so the old
  // `[VSS_EIK, ...VSS_ALIAS_EIKS, ...JUDICIAL_EIKS]` shipped two DUPLICATE
  // entries, 121513231 and 181092349 each in twice. Harmless in the `IN (...)`
  // filter this feeds today, which is why it went unnoticed — but it makes
  // eiks.length wrong and would double-weight both the council and its own alias
  // the day the list drives a per-EIK fan-out.
  judiciary: {
    id: "judiciary",
    label: { bg: "Съдебна власт (ВСС)", en: "Judiciary (ВСС)" },
    eiks: JUDICIAL_EIKS,
  },
  defense: {
    id: "defense",
    label: { bg: "Отбрана (МО)", en: "Defense (МО)" },
    eiks: DEFENSE_SECTOR_EIKS,
    Section: DefenseBrowseSection,
  },
  security: {
    id: "security",
    label: { bg: "Сигурност (МВР)", en: "Security (МВР)" },
    eiks: SECURITY_SECTOR_EIKS,
  },
  // Single-EIK sectors graduated to the generic /sector/:id dashboard — their
  // ?sector= filter narrows the browse table to the one awarder seat. Widen the
  // EIK-set here (and the server allow-list) when a multi-entity roster lands.
  // `edu` below is no longer one of these: the 2026-08-18 audit widened it from
  // МОН alone to the 126-EIK education roster (see educationReferenceData.ts).
  revenue: {
    id: "revenue",
    label: { bg: "Приходи (НАП)", en: "Revenue (НАП)" },
    eiks: [NAP_EIK],
  },
  customs: {
    id: "customs",
    label: { bg: "Митници (АМ)", en: "Customs (АМ)" },
    eiks: [CUSTOMS_EIK],
  },
  edu: {
    id: "edu",
    label: { bg: "Образование и наука", en: "Education & science" },
    eiks: EDU_SECTOR_EIKS,
  },
  transport: {
    id: "transport",
    label: { bg: "Транспорт (МТС)", en: "Transport (МТС)" },
    eiks: TRANSPORT_SECTOR_EIKS,
  },
  social: {
    id: "social",
    label: {
      bg: "Социално подпомагане (МТСП)",
      en: "Social assistance (МТСП)",
    },
    eiks: SOCIAL_SECTOR_EIKS,
  },
  environment: {
    id: "environment",
    label: { bg: "Околна среда (МОСВ)", en: "Environment (МОСВ)" },
    eiks: ENV_SECTOR_EIKS,
  },
  regional: {
    id: "regional",
    label: {
      bg: "Регионално развитие (МРРБ)",
      en: "Regional development (МРРБ)",
    },
    eiks: REGIONAL_SECTOR_EIKS,
  },
  administration: {
    id: "administration",
    label: { bg: "Администрация (е-управление)", en: "Administration (e-gov)" },
    eiks: [...ADMIN_SECTOR_EIKS],
  },
  energy: {
    id: "energy",
    label: { bg: "Енергетика (МЕ)", en: "Energy (МЕ)" },
    eiks: ENERGY_SECTOR_EIKS,
  },
  tourism: {
    id: "tourism",
    label: { bg: "Туризъм (МТ)", en: "Tourism (МТ)" },
    eiks: TOURISM_SECTOR_EIKS,
  },
  // Culture was the one sector with a curated EIK register and no browse pack,
  // so `?sector=culture` — a param the other eighteen have had all along —
  // resolved to null and served the unfiltered corpus. CULTURE_GROUP_EIKS is the
  // principal-МК roll-up (kulturaReferenceData.ts, T0.6): funders, state
  // institutes and the national art schools. Deliberately NOT the wider
  // „universe" — verify-principal and adjacent bodies are declared but are not
  // what a „Култура" filter should silently include.
  culture: {
    id: "culture",
    label: { bg: "Култура (МК)", en: "Culture (МК)" },
    eiks: CULTURE_GROUP_EIKS,
    // ИСУН only — see beneficiaryCorpora. ДФЗ and Interreg culture money is real
    // but is not reachable through these EIKs.
    beneficiaryCorpora: ["fund_projects"],
    beneficiaryWithheld: [
      {
        corpus: "agri_subsidies",
        rowsAtDecision: 2,
        // Decided 2026-08-19, re-made rather than inherited after the roster
        // widening (a269711a0b, dae2a1eb95) took this from 0 rows to 2.
        //
        // Both rows are ONE EIK — 000669774, Национално музикално училище
        // „Любомир Пипков" — on „Училищни схеми": €3,205.25 (2016) and €2,210.84
        // (2017). That is the EU School Fruit/Vegetables/Milk Scheme, which ДФЗ
        // merely ADMINISTERS, reaching a body that is in this roster because it
        // is a national art school. It is school-food aid, not a farm subsidy to
        // a cultural institution.
        //
        // So declaring the corpus would render a ДФЗ page for culture showing
        // €5,416 — against the €18.3m the sector actually receives, as народни
        // читалища, a NAME population these EIKs do not carry. Wrong by ~3,400x
        // and populated enough to be believed, which is strictly worse than the
        // empty page this gate was built to prevent.
        reason:
          'The only match is one national music school on „Училищни схеми" (the EU ' +
          "School Scheme ДФЗ administers), €5,416 over 2016-2017. The sector's real " +
          "ДФЗ money is €18.3m to народни читалища, a name population these EIKs do " +
          "not carry — so an EIK-keyed ДФЗ arm would understate it by ~3,400x while " +
          "looking answered.",
      },
    ],
  },
};

/** The EIKs a pack may be used with on a BENEFICIARY corpus (fund_projects,
 *  agri_subsidies, interreg_partners), or null when it may not be used there at
 *  all.
 *
 *  Not decoration, and the reason it takes a CORPUS rather than just a pack:
 *  culture reaches `fund_projects` and neither `agri_subsidies` nor
 *  `interreg_partners`, though it demonstrably receives money from both. Wiring
 *  `?sector` to a beneficiary table without this check renders an empty page
 *  that reads as „culture received no subsidies", when the truth is €18.3m —
 *  paid to народни читалища, a NAME population deliberately in no EIK list.
 *
 *  So the rule is: an EIK-keyed sector filter is only ever valid on a corpus
 *  where that sector's bodies actually appear under their own EIK. Where they do
 *  not, the answer is a name rule (`chitalishteNameSql`) or nothing — never a
 *  silent zero. `sector_beneficiary_reach.data.test.ts` fails a pack that
 *  declares a beneficiary role and matches nothing. */
export const sectorBeneficiaryEiks = (
  pack: SectorBrowsePack | null,
  corpus: BeneficiaryCorpus,
): readonly string[] | null =>
  pack?.beneficiaryCorpora?.includes(corpus) ? pack.eiks : null;

export const getSectorBrowsePack = (
  id: string | null | undefined,
): SectorBrowsePack | null => (id ? (SECTOR_BROWSE_PACKS[id] ?? null) : null);
