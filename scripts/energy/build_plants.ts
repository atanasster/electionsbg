/**
 * Bulgaria's power-plant fleet — the asset-level tracker behind the /sector/energy
 * "Електроцентрали" tile. Answers "which plants generate the country's power, who
 * owns them, and when do they retire" — the physical companion to the БЕХ
 * procurement pack (which lists only the STATE awarders) and the national Ember
 * generation mix (which has no per-plant detail).
 *
 *   npx tsx scripts/energy/build_plants.ts   → data/energy/plants.json
 *
 * CURATED, not auto-fetched (the defense/programs.json pattern): Global Energy
 * Monitor's per-plant data (gem.wiki / Global Integrated Power Tracker) is
 * CC-BY but gated behind registration, so the ~14 significant Bulgarian plants
 * are curated here from GEM + Wikipedia + our own contracts corpus (EIKs) + the
 * ownership research. Capacities are installed MW (GEM). `eik` cross-links to the
 * operator's page where it exists in our data. Aggregate rows (wind/solar/the
 * 31-plant НЕК hydro cascade) carry no single EIK.
 *
 * ⚠ Ownership is the point: state (БЕХ) vs the private lignite fleet (AES,
 * ContourGlobal) vs the opaque Kovachki plants (Брикел/Бобов дол, nominally owned
 * through Cyprus shells — the ACF/BIRD "secret energy cartel"). Update on a plant
 * open/close, an ownership change, or a GEM/strategy release.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PowerPlant } from "../../src/data/energy/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../data/energy/plants.json");

const PLANTS: PowerPlant[] = [
  // ── Nuclear ──────────────────────────────────────────────────────────────
  {
    id: "kozloduy-5-6",
    name: { bg: "АЕЦ Козлодуй (блокове 5 и 6)", en: "Kozloduy NPP (units 5 & 6)" }, // prettier-ignore
    fuel: "nuclear",
    capacityMw: 2006,
    owner: { bg: "АЕЦ Козлодуй ЕАД (БЕХ)", en: "Kozloduy NPP EAD (BEH)" },
    ownership: "state",
    eik: "106513772",
    isAwarder: true,
    commissioned: 1987,
    status: "operating",
    note: { bg: "Двата действащи ВВЕР-1000 реактора — ~⅓ от тока в страната.", en: "The two operating VVER-1000 reactors — ~⅓ of the country's electricity." }, // prettier-ignore
  },
  {
    id: "kozloduy-7-8",
    name: { bg: "АЕЦ Козлодуй 7 и 8 (AP1000)", en: "Kozloduy 7 & 8 (AP1000)" },
    fuel: "nuclear",
    capacityMw: 2300,
    owner: { bg: "АЕЦ Козлодуй – Нови мощности ЕАД", en: "Kozloduy NPP – New Build EAD" }, // prettier-ignore
    ownership: "state",
    eik: "202671079",
    status: "planned",
    note: { bg: "Планирани нови мощности (Westinghouse AP1000), ~14 млрд. €. Възлагат се извън ЦАИС.", en: "Planned new units (Westinghouse AP1000), ~€14bn. Procured outside ЦАИС." }, // prettier-ignore
  },
  // ── Coal / lignite (the Марица изток complex + the private fleet) ─────────
  {
    id: "maritsa-iztok-2",
    name: { bg: "ТЕЦ Марица изток 2", en: "Maritsa East 2 TPP" },
    fuel: "coal",
    capacityMw: 1620,
    owner: {
      bg: "ТЕЦ Марица изток 2 ЕАД (БЕХ)",
      en: "Maritsa East 2 EAD (BEH)",
    },
    ownership: "state",
    eik: "123531939",
    isAwarder: true,
    retire: 2038,
    status: "retiring",
    note: { bg: "Най-голямата държавна ТЕЦ. Захранва се от Мини „Марица-изток“.", en: "The largest state coal plant. Fed by the Mini Maritsa-Iztok lignite mines." }, // prettier-ignore
  },
  {
    id: "maritsa-iztok-3",
    name: { bg: "КонтурГлобал Марица изток 3", en: "ContourGlobal Maritsa East 3" }, // prettier-ignore
    fuel: "coal",
    capacityMw: 908,
    owner: { bg: "73% ContourGlobal (KKR) / 27% НЕК", en: "73% ContourGlobal (KKR) / 27% NEK" }, // prettier-ignore
    ownership: "jv",
    eik: "130020522",
    isAwarder: true,
    retire: 2038,
    status: "retiring",
    note: { bg: "НЕК държи 27% (държавен дял). Обявена продажба на „Номад Енерджи“ (2026).", en: "NEK holds 27% (state stake). Announced sale to 'Nomad Energy' (2026)." }, // prettier-ignore
  },
  {
    id: "aes-galabovo",
    name: { bg: "AES Гълъбово (Марица изток 1)", en: "AES Galabovo (Maritsa East 1)" }, // prettier-ignore
    fuel: "coal",
    capacityMw: 690,
    owner: { bg: "AES (→ BlackRock/GIP)", en: "AES (→ BlackRock/GIP)" },
    ownership: "private",
    eik: "123533834",
    commissioned: 2011,
    status: "operating",
    note: { bg: "Частна, с дългосрочен договор с НЕК. Най-новата въглищна централа.", en: "Private, on a long-term PPA with NEK. The newest coal plant." }, // prettier-ignore
  },
  {
    id: "bobov-dol",
    name: { bg: "ТЕЦ Бобов дол", en: "Bobov Dol TPP" },
    fuel: "coal",
    capacityMw: 630,
    owner: { bg: "непрозрачна (свързва се с Х. Ковачки)", en: "opaque (linked to H. Kovachki)" }, // prettier-ignore
    ownership: "private",
    eik: "109513731",
    status: "operating",
    note: { bg: "Собственост през офшорни дружества; разследвана от АКФ/BIRD („енергийният картел“).", en: "Owned via offshore shells; probed by ACF/BIRD (the 'energy cartel')." }, // prettier-ignore
  },
  {
    id: "brikel",
    name: { bg: "Брикел (Гълъбово)", en: "Brikel (Galabovo)" },
    fuel: "coal",
    capacityMw: 200,
    owner: { bg: "Bakkar Ltd (Кипър); свързва се с Х. Ковачки", en: "Bakkar Ltd (Cyprus); linked to H. Kovachki" }, // prettier-ignore
    ownership: "private",
    eik: "123526494",
    status: "operating",
  },
  {
    id: "maritsa-3",
    name: {
      bg: "ТЕЦ Марица 3 (Димитровград)",
      en: "Maritsa 3 TPP (Dimitrovgrad)",
    },
    fuel: "coal",
    capacityMw: 120,
    owner: { bg: "частна", en: "private" },
    ownership: "private",
    eik: "126526421",
    status: "operating",
  },
  // ── Hydro — the НЕК cascades (all state; ~2.7 GW over 31 plants) ──────────
  {
    id: "hydro-belmeken",
    name: { bg: "Каскада „Белмекен–Сестримо–Чаира“", en: "Belmeken–Sestrimo–Chaira cascade" }, // prettier-ignore
    fuel: "hydro",
    capacityMw: 1599,
    owner: { bg: "НЕК (БЕХ)", en: "NEK (BEH)" },
    ownership: "state",
    eik: "000649348",
    isAwarder: true,
    status: "operating",
    note: { bg: "Включва ПАВЕЦ „Чаира“ (864 MW) — извън строя след авария от 2022 г.", en: "Includes the Chaira PSPP (864 MW) — offline since a 2022 accident." }, // prettier-ignore
  },
  {
    id: "hydro-dospat-vacha",
    name: { bg: "Каскада „Доспат–Въча“", en: "Dospat–Vacha cascade" },
    fuel: "hydro",
    capacityMw: 500,
    owner: { bg: "НЕК (БЕХ)", en: "NEK (BEH)" },
    ownership: "state",
    eik: "000649348",
    isAwarder: true,
    status: "operating",
  },
  {
    id: "hydro-arda",
    name: { bg: "Каскада „Арда“ (Кърджали, Ивайловград, Студен кладенец)", en: "Arda cascade" }, // prettier-ignore
    fuel: "hydro",
    capacityMw: 325,
    owner: { bg: "НЕК (БЕХ)", en: "NEK (BEH)" },
    ownership: "state",
    eik: "000649348",
    isAwarder: true,
    status: "operating",
  },
  {
    id: "hydro-batak",
    name: { bg: "Каскада „Баташки водносилов път“", en: "Batak cascade" },
    fuel: "hydro",
    capacityMw: 254,
    owner: { bg: "НЕК (БЕХ)", en: "NEK (BEH)" },
    ownership: "state",
    eik: "000649348",
    isAwarder: true,
    status: "operating",
  },
  // ── Gas ──────────────────────────────────────────────────────────────────
  {
    id: "tec-varna",
    name: { bg: "ТЕЦ Варна (Езерово)", en: "Varna TPP (Ezerovo)" },
    fuel: "gas",
    capacityMw: 1260,
    owner: { bg: "Сигда (частна)", en: "Sigda (private)" },
    ownership: "private",
    eik: "103551629",
    status: "operating",
    note: { bg: "Бивша държавна въглищна централа, преминала на газ; резерв за сигурност.", en: "A former state coal plant, converted to gas; a security reserve." }, // prettier-ignore
  },
  // ── Wind (private; ~0.7 GW) ──────────────────────────────────────────────
  {
    id: "wind-sveti-nikola",
    name: { bg: "Вятърен парк „Свети Никола“ (Каварна)", en: "St. Nikola wind farm (Kavarna)" }, // prettier-ignore
    fuel: "wind",
    capacityMw: 156,
    owner: { bg: "AES Гео Енерджи (частна)", en: "AES Geo Energy (private)" },
    ownership: "private",
    commissioned: 2010,
    status: "operating",
    note: { bg: "Най-големият вятърен парк в страната (52 турбини Vestas).", en: "The country's largest wind farm (52 Vestas turbines)." }, // prettier-ignore
  },
  {
    id: "wind-suvorovo",
    name: { bg: "Вятърен парк „Суворово“", en: "Suvorovo wind farm" },
    fuel: "wind",
    capacityMw: 60,
    owner: { bg: "MET Group (частна)", en: "MET Group (private)" },
    ownership: "private",
    status: "operating",
  },
  {
    id: "wind-other",
    name: { bg: "Други вятърни паркове", en: "Other wind farms" },
    fuel: "wind",
    capacityMw: 480,
    owner: { bg: "предимно частни", en: "mostly private" },
    ownership: "private",
    status: "operating",
  },
  // ── Solar (private/distributed; post-2022 boom, ~3 GW) ────────────────────
  {
    id: "solar-st-george",
    name: { bg: "ФЕЦ „Св. Георги“ (Силистра)", en: "St. George PV park (Silistra)" }, // prettier-ignore
    fuel: "solar",
    capacityMw: 229,
    owner: { bg: "Rezolv Energy (частна)", en: "Rezolv Energy (private)" },
    ownership: "private",
    commissioned: 2024,
    status: "operating",
  },
  {
    id: "solar-dalgo-pole",
    name: { bg: "ФЕЦ „Дълго поле“", en: "Dalgo Pole PV park" },
    fuel: "solar",
    capacityMw: 208,
    owner: { bg: "Sunterra/Galaxy Re (частна)", en: "Sunterra/Galaxy Re (private)" }, // prettier-ignore
    ownership: "private",
    status: "operating",
  },
  {
    id: "solar-apriltsi",
    name: { bg: "ФЕЦ „Априлци“", en: "Apriltsi PV park" },
    fuel: "solar",
    capacityMw: 184,
    owner: { bg: "частна", en: "private" },
    ownership: "private",
    status: "operating",
  },
  {
    id: "solar-verila",
    name: { bg: "ФЕЦ „Верила“ (Дупница)", en: "Verila PV park (Dupnitsa)" },
    fuel: "solar",
    capacityMw: 123,
    owner: { bg: "Eurohold (частна)", en: "Eurohold (private)" },
    ownership: "private",
    status: "operating",
  },
  {
    id: "solar-lovech",
    name: { bg: "ФЕЦ „Ловеч“", en: "Lovech PV park" },
    fuel: "solar",
    capacityMw: 106,
    owner: { bg: "частна", en: "private" },
    ownership: "private",
    status: "operating",
  },
  {
    id: "solar-other",
    name: { bg: "Други соларни паркове (разпределени)", en: "Other solar (distributed)" }, // prettier-ignore
    fuel: "solar",
    capacityMw: 1950,
    owner: { bg: "предимно частни", en: "mostly private" },
    ownership: "private",
    status: "operating",
    note: { bg: "Бум след 2022 г. — соларът вече е ~18% от производството (2025).", en: "A post-2022 boom — solar is already ~18% of generation (2025)." }, // prettier-ignore
  },
];

const out = {
  updated: process.env.INGEST_DATE ?? new Date().toISOString().slice(0, 10),
  source:
    "Curated from Global Energy Monitor + Wikipedia + the АОП contracts corpus (ownership research)",
  sourceUrl: "https://globalenergymonitor.org/projects/global-integrated-power-tracker/", // prettier-ignore
  coalExitYear: 2038,
  plants: PLANTS,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out) + "\n");

const byFuel = PLANTS.reduce<Record<string, number>>((a, p) => {
  a[p.fuel] = (a[p.fuel] ?? 0) + (p.capacityMw ?? 0);
  return a;
}, {});
const stateMw = PLANTS.filter((p) => p.ownership === "state").reduce(
  (a, p) => a + (p.capacityMw ?? 0),
  0,
);
const totalMw = PLANTS.reduce((a, p) => a + (p.capacityMw ?? 0), 0);
console.log(
  `energy/plants: ${PLANTS.length} plants → ${path.relative(process.cwd(), OUT)}`,
);
console.log(
  `  ~${totalMw} MW total; state ~${Math.round((stateMw / totalMw) * 100)}%; by fuel:`,
  byFuel,
);
