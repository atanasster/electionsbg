// Околна среда (МОСВ) tools — the chat surface for the /sector/environment pack. The
// МОСВ group's procurement is served live from Postgres (the same awarder-group-model
// the dashboard uses); the EU-funds absorption and the recycling outcome come from the
// small committed JSON the dashboard reads.
//
//   environmentSpending — group procurement by universe (ministry/agency/fund/parks/
//                         basin/riosv/meteo) + what it buys + competition. The signature
//                         fact: ИАОС (the air-monitoring agency) is nearly the ministry's size.
//   environmentFunds    — ОП „Околна среда" absorption (contracted vs paid) by OP code.
//   wasteRecycling      — municipal-recycling rate vs the EU 55%/65% targets (Eurostat).
//
// Every fact goes through ctx.lang and the tool never computes prose numbers — narrate()
// reads env.facts. Air is a SEPARATE tool (airQuality, place-based) — not here. Mirrors
// the transport tools' Envelope shape.

import { fetchDb, fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import type { Envelope, Row, ToolArgs, ToolContext } from "./types";
import type { GroupModelPayload } from "@/lib/awarderModel";
import {
  buildEnvironmentModelFromAggregates,
  categoryLabel,
} from "@/lib/environmentAttributes";
import {
  ENV_SECTOR_EIKS,
  ENV_UNIVERSES,
  ENV_FUND_PROGRAM_CODES,
  IAOS_EIK,
  envUniverseLabel,
  envUniverseOf,
  type EnvUniverse,
} from "@/lib/environmentReferenceData";

const pct = (share: number | null, lang: "bg" | "en"): string =>
  fmtPct(share == null ? null : Math.round(share * 100), lang);

// "Къде отиват парите за околна среда?" — the МОСВ group's procurement folded by
// universe + function, the chat analog of the /sector/environment pack.
export const environmentSpending = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const payload = await fetchDb<GroupModelPayload>("awarder-group-model", {
    eiks: ENV_SECTOR_EIKS.join(","),
  });
  const m = buildEnvironmentModelFromAggregates(payload);

  const byUni = new Map<EnvUniverse, number>();
  let iaosEur = 0;
  for (const u of payload.byUnit) {
    if (u.eik === IAOS_EIK) iaosEur += u.totalEur;
    const uni = envUniverseOf(u.eik);
    if (!uni) continue;
    byUni.set(uni, (byUni.get(uni) ?? 0) + u.totalEur);
  }
  const total = m.totalEur;
  const uniRows = ENV_UNIVERSES.map((uni) => ({
    uni,
    eur: byUni.get(uni) ?? 0,
  })).filter((r) => r.eur > 0);
  uniRows.sort((a, b) => b.eur - a.eur);

  const rows: Row[] = uniRows.map((r) => ({
    universe: envUniverseLabel(r.uni, ctx.lang),
    amount: fmtEurCompact(r.eur, ctx.lang),
    share: total > 0 ? pct(r.eur / total, ctx.lang) : "—",
  }));

  const topUni = uniRows[0];
  const topCat = [...m.categories]
    .filter((c) => c.id !== "other" && c.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur)[0];
  const topCon = m.suppliers[0];

  return {
    tool: "environmentSpending",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Околна среда — държавната група (МОСВ, ИАОС, ПУДООС, паркове)"
      : "Environment — the state group (МОСВ, ИАОС, ПУДООС, parks)",
    subtitle: bg
      ? "Обществени поръчки по структура (АОП/ЦАИС). Горите (МЗХ) и ВиК са отделни сектори."
      : "Procurement by unit (AOP/ЦАИС). Forestry (МЗХ) and ВиК are separate sectors.",
    columns: [
      { key: "universe", label: bg ? "Структура" : "Unit type" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      total_value: fmtEurCompact(total, ctx.lang),
      contracts: fmtInt(m.contractCount, ctx.lang),
      iaos_share: total > 0 ? pct(iaosEur / total, ctx.lang) : "—",
      top_unit: topUni
        ? `${envUniverseLabel(topUni.uni, ctx.lang)} (${fmtEurCompact(topUni.eur, ctx.lang)})`
        : "—",
      top_function: topCat
        ? `${categoryLabel(topCat.id, ctx.lang)} (${fmtEurCompact(topCat.totalEur, ctx.lang)})`
        : "—",
      single_bid_share: pct(m.singleBidShare, ctx.lang),
      direct_award_share: pct(m.directShare, ctx.lang),
      top_contractor: topCon
        ? `${topCon.name} (${fmtEurCompact(topCon.totalEur, ctx.lang)})`
        : "—",
      note: bg
        ? "ИАОС — агенцията, която мери въздуха — сама е сред най-големите възложители, почти колкото цялото министерство."
        : "ИАОС — the agency that measures the air — is itself one of the largest buyers, nearly the size of the whole ministry.",
    },
    provenance: ["db:awarder-group-model"],
  };
};

interface AbsorptionFile {
  byProgramme?: {
    programCode: string;
    programName: string;
    period: string;
    contractedEur: number;
    paidEur: number;
    absorptionPct: number;
    contractCount: number;
  }[];
}

// "Колко европейски пари усвоява околната среда?" — the ОП „Околна среда" absorption:
// contracted vs actually paid, joined by OP code (the two programme periods + the
// EEA/Norway grants). The signature contrast: 2014-20 closed ~95%, 2021-27 near ~18%.
export const environmentFunds = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const file = await fetchData<AbsorptionFile>(
    "/funds/derived/absorption.json",
  );
  const codes = new Set<string>(ENV_FUND_PROGRAM_CODES);
  const progs = (file.byProgramme ?? [])
    .filter((p) => codes.has(p.programCode) && p.contractedEur > 0)
    .sort((a, b) => b.contractedEur - a.contractedEur);

  const contracted = progs.reduce((s, p) => s + p.contractedEur, 0);
  const paid = progs.reduce((s, p) => s + p.paidEur, 0);
  const absorption = contracted > 0 ? paid / contracted : 0;

  const rows: Row[] = progs.map((p) => ({
    programme: p.programName,
    period: p.period,
    contracted: fmtEurCompact(p.contractedEur, ctx.lang),
    absorbed: pct(
      p.contractedEur > 0 ? p.paidEur / p.contractedEur : 0,
      ctx.lang,
    ),
  }));

  const opOld = progs.find((p) => p.programCode === "2014BG16M1OP002");
  const opNew = progs.find((p) => p.programCode === "2021BG16FFPR002");
  const absOf = (p?: { paidEur: number; contractedEur: number }) =>
    p && p.contractedEur > 0 ? pct(p.paidEur / p.contractedEur, ctx.lang) : "—";

  return {
    tool: "environmentFunds",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Европейски средства за околна среда (ИСУН)"
      : "EU funds for the environment (ИСУН)",
    subtitle: bg
      ? "Договорени срещу реално изплатени (усвояване), по програма"
      : "Contracted vs actually paid (absorption), by programme",
    columns: [
      { key: "programme", label: bg ? "Програма" : "Programme" },
      { key: "period", label: bg ? "Период" : "Period" },
      {
        key: "contracted",
        label: bg ? "Договорени" : "Contracted",
        numeric: true,
      },
      { key: "absorbed", label: bg ? "Усвоени" : "Absorbed", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      total_contracted: fmtEurCompact(contracted, ctx.lang),
      total_paid: fmtEurCompact(paid, ctx.lang),
      absorption: pct(absorption, ctx.lang),
      opos_2014_20: opOld
        ? `${fmtEurCompact(opOld.contractedEur, ctx.lang)}, ${absOf(opOld)}`
        : "—",
      pos_2021_27: opNew
        ? `${fmtEurCompact(opNew.contractedEur, ctx.lang)}, ${absOf(opNew)}`
        : "—",
      note: bg
        ? "Сумите са за целия програмен период (ОП/Програма „Околна среда“), не по избран парламент. Водният цикъл се брои и в изгледа „Води“."
        : "Figures are programme-period totals (ОП/Programme „Околна среда“), not scoped to a parliament. The water-cycle also appears in the Water view.",
    },
    provenance: ["funds/derived/absorption.json (ИСУН)"],
  };
};

interface WastePoint {
  year: number;
  value: number;
}
interface WasteFile {
  targets: { y2025: number; y2035: number };
  recyclingRate: { byGeo: Record<string, WastePoint[]> };
  wastePerCapita: { byGeo: Record<string, WastePoint[]> };
}

// "Колко рециклира България?" — the municipal-recycling rate against the EU 2025 (55%)
// and 2035 (65%) targets. BG peaked ~35% (2020) then fell to ~17% (2023) — far below.
export const wasteRecycling = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const file = await fetchData<WasteFile>("/environment/waste.json");
  const bgSeries = file.recyclingRate.byGeo.BG ?? [];
  const euSeries = file.recyclingRate.byGeo.EU27_2020 ?? [];
  const latest = bgSeries[bgSeries.length - 1];
  const euLatest = euSeries[euSeries.length - 1];
  const perCapita = file.wastePerCapita.byGeo.BG ?? [];
  const perCapitaLatest = perCapita[perCapita.length - 1];
  const target = file.targets.y2025;
  const gap = latest ? target - latest.value : null;

  return {
    tool: "wasteRecycling",
    domain: "indicators",
    kind: "series",
    title: bg
      ? "Рециклиране на битови отпадъци — спрямо целта на ЕС"
      : "Municipal waste recycling — vs the EU target",
    viz: "line",
    value: latest?.value ?? 0,
    categories: bgSeries.map((p) => p.year),
    series: [
      {
        key: "recycling",
        label: bg ? "Степен на рециклиране, %" : "Recycling rate, %",
        points: bgSeries.map((p) => ({ x: p.year, y: p.value })),
      },
    ],
    facts: {
      latest_year: String(latest?.year ?? "—"),
      recycling_rate: latest ? `${latest.value}%` : "—",
      eu_target_2025: `${file.targets.y2025}%`,
      eu_target_2035: `${file.targets.y2035}%`,
      gap_to_target:
        gap != null && gap > 0
          ? bg
            ? `${Math.round(gap)} пункта под целта`
            : `${Math.round(gap)} pts below target`
          : bg
            ? "на или над целта"
            : "at or above target",
      eu_average: euLatest ? `${euLatest.value}%` : "—",
      waste_per_capita: perCapitaLatest
        ? bg
          ? `${perCapitaLatest.value} кг/човек (${perCapitaLatest.year})`
          : `${perCapitaLatest.value} kg/capita (${perCapitaLatest.year})`
        : "—",
      note: bg
        ? "Целите са по Рамковата директива за отпадъците (2018/851). Показва резултат, не разход."
        : "Targets per the Waste Framework Directive (2018/851). An outcome, not a spend figure.",
    },
    provenance: ["environment/waste.json (Eurostat cei_wm011 / env_wasmun)"],
  };
};
