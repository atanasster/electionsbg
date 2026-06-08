// Party-blind "winners" drill-downs: a list of every area at one level (municipality
// / settlement / polling section) with the party that LED there. These are the
// counterparts to the party-scoped *Breakdown tools in electionDepth.ts (which
// shade one named party's share) and to regionWinners in national.ts (the oblast
// level). Each answers a "results by <level> in X" question with no party named.

import { resolveElection } from "./args";
import { fetchData, fetchNationalSummary } from "./dataClient";
import { round2 } from "./dataset";
import { electionFullLabel } from "./format";
import { muniChoropleth, settlementChoropleth } from "./geo";
import {
  findOblastInText,
  loadMunis,
  resolveMunicipality,
  resolveOblast,
} from "./place";
import type {
  Column,
  Envelope,
  GeoArea,
  Lang,
  Row,
  ToolArgs,
  ToolContext,
} from "./types";

type NSParty = { partyNum: number; nickName: string; color?: string };
type VoteEntry = { partyNum: number; totalVotes: number };
type VoteResult = { results: { votes: VoteEntry[] } };

type AreaWinner = {
  code: string;
  label: string;
  party: string;
  color?: string;
  votes: number;
  total: number;
  pct: number;
};

// Leading party (by votes) in one area's vote list, resolved to its national
// nickName + colour. Returns null for an area with no votes.
const winnerOf = (
  votes: VoteEntry[],
  byNum: Map<number, NSParty>,
): { party: NSParty | undefined; votes: number; total: number } | null => {
  const total = votes.reduce((s, v) => s + (v.totalVotes ?? 0), 0);
  const top = votes.reduce<VoteEntry | undefined>(
    (best, v) => (v.totalVotes > (best?.totalVotes ?? 0) ? v : best),
    undefined,
  );
  if (!top || top.totalVotes <= 0) return null;
  return { party: byNum.get(top.partyNum), votes: top.totalVotes, total };
};

// Shared table/facts/narration scaffold from a list of per-area winners.
const winnersEnvelope = (
  tool: string,
  winners: AreaWinner[],
  areaLabel: { bg: string; en: string },
  countLabel: string, // facts key for the area count (e.g. "municipalities")
  title: string,
  subtitle: string,
  lang: Lang,
  geo: Envelope["geo"],
  provenance: string[],
  extraFacts: Record<string, string | number> = {},
): Envelope => {
  const bg = lang === "bg";
  const sorted = [...winners].sort((a, b) =>
    a.label.localeCompare(b.label, bg ? "bg" : "en"),
  );
  const columns: Column[] = [
    { key: "area", label: areaLabel[lang] },
    { key: "winner", label: bg ? "Първа партия" : "Leading party" },
    {
      key: "votes",
      label: bg ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const rows: Row[] = sorted.map((w) => ({
    area: w.label,
    winner: w.party,
    votes: w.votes,
    pct: w.pct,
  }));

  const winsByParty = new Map<string, number>();
  winners.forEach((w) =>
    winsByParty.set(w.party, (winsByParty.get(w.party) ?? 0) + 1),
  );
  const ranked = [...winsByParty.entries()].sort((a, b) => b[1] - a[1]);
  const [leadParty, leadWins] = ranked[0] ?? ["—", 0];

  const facts: Record<string, string | number> = {
    leading_party: leadParty,
    leading_wins: leadWins,
    [countLabel]: winners.length,
    ...extraFacts,
  };
  ranked.slice(0, 5).forEach(([name, n]) => {
    if (!(name in facts)) facts[name] = n;
  });

  return {
    tool,
    domain: "elections",
    kind: "table",
    title,
    subtitle,
    columns,
    rows,
    viz: "none",
    geo,
    facts,
    provenance,
  };
};

const noData = (
  tool: string,
  title: string,
  provenance: string[],
  facts: Record<string, string | number> = {},
): Envelope => ({
  tool,
  domain: "elections",
  kind: "scalar",
  title,
  viz: "none",
  facts,
  provenance,
});

// ---- municipalities within one oblast ---------------------------------------

type MuniVoteRow = { obshtina: string } & VoteResult;

export const municipalityWinners = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const raw = String(args.oblast ?? args.place ?? "");
  const ob = resolveOblast(raw) ?? findOblastInText(raw);
  if (!ob)
    return noData(
      "municipalityWinners",
      bg ? `Не разпознах област „${raw}“` : `No province matched "${raw}"`,
      [`${election}/municipalities/by/*.json`],
      { query: raw },
    );
  const [munis, ns] = await Promise.all([
    fetchData<MuniVoteRow[]>(
      `/${election}/municipalities/by/${ob.code}.json`,
    ).catch(() => [] as MuniVoteRow[]),
    fetchNationalSummary<{ parties: NSParty[] }>(election),
  ]);
  if (!munis.length)
    return noData(
      "municipalityWinners",
      bg
        ? `Няма данни по общини за ${ob.name.bg}`
        : `No municipality data for ${ob.name.en}`,
      [`${election}/municipalities/by/${ob.code}.json`],
      { oblast: ob.name[ctx.lang] },
    );
  const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
  const nameByCode = new Map(
    (await loadMunis()).map((m) => [m.obshtina, bg ? m.name : m.nameEn]),
  );
  const winners: AreaWinner[] = munis
    .map((r): AreaWinner | null => {
      const w = winnerOf(r.results.votes, byNum);
      if (!w) return null;
      return {
        code: r.obshtina,
        label: nameByCode.get(r.obshtina) ?? r.obshtina,
        party: w.party?.nickName ?? "—",
        color: w.party?.color,
        votes: w.votes,
        total: w.total,
        pct: w.total > 0 ? round2((100 * w.votes) / w.total) : 0,
      };
    })
    .filter((w): w is AreaWinner => w !== null);

  const geo = muniChoropleth(ob.code, winnersToAreas(winners), {
    metricLabel: bg ? "Първа партия" : "Leading party",
    colorMode: "explicit",
  });
  return winnersEnvelope(
    "municipalityWinners",
    winners,
    { bg: "Община", en: "Municipality" },
    "municipalities",
    bg
      ? `Резултати по общини — ${ob.name.bg} (${electionFullLabel(election, "bg")})`
      : `Results by municipality — ${ob.name.en} (${electionFullLabel(election, "en")})`,
    bg
      ? "Водещата партия във всяка община"
      : "The leading party in each municipality",
    ctx.lang,
    geo,
    [`${election}/municipalities/by/${ob.code}.json`],
    { oblast: ob.name[ctx.lang] },
  );
};

// ---- settlements within one municipality ------------------------------------

type SettlementVoteRow = { ekatte: string; name: string } & VoteResult;

export const settlementWinners = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const query = String(args.place ?? "");
  const place = await resolveMunicipality(query);
  if (!place)
    return noData(
      "settlementWinners",
      bg
        ? `Не намерих община „${query}“`
        : `No municipality matched "${query}"`,
      [`${election}/settlements/by/*.json`],
      { query },
    );
  const [settlements, ns] = await Promise.all([
    fetchData<SettlementVoteRow[]>(
      `/${election}/settlements/by/${place.obshtina}.json`,
    ).catch(() => [] as SettlementVoteRow[]),
    fetchNationalSummary<{ parties: NSParty[] }>(election),
  ]);
  const placeName = bg ? place.name : place.nameEn;
  if (!settlements.length)
    return noData(
      "settlementWinners",
      bg
        ? `Няма данни по населени места за ${place.name}`
        : `No settlement data for ${place.nameEn}`,
      [`${election}/settlements/by/${place.obshtina}.json`],
      { place: placeName },
    );
  const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
  const winners: AreaWinner[] = settlements
    .map((r): AreaWinner | null => {
      const w = winnerOf(r.results.votes, byNum);
      if (!w) return null;
      return {
        code: r.ekatte,
        label: r.name,
        party: w.party?.nickName ?? "—",
        color: w.party?.color,
        votes: w.votes,
        total: w.total,
        pct: w.total > 0 ? round2((100 * w.votes) / w.total) : 0,
      };
    })
    .filter((w): w is AreaWinner => w !== null);

  const geo = settlementChoropleth(place.obshtina, winnersToAreas(winners), {
    metricLabel: bg ? "Първа партия" : "Leading party",
    colorMode: "explicit",
  });
  return winnersEnvelope(
    "settlementWinners",
    winners,
    { bg: "Населено място", en: "Settlement" },
    "settlements",
    bg
      ? `Резултати по населени места — ${place.name} (${electionFullLabel(election, "bg")})`
      : `Results by settlement — ${place.nameEn} (${electionFullLabel(election, "en")})`,
    bg
      ? "Водещата партия във всяко населено място"
      : "The leading party in each settlement",
    ctx.lang,
    geo,
    [`${election}/settlements/by/${place.obshtina}.json`],
    { place: placeName },
  );
};

// ---- polling sections within one settlement (or municipality) ---------------

// nuts3 -> the 2-digit МИР number that names the per-oblast section bundle
// (sections/by-oblast/NN.json). Mirrors scripts/parsers/region_codes.ts; kept
// local so the browser bundle doesn't pull in the node data-pipeline tree.
const SECTION_FILE_BY_NUTS3: Record<string, string> = {
  "32": "32",
  BG413: "01",
  BG341: "02",
  BG331: "03",
  BG321: "04",
  BG311: "05",
  BG313: "06",
  BG322: "07",
  BG332: "08",
  BG425: "09",
  BG415: "10",
  BG315: "11",
  BG312: "12",
  BG423: "13",
  BG414: "14",
  BG314: "15",
  BG421: "16",
  "BG421-1": "17",
  BG324: "18",
  BG323: "19",
  BG325: "20",
  BG342: "21",
  BG424: "22",
  BG416: "23",
  BG417: "24",
  BG418: "25",
  BG412: "26",
  BG344: "27",
  BG334: "28",
  BG422: "29",
  BG333: "30",
  BG343: "31",
};

const MAX_SECTIONS = 120; // a big-city settlement can hold hundreds; cap + note

type SectionRecord = {
  section: string;
  settlement: string;
  ekatte: string;
  obshtina: string;
} & VoteResult;

export const sectionWinners = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const query = String(args.place ?? "");
  const place = await resolveMunicipality(query);
  if (!place)
    return noData(
      "sectionWinners",
      bg ? `Не намерих място „${query}“` : `No place matched "${query}"`,
      [`${election}/sections/by-oblast/*.json`],
      { query },
    );
  const file = SECTION_FILE_BY_NUTS3[place.nuts3];
  const placeName = bg ? place.name : place.nameEn;
  if (!file)
    return noData(
      "sectionWinners",
      bg
        ? `Няма данни по секции за ${place.name}`
        : `No section data for ${place.nameEn}`,
      [`${election}/sections/by-oblast/*.json`],
      { place: placeName },
    );
  const [secMap, ns] = await Promise.all([
    fetchData<Record<string, SectionRecord>>(
      `/${election}/sections/by-oblast/${file}.json`,
    ).catch(() => ({}) as Record<string, SectionRecord>),
    fetchNationalSummary<{ parties: NSParty[] }>(election),
  ]);
  const all = Object.values(secMap);
  // Prefer the named settlement (its EKATTE); fall back to the whole município.
  let scope = all.filter((s) => s.ekatte === place.ekatte);
  const scopedToSettlement = scope.length > 0;
  if (!scope.length) scope = all.filter((s) => s.obshtina === place.obshtina);
  if (!scope.length)
    return noData(
      "sectionWinners",
      bg
        ? `Няма данни по секции за ${place.name}`
        : `No section data for ${place.nameEn}`,
      [`${election}/sections/by-oblast/${file}.json`],
      { place: placeName },
    );

  const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
  const ranked = scope
    .map((s) => {
      const w = winnerOf(s.results.votes, byNum);
      return w
        ? {
            section: s.section,
            settlement: s.settlement,
            party: w.party?.nickName ?? "—",
            votes: w.votes,
            total: w.total,
            pct: w.total > 0 ? round2((100 * w.votes) / w.total) : 0,
          }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.section.localeCompare(b.section));

  const total = ranked.length;
  const shown = ranked.slice(0, MAX_SECTIONS);
  const truncated = total > shown.length;

  const winsByParty = new Map<string, number>();
  ranked.forEach((r) =>
    winsByParty.set(r.party, (winsByParty.get(r.party) ?? 0) + 1),
  );
  const rankedParties = [...winsByParty.entries()].sort((a, b) => b[1] - a[1]);
  const [leadParty, leadWins] = rankedParties[0] ?? ["—", 0];

  const columns: Column[] = [
    { key: "section", label: bg ? "Секция" : "Section" },
    { key: "settlement", label: bg ? "Населено място" : "Settlement" },
    { key: "winner", label: bg ? "Първа партия" : "Leading party" },
    {
      key: "votes",
      label: bg ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const rows: Row[] = shown.map((r) => ({
    section: r.section,
    settlement: r.settlement,
    winner: r.party,
    votes: r.votes,
    pct: r.pct,
  }));

  const scopeName = scopedToSettlement
    ? scope[0].settlement
    : bg
      ? place.name
      : place.nameEn;
  const facts: Record<string, string | number> = {
    place: scopeName,
    sections: total,
    leading_party: leadParty,
    leading_wins: leadWins,
  };
  rankedParties.slice(0, 5).forEach(([name, n]) => {
    if (!(name in facts)) facts[name] = n;
  });
  // Hidden deep-link id (the _id suffix keeps it out of the narration/UI) so
  // the "Виж в сайта" link targets THIS place's own page: the settlement's
  // section breakdown (/sections/:ekatte) when scoped to one settlement, else
  // the município page (/settlement/:obshtina). Without it the link fell back
  // to the national /regions overview.
  if (scopedToSettlement) facts.ekatte_id = scope[0].ekatte;
  else facts.obshtina_id = place.obshtina;

  const subtitle = truncated
    ? bg
      ? `Водещата партия по секции · показани ${shown.length} от ${total}`
      : `Leading party per section · showing ${shown.length} of ${total}`
    : bg
      ? "Водещата партия във всяка секция"
      : "The leading party in each section";

  return {
    tool: "sectionWinners",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Резултати по секции — ${scopeName} (${electionFullLabel(election, "bg")})`
      : `Results by section — ${scopeName} (${electionFullLabel(election, "en")})`,
    subtitle,
    columns,
    rows,
    viz: "none",
    facts,
    provenance: [`${election}/sections/by-oblast/${file}.json`],
  };
};

// Map per-area winners to explicit-colour choropleth areas.
const winnersToAreas = (winners: AreaWinner[]): GeoArea[] =>
  winners.map((w) => ({
    code: w.code,
    label: w.label,
    color: w.color,
    display: w.party,
  }));
