// Sector-dashboard registry — the config that drives the generic
// SectorDashboardScreen (/sector/:id). Each entry gives a sector a proper
// dashboard-style landing page: a group KPI overview rolled up over the
// sector's awarder EIK-set (via useAwarderGroupModel → awarder_group_model)
// plus a SectorAwardersTile listing every member institution, each deep-linking
// to its own /awarder/:eik page.
//
// This graduates the sectors that previously deep-linked straight to a single
// awarder page (health, roads, revenue, customs, social, edu, agri, transport,
// administration). The already-bespoke dashboards (water/defense/culture/
// judiciary/pensions/education) keep their own richer screens and are NOT listed
// here — the sectors hub still links them to their vanity paths.
//
// Members carry an inline canonical name so the awarders tile needs no fetch to
// label its chips (mirrors DefenseAwardersTile / MO_ENTITIES). Single-member
// sectors render one chip; the awarder page behind it holds the full pack.

import { lazy, type ComponentType } from "react";
// From the import-free @/lib/roadsAwarder, not the 31 KB roadAttributes engine
// that re-exports it — API_EIK is the only symbol this registry takes, and
// naming the engine here pulls cpvSectors + awarderModel behind it. Same rule
// as sectorPacks.tsx; gated by src/entryGraph.test.ts.
import { API_EIK } from "@/lib/roadsAwarder";
import { NZOK_EIK, HEALTH_ENTITIES } from "@/lib/healthReferenceData";
import {
  EDU_LEAD_EIK,
  EDU_ENTITIES,
  EDU_UNIVERSE_LABEL,
  educationFootnote,
} from "@/lib/educationReferenceData";
import { NAP_EIK } from "@/lib/napReferenceData";
import { CUSTOMS_EIK } from "@/lib/customsReferenceData";
import { AGRI_PAYER_EIK } from "@/data/agri/constants";
import { BEH_EIK } from "@/lib/energyReferenceData";
import { TOURISM_MINISTRY_EIK } from "@/lib/tourismReferenceData";
import {
  MVR_EIK,
  MVR_ENTITIES,
  SECURITY_UNIVERSE_LABEL,
} from "@/lib/securityReferenceData";
import {
  TRANSPORT_EIK,
  TRANSPORT_ENTITIES,
  TRANSPORT_UNIVERSE_LABEL,
} from "@/lib/transportReferenceData";
import {
  REGIONAL_EIK,
  REGIONAL_ENTITIES,
  REGIONAL_UNIVERSE_LABEL,
} from "@/lib/regionalReferenceData";
import {
  SOCIAL_LEAD_EIK,
  SOCIAL_ENTITIES,
  SOCIAL_UNIVERSE_LABEL,
} from "@/lib/socialReferenceData";
import {
  MOSV_EIK,
  ENV_ENTITIES,
  ENV_UNIVERSE_LABEL,
} from "@/lib/environmentReferenceData";

export interface SectorMember {
  eik: string;
  name: { bg: string; en: string };
  /** Optional sub-group label key for the awarders tile (e.g. defense universes). */
  group?: { bg: string; en: string };
  /** This member has no servable `/awarder/:eik` page, so it is listed in the
   *  awarders tile but kept OUT of the members search — every row the search
   *  offers has to land somewhere (membersIndex.test.ts rule 1). The live case is
   *  a БУЛСТАТ body with a zero procurement footprint: `institution_identity()`
   *  returns NULL, there is no `tr_companies` row, and the page renders „Няма
   *  фирма с ЕИК … в базата.". НФЦ is the precedent (CultureSearchBox).
   *
   *  ⚠ It must come OFF the moment the body awards its first contract, or a live
   *  institution stays hidden from search for no reason — which nobody would
   *  notice. `sector_members_land.data.test.ts` asserts the flag in BOTH
   *  directions against the corpus, so the flag retires itself. */
  noAwarderPage?: boolean;
}

export interface SectorDashboardConfig {
  /** Matches the sectorRegistry id and (where present) the SECTOR_BROWSE_PACKS key. */
  id: string;
  /** i18n keys reused from the sector registry (short tile label + description). */
  titleKey: string;
  descKey: string;
  /** Cyrillic agency acronym — same in both languages. */
  agency: string;
  /** The lead/consolidated awarder EIK — the "whole group" link + hero. */
  leadEik: string;
  /** Every awarder in the sector (lead first). One chip each → /awarder/:eik. */
  members: SectorMember[];
  /** ?sector= browse-pack id for the "all sector contracts" footer link.
   *  Defaults to `id` when omitted. Only resolves if registered in
   *  SECTOR_BROWSE_PACKS (and allow-listed server-side). */
  browsePackId?: string;
  /** Optional bespoke thematic tiles rendered between the KPI row and the
   *  awarders tile (curated, sector-specific data). None of the graduating
   *  sectors ship one yet. */
  ThematicTiles?: ComponentType;
  /** Optional note under the awarders roster, for a sector whose membership needs
   *  a caveat the roster itself cannot express — what the hub tile's € does and
   *  does not cover, or bodies a reader would expect here and will find elsewhere.
   *
   *  ⚠ Only single-member sectors used to get a footnote (SectorAwardersTile hard-
   *  coded one saying "the full breakdown is on the awarder's page"). That is
   *  backwards for exactly the sector that needs it most: a one-EIK roster needs no
   *  explanation, and a 126-EIK one spanning three budget principals does. */
  footnote?: { bg: string; en: string };
  /** The sector pack registered under `leadEik` is THEMATIC, not group-scoped:
   *  render the generic group dashboard (KPI row / spend-by-year / top
   *  contractors over `members`) and demote the pack to the thematic slot below
   *  it, instead of letting the pack BE the page.
   *
   *  ⚠ Set this whenever a pack ignores the group. `getSectorPack(leadEik)`
   *  normally short-circuits the whole group model — `useAwarderGroupModel` is
   *  called with `enabled: !Pack` — which is right for the packs that ARE their
   *  sector's money (НЗОК's payouts, ВиК's operators, МВР's directorates) and
   *  silently wrong for one that is not. `edu` is the live case and the reason
   *  this exists: MonPack is a cross-buyer analysis of the €51M textbook market
   *  (bought by 606 schools) and does not even bind its `eik` prop, so widening
   *  the sector from МОН alone to the 126-EIK education roster moved every
   *  headline number — €3.17M → €71.7M on the default scope, top contractor
   *  72.3% → 2.73% — and NONE of it reached the page. Removing the pack from the
   *  registry is not the fix: `/awarder/000695114` renders it too, via the same
   *  `getSectorPack`. */
  packIsThematic?: boolean;
  /** The pack renders its OWN <ScopeControl>, so the screen must not render a
   *  second one.
   *
   *  ⚠ Set this whenever a pack's content is year-scoped from a source the SCREEN
   *  cannot enumerate. The screen's control is URL-backed and resolves `?pscope`
   *  against a year list, and neither collector pack's year list is knowable
   *  before its own query lands: useCustoms() returns only the years whose
   *  breakdown file actually fetched, and useNap() derives its years from
   *  kfp.json's snapshots. So the coverage cannot live in this config, and a
   *  screen-level control would be resolving against a list it does not have.
   *
   *  Before this flag, CustomsPack and NapPack were the only two packs taking no
   *  props at all — they ignored `scopeWindow` entirely and drove off their own
   *  year buttons — while the screen rendered a scope control above them anyway.
   *  Measured live: /sector/customs?pscope=y:2022 showed the pill reading „2022"
   *  above „Откъде идват митническите приходи (2025)" and €7,4 млрд, and
   *  /sector/revenue?pscope=y:2013 showed „2013" above 2026 figures. `?pscope` is
   *  in the usePreserveParams allowlist, so ordinary in-app links mint that state.
   *  CLAUDE.md's URL contract names this exact failure: „What no page may do is
   *  show one window and count another."
   *
   *  ⚠ TWO RULES THE FLAG DOES NOT ENFORCE, both silent:
   *
   *  1. NEVER together with `packIsThematic`. The screen's guard is
   *     `!(Pack && packOwnsScope)` and a thematic pack sets `Pack = null`, so the
   *     screen renders ITS control and the pack renders its own — two controls,
   *     the state this flag exists to end. That is not a bug in the guard: the
   *     generic group dashboard above a thematic pack is scope-driven and needs
   *     a control. The combination is simply invalid.
   *  2. The pack must render its control ABOVE its own early returns. The
   *     screen's suppression is STRUCTURAL — `Pack` is truthy the moment the EIK
   *     is in the pack registry — while the pack's content waits on a lazy chunk
   *     and a fetch, so a pack that returns a skeleton, or null on a failed
   *     corpus, leaves the page with NO time control at all and no explanation.
   *     `usePackScope` returns the strip precisely so it can be rendered in every
   *     branch.
   *
   *  Both are gated in sectorDashboards.test.ts, mutation-checked. */
  packOwnsScope?: boolean;
  /** Optional entity-search box, rendered directly under the scope control and
   *  above the first tile — ONE per page (see SectorEntitySearch's header). The
   *  sector supplies it because only the sector knows what its entities are and
   *  which payloads they come from. Lazy so this config module, which is pulled
   *  in wherever sectorPacks is imported, does not eager-load them. */
  SearchBox?: ComponentType;
}

// Awarder EIKs given as literals where no reference-data export exists yet.
// Exported so sibling surfaces (sectorPacks browse-pack set) reuse them rather
// than re-hardcoding the same digits.
// TRANSPORT_EIK (000695388, МТС) is the group lead — defined in its reference data,
// re-exported so sibling surfaces (sectorPacks) keep importing it here.
export { TRANSPORT_EIK };
export const ADMIN_EIK = "180680495"; // Министерство на електронното управление (МЕУ)

// Energy is the first sector to ship bespoke ThematicTiles (the invisible-€14bn
// call-out, single-bid gauge, per-unit spend). Lazy so the config module — pulled
// in wherever sectorPacks is imported — doesn't eager-load react-query/lucide.
const EnergyThematicTiles = lazy(() =>
  import("./energy/EnergyThematicTiles").then((m) => ({
    default: m.EnergyThematicTiles,
  })),
);

export const SECTOR_DASHBOARDS: Record<string, SectorDashboardConfig> = {
  tourism: {
    id: "tourism",
    titleKey: "sector_tourism_title",
    descKey: "sector_tourism_desc",
    agency: "МТ",
    leadEik: TOURISM_MINISTRY_EIK,
    browsePackId: "tourism",
    members: [
      {
        eik: TOURISM_MINISTRY_EIK,
        name: {
          bg: "Министерство на туризма",
          en: "Ministry of Tourism",
        },
      },
    ],
    ThematicTiles: lazy(() =>
      import("./tourism/TourismThematicTiles").then((m) => ({
        default: m.TourismThematicTiles,
      })),
    ),
  },
  // Здравеопазване — НЗОК (pays for care) + МЗ (builds and equips it). The
  // hub HEADLINE stays НЗОК-only payout on purpose: summing МЗ's budget onto it
  // would mix bases and double-count the state transfer that part-funds НЗОК.
  // Members from the curated allowlist (healthReferenceData.ts), which carries
  // that reasoning and the second-level anti-allowlist.
  //
  // leadEik stays НЗОК because getSectorPack keys on it, so the fund's
  // budget-bridge pack — the one that shows ЗОП is ~1.5% of the money — remains
  // this dashboard's content. МЗ reaches the reader through the awarders tile
  // and the whole-group browse link.
  health: {
    id: "health",
    titleKey: "sector_health_title",
    descKey: "sector_health_desc",
    agency: "НЗОК",
    leadEik: NZOK_EIK,
    browsePackId: "nzok",
    SearchBox: lazy(() =>
      import("@/screens/components/procurement/nzok/NzokSearchBox").then(
        (m) => ({ default: m.NzokSearchBox }),
      ),
    ),
    members: HEALTH_ENTITIES.map((e) => ({ eik: e.eik, name: e.name })),
  },
  roads: {
    id: "roads",
    titleKey: "sector_roads_title",
    descKey: "sector_roads_desc",
    agency: "АПИ",
    leadEik: API_EIK,
    browsePackId: "roads",
    members: [
      {
        eik: API_EIK,
        name: {
          bg: "Агенция „Пътна инфраструктура“",
          en: "Road Infrastructure Agency",
        },
      },
    ],
  },
  // Транспорт — the МТС state transport group: rail (НКЖИ + БДЖ + ИАЖА + ДП ТСВ),
  // ports and the Danube (Пристанищна инфраструктура + Морска администрация + ИАППД),
  // aviation (БУЛАТСА + Летище София + ГД ГВА) and road regulation/safety
  // (Автомобилна администрация + ДАБДП). МТС leads; its /awarder
  // page renders the TransportPack (registered under TRANSPORT_EIK), and so does this
  // dashboard. ⚠ ROAD BUILDING is a SEPARATE sector — АПИ/Автомагистрали are excluded;
  // the pack cross-links to /sector/roads. Метрополитен is municipal, also excluded.
  // Members from the curated allowlist (transportReferenceData.ts).
  transport: {
    id: "transport",
    titleKey: "sector_transport_title",
    descKey: "sector_transport_desc",
    agency: "МТС",
    leadEik: TRANSPORT_EIK,
    browsePackId: "transport",
    members: TRANSPORT_ENTITIES.map((e) => ({
      eik: e.eik,
      name: { bg: e.name, en: e.name },
      group: TRANSPORT_UNIVERSE_LABEL[e.universe],
    })),
  },
  // Регионално развитие — the МРРБ group: the ministry (pass-through principal —
  // it controls ~€1.06bn/year but procures only ~€100M; the rest leaves as capital
  // transfers to municipalities + EU-cohesion co-financing), the cadastre agency
  // (АГКК), the building-control directorate (ДНСК) and the 28 областни
  // администрации (regional governors — the per-oblast backbone). МРРБ leads; its
  // /awarder page renders the RegionalPack (registered under REGIONAL_EIK), and so
  // does this dashboard. ⚠ ROADS (АПИ) and WATER (ВиК) are SEPARATE sectors
  // (/sector/roads, /water) — administratively МРРБ's children but excluded here;
  // the pack cross-links to them. Members from the curated allowlist
  // (regionalReferenceData.ts).
  regional: {
    id: "regional",
    titleKey: "sector_regional_title",
    descKey: "sector_regional_desc",
    agency: "МРРБ",
    leadEik: REGIONAL_EIK,
    browsePackId: "regional",
    members: REGIONAL_ENTITIES.map((e) => ({
      eik: e.eik,
      name: { bg: e.name, en: e.name },
      group: REGIONAL_UNIVERSE_LABEL[e.universe],
      noAwarderPage: e.noAwarderPage,
    })),
  },
  // Социално подпомагане — the МТСП/АСП state social group: the ministry (policy
  // principal), the social-assistance agency that pays the benefits (АСП — the
  // star), the labour agencies (АЗ + ГИТ) and the small policy/quality agencies
  // (АХУ + АКСУ). МТСП leads; its /awarder page renders the SocialPack. ⚠ НОИ
  // (pensions) is a SEPARATE view (/pensions) — deliberately excluded, never folded
  // (this is the redundancy fix: the slot used to duplicate `pension`). Members
  // from the curated allowlist (socialReferenceData.ts).
  social: {
    id: "social",
    titleKey: "sector_social_title",
    descKey: "sector_social_desc",
    agency: "МТСП",
    leadEik: SOCIAL_LEAD_EIK,
    browsePackId: "social",
    members: SOCIAL_ENTITIES.map((e) => ({
      eik: e.eik,
      name: { bg: e.name, en: e.name },
      group: SOCIAL_UNIVERSE_LABEL[e.universe],
    })),
  },
  revenue: {
    id: "revenue",
    titleKey: "sector_revenue_title",
    descKey: "sector_revenue_desc",
    agency: "НАП",
    leadEik: NAP_EIK,
    browsePackId: "revenue",
    // NapPack owns the year picker — its coverage is kfp.json's snapshot years.
    packOwnsScope: true,
    members: [
      {
        eik: NAP_EIK,
        name: {
          bg: "Национална агенция за приходите",
          en: "National Revenue Agency",
        },
      },
    ],
  },
  customs: {
    id: "customs",
    titleKey: "sector_customs_title",
    descKey: "sector_customs_desc",
    agency: "АМ",
    leadEik: CUSTOMS_EIK,
    browsePackId: "customs",
    // CustomsPack owns the year picker — its coverage is whichever of
    // data/budget/revenue_breakdown/customs/*.json actually fetched.
    packOwnsScope: true,
    members: [
      {
        eik: CUSTOMS_EIK,
        name: { bg: "Агенция „Митници“", en: "Customs Agency" },
      },
    ],
  },
  // ⚠ This config is INERT for administration: routes.tsx statically intercepts
  // /sector/administration with the bespoke AdministrationScreen, so the generic
  // SectorDashboardScreen never renders it and `members`/`leadEik` here are not
  // consumed for the folded KPI row. The real e-gov procurement group (МЕУ + ИА
  // ИЕУ + ДАЕУ) lives in ADMIN_SECTOR_EIKS (administrationReferenceData.ts) and
  // is what the bespoke screen + SECTOR_BROWSE_PACKS.administration fold. The
  // single МЕУ member below is kept only so SECTOR_DASHBOARD_IDS (sitemap / OG /
  // prerender / sectorRegistry) still lists the slug. Suppression is lead-only by
  // design (like every group sector): the non-lead members' own /awarder pages
  // show their generic contracts AND those contracts fold into this view — the
  // same double-surface energy's subsidiaries have.
  administration: {
    id: "administration",
    titleKey: "sector_admin_title",
    descKey: "sector_admin_desc",
    agency: "МЕУ",
    leadEik: ADMIN_EIK,
    browsePackId: "administration",
    members: [
      {
        eik: ADMIN_EIK,
        name: {
          bg: "Министерство на електронното управление",
          en: "Ministry of e-Government",
        },
      },
    ],
  },
  edu: {
    id: "edu",
    titleKey: "sector_edu_title",
    descKey: "sector_edu_desc",
    agency: "МОН",
    leadEik: EDU_LEAD_EIK,
    browsePackId: "edu",
    // MonPack is the textbook-market analysis, not this group's money — see
    // packIsThematic above for why leaving it as the page content silently
    // discarded the whole point of the 2026-08-18 widening.
    packIsThematic: true,
    footnote: { bg: educationFootnote(true), en: educationFootnote(false) },
    members: EDU_ENTITIES.map((e) => ({
      eik: e.eik,
      name: { bg: e.name, en: e.name },
      group: EDU_UNIVERSE_LABEL[e.universe],
    })),
  },
  agri: {
    id: "agri",
    titleKey: "sector_agri_title",
    descKey: "sector_agri_desc",
    agency: "ДФЗ",
    leadEik: AGRI_PAYER_EIK,
    browsePackId: "agri",
    members: [
      {
        eik: AGRI_PAYER_EIK,
        name: {
          bg: "Държавен фонд „Земеделие“",
          en: "State Fund Agriculture",
        },
      },
    ],
  },
  // Енергетика — the БЕХ state-energy group. Unlike the single-institution
  // sectors above, `members` IS the whole group (9 EIKs) so the KPI rollup folds
  // every subsidiary; БЕХ leads (its /awarder page suppresses the pack and links
  // here, and it awards €0 — the KPIs are the folded group, not the lead).
  // EIKs measured from the corpus (energyReferenceData.ts, 2026-07-12); the ЕСО
  // branch 1752013040 (~€64K) is folded server-side, not a member chip.
  energy: {
    id: "energy",
    titleKey: "sector_energy_title",
    descKey: "sector_energy_desc",
    // МЕ, not БЕХ: the members are the state energy sector by PRINCIPAL, which is
    // the БЕХ group plus ДП РАО (a чл. 62 ал. 3 ТЗ enterprise under the minister
    // directly). leadEik stays БЕХ — it is the biggest node and the group hero,
    // not a claim that every member is its subsidiary.
    agency: "МЕ",
    leadEik: BEH_EIK,
    browsePackId: "energy",
    ThematicTiles: EnergyThematicTiles,
    members: [
      {
        eik: BEH_EIK,
        name: {
          bg: "Български енергиен холдинг",
          en: "Bulgarian Energy Holding",
        },
        group: { bg: "Холдинг", en: "Holding" },
      },
      {
        eik: "106513772",
        name: { bg: "АЕЦ Козлодуй", en: "Kozloduy NPP" },
        group: { bg: "Ядрена енергия", en: "Nuclear" },
      },
      {
        eik: "123531939",
        name: { bg: "ТЕЦ Марица изток 2", en: "Maritsa East 2 TPP" },
        group: { bg: "Въглища", en: "Coal" },
      },
      {
        eik: "833017552",
        name: { bg: "Мини Марица-изток", en: "Mini Maritsa Iztok" },
        group: { bg: "Въглища", en: "Coal" },
      },
      {
        eik: "000649348",
        name: {
          bg: "Национална електрическа компания (НЕК)",
          en: "National Electric Company (NEK)",
        },
        group: { bg: "ВЕЦ и търговия", en: "Hydro & trading" },
      },
      {
        eik: "106588180",
        name: { bg: "ВЕЦ Козлодуй", en: "Kozloduy HPP" },
        group: { bg: "ВЕЦ и търговия", en: "Hydro & trading" },
      },
      {
        eik: "175201304",
        name: {
          bg: "Електроенергиен системен оператор (ЕСО)",
          en: "Electricity System Operator (ESO)",
        },
        group: { bg: "Електропренос", en: "Power grid" },
      },
      {
        eik: "175203478",
        name: { bg: "Булгартрансгаз", en: "Bulgartransgaz" },
        group: { bg: "Природен газ", en: "Natural gas" },
      },
      {
        eik: "175203485",
        name: { bg: "Булгаргаз", en: "Bulgargaz" },
        group: { bg: "Природен газ", en: "Natural gas" },
      },
      {
        eik: "131218471",
        name: {
          bg: "ДП „Радиоактивни отпадъци“ (ДП РАО)",
          en: "State Enterprise Radioactive Waste (DP RAO)",
        },
        group: { bg: "Радиоактивни отпадъци", en: "Radioactive waste" },
      },
    ],
  },
  // Сигурност / МВР (sector id "security") — the security-cluster twin of energy:
  // `members` IS the whole ~75-EIK group so the awarders tile lists every unit
  // (grouped by universe). МВР leads; its /awarder page renders the MvrPack
  // (registered under MVR_EIK), and so does this dashboard (getSectorPack(leadEik)
  // → MvrPack becomes the content). Members generated from the curated allowlist
  // (securityReferenceData.ts); the canonical BG name doubles as the en label.
  security: {
    id: "security",
    titleKey: "sector_security_title",
    descKey: "sector_security_desc",
    agency: "МВР",
    leadEik: MVR_EIK,
    browsePackId: "security",
    members: MVR_ENTITIES.map((e) => ({
      eik: e.eik,
      name: { bg: e.name, en: e.name },
      group: SECURITY_UNIVERSE_LABEL[e.universe],
    })),
  },
  // Околна среда / МОСВ (sector id "environment") — the last untouched top-level
  // COFOG function (GF05). `members` IS the whole 28-EIK group (ministry + ИАОС +
  // ПУДООС + НДЕФ + 3 national parks + НИМХ + 4 river-basin directorates + 16 РИОСВ)
  // so the awarders tile lists every unit grouped by universe. МОСВ leads; its /awarder page
  // renders the EnvironmentPack (registered under MOSV_EIK), and so does this
  // dashboard (getSectorPack(leadEik) → EnvironmentPack becomes the content). The
  // signature finding: ИАОС — the agency that produces the PM10 series the pack maps —
  // is itself a top-tier buyer, nearly the size of the whole ministry.
  environment: {
    id: "environment",
    titleKey: "sector_environment_title",
    descKey: "sector_environment_desc",
    agency: "МОСВ",
    leadEik: MOSV_EIK,
    browsePackId: "environment",
    members: ENV_ENTITIES.map((e) => ({
      eik: e.eik,
      name: { bg: e.name, en: e.name },
      group: ENV_UNIVERSE_LABEL[e.universe],
    })),
  },
};

export const getSectorDashboard = (
  id: string | null | undefined,
): SectorDashboardConfig | null =>
  id ? (SECTOR_DASHBOARDS[id] ?? null) : null;

// Two reverse lookups, because the awarder page asks TWO different questions of
// this config and only one of them is about leadership:
//
//   · LEAD (below) — "has this awarder's pack moved to /sector/:id?" That is true
//     only for the lead, whose disbursement content now lives on the dashboard,
//     leaving its awarder page as the institution's own ЗОП financials.
//   · MEMBER (further down) — "which sector does this awarder belong to?" True for
//     every member, and the basis of the cross-link.
//
// They were one lookup until 2026-08-16, keyed on lead, which made every non-lead
// member of a multi-member sector a dead end: 161 non-lead members — 160 of them
// with a servable awarder page (regional 125043455 is `noAwarderPage`) — belonging
// to a sector they could not link to, the largest being МЗ (000695317) at €2.84bn.
// Keep them apart: collapsing them back would suppress the pack for every non-lead
// member, which today is invisible only because no member happens to have one.
//
// Both maps are null-prototype. An EIK arrives as an unvalidated /awarder/:eik route
// param, and on a plain object `byEik["toString"]` returns Function.prototype.toString
// — truthy, typed as a config, and `?? null` never sees it. Measured: toString,
// constructor, hasOwnProperty and __proto__ all resolved to non-configs before this.
const DASHBOARD_BY_LEAD_EIK: Record<string, SectorDashboardConfig> =
  Object.assign(
    Object.create(null) as Record<string, SectorDashboardConfig>,
    Object.fromEntries(
      Object.values(SECTOR_DASHBOARDS).map((c) => [c.leadEik, c]),
    ),
  );

export const sectorDashboardForLeadEik = (
  eik: string | null | undefined,
): SectorDashboardConfig | null =>
  eik ? (DASHBOARD_BY_LEAD_EIK[eik] ?? null) : null;

/** Every EIK in a sector — the input to useAwarderGroupModel + the ?sector= set. */
export const sectorMemberEiks = (c: SectorDashboardConfig): string[] =>
  c.members.map((m) => m.eik);

/** Builds the member→sector index, refusing ANY repeated EIK.
 *
 *  Explicit rather than Object.fromEntries, because member EIKs — unlike leadEik —
 *  are NOT unique by construction: nothing in this config, and no GENERAL test,
 *  stops two sectors listing the same body (only МЗ is pinned, in
 *  `sector_stats.data.test.ts`). fromEntries keeps the last writer silently, so a
 *  shared EIK would link that body to whichever sector came later in object key
 *  order. A sector attribution picked by key order is worse than a boot failure —
 *  and this module is imported by three build scripts, so the throw fails the
 *  BUILD rather than one page.
 *
 *  The check is object IDENTITY, never `prev.id !== c.id`: nothing enforces that a
 *  config's `id` matches its SECTOR_DASHBOARDS key, so two copy-pasted entries can
 *  share an `id` — and an id-based comparison would wave exactly that collision
 *  through, which is the likeliest way the mistake actually gets made.
 *
 *  A sector repeating its OWN EIK is refused too. The index would be unharmed, but
 *  nothing else catches it and the duplicate reaches the reader: two chips in
 *  `SectorAwardersTile`, a doubled row in `buildMembersIndex`, and a double count
 *  through `sectorMemberEiks` → `useAwarderGroupModel`.
 *
 *  Exported so the refusal is directly assertable — the caller below is the only
 *  production use. */
export const buildMemberIndex = (
  configs: SectorDashboardConfig[],
): Record<string, SectorDashboardConfig> => {
  const byEik: Record<string, SectorDashboardConfig> = Object.create(null);
  for (const c of configs)
    for (const { eik } of c.members) {
      const prev = byEik[eik];
      if (prev)
        throw new Error(
          prev === c
            ? `SECTOR_DASHBOARDS: "${c.id}" lists EIK ${eik} twice — it would render two chips and double-count the member`
            : `SECTOR_DASHBOARDS: EIK ${eik} is a member of both "${prev.id}" and "${c.id}" — a sector must claim it exclusively`,
        );
      byEik[eik] = c;
    }
  return byEik;
};

const DASHBOARD_BY_MEMBER_EIK = buildMemberIndex(
  Object.values(SECTOR_DASHBOARDS),
);

/** The sector an awarder EIK BELONGS to — lead or not. Powers the /awarder/:eik
 *  cross-link up to /sector/:id. Every leadEik is also in its own `members`, so a
 *  lead resolves here too; this is a superset of sectorDashboardForLeadEik, not an
 *  alternative to it, and the two answer different questions (see above). */
export const sectorDashboardForMemberEik = (
  eik: string | null | undefined,
): SectorDashboardConfig | null =>
  eik ? (DASHBOARD_BY_MEMBER_EIK[eik] ?? null) : null;

export const SECTOR_DASHBOARD_IDS = Object.keys(SECTOR_DASHBOARDS);
