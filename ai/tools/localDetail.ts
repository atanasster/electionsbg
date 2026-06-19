// Phase B — per-município local-election detail + extraordinary (chmi) feed.

import { fetchCanonicalParties, fetchData } from "./dataClient";
import { fmtInt, fmtPct } from "./format";
import {
  fetchLocalMuni,
  localCycleYear,
  LOCAL_CYCLES,
  resolveLocalCycle,
} from "./localDataset";
import { resolveMunicipality } from "./place";
import { muniLocator } from "./geo";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

const noMuni = (tool: string, query: string, ctx: ToolContext): Envelope => ({
  tool,
  domain: "local",
  kind: "scalar",
  title:
    ctx.lang === "bg"
      ? `Не намерих община „${query}“`
      : `No municipality matched "${query}"`,
  viz: "none",
  facts: { query },
  provenance: ["municipalities.json"],
});

// A município's elected mayor across the local-election cycles ("last mayors of
// Sofia"). Each cycle's bundle holds mayor.elected; we walk all regular cycles.
export const localMayorHistory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) return noMuni("localMayorHistory", String(args.place ?? ""), ctx);
  const results = await Promise.all(
    LOCAL_CYCLES.map(async (c) => {
      try {
        const b = await fetchLocalMuni(c.name, place.obshtina);
        return { year: localCycleYear(c.name), elected: b.mayor.elected };
      } catch {
        return { year: localCycleYear(c.name), elected: null };
      }
    }),
  );
  const rows: Row[] = results
    .filter((r) => r.elected)
    .map((r) => ({
      year: r.year,
      mayor: r.elected!.candidateName,
      party: r.elected!.localPartyName,
    }));
  if (!rows.length) {
    return {
      tool: "localMayorHistory",
      domain: "local",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма данни за кметове на ${place.name}`
          : `No mayor data for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: [`*/municipalities/${place.obshtina}.json`],
    };
  }
  return {
    tool: "localMayorHistory",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Кметове на ${place.name} по мандати`
        : `Mayors of ${place.nameEn} by term`,
    columns: [
      { key: "year", label: ctx.lang === "bg" ? "Избори" : "Election" },
      { key: "mayor", label: ctx.lang === "bg" ? "Кмет" : "Mayor" },
      {
        key: "party",
        label: ctx.lang === "bg" ? "Партия / коалиция" : "Party / coalition",
      },
    ],
    rows,
    viz: "none",
    facts: {
      // hidden deep-link keys (cross-cycle -> the latest cycle's dashboard)
      obshtina_id: place.obshtina,
      cycle_id: LOCAL_CYCLES[0].name,
      place: place.name,
      latest_mayor: String(rows[0].mayor),
      latest_party: String(rows[0].party),
      terms: rows.length,
    },
    provenance: LOCAL_CYCLES.map(
      (c) => `${c.name}/municipalities/${place.obshtina}.json`,
    ),
  };
};

// Sub-municipal mayors: Sofia районs (bundle.districts) or a município's
// кметства / settlement mayors (bundle.kmetstva). Each entry carries candidates
// with an isElected flag. Answers "районните кметове на София", "кметовете на
// кметствата в Асеновград".
type SubMayorCand = {
  candidateName: string;
  localPartyName: string;
  isElected?: boolean;
  votes?: number;
};
type SubArea = {
  districtName?: string;
  kmetstvoName?: string;
  candidates?: SubMayorCand[];
};

export const localSubMayors = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) return noMuni("localSubMayors", String(args.place ?? ""), ctx);
  const b = await fetchLocalMuni(cycle, place.obshtina);
  const districts = (b.districts ?? []) as SubArea[];
  const kmetstva = (b.kmetstva ?? []) as SubArea[];
  const useDistricts = districts.length > 0; // Sofia районs
  const entries = useDistricts ? districts : kmetstva;
  const level = useDistricts
    ? ctx.lang === "bg"
      ? "районни кметове"
      : "district mayors"
    : ctx.lang === "bg"
      ? "кметове на кметства"
      : "settlement mayors";
  if (!entries.length) {
    return {
      tool: "localSubMayors",
      domain: "local",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма райони/кметства за ${place.name}`
          : `No districts/settlements for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: [`${cycle}/municipalities/${place.obshtina}.json`],
    };
  }
  const rows: Row[] = entries
    .map((e) => {
      const cands = e.candidates ?? [];
      const won =
        cands.find((c) => c.isElected) ??
        [...cands].sort((x, y) => (y.votes ?? 0) - (x.votes ?? 0))[0];
      return {
        area: String(e.districtName ?? e.kmetstvoName ?? ""),
        mayor: won?.candidateName ?? "—",
        party: won?.localPartyName ?? "—",
      };
    })
    .filter((r) => r.area)
    .sort((a, b2) => String(a.area).localeCompare(String(b2.area), "bg"));
  const shown = rows.slice(0, 80);
  return {
    tool: "localSubMayors",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `${useDistricts ? "Районни кметове" : "Кметове на кметствата"} — ${place.name} (${localCycleYear(cycle)})`
        : `${useDistricts ? "District mayors" : "Settlement mayors"} — ${place.nameEn} (${localCycleYear(cycle)})`,
    columns: [
      {
        key: "area",
        label: useDistricts
          ? ctx.lang === "bg"
            ? "Район"
            : "District"
          : ctx.lang === "bg"
            ? "Кметство"
            : "Settlement",
      },
      { key: "mayor", label: ctx.lang === "bg" ? "Кмет" : "Mayor" },
      {
        key: "party",
        label: ctx.lang === "bg" ? "Партия / коалиция" : "Party / coalition",
      },
    ],
    rows: shown,
    viz: "none",
    facts: {
      // hidden deep-link keys (consumed by ai/render/links.ts)
      obshtina_id: place.obshtina,
      cycle_id: cycle,
      place: place.name,
      level,
      total: rows.length,
      shown: shown.length,
    },
    provenance: [`${cycle}/municipalities/${place.obshtina}.json`],
  };
};

export const localMayorRace = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) return noMuni("localMayorRace", String(args.place ?? ""), ctx);
  const b = await fetchLocalMuni(cycle, place.obshtina);
  // round2 if there was a runoff, else round1
  const cands = (b.mayor.round2.length ? b.mayor.round2 : b.mayor.round1)
    .slice()
    .sort((x, y) => (y.votes ?? 0) - (x.votes ?? 0));

  const columns: Column[] = [
    { key: "name", label: ctx.lang === "bg" ? "Кандидат" : "Candidate" },
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const rows: Row[] = cands.map((c) => ({
    name: `${c.isElected ? "★ " : ""}${c.candidateName}`,
    party: c.localPartyName,
    votes: c.votes ?? null,
    pct: c.pctOfValid != null ? round2(c.pctOfValid) : null,
  }));
  const winner = b.mayor.elected;
  return {
    tool: "localMayorRace",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Кмет на ${b.obshtinaName} — ${localCycleYear(cycle)}${b.mayor.round2.length ? " (II тур)" : ""}`
        : `Mayor of ${place.nameEn} — ${localCycleYear(cycle)}${b.mayor.round2.length ? " (runoff)" : ""}`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      // hidden deep-link keys (consumed by ai/render/links.ts)
      obshtina_id: place.obshtina,
      cycle_id: cycle,
      municipality: b.obshtinaName,
      winner: winner
        ? `${winner.candidateName} (${winner.localPartyName})`
        : "—",
      winner_pct:
        winner?.pctOfValid != null ? fmtPct(winner.pctOfValid, ctx.lang) : "—",
      candidates: cands.length,
    },
    provenance: [`${cycle}/municipalities/${place.obshtina}.json`],
  };
};

// Where the elected mayor ran strongest / weakest, by polling station — reads
// the per-section mayor votes added to the section shard (mayorVotes for a
// община, rayonMayorVotes for a Sofia район). Answers "where in <town> did the
// mayor do best?". Self-handles places without per-section mayor data (older
// cycles, the Sofia city aggregate) with a graceful scalar.
type SectionVote = { localPartyNum: number; votes: number };
type LocalSectionLite = {
  sectionCode: string;
  settlement: string;
  address?: string;
  mayorVotes?: SectionVote[];
  mayorValid?: number;
  rayonMayorVotes?: SectionVote[];
  rayonMayorValid?: number;
};

export const localMayorSections = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place)
    return noMuni("localMayorSections", String(args.place ?? ""), ctx);
  const b = await fetchLocalMuni(cycle, place.obshtina);
  const winner = b.mayor.elected;
  const noData = (msg: string): Envelope => ({
    tool: "localMayorSections",
    domain: "local",
    kind: "scalar",
    title: msg,
    viz: "none",
    facts: { municipality: b.obshtinaName, cycle_id: cycle },
    provenance: [`${cycle}/sections/${place.obshtina}.json`],
  });
  if (!winner)
    return noData(
      ctx.lang === "bg"
        ? `Няма избран кмет в ${b.obshtinaName}`
        : `No elected mayor in ${place.nameEn}`,
    );

  const isRayon = /^S2\d{3}$/.test(place.obshtina);
  let shard: { sections: LocalSectionLite[] } | undefined;
  try {
    shard = await fetchData<{ sections: LocalSectionLite[] }>(
      `/${cycle}/sections/${place.obshtina}.json`,
    );
  } catch {
    shard = undefined;
  }
  const ranked = (shard?.sections ?? [])
    .map((s) => {
      const votes = isRayon ? s.rayonMayorVotes : s.mayorVotes;
      const valid = (isRayon ? s.rayonMayorValid : s.mayorValid) ?? 0;
      const w = votes?.find((v) => v.localPartyNum === winner.localPartyNum);
      if (!w || valid <= 0) return null;
      return {
        where: s.address || s.settlement || s.sectionCode,
        section: s.sectionCode,
        votes: w.votes,
        share: round2((100 * w.votes) / valid),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, c) => c.share - a.share);

  if (ranked.length === 0)
    return noData(
      ctx.lang === "bg"
        ? `Няма данни по секции за кмета на ${b.obshtinaName}`
        : `No per-station mayor data for ${place.nameEn}`,
    );

  // Top + bottom few, tagged so the geographic spread reads at a glance.
  const N = Math.min(5, Math.floor(ranked.length / 2) || ranked.length);
  const strong = ranked.slice(0, N);
  const weak = ranked.length > N ? ranked.slice(-N).reverse() : [];
  const grpLabel = (s: boolean) =>
    s
      ? ctx.lang === "bg"
        ? "най-силни"
        : "strongest"
      : ctx.lang === "bg"
        ? "най-слаби"
        : "weakest";
  const columns: Column[] = [
    { key: "grp", label: ctx.lang === "bg" ? "Секции" : "Stations" },
    { key: "where", label: ctx.lang === "bg" ? "Място" : "Where" },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "share", label: "%", numeric: true, format: "pct" },
  ];
  const rows: Row[] = [
    ...strong.map((r) => ({ grp: grpLabel(true), ...r })),
    ...weak.map((r) => ({ grp: grpLabel(false), ...r })),
  ];
  const shares = ranked.map((r) => r.share);
  return {
    tool: "localMayorSections",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `${winner.candidateName} по секции — ${b.obshtinaName}, ${localCycleYear(cycle)}`
        : `${winner.candidateName} by polling station — ${place.nameEn}, ${localCycleYear(cycle)}`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      obshtina_id: place.obshtina,
      cycle_id: cycle,
      municipality: b.obshtinaName,
      mayor: winner.candidateName,
      stations: ranked.length,
      best: `${strong[0].share}% (${strong[0].where})`,
      worst: `${ranked[ranked.length - 1].share}% (${ranked[ranked.length - 1].where})`,
      spread: `${round2(Math.max(...shares) - Math.min(...shares))} pp`,
    },
    provenance: [`${cycle}/sections/${place.obshtina}.json`],
  };
};

// id -> brand colour from the canonical-party registry. The local-council bundle
// stores only `primaryCanonicalId`, so the hemicycle resolves each party's colour
// here (mirrors the site's LocalCouncilHemicycleTile, which uses `colorFor`).
type CanonColorFile = { parties: { id: string; color?: string }[] };
const canonicalColorMap = async (): Promise<Record<string, string>> => {
  const canon = await fetchCanonicalParties<CanonColorFile>();
  const map: Record<string, string> = {};
  for (const p of canon.parties) if (p.color) map[p.id] = p.color;
  return map;
};

export const localCouncil = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) return noMuni("localCouncil", String(args.place ?? ""), ctx);
  const b = await fetchLocalMuni(cycle, place.obshtina);
  const bg = ctx.lang === "bg";
  const parties = [...b.council]
    .filter((p) => p.mandatesWon > 0)
    .sort((x, y) => y.mandatesWon - x.mandatesWon);
  const colors = await canonicalColorMap();

  const columns: Column[] = [
    { key: "party", label: bg ? "Партия" : "Party" },
    {
      key: "seats",
      label: bg ? "Места" : "Seats",
      numeric: true,
      format: "int",
    },
    {
      key: "votes",
      label: bg ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  // `color` rides along for the hemicycle renderer (not a declared column).
  const rows: Row[] = parties.map((p) => ({
    party: p.localPartyName,
    seats: p.mandatesWon,
    votes: p.totalVotes,
    pct: round2(p.pctOfValid),
    color: colors[p.primaryCanonicalId] ?? null,
  }));
  const totalSeats = parties.reduce((s, p) => s + p.mandatesWon, 0);
  const majority = Math.floor(totalSeats / 2) + 1;
  const top = parties[0];
  const hasMajority = !!top && top.mandatesWon >= majority;
  return {
    tool: "localCouncil",
    domain: "local",
    kind: "table",
    title: bg
      ? `Общински съвет на ${b.obshtinaName} — ${localCycleYear(cycle)}`
      : `${place.nameEn} municipal council — ${localCycleYear(cycle)}`,
    subtitle: bg
      ? `${totalSeats} места · мнозинство ${majority}`
      : `${totalSeats} seats · majority ${majority}`,
    columns,
    rows,
    viz: "hemicycle",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      bg ? place.name : place.nameEn,
    ),
    facts: {
      // hidden deep-link keys (consumed by ai/render/links.ts)
      obshtina_id: place.obshtina,
      cycle_id: cycle,
      municipality: b.obshtinaName,
      total_seats: totalSeats,
      majority,
      leader: top ? `${top.localPartyName} (${top.mandatesWon})` : "—",
      control: hasMajority
        ? bg
          ? `${top.localPartyName} има самостоятелно мнозинство`
          : `${top.localPartyName} holds an outright majority`
        : bg
          ? "няма самостоятелно мнозинство"
          : "no single-party majority",
    },
    provenance: [`${cycle}/municipalities/${place.obshtina}.json`],
  } as Envelope;
};

// ---- extraordinary (chmi) elections feed ------------------------------------

type ChmiEvent = {
  cycle: string;
  date: string;
  obshtinaCode: string;
  obshtinaName: string;
  kind: string;
  kmetstvoName?: string;
  candidateName?: string;
  localPartyName?: string;
};
type ChmiHistory = {
  byObshtina: Record<string, ChmiEvent[]>;
  allEvents: ChmiEvent[];
};

const KIND_LABEL: Record<string, { bg: string; en: string }> = {
  kmetstvo_mayor: { bg: "кмет на кметство", en: "kmetstvo mayor" },
  obshtina_mayor: { bg: "кмет на община", en: "municipality mayor" },
  council: { bg: "общински съвет", en: "council" },
};

export const chmiEvents = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const h = await fetchData<ChmiHistory>("/local_chmi_history.json");
  let events = h.allEvents;
  let placeName: string | undefined;
  if (args.place) {
    const place = await resolveMunicipality(String(args.place));
    if (place) {
      events = h.byObshtina[place.obshtina] ?? [];
      placeName = place.name;
    }
  }
  const recent = [...events]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12);

  const columns: Column[] = [
    { key: "date", label: ctx.lang === "bg" ? "Дата" : "Date" },
    { key: "place", label: ctx.lang === "bg" ? "Място" : "Place" },
    { key: "kind", label: ctx.lang === "bg" ? "Вид" : "Type" },
    { key: "winner", label: ctx.lang === "bg" ? "Избран" : "Elected" },
  ];
  const rows: Row[] = recent.map((e) => ({
    date: e.date,
    place: e.kmetstvoName
      ? `${e.obshtinaName} / ${e.kmetstvoName}`
      : e.obshtinaName,
    kind: (KIND_LABEL[e.kind] ?? { bg: e.kind, en: e.kind })[ctx.lang],
    winner: e.candidateName ?? "—",
  }));
  return {
    tool: "chmiEvents",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Извънредни местни избори${placeName ? ` — ${placeName}` : ""}`
        : `Extraordinary local elections${placeName ? ` — ${placeName}` : ""}`,
    columns,
    rows,
    viz: "none",
    facts: {
      total: fmtInt(events.length, ctx.lang),
      shown: recent.length,
      latest: recent[0]?.date ?? "—",
    },
    provenance: ["local_chmi_history.json"],
  };
};
