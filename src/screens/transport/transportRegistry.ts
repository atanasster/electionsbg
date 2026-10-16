// The /sector/transport hub registry — the tiles the sector fronts. Pure data;
// the scene is referenced by `id` (TRANSPORT_SCENES[id]), so this module carries
// no JSX. Mirrors roadsRegistry.ts / waterRegistry.ts. Plan:
// docs/plans/transport-hub-v1.md §3.
//
// EVERY `to` IS A LIVE, STATIC DESTINATION — asserted against the routed list by
// `transportRegistry.test.ts`. No seeded `:param` paths.
//
// ⚠️ NO FIGURE IS WRITTEN IN THE COPY BELOW. Numbers come from
// data/transport/derived/hub_stats.json (db:gen-transport-hub-stats).
//
// ⚠️ EVERY DESTINATION THAT TAKES A SCOPE CARRIES `?pscope=all`. The hub is
// unscoped (whole corpus, 2011–) while the browsers and the scoped sub-pages
// default to the SELECTED PARLIAMENT — €114M of the sector's €7.29bn on
// 2026-10-16, so a tile without the param lands on 1.6% of its own figure.
// /sector/transport/money is „без период" and takes no scope.
//
// ⚠️ THE FRAGMENT IDS ARE THE PLAN'S §3 SET AND ONLY THAT SET (C6). The pack's
// old ids (mode-split, rail-subsidy, eu-funds, transport-budget …) are retired;
// the registry test fails a #fragment its destination does not render.
//
// Copy is inline {bg, en} — no i18n corpus keys and no withBundle (O7): these
// strings exist once, on one page.

import { TILE_ACCENTS } from "@/ux/infographic";
import { TRANSPORT_PATHS } from "@/lib/transportPaths";

export { TRANSPORT_PATHS };

export interface TransportTile {
  /** Scene key (TRANSPORT_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Always static. */
  to: string;
  /** A TILE_ACCENTS token, unique across the page. */
  accent: string;
}

export interface TransportBand {
  labelKey: string;
  /** One line under the heading saying what is IN the band. */
  descKey: string;
  tiles: TransportTile[];
}

export const ALL = "?pscope=all";

/** `?mode=` values the network and procurement pages accept (validated on read
 *  there). Page-local: not in the usePreserveParams allowlist. */
const modeLink = (mode: string) =>
  `${TRANSPORT_PATHS.network}?mode=${mode}&pscope=all`;

/** The sector-filtered contracts browser at the whole-corpus scope. */
export const TRANSPORT_CONTRACTS_PATH =
  "/procurement/contracts?sector=transport&pscope=all";

/** Band + tile copy. Kept beside the registry, not in the i18n corpus. */
export const TRANSPORT_HUB_COPY: Record<string, { bg: string; en: string }> = {
  transport_band_where: { bg: "Къде", en: "Where" },
  transport_band_where_desc: {
    bg: "В коя част от мрежата отиват парите — жп линиите, пристанищата и Дунав, летищата и въздушното движение.",
    en: "Which part of the network the money goes to — the railway lines, the ports and the Danube, the airports and air traffic.",
  },
  transport_band_how: { bg: "Как се възлага", en: "How it is awarded" },
  transport_band_how_desc: {
    bg: "Конкуренцията, процедурите без обявление и изпълнителите на най-големите договори.",
    en: "Competition, procedures without a notice and the contractors behind the largest contracts.",
  },
  transport_band_who: { bg: "Кой и колко", en: "Who and how much" },
  transport_band_who_desc: {
    bg: "Структурите на сектора, парите, които остават в държавната група, и средствата извън обществените поръчки.",
    en: "The sector's bodies, the money that stays inside the state group, and the funding outside public procurement.",
  },

  transport_tile_map: { bg: "Карта на проектите", en: "Project map" },
  transport_tile_map_desc: {
    bg: "Жп участъците, гарите и пристанищата, назовани в договорите — по вложени средства и конкуренция.",
    en: "The railway sections, stations and ports named in the contracts — by money spent and competition.",
  },
  transport_tile_rail: { bg: "Железници", en: "Railways" },
  transport_tile_rail_desc: {
    bg: "Поръчките на НКЖИ, БДЖ и жп администрацията — на картата и по участъци.",
    en: "The procurement of NRIC, BDZ and the railway administration — on the map and by section.",
  },
  transport_tile_maritime: {
    bg: "Пристанища и Дунав",
    en: "Ports and the Danube",
  },
  transport_tile_maritime_desc: {
    bg: "Пристанищната инфраструктура, морската администрация и поддръжката на реката.",
    en: "Port infrastructure, the maritime administration and the upkeep of the river.",
  },
  transport_tile_aviation: { bg: "Въздушен транспорт", en: "Aviation" },
  transport_tile_aviation_desc: {
    bg: "Ръководството на въздушното движение, държавните летища и гражданската авиация.",
    en: "Air-traffic control, the state airports and the civil aviation authority.",
  },

  transport_tile_competition: { bg: "Конкуренция", en: "Competition" },
  transport_tile_competition_desc: {
    bg: "Делът на договорите с една оферта по структура, до средното за страната — сигнал за проверка, не доказателство.",
    en: "The single-bidder share by body, beside the national average — a flag for review, not proof.",
  },
  transport_tile_direct: { bg: "Без обявление", en: "Without a notice" },
  transport_tile_direct_desc: {
    bg: "Поръчките, възложени без предварително обявление или чрез пряко договаряне.",
    en: "Contracts awarded without a prior notice or by direct negotiation.",
  },
  transport_tile_top: {
    bg: "Най-големите договори",
    en: "The largest contracts",
  },
  transport_tile_top_desc: {
    bg: "Най-скъпите отделни договори — с отбелязани многогодишните договори за обществена услуга.",
    en: "The costliest individual contracts — with the multi-year public-service contracts marked.",
  },
  transport_tile_contracts: { bg: "Всички договори", en: "Every contract" },
  transport_tile_contracts_desc: {
    bg: "Договорите на сектора в регистъра — с филтри по процедура, предмет и година.",
    en: "The sector's contracts in the register — filterable by procedure, subject and year.",
  },

  transport_tile_bodies: { bg: "Структурите", en: "The bodies" },
  transport_tile_bodies_desc: {
    bg: "Министерството и дружествата и агенциите към него — по вид транспорт, с поръчките на всяка.",
    en: "The ministry and the companies and agencies under it — by mode, with each one's procurement.",
  },
  transport_tile_ingroup: {
    bg: "В държавната група",
    en: "Inside the state group",
  },
  transport_tile_ingroup_desc: {
    bg: "Договорите между структурите на МТС — парите, които не излизат на пазара.",
    en: "Contracts between MTC bodies — money that never reaches an outside market.",
  },
  transport_tile_subsidy: { bg: "Субсидията за влака", en: "The rail subsidy" },
  transport_tile_subsidy_desc: {
    bg: "Годишната държавна субсидия за пътническите превози и инфраструктурата — и колко е на пътник.",
    en: "The annual state subsidy for passenger services and the infrastructure — and how much it is per passenger.",
  },
  transport_tile_funds: { bg: "Еврофондове", en: "EU funds" },
  transport_tile_funds_desc: {
    bg: "Безвъзмездната помощ по европейските програми за структурите — друг корпус, не се събира с поръчките.",
    en: "The grant aid from EU programmes to the bodies — a different corpus, never summed with procurement.",
  },
};

export const TRANSPORT_BANDS: TransportBand[] = [
  {
    labelKey: "transport_band_where",
    descKey: "transport_band_where_desc",
    tiles: [
      {
        id: "map",
        titleKey: "transport_tile_map",
        descKey: "transport_tile_map_desc",
        to: `${TRANSPORT_PATHS.network}${ALL}`,
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "rail",
        titleKey: "transport_tile_rail",
        descKey: "transport_tile_rail_desc",
        to: modeLink("rail"),
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "maritime",
        titleKey: "transport_tile_maritime",
        descKey: "transport_tile_maritime_desc",
        to: modeLink("maritime"),
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "aviation",
        titleKey: "transport_tile_aviation",
        descKey: "transport_tile_aviation_desc",
        to: modeLink("aviation"),
        accent: TILE_ACCENTS.azure,
      },
    ],
  },
  {
    labelKey: "transport_band_how",
    descKey: "transport_band_how_desc",
    tiles: [
      {
        id: "competition",
        titleKey: "transport_tile_competition",
        descKey: "transport_tile_competition_desc",
        to: `${TRANSPORT_PATHS.procurement}${ALL}#competition`,
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "direct",
        titleKey: "transport_tile_direct",
        descKey: "transport_tile_direct_desc",
        to: `${TRANSPORT_PATHS.procurement}${ALL}#direct`,
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "top",
        titleKey: "transport_tile_top",
        descKey: "transport_tile_top_desc",
        to: `${TRANSPORT_PATHS.procurement}${ALL}#top-contracts`,
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "contracts",
        titleKey: "transport_tile_contracts",
        descKey: "transport_tile_contracts_desc",
        to: TRANSPORT_CONTRACTS_PATH,
        accent: TILE_ACCENTS.slate,
      },
    ],
  },
  {
    labelKey: "transport_band_who",
    descKey: "transport_band_who_desc",
    tiles: [
      {
        id: "bodies",
        titleKey: "transport_tile_bodies",
        descKey: "transport_tile_bodies_desc",
        to: `${TRANSPORT_PATHS.bodies}${ALL}`,
        accent: TILE_ACCENTS.indigo,
      },
      {
        id: "ingroup",
        titleKey: "transport_tile_ingroup",
        descKey: "transport_tile_ingroup_desc",
        to: `${TRANSPORT_PATHS.procurement}${ALL}#contractors`,
        accent: TILE_ACCENTS.plum,
      },
      {
        id: "subsidy",
        titleKey: "transport_tile_subsidy",
        descKey: "transport_tile_subsidy_desc",
        to: `${TRANSPORT_PATHS.money}#subsidy`,
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "funds",
        titleKey: "transport_tile_funds",
        descKey: "transport_tile_funds_desc",
        to: `${TRANSPORT_PATHS.money}#funds`,
        accent: TILE_ACCENTS.emerald,
      },
    ],
  },
];

export const TRANSPORT_TILES: TransportTile[] = TRANSPORT_BANDS.flatMap(
  (b) => b.tiles,
);
