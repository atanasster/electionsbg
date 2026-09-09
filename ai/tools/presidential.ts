// Presidential results — one cycle, one round, nationally or in one place.
//
// ⚠⚠ ART. 93 (3) IS A TEST ON ROUND ONE ONLY, AND `winsOutright` MUST NOT BE READ ON ROUND 2.
// A round-1 win needs more than half the VALID votes **and** more than half the electorate to
// have turned out — 2006's Първанов took 64.05% of the valid vote and was NOT elected, because
// turnout was 43.88%. The RUNOFF is art. 93 (4): two tickets, a plain plurality, no turnout
// threshold. `winnerRule.ts` computes `winsOutright = meetsMajority && meetsTurnout` for BOTH
// rounds and then consumes only the round-1 value (`decideCycle`), so the round-2 value is a
// number nothing was meant to read — and reading it says nobody was elected in the round that
// elected the president, on 2021 (34.63% turnout), 2011 (48.24%) and 2006 (41.69%). Round 2's
// verdict therefore comes from `summary.decidedInRound`: still the producer's answer, just the
// one that applies.
//
// ⚠ A TICKET IS A PERSON, NOT A PARTY. The nominator may be a party, a coalition or an
// инициативен комитет — both 2021 finalists were committee-nominated — so nothing here maps a
// candidate to a party, and the „nominated by" column carries the register's own wording.
//
// ⚠ THE DEFAULT ROUND IS THE ONE THAT ELECTED THE PRESIDENT, not round 1. „The results of the
// 2021 presidential election" means the runoff; defaulting to round 1 would answer a different
// question with a table that looks like an answer. All five cycles went to a runoff, so the
// round-1 default would have been wrong every time.
//
// ⚠ TURNOUT IS ROUND-SPECIFIC AND SO IS THE BALLOT. A runoff is a different electorate a week
// later (2021: 5.67 points lower) and carries two tickets rather than 23, so a figure without
// its round is a figure about an unstated question. Every title names the round.
//
// ⚠⚠ THE PLACE ARGUMENT MUST ANSWER THE PLACE THAT WAS ASKED, and two ways of failing that are
// specific to this corpus. `SOF` is a RESOLVER ALIAS and a key in no vote file — Sofia city is
// the three МИР S23/S24/S25 — so a plain municipality lookup returns „no data" about the
// largest município in the country. And `resolveMunicipality` substring-matches, while all 28
// oblast centres share their name with a município, so a municipality-first single argument
// makes the oblast tier unreachable: „област Пловдив" answered with Пловдив município is half
// the votes under a title naming neither scope. Hence the separate `oblast` argument, the
// qualifier strip, and the scope in every title.

import {
  LATEST_PRESIDENTIAL_CYCLE,
  PRESIDENTIAL_CATALOGUE,
  type PresidentialElectionEntry,
} from "../../src/data/presidentialCatalogue";
import { SOFIA_CITY_CODES } from "./areaResults";
import { fetchData } from "./dataClient";
import { barTable, firstString, noData } from "./envelope";
import { round2 } from "./dataset";
import { fmtInt, fmtPct } from "./format";
import { translitKey } from "./translit";
import { muniLocator, oblastChoropleth, oblastLocator } from "./geo";
import { resolveMunicipality, resolveOblast } from "./place";
import type {
  Column,
  Envelope,
  GeoArea,
  Lang,
  Row,
  ToolArgs,
  ToolContext,
} from "./types";

type Ranked = {
  number: number;
  president: string;
  vicePresident: string;
  nominatedBy: { name: string; kind: string };
  votes: number;
  shareOfValid: number;
};

type SummaryRound = {
  round: 1 | 2;
  date: string;
  ranking: Ranked[];
  votes: { tickets: number; noneOfTheAbove: number | null; valid: number };
  turnout: { registeredVoters: number; cast: number; pct: number | null };
  outcome: {
    meetsMajority: boolean;
    meetsTurnout: boolean;
    winsOutright: boolean;
  };
};

type Summary = {
  cycle: string;
  decidedInRound: 1 | 2;
  winner: { president: string; vicePresident: string };
  rounds: SummaryRound[];
};

type Ticket = { number: number; president: string; color?: string };
type PlaceEntry = {
  key: string;
  results: {
    votes: { partyNum: number; totalVotes: number }[];
    protocol?: { registeredVoters?: number; signatures?: number };
  };
};

/** ⚠ THE CATALOGUE, NOT A REGEX. „2016" must resolve to the cycle this build actually has;
 *  matching a shape would let `2019_11_14_pvr` through to a 404 the chat renders as „no data". */
export const resolvePresidentialCycle = (
  raw?: string,
): PresidentialElectionEntry => {
  const latest =
    PRESIDENTIAL_CATALOGUE.find((e) => e.name === LATEST_PRESIDENTIAL_CYCLE) ??
    PRESIDENTIAL_CATALOGUE[PRESIDENTIAL_CATALOGUE.length - 1];
  if (!raw) return latest;
  const exact = PRESIDENTIAL_CATALOGUE.find((e) => e.name === raw);
  if (exact) return exact;
  const year = String(raw).match(/(19|20)\d{2}/)?.[0];
  const byYear = year
    ? PRESIDENTIAL_CATALOGUE.find((e) => e.name.startsWith(year))
    : undefined;
  return byYear ?? latest;
};

/** ⚠ CLAMPED TO WHAT THE CYCLE HAS. A cycle decided in round 1 has no `tur2` tree, and asking
 *  for one would 404 into „no data" rather than saying the round did not happen. */
export const resolvePresidentialRound = (
  entry: PresidentialElectionEntry,
  raw?: unknown,
): 1 | 2 => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  const asked = n === 1 || n === 2 ? (n as 1 | 2) : undefined;
  if (asked === 2 && !entry.round2Date) return 1;
  return asked ?? entry.decidedInRound;
};

const roundLabel = (pvrCycle: string, round: 1 | 2, lang: Lang): string => {
  const year = pvrCycle.slice(0, 4);
  return lang === "bg"
    ? `${year}, ${round === 1 ? "първи тур" : "балотаж"}`
    : `${year}, ${round === 1 ? "round 1" : "runoff"}`;
};

const kindLabel = (kind: string, lang: Lang): string => {
  const bg: Record<string, string> = {
    party: "партия",
    coalition: "коалиция",
    committee: "инициативен комитет",
  };
  const en: Record<string, string> = {
    party: "party",
    coalition: "coalition",
    committee: "initiative committee",
  };
  return (lang === "bg" ? bg : en)[kind] ?? kind;
};

/** House convention — `areaResults.ts` and `national.ts` both cut at 12. */
const MAX_ROWS = 12;

/**
 * The МИР an administrative oblast is split across.
 *
 * ⚠⚠ AN OBLAST IS NOT ALWAYS ONE МИР, AND THE TWO THAT ARE NOT ARE THE TWO BIGGEST CITIES.
 * `region_votes.json` is keyed by МИР: Sofia city is `S23`/`S24`/`S25` and Plovdiv is `PDV`
 * (Пловдив-област) beside `PDV-00` (Пловдив-град). `resolveOblast("Пловдив")` answers `PDV`
 * alone by design, so a reader asking „област Пловдив" and getting one МИР is told roughly half
 * the oblast under a title that says „област" — measured on the 2021 runoff, `PDV` is 62,734
 * against 135,321 for the pair. `SOF` is the resolver's Sofia-city ALIAS and is a key in no
 * vote file at all.
 */
const OBLAST_GROUPS: Record<string, string[]> = {
  SOF: SOFIA_CITY_CODES,
  S23: SOFIA_CITY_CODES,
  PDV: ["PDV", "PDV-00"],
};

const oblastGroup = (code: string): string[] => OBLAST_GROUPS[code] ?? [code];
const TOP_FACTS = 3;

/**
 * ⚠ THE DENOMINATOR DIFFERS BY ARM AND THE LABEL SAYS WHICH. Nationally the share is of VALID
 * votes, which include „не подкрепям никого"; in one place it is of TICKET votes only, because
 * the per-place roll-ups carry no „никого" line. The second is systematically larger — 2021's
 * Радев is 66.72% nationally and 68.10% in Пловдив — so one bare „%" on both makes an ordinary
 * difference of basis read as an error.
 */
const columnsFor = (lang: Lang, basis: "valid" | "tickets"): Column[] => [
  { key: "pair", label: lang === "bg" ? "Двойка" : "Pair" },
  { key: "nominatedBy", label: lang === "bg" ? "Издигнат от" : "Nominated by" },
  {
    key: "votes",
    label: lang === "bg" ? "Гласове" : "Votes",
    numeric: true,
    format: "int",
  },
  {
    key: "pct",
    label:
      lang === "bg"
        ? basis === "valid"
          ? "% от действителните"
          : "% от гласовете за двойки"
        : basis === "valid"
          ? "% of valid"
          : "% of ticket votes",
    numeric: true,
    format: "pct",
  },
];

/** The leading ticket per oblast, for the winner map. */
const oblastWinners = async (
  pvrCycle: string,
  round: 1 | 2,
  tickets: Map<number, Ticket>,
  lang: Lang,
): Promise<GeoArea[]> => {
  // ⚠ THE MAP IS ADDITIVE, THE TABLE IS THE ANSWER. `fetchData` rejects on a non-OK response,
  // so an absent per-round roll-up — a realistic state across five publication eras — would
  // otherwise fail the whole envelope over a decoration.
  const file = await fetchData<{ entries: PlaceEntry[] }>(
    `/${pvrCycle}/tur${round}/region_votes.json`,
  ).catch(() => ({ entries: [] as PlaceEntry[] }));
  const areas: GeoArea[] = [];
  for (const e of file.entries ?? []) {
    const top = [...(e.results?.votes ?? [])].sort(
      (a, b) => b.totalVotes - a.totalVotes,
    )[0];
    // ⚠ SKIPPED, NOT COLOURED NEUTRAL — a place with no votes takes the map's own fallback
    // fill rather than an area row asserting a leader it does not have.
    if (!top) continue;
    const ticket = tickets.get(top.partyNum);
    const ob = resolveOblast(e.key);
    areas.push({
      code: e.key,
      label: ob?.name[lang] ?? e.key,
      // ⚠ THE TICKET'S OWN COLOUR, from `tickets.json` — the ingest resolved it once and the
      // map, the page and this tool must not each pick a different one for the same pair.
      ...(ticket?.color ? { color: ticket.color } : {}),
      display: ticket?.president ?? String(top.partyNum),
    });
  }
  return areas;
};

/**
 * One place's rows, or `undefined` when that place cast no votes in this round.
 *
 * ⚠ IT TAKES A LIST, because Sofia city is THREE entries (S23/S24/S25) and a single-entry
 * signature is what would push a caller into picking one of them.
 */
const placeRows = (
  entries: PlaceEntry[],
  ranking: Ranked[],
  lang: Lang,
): { rows: Row[]; total: number; reg: number; cast: number } | undefined => {
  if (!entries.length) return undefined;
  const votes = entries.flatMap((e) => e.results?.votes ?? []);
  const byNum = new Map<number, number>();
  for (const v of votes)
    byNum.set(v.partyNum, (byNum.get(v.partyNum) ?? 0) + v.totalVotes);
  const total = votes.reduce((n, v) => n + v.totalVotes, 0);
  const rows = ranking
    .map((r) => ({ r, votes: byNum.get(r.number) ?? 0 }))
    .sort((a, b) => b.votes - a.votes)
    .map(({ r, votes }) => ({
      pair: `${r.president} / ${r.vicePresident}`,
      nominatedBy: `${r.nominatedBy.name} (${kindLabel(r.nominatedBy.kind, lang)})`,
      votes,
      // ⚠ OF THE TICKET VOTES IN THIS PLACE — the column label says so (see `columnsFor`).
      // „не подкрепям никого" is a valid vote and is not in this denominator, so the figure is
      // larger than the national `shareOfValid`, and a reader comparing the two without the
      // label would read an ordinary difference of basis as an error.
      pct: total > 0 ? round2((100 * votes) / total) : 0,
    }));
  return {
    rows,
    total,
    reg: entries.reduce(
      (n, e) => n + (e.results?.protocol?.registeredVoters ?? 0),
      0,
    ),
    cast: entries.reduce(
      (n, e) => n + (e.results?.protocol?.signatures ?? 0),
      0,
    ),
  };
};

export const presidentialResults = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const bg = lang === "bg";
  const askedCycle = firstString(args.cycle);
  const entry = resolvePresidentialCycle(askedCycle || undefined);
  // ⚠⚠ THE VARIABLE NAME IS LOAD-BEARING, AND `cycle` IS TAKEN. `scripts/data_map` derives the
  // assistant's dataset edges by scanning `ai/` for path literals and normalising `${expr}` to
  // `{expr}` — so `/${cycle}/…` matches the LOCAL-elections rule and this tool's reads would be
  // attributed to the local corpus. The build only fails on an UNMATCHED path, never on a
  // wrongly matched one, so that edge would be silently false. `pvrCycle` has its own rule in
  // `AI_PATH_RULES`. For the same reason `national_summary.json` is fetched here rather than
  // through `fetchNationalSummary`, whose own literal is `/${election}/…` and lands on the
  // parliamentary dataset.
  const pvrCycle = entry.name;
  const round = resolvePresidentialRound(entry, args.round);
  const summary = await fetchData<Summary>(
    `/${pvrCycle}/national_summary.json`,
  );
  const rounds = summary.rounds ?? [];
  const sr = rounds.find((r) => r.round === round) ?? rounds[0];
  // ⚠ `provenance` IS THE CITATION SURFACE, so it names only what was actually read. It used to
  // be seeded with `tickets.json`, which the place arms fetch and discard.
  const provenance = [`${pvrCycle}/national_summary.json`];
  const noRounds = () =>
    noData(
      "presidentialResults",
      bg
        ? `Президентски избори — ${pvrCycle.slice(0, 4)}`
        : `Presidential election — ${pvrCycle.slice(0, 4)}`,
      provenance,
      {
        [bg ? "няма публикуван тур" : "no published round"]: pvrCycle,
      },
    );
  if (!sr) return noRounds();
  const label = roundLabel(pvrCycle, sr.round, lang);

  // ⚠ ART. 93 (3) IS A TEST ON ROUND 1. On the runoff the producer's `winsOutright` is a value
  // nothing was meant to read (see the header); `decidedInRound` is the answer that applies.
  const electedHere =
    sr.round === 1
      ? sr.outcome.winsOutright
      : summary.decidedInRound === sr.round;
  const conditions = bg
    ? `${sr.outcome.meetsMajority ? "мнозинството е налице" : "няма мнозинство"}, ${sr.outcome.meetsTurnout ? "активността е достатъчна" : "активността е недостатъчна"}`
    : `${sr.outcome.meetsMajority ? "majority met" : "majority not met"}, ${sr.outcome.meetsTurnout ? "turnout met" : "turnout not met"}`;
  const verdict = electedHere
    ? bg
      ? `избран в този тур: ${summary.winner.president}`
      : `elected in this round: ${summary.winner.president}`
    : sr.round === 1
      ? // ⚠ THE TWO CONDITIONS ONLY WHERE THE RULE APPLIES. Printed beside a runoff they
        // describe a test that does not govern it.
        bg
        ? `няма избран в първи тур (${conditions}) — насрочва се балотаж`
        : `nobody elected in round 1 (${conditions}) — a runoff follows`
      : bg
        ? "няма избран в този тур"
        : "nobody elected in this round";

  const facts: Record<string, string | number> = {
    [bg ? "избор" : "election"]: label,
    [bg ? "изход" : "outcome"]: verdict,
    [bg ? "избран президент" : "president elected"]:
      `${summary.winner.president} (${bg ? "тур" : "round"} ${summary.decidedInRound})`,
  };
  const candidateQuery = firstString(args.candidate);
  if (candidateQuery) {
    const queryTokens = translitKey(candidateQuery).split(" ").filter(Boolean);
    const candidate = (sr.ranking ?? []).find((r) =>
      queryTokens.every((token) =>
        translitKey(`${r.president} ${r.vicePresident}`).includes(token),
      ),
    );
    facts[bg ? "търсен кандидат" : "requested candidate"] = candidateQuery;
    facts[bg ? "резултат на кандидата" : "candidate result"] = candidate
      ? `${candidate.president}: ${fmtInt(candidate.votes, lang)} (${fmtPct(round2(100 * candidate.shareOfValid), lang)})`
      : bg
        ? "не е намерен в този тур"
        : "not found in this round";
  }
  // ⚠ A SUBSTITUTED CYCLE IS RECORDED, the way an unresolvable place is. The fallback is right
  // — better the latest than a 404 — but the LLM narrates `facts`, so „резултатите през 2019"
  // would otherwise come back as a confident 2021 answer with nothing saying which year it is.
  if (askedCycle && !pvrCycle.startsWith(askedCycle) && pvrCycle !== askedCycle)
    facts[bg ? "няма президентски избор през" : "no presidential election in"] =
      askedCycle;
  if (sr.turnout?.pct !== null && sr.turnout?.pct !== undefined)
    facts[bg ? "активност" : "turnout"] = fmtPct(
      round2(100 * sr.turnout.pct),
      lang,
    );

  // ⚠ OBLAST FIRST WHEN NAMED, and a qualifier counts as naming it. `resolveMunicipality`
  // substring-matches and every oblast centre shares its name with a município, so a
  // municipality-first single argument makes the oblast tier unreachable.
  const placeArg = firstString(args.place);
  const oblastArg = firstString(args.oblast);
  const QUALIFIER = /^\s*(област|обл\.?|oblast|region)\s+/iu;
  const qualified = QUALIFIER.test(placeArg);
  const oblastQuery =
    oblastArg || (qualified ? placeArg.replace(QUALIFIER, "") : "");
  const place = qualified ? "" : placeArg;

  if (oblastQuery || place) {
    const ob = oblastQuery ? resolveOblast(oblastQuery) : undefined;
    const muni = ob
      ? undefined
      : place
        ? await resolveMunicipality(place)
        : undefined;
    const asked = oblastQuery || place;
    if (!ob && !muni)
      return noData(
        "presidentialResults",
        bg
          ? `Президентски избори — ${label}`
          : `Presidential election — ${label}`,
        provenance,
        { ...facts, [bg ? "непознато място" : "unknown place"]: asked },
      );

    // ⚠ `SOF` IS A RESOLVER ALIAS AND A KEY IN NO VOTE FILE. Sofia city is the three МИР
    // S23/S24/S25 in every pvr tree, so a municipality lookup on it answers „no data" about the
    // largest município in the country. `areaResults.ts` makes the same hand-off.
    const sofia = muni?.obshtina === "SOF";
    const useOblast = !!ob || sofia;
    const file = useOblast ? "region_votes" : "municipality_votes";
    const keys = useOblast
      ? oblastGroup(sofia ? "SOF" : ob!.code)
      : [muni!.obshtina];
    const data = await fetchData<{ entries: PlaceEntry[] }>(
      `/${pvrCycle}/tur${sr.round}/${file}.json`,
    ).catch(() => ({ entries: [] as PlaceEntry[] }));
    provenance.push(`${pvrCycle}/tur${sr.round}/${file}.json`);
    const found = placeRows(
      (data.entries ?? []).filter((e) => keys.includes(e.key)),
      sr.ranking ?? [],
      lang,
    );
    // ⚠ THE SCOPE IS IN THE TITLE. „Пловдив" alone cannot distinguish the município from the
    // oblast, and 15 more oblasts carry the same collision.
    // ⚠ THE SCOPE, AND THE МИР COUNT WHERE IT IS NOT ONE. „Пловдив (област)" over two МИР and
    // „Пловдив (област)" over one are different numbers under one label; saying „2 МИР" is what
    // lets a reader check the figure against a per-МИР source.
    const mir = keys.length > 1 ? ` — ${keys.length} МИР` : "";
    const name = sofia
      ? bg
        ? `София (столична община${mir})`
        : `Sofia (city, ${keys.length} MIR)`
      : ob
        ? bg
          ? `${ob.name.bg} (област${mir})`
          : `${ob.name.en} (oblast${keys.length > 1 ? `, ${keys.length} MIR` : ""})`
        : bg
          ? `${muni!.name} (община)`
          : `${muni!.name} (municipality)`;
    if (!found)
      return noData("presidentialResults", `${name} — ${label}`, provenance, {
        ...facts,
        [bg ? "няма данни за" : "no data for"]: name,
      });
    if (found.reg > 0)
      facts[bg ? `активност (${name})` : `turnout (${name})`] = fmtPct(
        round2((100 * found.cast) / found.reg),
        lang,
      );
    const shown = found.rows.slice(0, MAX_ROWS);
    return {
      tool: "presidentialResults",
      kind: "table",
      title: `${name} — ${label}`,
      subtitle: bg
        ? "Процентите са от гласовете за двойки в това място."
        : "Percentages are of the ticket votes cast in this place.",
      ...barTable(columnsFor(lang, "tickets"), shown, "pair", "votes", lang),
      geo:
        ob || sofia
          ? oblastLocator(sofia ? SOFIA_CITY_CODES[0] : ob!.code, name)
          : muniLocator(muni!.obshtina, muni!.oblast, name),
      facts,
      provenance,
    };
  }

  const ranking = sr.ranking ?? [];
  const rows: Row[] = ranking.slice(0, MAX_ROWS).map((r) => ({
    pair: `${r.president} / ${r.vicePresident}`,
    nominatedBy: `${r.nominatedBy.name} (${kindLabel(r.nominatedBy.kind, lang)})`,
    votes: r.votes,
    pct: round2(100 * r.shareOfValid),
  }));
  ranking.slice(0, TOP_FACTS).forEach((r) => {
    facts[r.president] =
      `${fmtInt(r.votes, lang)} (${fmtPct(round2(100 * r.shareOfValid), lang)})`;
  });
  // ⚠ „не подкрепям никого" IS ABSENT BEFORE 2016, NOT ZERO — the ballot did not carry the
  // line, and a 0 would report that nobody chose an option nobody was offered.
  if (
    sr.votes?.noneOfTheAbove !== null &&
    sr.votes?.noneOfTheAbove !== undefined
  )
    facts[bg ? "не подкрепям никого" : "none of the above"] = fmtInt(
      sr.votes.noneOfTheAbove,
      lang,
    );

  // The winner map's colours — the only reader of `tickets.json`, hence fetched here.
  const ticketList = await fetchData<{ tickets: Ticket[] }>(
    `/${pvrCycle}/tickets.json`,
  ).catch(() => ({ tickets: [] as Ticket[] }));
  const tickets = new Map((ticketList.tickets ?? []).map((t) => [t.number, t]));
  const areas = await oblastWinners(pvrCycle, sr.round, tickets, lang);
  if (tickets.size) provenance.push(`${pvrCycle}/tickets.json`);
  if (areas.length)
    provenance.push(`${pvrCycle}/tur${sr.round}/region_votes.json`);
  return {
    tool: "presidentialResults",
    kind: "table",
    title: bg
      ? `Президентски избори — ${label}`
      : `Presidential election — ${label}`,
    subtitle: bg
      ? "Процентите са от действителните гласове (вкл. „не подкрепям никого“)."
      : "Percentages are of valid votes (including „none of the above“).",
    ...barTable(columnsFor(lang, "valid"), rows, "pair", "votes", lang),
    geo: oblastChoropleth(areas, {
      metricLabel: bg ? "Водеща двойка" : "Leading pair",
      colorMode: "explicit",
    }),
    facts,
    provenance,
  };
};
