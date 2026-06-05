// Phase C — local procurement (by settlement) + the composite governance profile
// for a place (the "about my area" place-ladder dashboard).

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import {
  fetchLocalMuni,
  localCycleYear,
  resolveLocalCycle,
} from "./localDataset";
import { resolveMunicipality } from "./place";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// LISI / taxes / census / indicators key Sofia as SOF00, not the synthetic SOF.
const govCode = (obshtina: string): string =>
  obshtina === "SOF" ? "SOF00" : obshtina;

const tryFetch = async <T>(path: string): Promise<T | null> => {
  try {
    return await fetchData<T>(path);
  } catch {
    return null;
  }
};

// ---- procurement by settlement (keyed by ekatte) ----------------------------

type SettlementProc = {
  totalEur: number;
  contractCount: number;
  awarders: { name: string; totalEur: number }[];
};

export const procurementBySettlement = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place)
    return noPlace("procurementBySettlement", String(args.place ?? ""), ctx);
  const data = await tryFetch<SettlementProc>(
    `/procurement/by_settlement/${place.ekatte}.json`,
  );
  if (!data) {
    return {
      tool: "procurementBySettlement",
      domain: "place",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма данни за поръчки в ${place.name}`
          : `No procurement data for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: [`procurement/by_settlement/${place.ekatte}.json`],
    };
  }
  const top = [...data.awarders]
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, 8);
  const columns: Column[] = [
    { key: "buyer", label: ctx.lang === "bg" ? "Възложител" : "Buyer" },
    {
      key: "amount",
      label: ctx.lang === "bg" ? "Сума" : "Amount",
      numeric: true,
    },
  ];
  const rows: Row[] = top.map((a) => ({
    buyer: a.name,
    amount: fmtEurCompact(a.totalEur, ctx.lang),
  }));
  return {
    tool: "procurementBySettlement",
    domain: "place",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Обществени поръчки — ${place.name}`
        : `Public procurement — ${place.nameEn}`,
    columns,
    rows,
    viz: "none",
    facts: {
      place: place.name,
      total: fmtEurCompact(data.totalEur, ctx.lang),
      contracts: fmtInt(data.contractCount, ctx.lang),
      top_buyer: top[0]?.name ?? "—",
    },
    provenance: [`procurement/by_settlement/${place.ekatte}.json`],
  };
};

// ---- composite governance profile -------------------------------------------

type CensusMuni = { population: number };
type LisiData = {
  scoresByObshtina: Record<string, { composite: number; nationalRank: number }>;
};
type IndData = {
  series: Record<string, Record<string, { year: number; value: number }[]>>;
};

export const governanceProfile = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place)
    return noPlace("governanceProfile", String(args.place ?? ""), ctx);
  const code = govCode(place.obshtina);
  const cycle = resolveLocalCycle(undefined);

  const [census, local, lisi, ind, proc] = await Promise.all([
    tryFetch<CensusMuni>(`/census/municipalities/${code}.json`),
    fetchLocalMuni(cycle, place.obshtina).catch(() => null),
    tryFetch<LisiData>("/municipal_transparency/index.json"),
    tryFetch<IndData>("/indicators.json"),
    tryFetch<SettlementProc>(`/procurement/by_settlement/${place.ekatte}.json`),
  ]);

  const facts: Record<string, string | number> = {
    place: place.name,
    oblast: place.oblastName[ctx.lang],
  };
  const provenance: string[] = ["municipalities.json"];

  if (census?.population) {
    facts.population = fmtInt(census.population, ctx.lang);
    provenance.push(`census/municipalities/${code}.json`);
  }
  if (local) {
    const elected = local.mayor.elected;
    const topCouncil = [...local.council].sort(
      (a, b) => b.mandatesWon - a.mandatesWon,
    )[0];
    const turnout =
      local.protocol.numRegisteredVoters > 0
        ? round2(
            (100 * local.protocol.totalActualVoters) /
              local.protocol.numRegisteredVoters,
          )
        : null;
    facts.mayor = elected
      ? `${elected.candidateName} (${elected.localPartyName})`
      : "—";
    facts.council_leader = topCouncil
      ? `${topCouncil.localPartyName} (${topCouncil.mandatesWon})`
      : "—";
    facts.local_turnout = `${fmtPct(turnout, ctx.lang)} (${localCycleYear(cycle)})`;
    provenance.push(`${cycle}/municipalities/${place.obshtina}.json`);
  }
  const unemp = ind?.series?.unemployment?.[code];
  if (unemp && unemp.length) {
    const last = unemp[unemp.length - 1];
    facts.unemployment = `${last.value}% (${last.year})`;
    provenance.push("indicators.json");
  }
  const score = lisi?.scoresByObshtina?.[code];
  if (score) {
    facts.transparency = `${score.composite} (${ctx.lang === "bg" ? "място" : "rank"} ${score.nationalRank})`;
    provenance.push("municipal_transparency/index.json");
  }
  if (proc?.totalEur) {
    facts.local_procurement = fmtEurCompact(proc.totalEur, ctx.lang);
    provenance.push(`procurement/by_settlement/${place.ekatte}.json`);
  }

  return {
    tool: "governanceProfile",
    domain: "place",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Профил на ${place.name}`
        : `${place.nameEn} — governance profile`,
    viz: "none",
    facts,
    provenance,
  };
};

function noPlace(tool: string, query: string, ctx: ToolContext): Envelope {
  return {
    tool,
    domain: "place",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Не намерих място „${query}“`
        : `No place matched "${query}"`,
    viz: "none",
    facts: { query },
    provenance: ["municipalities.json"],
  };
}
