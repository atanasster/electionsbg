// НОИ „Брой на пенсионерите по териториални поделения на НОИ (средномесечен брой) - по години"
// (data.egov.bg dataset 10480, НОИ org 123): the average monthly number of pensioners each of
// НОИ's 28 territorial divisions (ТП) serves, by year from 2010.
//
// The crosswalk is EXPLICIT, one line per ТП, and checked against the published name — never a
// fuzzy name match. Three things it encodes:
//   * one ТП per oblast, so ТП ↔ oblast is 1:1;
//   * „София-град" (ТП 21) and „София-област" (ТП 22) are DIFFERENT units: the capital is
//     SOFIA_CITY and Софийска област is SFO, matching the canonical choropleth buckets in
//     src/lib/regionalOblast.ts — folding them would put 330k capital pensioners on the oblast;
//   * ТП 29 „Международни спогодби/договори" has NO territory — pensions paid under social-
//     security agreements, mostly abroad. It is kept as its own series and never placed on a map.
//
// A pensioner is counted where their pension is ADMINISTERED, which is usually but not always
// where they live.

import { OBLAST_NAME } from "../../../src/lib/regionalOblast";

export const NOI_TP_DATASET_ID = 10480;
export const NOI_TP_DATASET_URI = "3eab3ab2-80f2-4ef3-ab24-39658918c82f";

/** ТП number → [the name НОИ prints, the canonical oblast bucket]. */
export const TP_OBLAST: Readonly<Record<number, readonly [string, string]>> = {
  1: ["Благоевград", "BLG"],
  2: ["Бургас", "BGS"],
  3: ["Варна", "VAR"],
  4: ["Велико Търново", "VTR"],
  5: ["Видин", "VID"],
  6: ["Враца", "VRC"],
  7: ["Габрово", "GAB"],
  8: ["Кърджали", "KRZ"],
  9: ["Кюстендил", "KNL"],
  10: ["Ловеч", "LOV"],
  11: ["Монтана", "MON"],
  12: ["Пазарджик", "PAZ"],
  13: ["Перник", "PER"],
  14: ["Плевен", "PVN"],
  15: ["Пловдив", "PDV"],
  16: ["Разград", "RAZ"],
  17: ["Русе", "RSE"],
  18: ["Силистра", "SLS"],
  19: ["Сливен", "SLV"],
  20: ["Смолян", "SML"],
  21: ["София-град", "SOFIA_CITY"],
  22: ["София-област", "SFO"],
  23: ["Стара Загора", "SZR"],
  24: ["Добрич", "DOB"],
  25: ["Търговище", "TGV"],
  26: ["Хасково", "HKV"],
  27: ["Шумен", "SHU"],
  28: ["Ямбол", "JAM"],
};
export const TP_INTERNATIONAL = 29;
const INTERNATIONAL_NAME = /^Международни спогодби\/договори$/;

export interface TpSeries {
  tp: number;
  name: string;
  /** Canonical oblast bucket; null only for the international ТП. */
  oblast: string | null;
  /** Year → average monthly pensioners. */
  values: Record<string, number>;
}

export interface PensionersByTp {
  source: {
    datasetId: number;
    datasetUri: string;
    resourceUri: string;
    publishedAt: string;
  };
  unit: "average monthly pensioners";
  years: number[];
  territories: TpSeries[];
  international: TpSeries;
  total: Record<string, number>;
}

const num = (s: string, where: string): number => {
  const t = s.replace(/\s/g, "");
  if (!/^\d+$/.test(t))
    throw new Error(`${where}: not a count: ${JSON.stringify(s)}`);
  return Number(t);
};

/** The published table → the artifact body. Throws on any ТП it cannot place, a missing or
 *  extra ТП, a non-numeric cell, or a year whose ТП rows do not sum to the published Общо — the
 *  checksum that holds exactly for every year 2010-2025. */
export const parsePensionersByTp = (
  table: string[][],
): Omit<PensionersByTp, "source" | "unit"> => {
  const [headers, ...body] = table;
  if (!headers || headers[0] !== "ТП на НОИ")
    throw new Error(`unexpected header ${JSON.stringify(headers?.[0])}`);
  const years = headers.slice(1).map((y) => {
    if (!/^\d{4}$/.test(y))
      throw new Error(`header ${JSON.stringify(y)} is not a year`);
    return Number(y);
  });
  const values = (r: string[], where: string) =>
    Object.fromEntries(
      years.map((y, i) => [String(y), num(r[i + 1] ?? "", `${where} ${y}`)]),
    );

  let total: Record<string, number> | null = null;
  let international: TpSeries | null = null;
  const territories: TpSeries[] = [];
  for (const r of body) {
    const label = r[0] ?? "";
    if (label === "Общо") {
      total = values(r, "Общо");
      continue;
    }
    const m = /^(\d+)\.\s*(.+)$/.exec(label);
    if (!m)
      throw new Error(`row label ${JSON.stringify(label)} is not „N.Name"`);
    const tp = Number(m[1]);
    const name = m[2].trim();
    if (tp === TP_INTERNATIONAL) {
      if (!INTERNATIONAL_NAME.test(name))
        throw new Error(
          `ТП 29 is ${JSON.stringify(name)}, expected the international row`,
        );
      international = { tp, name, oblast: null, values: values(r, label) };
      continue;
    }
    const known = TP_OBLAST[tp];
    if (!known || known[0] !== name)
      throw new Error(
        `ТП ${tp} is ${JSON.stringify(name)}, crosswalk expects ${JSON.stringify(known?.[0])}`,
      );
    if (!OBLAST_NAME[known[1]])
      throw new Error(
        `ТП ${tp} → ${known[1]} is not a canonical oblast bucket`,
      );
    if (territories.some((t) => t.tp === tp))
      throw new Error(`ТП ${tp} listed twice`);
    territories.push({ tp, name, oblast: known[1], values: values(r, label) });
  }
  if (!total) throw new Error("no Общо row");
  if (!international) throw new Error("no international (ТП 29) row");
  if (territories.length !== Object.keys(TP_OBLAST).length)
    throw new Error(
      `${territories.length} ТП, expected ${Object.keys(TP_OBLAST).length}`,
    );
  for (const y of years) {
    const sum =
      territories.reduce((s, t) => s + t.values[y], 0) +
      international.values[y];
    if (sum !== total[y])
      throw new Error(`${y}: ТП rows sum to ${sum}, Общо says ${total[y]}`);
  }
  territories.sort((a, b) => a.tp - b.tp);
  return { years, territories, international, total };
};
