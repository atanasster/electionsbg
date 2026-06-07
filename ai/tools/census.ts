// Phase C — Census 2021 demographics for a município.

import { fetchData } from "./dataClient";
import { fmtInt } from "./format";
import { resolveMunicipality } from "./place";
import { muniLocator } from "./geo";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

const censusCode = (obshtina: string): string =>
  obshtina === "SOF" ? "SOF00" : obshtina;

type CensusMuni = {
  code: string;
  nameBg: string;
  nameEn: string;
  population: number;
  gender: { male: number; female: number };
  ethnic: Record<string, number>;
};

const ETHNIC_LABELS: Record<string, { bg: string; en: string }> = {
  bulgarian: { bg: "българи", en: "Bulgarian" },
  turkish: { bg: "турци", en: "Turkish" },
  roma: { bg: "роми", en: "Roma" },
  other: { bg: "други", en: "Other" },
};

export const census = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) {
    return {
      tool: "census",
      domain: "place",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Не намерих община „${args.place ?? ""}“`
          : `No municipality matched "${args.place ?? ""}"`,
      viz: "none",
      facts: { query: String(args.place ?? "") },
      provenance: ["municipalities.json"],
    };
  }
  let c: CensusMuni;
  try {
    c = await fetchData<CensusMuni>(
      `/census/municipalities/${censusCode(place.obshtina)}.json`,
    );
  } catch {
    return {
      tool: "census",
      domain: "place",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма преброителни данни за ${place.name}`
          : `No census data for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: [`census/municipalities/${censusCode(place.obshtina)}.json`],
    };
  }

  const pop = c.population || 0;
  const pct = (n: number) => (pop > 0 ? round2((100 * n) / pop) : 0);
  const ethnicRows = Object.entries(ETHNIC_LABELS)
    .map(([k, lab]) => ({ label: lab[ctx.lang], value: c.ethnic[k] ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const columns: Column[] = [
    {
      key: "group",
      label: ctx.lang === "bg" ? "Етническа група" : "Ethnic group",
    },
    {
      key: "people",
      label: ctx.lang === "bg" ? "Брой" : "People",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const rows: Row[] = ethnicRows.map((r) => ({
    group: r.label,
    people: r.value,
    pct: pct(r.value),
  }));

  const largest = ethnicRows[0];
  return {
    tool: "census",
    domain: "place",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Преброяване 2021 — ${place.name}`
        : `Census 2021 — ${place.nameEn}`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      place: place.name,
      population: fmtInt(pop, ctx.lang),
      male: fmtInt(c.gender?.male ?? 0, ctx.lang),
      female: fmtInt(c.gender?.female ?? 0, ctx.lang),
      largest_group: largest
        ? `${largest.label} (${pct(largest.value)}%)`
        : "—",
    },
    provenance: [`census/municipalities/${censusCode(place.obshtina)}.json`],
  };
};
