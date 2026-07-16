// Държавна администрация tool (the /sector/administration view). Reads the
// committed artifacts behind the dashboard — the annual Доклад aggregates
// (/budget/personnel.json), the e-government adoption vs the EU
// (/administration/egov.json), the service-quality signals
// (/administration/service_quality.json), the services-register totals
// (/administration/services_overview.json) and COFOG GF01 (/cofog.json) — and
// returns one headline table. Envelope shape mirrors the fiscal tools; every
// fact goes through ctx.lang.

import { fetchData } from "./dataClient";
import { fmtInt, fmtPct } from "./format";
import type { Envelope, ToolArgs, ToolContext } from "./types";

// ---- mirrored shapes (ai/ cannot import from src/) ---------------------------
type DokladData = {
  year: number;
  positions: {
    total: number;
    filled: number | null;
    vacant: number | null;
  };
  structureCounts: {
    central: Record<string, number>;
    territorial: Record<string, number>;
  };
};
type PersonnelFile = { national: Record<string, DokladData> };

type EgovPoint = { year: number; value: number };
type EgovPayload = { latestYear: number; byGeo: Record<string, EgovPoint[]> };

type ServiceQualityPayload = {
  latestYear: number | null;
  byYear: Record<string, { signals: number | null; proposals: number | null }>;
};

type ServicesOverview = {
  total: number;
  byTier: Array<{ key: string; bg: string; en: string; count: number }>;
};

type CofogData = {
  peers?: Record<
    string,
    {
      bgPctGdp: number;
      euAvgPctGdp: number | null;
      rank: number;
      total: number;
    }
  >;
};

const sumCounts = (r: Record<string, number>): number =>
  Object.values(r).reduce((a, b) => a + b, 0);

// State-administration overview: size, cost, service quality and the EU digital
// gap in one card. Cues: администрация / държавна администрация / чиновници /
// щат / електронно управление / е-услуги / брой служители.
export const administrationOverview = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const [personnel, egov, quality, services, cofog] = await Promise.all([
    fetchData<PersonnelFile>("/budget/personnel.json"),
    fetchData<EgovPayload>("/administration/egov.json").catch(() => null),
    fetchData<ServiceQualityPayload>(
      "/administration/service_quality.json",
    ).catch(() => null),
    fetchData<ServicesOverview>("/administration/services_overview.json").catch(
      () => null,
    ),
    fetchData<CofogData>("/cofog.json").catch(() => null),
  ]);

  const years = Object.keys(personnel.national)
    .map(Number)
    .sort((a, b) => b - a);
  const latestYear = years[0];
  const nat = personnel.national[String(latestYear)];
  const structures =
    sumCounts(nat.structureCounts.central) +
    sumCounts(nat.structureCounts.territorial);

  const rows: Array<Record<string, string | number | null>> = [
    {
      metric: bg ? "Щатна численост" : "Positions",
      value: fmtInt(nat.positions.total, ctx.lang),
    },
    {
      metric: bg ? "Административни структури" : "Administrative structures",
      value: fmtInt(structures, ctx.lang),
    },
  ];
  if (nat.positions.vacant != null && nat.positions.filled != null) {
    rows.push({
      metric: bg ? "Незаети щатове" : "Vacant positions",
      value: `${fmtInt(nat.positions.vacant, ctx.lang)} (${fmtPct(
        Math.round(
          (nat.positions.vacant /
            (nat.positions.vacant + nat.positions.filled)) *
            1000,
        ) / 10,
        ctx.lang,
      )})`,
    });
  }
  const gf01 = cofog?.peers?.GF01;
  if (gf01) {
    rows.push({
      metric: bg
        ? "Общи държавни служби (% от БВП)"
        : "General public services (% of GDP)",
      value: bg
        ? `${gf01.bgPctGdp}% · ${gf01.rank}-а от ${gf01.total} в ЕС`
        : `${gf01.bgPctGdp}% · ${gf01.rank} of ${gf01.total} in the EU`,
    });
  }
  const svc = services?.total;
  if (svc) {
    rows.push({
      metric: bg ? "Административни услуги" : "Administrative services",
      value: fmtInt(svc, ctx.lang),
    });
  }
  if (quality?.latestYear != null) {
    const q = quality.byYear[String(quality.latestYear)];
    if (q?.signals != null) {
      rows.push({
        metric: bg
          ? `Сигнали за обслужването (${quality.latestYear})`
          : `Service signals (${quality.latestYear})`,
        value: fmtInt(q.signals, ctx.lang),
      });
    }
  }
  if (egov) {
    const bgV = egov.byGeo.BG?.find((p) => p.year === egov.latestYear)?.value;
    const euV = egov.byGeo.EU27_2020?.find(
      (p) => p.year === egov.latestYear,
    )?.value;
    if (bgV != null) {
      rows.push({
        metric: bg
          ? `Използване на е-управление (${egov.latestYear})`
          : `e-Government use (${egov.latestYear})`,
        value:
          euV != null
            ? bg
              ? `${bgV.toFixed(1)}% (ЕС: ${euV.toFixed(1)}%)`
              : `${bgV.toFixed(1)}% (EU: ${euV.toFixed(1)}%)`
            : `${bgV.toFixed(1)}%`,
      });
    }
  }

  return {
    tool: "administrationOverview",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Държавна администрация — преглед (${latestYear})`
      : `State administration — overview (${latestYear})`,
    viz: "none",
    columns: [
      { key: "metric", label: bg ? "Показател" : "Metric" },
      { key: "value", label: bg ? "Стойност" : "Value" },
    ],
    rows,
    facts: {
      positions: nat.positions.total,
      structures,
      ...(svc ? { services: svc } : {}),
    },
    provenance: [
      "budget/personnel.json",
      "administration/egov.json",
      "administration/service_quality.json",
      "administration/services_overview.json",
      "cofog.json",
    ],
  };
};

// ---- citizen digital skills (Eurostat isoc_sk_dskl_i21) ---------------------
type DskPoint = { year: number; value: number };
type DskArea = {
  code: string;
  labelBg: string;
  labelEn: string;
  bgValue: number | null;
  euValue: number | null;
};
type EuRank = { rank: number; total: number; isLast: boolean };
type DigitalSkillsPayload = {
  latestYear: number;
  rank: EuRank | null;
  atLeastBasic: Record<string, DskPoint[]>;
  areas: DskArea[];
  youth: {
    latestYear: number;
    byGeo: Record<string, number>;
    rank: EuRank | null;
    bg: { total: number | null; male: number | null; female: number | null };
  };
};

// "26th of 27" / "last in the EU" from a computed rank (never hard-coded).
const rankPhrase = (r: EuRank | null | undefined, bg: boolean): string => {
  if (!r) return "";
  if (r.isLast) return bg ? "последна в ЕС" : "last in the EU";
  return bg ? `${r.rank}-а от ${r.total}` : `${r.rank}th of ${r.total}`;
};

// Citizen digital skills — BG vs the EU on "at least basic digital skills", the
// demand-side companion to e-government use. Cues: дигитални умения / цифрови
// умения / компютърна грамотност / digital skills / DESI.
export const digitalSkills = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchData<DigitalSkillsPayload>(
    "/administration/digital_skills.json",
  );

  const yr = d.latestYear;
  const at = (geo: string) =>
    d.atLeastBasic[geo]?.find((p) => p.year === yr)?.value ?? null;
  const bgV = at("BG");
  const euV = at("EU27_2020");
  const youth = d.youth;
  const yBg = youth.byGeo.BG ?? null;
  const yEu = youth.byGeo.EU27_2020 ?? null;

  const headlineRank = rankPhrase(d.rank, bg);
  const youthRankLabel = rankPhrase(youth.rank, bg);

  const rows: Array<Record<string, string | number | null>> = [];
  if (bgV != null) {
    const suffix = headlineRank ? ` · ${headlineRank}` : "";
    rows.push({
      metric: bg
        ? `Поне базови дигитални умения (${yr})`
        : `At least basic digital skills (${yr})`,
      value:
        euV != null
          ? bg
            ? `${bgV.toFixed(0)}% (ЕС: ${euV.toFixed(0)}%)${suffix}`
            : `${bgV.toFixed(0)}% (EU: ${euV.toFixed(0)}%)${suffix}`
          : `${bgV.toFixed(0)}%`,
    });
  }
  if (yBg != null) {
    const suffix = youthRankLabel ? ` — ${youthRankLabel}` : "";
    rows.push({
      metric: bg
        ? `Младежи 16-24 г. (${youth.latestYear})`
        : `Young people 16-24 (${youth.latestYear})`,
      value:
        yEu != null
          ? bg
            ? `${yBg.toFixed(0)}%${suffix} (ЕС: ${yEu.toFixed(0)}%)`
            : `${yBg.toFixed(0)}%${suffix} (EU: ${yEu.toFixed(0)}%)`
          : `${yBg.toFixed(0)}%`,
    });
  }
  if (youth.bg.male != null && youth.bg.female != null) {
    rows.push({
      metric: bg ? "Младежи по пол (жени/мъже)" : "Youth by sex (women/men)",
      value: `${youth.bg.female.toFixed(0)}% / ${youth.bg.male.toFixed(0)}%`,
    });
  }
  // Weakest area (largest gap to the EU).
  const gap = d.areas
    .filter((a) => a.bgValue != null && a.euValue != null)
    .map((a) => ({ a, g: (a.euValue as number) - (a.bgValue as number) }))
    .sort((x, y) => y.g - x.g)[0];
  if (gap) {
    rows.push({
      metric: bg ? "Най-голямо изоставане" : "Widest gap to the EU",
      value: bg
        ? `${gap.a.labelBg}: ${(gap.a.bgValue as number).toFixed(0)}% срещу ${(gap.a.euValue as number).toFixed(0)}% в ЕС`
        : `${gap.a.labelEn}: ${(gap.a.bgValue as number).toFixed(0)}% vs ${(gap.a.euValue as number).toFixed(0)}% in the EU`,
    });
  }

  return {
    tool: "digitalSkills",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Дигитални умения на гражданите — България спрямо ЕС (${yr})`
      : `Citizen digital skills — Bulgaria vs the EU (${yr})`,
    viz: "none",
    columns: [
      { key: "metric", label: bg ? "Показател" : "Metric" },
      { key: "value", label: bg ? "Стойност" : "Value" },
    ],
    rows,
    facts: {
      ...(bgV != null ? { bgAtLeastBasic: bgV } : {}),
      ...(euV != null ? { euAtLeastBasic: euV } : {}),
      ...(d.rank ? { rank: d.rank.rank, total: d.rank.total } : {}),
      ...(yBg != null ? { youthBg: yBg } : {}),
      ...(yEu != null ? { youthEu: yEu } : {}),
      ...(youth.rank ? { youthRank: youth.rank.rank } : {}),
      target2030: 80,
    },
    provenance: ["administration/digital_skills.json"],
  };
};
