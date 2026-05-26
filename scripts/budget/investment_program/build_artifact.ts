// Builds data/budget/investment_program/{year}.json artifacts from the
// parsed annex. Joins each project's municipality name to canonical EKATTE +
// oblast code via the existing municipality_lookup helper, classifies by
// project type (regex on the name), and emits both the full project list
// and pre-aggregated rollups for the Sankey drilldown.

import { toEur } from "../../../src/lib/currency";
import type { Money } from "../types";
import {
  resolveMunicipality,
  type MunicipalityRecord,
} from "../lib/municipality_lookup";
import {
  classifyProject,
  type InvestmentCategory,
  type ParsedInvestmentAnnex,
  type ParsedInvestmentProject,
} from "./parse_annex_pdf";

export interface InvestmentProjectRow {
  projectId: string;
  name: string;
  category: InvestmentCategory;
  municipalityNameBg: string | null;
  ekatte: string | null;
  obshtinaCode: string | null;
  oblastCode: string | null;
  oblastNameBg: string | null;
  cost: Money;
}

export interface InvestmentRollupRow {
  key: string; // oblastCode or category id
  labelBg: string;
  labelEn: string;
  count: number;
  total: Money;
}

export interface InvestmentProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: { documentId: string; url: string };
  projectCount: number;
  grandTotal: Money;
  byOblast: InvestmentRollupRow[];
  byCategory: InvestmentRollupRow[];
  // Top-50 projects by cost — drives the drilldown's top-list. The full
  // 3000-row list is dropped from the artifact to keep it small (the
  // dashboard tile doesn't need every row; a separate per-oblast shard
  // could deliver them per-page if needed).
  topProjects: InvestmentProjectRow[];
}

const sumMoney = (values: Money[]): Money => {
  let amount = 0;
  for (const v of values) amount += v.amount;
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency: "BGN",
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

const CATEGORY_LABELS: Record<InvestmentCategory, { bg: string; en: string }> =
  {
    roads: { bg: "Пътища и улици", en: "Roads & streets" },
    water_sewage: { bg: "ВиК и пречистване", en: "Water & sewage" },
    education: { bg: "Образование", en: "Education" },
    social: { bg: "Здравеопазване и социални", en: "Health & social" },
    sports: { bg: "Спорт", en: "Sports" },
    culture: { bg: "Култура", en: "Culture" },
    buildings: { bg: "Сгради и саниране", en: "Buildings" },
    energy: { bg: "Енергия", en: "Energy" },
    other: { bg: "Други", en: "Other" },
  };

// Same oblast-name → 3-letter code map used by the municipal-transfers
// builder. Duplicated here to keep the investment-program module independent.
const OBLAST_NAME_TO_CODE: Record<string, string> = {
  Благоевград: "BLG",
  Бургас: "BGS",
  Варна: "VAR",
  "Велико Търново": "VTR",
  Видин: "VID",
  Враца: "VRC",
  Габрово: "GAB",
  Добрич: "DOB",
  Кърджали: "KRZ",
  Кюстендил: "KNL",
  Ловеч: "LOV",
  Монтана: "MON",
  Пазарджик: "PAZ",
  Перник: "PER",
  Плевен: "PVN",
  Пловдив: "PDV",
  Разград: "RAZ",
  Русе: "RSE",
  Силистра: "SLS",
  Сливен: "SLV",
  Смолян: "SML",
  Софийска: "SFO",
  "Стара Загора": "SZR",
  Търговище: "TGV",
  Хасково: "HKV",
  Шумен: "SHU",
  Ямбол: "JAM",
  "София-град": "SOF",
};

const OBLAST_NAME_BG: Record<string, string> = Object.fromEntries(
  Object.entries(OBLAST_NAME_TO_CODE).map(([name, code]) => [code, name]),
);

// Map "Софийска" (the law's adjectival form for the surrounding Sofia oblast)
// to canonical "Софийска" / SFO; "София-град" to SOF.
const oblastNameToCode = (name: string | null): string | null => {
  if (!name) return null;
  const trimmed = name.trim();
  return OBLAST_NAME_TO_CODE[trimmed] ?? null;
};

const joinMunicipality = (
  project: ParsedInvestmentProject,
): {
  ekatte: string | null;
  obshtinaCode: string | null;
  oblastCode: string | null;
} => {
  if (!project.municipalityName) {
    return { ekatte: null, obshtinaCode: null, oblastCode: null };
  }
  const oblastCode = oblastNameToCode(project.oblastName);
  const muni: MunicipalityRecord | null = resolveMunicipality(
    project.municipalityName,
    oblastCode,
  );
  if (!muni) {
    // Oblast code already known even when the muni didn't resolve — still
    // emit it so the by-oblast rollup catches the spending.
    return { ekatte: null, obshtinaCode: null, oblastCode };
  }
  return {
    ekatte: muni.ekatte,
    obshtinaCode: muni.obshtinaCode,
    oblastCode: muni.oblastCode,
  };
};

export const buildInvestmentProgramFile = (
  parsed: ParsedInvestmentAnnex,
  source: { documentId: string; url: string },
): InvestmentProgramFile => {
  const rows: InvestmentProjectRow[] = parsed.projects.map((p) => {
    const j = joinMunicipality(p);
    return {
      projectId: p.projectId,
      name: p.name,
      category: classifyProject(p.name),
      municipalityNameBg: p.municipalityName,
      ekatte: j.ekatte,
      obshtinaCode: j.obshtinaCode,
      oblastCode: j.oblastCode,
      oblastNameBg: p.oblastName,
      cost: p.cost,
    };
  });

  // Oblast rollup
  const byOblastMap = new Map<string, InvestmentProjectRow[]>();
  for (const r of rows) {
    const k = r.oblastCode ?? "_unresolved";
    const list = byOblastMap.get(k) ?? [];
    list.push(r);
    byOblastMap.set(k, list);
  }
  const byOblast: InvestmentRollupRow[] = [...byOblastMap.entries()]
    .map(([code, list]) => ({
      key: code,
      labelBg: OBLAST_NAME_BG[code] ?? code,
      labelEn: code,
      count: list.length,
      total: sumMoney(list.map((r) => r.cost)),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  // Category rollup
  const byCategoryMap = new Map<InvestmentCategory, InvestmentProjectRow[]>();
  for (const r of rows) {
    const list = byCategoryMap.get(r.category) ?? [];
    list.push(r);
    byCategoryMap.set(r.category, list);
  }
  const byCategory: InvestmentRollupRow[] = [...byCategoryMap.entries()]
    .map(([cat, list]) => ({
      key: cat,
      labelBg: CATEGORY_LABELS[cat].bg,
      labelEn: CATEGORY_LABELS[cat].en,
      count: list.length,
      total: sumMoney(list.map((r) => r.cost)),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  // Top-50 by cost
  const topProjects = [...rows]
    .sort((a, b) => b.cost.amountEur - a.cost.amountEur)
    .slice(0, 50);

  return {
    fiscalYear: parsed.fiscalYear,
    generatedAt: new Date().toISOString(),
    source,
    projectCount: rows.length,
    grandTotal: sumMoney(rows.map((r) => r.cost)),
    byOblast,
    byCategory,
    topProjects,
  };
};
