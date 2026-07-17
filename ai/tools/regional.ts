// Регионално развитие (МРРБ) tools — the chat surface for the /sector/regional pack. МРРБ
// is a pass-through ministry: it controls ~€1.06bn/year but procures only ~€100M through
// its own tenders, the rest leaving as capital transfers + EU-cohesion co-financing. So the
// tools follow the money:
//
//   mrrbSpending        — the МРРБ group procurement (ministry + АГКК + ДНСК + 27 governors)
//                         by function + competition, the chat analog of the pack's tiles.
//   cohesionAbsorption  — the two МРРБ regional OPs (ОПРР „Региони в растеж“ 2014-20 vs
//                         „Развитие на регионите“ 2021-27): contracted / paid / absorption %,
//                         against the 31 Dec 2029 n+3 decommitment deadline.
//   regionalInvestment  — ИСУН € per oblast (+ per capita), where the EU money lands.
//
// ⚠ The ИСУН reads go through fetchDb('fund-payload') — Postgres, NOT the static
// funds/*.json: bucket:sync EXCLUDES ^funds/.* since the funds PG migration, so the
// bucket copies are unmaintained and go stale.
//
// ⚠ ROADS (АПИ) and WATER (ВиК) are SEPARATE VIEWS — the router routes магистрал|път → roads
// and ВиК|вод → water before it reaches here. Every fact goes through ctx.lang; the tool
// never computes prose numbers — narrate() reads env.facts. Mirrors the social/transport tools.

import { fetchDb } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import type { Envelope, Row, ToolArgs, ToolContext } from "./types";
import type { GroupModelPayload } from "@/lib/awarderModel";
import {
  buildRegionalModelFromAggregates,
  categoryLabel,
} from "@/lib/regionalAttributes";
import {
  REGIONAL_SECTOR_EIKS,
  REGIONAL_COHESION_PROGRAMS,
} from "@/lib/regionalReferenceData";
import {
  aggregateRegionalOblasts,
  type MuniFundRow,
} from "@/lib/regionalOblast";

const pct = (share: number | null, lang: "bg" | "en"): string =>
  fmtPct(share == null ? null : Math.round(share * 100), lang);

// "Къде отиват парите на МРРБ?" — the group's procurement folded by function, the chat
// analog of the /sector/regional pack's procurement tiles.
export const mrrbSpending = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const payload = await fetchDb<GroupModelPayload>("awarder-group-model", {
    eiks: REGIONAL_SECTOR_EIKS.join(","),
  });
  const m = buildRegionalModelFromAggregates(payload);
  const total = m.totalEur;

  const cats = [...m.categories]
    .filter((c) => c.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur);
  const rows: Row[] = cats.map((c) => ({
    function: categoryLabel(c.id, ctx.lang),
    amount: fmtEurCompact(c.totalEur, ctx.lang),
    share: total > 0 ? pct(c.totalEur / total, ctx.lang) : "—",
  }));

  const topCat = cats.find((c) => c.id !== "other");
  const topCon = m.suppliers[0];

  return {
    tool: "mrrbSpending",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Регионално развитие — поръчките на групата (МРРБ, АГКК, ДНСК, области)"
      : "Regional development — the group's procurement (МРРБ, АГКК, ДНСК, oblasts)",
    subtitle: bg
      ? "Обществените поръчки са ~€100 млн. — тънка част от ~€1,06 млрд. бюджет; останалото са трансфери и кохезия (виж cohesionAbsorption)."
      : "Procurement is ~€100M — a thin slice of the ~€1.06bn budget; the rest is transfers and cohesion (see cohesionAbsorption).",
    columns: [
      { key: "function", label: bg ? "Функция" : "Function" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      total_value: fmtEurCompact(total, ctx.lang),
      contracts: fmtInt(m.contractCount, ctx.lang),
      top_function: topCat
        ? `${categoryLabel(topCat.id, ctx.lang)} (${fmtEurCompact(topCat.totalEur, ctx.lang)})`
        : "—",
      single_bid_share: pct(m.singleBidShare, ctx.lang),
      direct_award_share: pct(m.directShare, ctx.lang),
      top_contractor: topCon
        ? `${topCon.name} (${fmtEurCompact(topCon.totalEur, ctx.lang)})`
        : "—",
      note: bg
        ? "Това са само обществените поръчки на групата на МРРБ (министерство + АГКК + ДНСК + 27 областни администрации). Пътищата (АПИ, ~€6,3 млрд.) и ВиК са отделни сектори и не са тук."
        : "This is only the МРРБ group's procurement (ministry + АГКК + ДНСК + 27 regional governors). Roads (АПИ, ~€6.3bn) and water (ВиК) are separate sectors and are not here.",
    },
    provenance: ["db:awarder-group-model"],
  };
};

// ---- absorption.json (ИСУН byProgramme) -------------------------------------

interface AbsorptionProgramme {
  programCode: string;
  programName: string;
  period: string;
  contractedEur: number;
  paidEur: number;
  absorptionPct: number;
  contractCount: number;
}
interface AbsorptionFile {
  byProgramme?: AbsorptionProgramme[];
}

const DECOMMITMENT_YEAR = 2029;

// "Усвоени ли са кохезионните средства за регионите?" — the two МРРБ regional OPs,
// contracted vs paid vs absorption %, against the 31 Dec 2029 n+3 deadline.
export const cohesionAbsorption = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchDb<AbsorptionFile>("fund-payload", {
    kind: "absorption",
  });
  const codes = new Set<string>(REGIONAL_COHESION_PROGRAMS);
  const progs = (f.byProgramme ?? [])
    .filter((p) => codes.has(p.programCode))
    .sort((a, b) => b.period.localeCompare(a.period));

  const rows: Row[] = progs.map((p) => ({
    programme: `${p.programName} (${p.period})`,
    contracted: fmtEurCompact(p.contractedEur, ctx.lang),
    paid: fmtEurCompact(p.paidEur, ctx.lang),
    absorption: `${Math.round(p.absorptionPct)}%`,
  }));

  const opr = progs.find((p) => p.period.startsWith("2014"));
  const rr = progs.find((p) => p.period.startsWith("2021"));
  const atRisk = rr ? Math.max(0, rr.contractedEur - rr.paidEur) : 0;

  return {
    tool: "cohesionAbsorption",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Усвояване на кохезионните средства за регионите"
      : "Absorption of the regional cohesion funds",
    subtitle: bg
      ? "ОП „Региони в растеж“ 2014-20 (затворена) срещу „Развитие на регионите“ 2021-27 (риск от неусвояване)"
      : "ОПРР „Региони в растеж“ 2014-20 (closed) vs „Развитие на регионите“ 2021-27 (absorption risk)",
    columns: [
      { key: "programme", label: bg ? "Програма" : "Programme" },
      { key: "contracted", label: bg ? "Договорени" : "Contracted", numeric: true }, // prettier-ignore
      { key: "paid", label: bg ? "Изплатени" : "Paid", numeric: true },
      { key: "absorption", label: bg ? "Усвоени" : "Absorbed", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      opr_absorption: opr ? `${Math.round(opr.absorptionPct)}%` : "—",
      rr_absorption: rr ? `${Math.round(rr.absorptionPct)}%` : "—",
      rr_at_risk: rr ? fmtEurCompact(atRisk, ctx.lang) : "—",
      deadline: `31.12.${DECOMMITMENT_YEAR}`,
      note: bg
        ? `Бенефициентите са общините. „Развитие на регионите“ е усвоена едва ~20% — средствата, останали неусвоени към 31 декември ${DECOMMITMENT_YEAR} г. (правилото n+3), се губят.`
        : `The beneficiaries are the municipalities. „Развитие на регионите“ is only ~20% absorbed — money left unspent by 31 December ${DECOMMITMENT_YEAR} (the n+3 rule) is forfeited.`,
    },
    provenance: ["db:fund-payload (ИСУН absorption)"],
  };
};

// ---- muni-map.json (ИСУН per oblast) ----------------------------------------

interface MuniMapFile {
  munis?: MuniFundRow[];
}

// "Къде отиват европейските пари по области?" — ИСУН € per oblast (+ per capita), the
// chat analog of the choropleth. All-ИСУН; Sofia inflated by HQ-attribution (disclosed).
export const regionalInvestment = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchDb<MuniMapFile>("fund-payload", { kind: "muni-map" });
  const oblasts = aggregateRegionalOblasts(f.munis ?? [], {}, bg)
    // Rank by per-capita (the honest cut), drop Sofia (HQ-attribution outlier).
    .filter((o) => o.canon !== "SOFIA_CITY" && o.population > 0)
    .sort((a, b) => b.perCapitaEur - a.perCapitaEur);

  const top = oblasts.slice(0, 10);
  const rows: Row[] = top.map((o) => ({
    oblast: o.name,
    per_capita: `${fmtEurCompact(o.perCapitaEur, ctx.lang)}/${bg ? "жит." : "cap"}`,
    total: fmtEurCompact(o.contractedEur, ctx.lang),
  }));

  const hiPc = oblasts[0];
  const loPc = oblasts[oblasts.length - 1];

  return {
    tool: "regionalInvestment",
    domain: "indicators",
    kind: "table",
    title: bg
      ? "Европейски средства (ИСУН) по област"
      : "EU funds (ИСУН) by oblast",
    subtitle: bg
      ? "На жител, топ 10 области (столицата отпада — завишена от национални програми)"
      : "Per capita, top 10 oblasts (the capital is dropped — inflated by national programmes)",
    columns: [
      { key: "oblast", label: bg ? "Област" : "Oblast" },
      { key: "per_capita", label: bg ? "На жител" : "Per capita", numeric: true }, // prettier-ignore
      { key: "total", label: bg ? "Общо" : "Total", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      highest_per_capita: hiPc
        ? `${hiPc.name} (${fmtEurCompact(hiPc.perCapitaEur, ctx.lang)}/${bg ? "жит." : "cap"})`
        : "—",
      lowest_per_capita: loPc
        ? `${loPc.name} (${fmtEurCompact(loPc.perCapitaEur, ctx.lang)}/${bg ? "жит." : "cap"})`
        : "—",
      note: bg
        ? "Всички фондове по ИСУН (вкл. ПВУ), отнесени към бенефициента по общини и обобщени по област. Столицата е завишена от национални програми със седалище там. Двете регионални програми на МРРБ поотделно са в cohesionAbsorption."
        : "All ИСУН funds (incl. the RRF), attributed to the beneficiary by municipality and aggregated to oblast. The capital is inflated by nationally-run programmes headquartered there. The two МРРБ regional programmes specifically are in cohesionAbsorption.",
    },
    provenance: ["db:fund-payload (ИСУН muni-map)"],
  };
};
