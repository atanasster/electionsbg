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
  // ── Hydro (НЕК cascade) ──────────────────────────────────────────────────
  {
    id: "nek-hydro",
    name: { bg: "НЕК — водни каскади (31 ВЕЦ/ПАВЕЦ)", en: "NEK — hydro cascade (31 plants)" }, // prettier-ignore
    fuel: "hydro",
    capacityMw: 2740,
    owner: { bg: "Национална електрическа компания (БЕХ)", en: "National Electric Company (BEH)" }, // prettier-ignore
    ownership: "state",
    eik: "000649348",
    isAwarder: true,
    status: "operating",
    note: { bg: "Най-голяма е ПАВЕЦ „Чаира“ (864 MW) — извън строя след авария от 2022 г.", en: "The largest is the Chaira PSPP (864 MW) — offline since a 2022 accident." }, // prettier-ignore
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
  // ── Renewables (aggregate — many small, mostly private/distributed) ───────
  {
    id: "wind-fleet",
    name: { bg: "Вятърни паркове (общо)", en: "Wind farms (total)" },
    fuel: "wind",
    capacityMw: 700,
    owner: { bg: "предимно частни", en: "mostly private" },
    ownership: "private",
    status: "operating",
    note: { bg: "Най-голям е АЕС „Свети Никола“ (Калиакра, 156 MW).", en: "The largest is AES St. Nikola (Kaliakra, 156 MW)." }, // prettier-ignore
  },
  {
    id: "solar-fleet",
    name: { bg: "Соларни паркове (общо)", en: "Solar farms (total)" },
    fuel: "solar",
    capacityMw: 3000,
    owner: {
      bg: "предимно частни/разпределени",
      en: "mostly private/distributed",
    },
    ownership: "private",
    status: "operating",
    note: { bg: "Бум след 2022 г. — вече ~18% от производството на ток (2025).", en: "A post-2022 boom — already ~18% of generation (2025)." }, // prettier-ignore
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
