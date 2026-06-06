// Parliament roll-call tools (current Народно събрание): MP party loyalty,
// attendance, faction cohesion, a per-MP voting profile, vote similarity
// ("who votes like X"), and a topic/keyword vote search. All read the
// precomputed derived metrics keyed by НС (parliament) number.

import { fetchData } from "./dataClient";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// ---- shared: current parliament + MP-name roster ----------------------------

type RollcallIndex = {
  ns: string;
  mpProfileByNs: Record<string, { mpNames: Record<string, string> }>;
};

let indexCache: Promise<RollcallIndex> | null = null;
const loadIndex = (): Promise<RollcallIndex> => {
  if (!indexCache)
    indexCache = fetchData<RollcallIndex>("/parliament/votes/index.json");
  return indexCache;
};

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s.\-_]+/g, " ")
    .trim();

// Bulgarian → Latin (the official Streamlined Romanization, Наредба за
// транслитерацията). Lets an English-spelled MP name match the Cyrillic-only
// roster: a query is matched in romanized space, so "Asen Vasilev" hits
// "АСЕН ВАСКОВ ВАСИЛЕВ" and Cyrillic queries still work (they romanize too).
const CYR2LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};

// Lowercase, romanize each Cyrillic letter (Latin passes through unchanged),
// collapse separators — the common key both scripts compare in.
export const translitKey = (s: string): string =>
  s
    .toLowerCase()
    .split("")
    .map((ch) => CYR2LAT[ch] ?? ch)
    .join("")
    .replace(/[\s.\-_]+/g, " ")
    .trim();

// Resolve a free-text MP name to {id, name} in the current parliament, in either
// script. Every query token must be a substring of the (romanized) roster name —
// handles patronymics + reversed order ("Борисов Бойко" ↦ "БОЙКО … БОРИСОВ") and
// morphological endings (name includes the token, e.g. "Иванова" ⊇ "Иванов").
// Substring (not a loose shared-prefix) so a lone common surname can't bind to
// the wrong MP (e.g. a "Георгиев" query never grabs a "Георги …" first-name MP).
const findMp = (
  query: string,
  mpNames: Record<string, string>,
): { id: number; name: string } | undefined => {
  const toks = translitKey(query)
    .split(" ")
    .filter((t) => t.length >= 3);
  if (!toks.length) return undefined;
  let best: { id: number; name: string } | undefined;
  for (const [id, name] of Object.entries(mpNames)) {
    const key = translitKey(name);
    const allHit = toks.every((t) => key.includes(t));
    if (allHit && (!best || name.length < best.name.length))
      best = { id: Number(id), name };
  }
  return best ? { id: best.id, name: best.name } : undefined;
};

const titleCase = (name: string): string =>
  name
    .toLocaleLowerCase("bg-BG")
    .replace(
      /(^|\s)(\p{L})/gu,
      (_, sp: string, ch: string) => sp + ch.toLocaleUpperCase("bg-BG"),
    );

// ---- MP party loyalty -------------------------------------------------------

type LoyaltyEntry = {
  mpId: number;
  partyShort: string;
  votesCast: number;
  loyaltyPct: number;
};
type DerivedFile<T> = { byNs: Record<string, { entries: T[] }> };

const noParliament = (
  tool: string,
  ctx: ToolContext,
  prov: string,
): Envelope => ({
  tool,
  domain: "people",
  kind: "scalar",
  title:
    ctx.lang === "bg"
      ? "Няма данни за това Народно събрание"
      : "No data for this parliament",
  viz: "none",
  facts: {},
  provenance: [prov],
});

export const mpLoyalty = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const idx = await loadIndex();
  const d = await fetchData<DerivedFile<LoyaltyEntry>>(
    "/parliament/votes/derived/loyalty.json",
  );
  const slice = d.byNs[idx.ns];
  if (!slice?.entries?.length)
    return noParliament(
      "mpLoyalty",
      ctx,
      "parliament/votes/derived/loyalty.json",
    );
  const names = idx.mpProfileByNs[idx.ns]?.mpNames ?? {};
  const named = slice.entries.map((e) => ({
    mp: titleCase(names[String(e.mpId)] ?? `#${e.mpId}`),
    party: e.partyShort,
    loyalty: round2(e.loyaltyPct * 100),
    votes: e.votesCast,
  }));
  const ranked = [...named].sort((a, b) => b.loyalty - a.loyalty);
  const top = ranked.slice(0, 12);
  const least = ranked[ranked.length - 1];
  const columns: Column[] = [
    { key: "mp", label: bg ? "Депутат" : "MP" },
    { key: "party", label: bg ? "Група" : "Group" },
    {
      key: "loyalty",
      label: bg ? "Лоялност" : "Loyalty",
      numeric: true,
      format: "pct",
    },
    {
      key: "votes",
      label: bg ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
  ];
  return {
    tool: "mpLoyalty",
    domain: "people",
    kind: "table",
    title: bg
      ? `Партийна лоялност на депутатите (${idx.ns}-о НС)`
      : `MP party loyalty (${idx.ns}th National Assembly)`,
    subtitle: bg
      ? "Дял на гласовете, съвпадащи с групата"
      : "Share of votes cast with the MP's group",
    columns,
    rows: top as Row[],
    viz: "none",
    facts: {
      ns: idx.ns,
      most_loyal: top[0]
        ? `${top[0].mp} (${top[0].party}, ${top[0].loyalty}%)`
        : "—",
      least_loyal: least
        ? `${least.mp} (${least.party}, ${least.loyalty}%)`
        : "—",
    },
    provenance: ["parliament/votes/derived/loyalty.json"],
  };
};

// ---- MP attendance ----------------------------------------------------------

type AttendanceEntry = {
  mpId: number;
  partyShort: string;
  presentPct: number;
  presentCount: number;
  totalItems: number;
};

export const mpAttendance = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const idx = await loadIndex();
  const d = await fetchData<DerivedFile<AttendanceEntry>>(
    "/parliament/votes/derived/attendance.json",
  );
  const slice = d.byNs[idx.ns];
  if (!slice?.entries?.length)
    return noParliament(
      "mpAttendance",
      ctx,
      "parliament/votes/derived/attendance.json",
    );
  const names = idx.mpProfileByNs[idx.ns]?.mpNames ?? {};
  const named = slice.entries.map((e) => ({
    mp: titleCase(names[String(e.mpId)] ?? `#${e.mpId}`),
    party: e.partyShort,
    present: round2(e.presentPct * 100),
  }));
  const ranked = [...named].sort((a, b) => b.present - a.present);
  const top = ranked.slice(0, 12);
  const worst = ranked[ranked.length - 1];
  return {
    tool: "mpAttendance",
    domain: "people",
    kind: "table",
    title: bg
      ? `Присъствие на депутатите (${idx.ns}-о НС)`
      : `MP attendance (${idx.ns}th National Assembly)`,
    subtitle: bg
      ? "Дял на гласуванията, в които депутатът е участвал"
      : "Share of votes the MP took part in",
    columns: [
      { key: "mp", label: bg ? "Депутат" : "MP" },
      { key: "party", label: bg ? "Група" : "Group" },
      {
        key: "present",
        label: bg ? "Присъствие" : "Present",
        numeric: true,
        format: "pct",
      },
    ],
    rows: top as Row[],
    viz: "none",
    facts: {
      ns: idx.ns,
      best_attendance: top[0] ? `${top[0].mp} (${top[0].present}%)` : "—",
      worst_attendance: worst ? `${worst.mp} (${worst.present}%)` : "—",
    },
    provenance: ["parliament/votes/derived/attendance.json"],
  };
};

// ---- faction cohesion -------------------------------------------------------

type CohesionEntry = {
  partyShort: string;
  itemsCovered: number;
  meanCohesion: number;
  membersTracked: number;
};

export const factionCohesion = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const idx = await loadIndex();
  const d = await fetchData<DerivedFile<CohesionEntry>>(
    "/parliament/votes/derived/cohesion.json",
  );
  const slice = d.byNs[idx.ns];
  if (!slice?.entries?.length)
    return noParliament(
      "factionCohesion",
      ctx,
      "parliament/votes/derived/cohesion.json",
    );
  const ranked = [...slice.entries].sort(
    (a, b) => b.meanCohesion - a.meanCohesion,
  );
  const rows: Row[] = ranked.map((e) => ({
    party: e.partyShort,
    cohesion: round2(e.meanCohesion * 100),
    members: e.membersTracked,
    items: e.itemsCovered,
  }));
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  return {
    tool: "factionCohesion",
    domain: "people",
    kind: "table",
    title: bg
      ? `Сплотеност на парламентарните групи (${idx.ns}-о НС)`
      : `Faction cohesion (${idx.ns}th National Assembly)`,
    subtitle: bg
      ? "Колко единно гласува всяка група"
      : "How uniformly each group votes",
    columns: [
      { key: "party", label: bg ? "Група" : "Group" },
      {
        key: "cohesion",
        label: bg ? "Сплотеност" : "Cohesion",
        numeric: true,
        format: "pct",
      },
      {
        key: "members",
        label: bg ? "Членове" : "Members",
        numeric: true,
        format: "int",
      },
      {
        key: "items",
        label: bg ? "Гласувания" : "Votes",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      ns: idx.ns,
      most_cohesive: top
        ? `${top.partyShort} (${round2(top.meanCohesion * 100)}%)`
        : "—",
      least_cohesive: bottom
        ? `${bottom.partyShort} (${round2(bottom.meanCohesion * 100)}%)`
        : "—",
    },
    provenance: ["parliament/votes/derived/cohesion.json"],
  };
};

// ---- per-MP voting profile --------------------------------------------------

export const mpVotingProfile = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const query = String(args.name ?? "");
  const idx = await loadIndex();
  const names = idx.mpProfileByNs[idx.ns]?.mpNames ?? {};
  const mp = findMp(query, names);
  if (!mp) {
    return {
      tool: "mpVotingProfile",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Не намерих депутат „${query}“ в ${idx.ns}-о НС`
        : `No MP matched "${query}" in the ${idx.ns}th Assembly`,
      viz: "none",
      facts: { query },
      provenance: ["parliament/votes/index.json"],
    };
  }
  const [loy, att] = await Promise.all([
    fetchData<DerivedFile<LoyaltyEntry>>(
      "/parliament/votes/derived/loyalty.json",
    ),
    fetchData<DerivedFile<AttendanceEntry>>(
      "/parliament/votes/derived/attendance.json",
    ),
  ]);
  const l = loy.byNs[idx.ns]?.entries?.find((e) => e.mpId === mp.id);
  const a = att.byNs[idx.ns]?.entries?.find((e) => e.mpId === mp.id);
  const facts: Record<string, string | number> = {
    name: titleCase(mp.name),
    ns: idx.ns,
  };
  if (l) {
    facts.party = l.partyShort;
    facts.loyalty = `${round2(l.loyaltyPct * 100)}%`;
    facts.votes_cast = l.votesCast;
  }
  if (a) facts.attendance = `${round2(a.presentPct * 100)}%`;
  return {
    tool: "mpVotingProfile",
    domain: "people",
    kind: "scalar",
    title: bg
      ? `${titleCase(mp.name)} — парламентарен профил (${idx.ns}-о НС)`
      : `${titleCase(mp.name)} — voting profile (${idx.ns}th Assembly)`,
    viz: "none",
    facts,
    provenance: [
      "parliament/votes/derived/loyalty.json",
      "parliament/votes/derived/attendance.json",
    ],
  };
};

// ---- vote similarity ("who votes like X") -----------------------------------

type SimilarityEntry = {
  mpId: number;
  topK: { mpId: number; score: number; overlap: number }[];
};

export const mpSimilarity = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const query = String(args.name ?? "");
  const idx = await loadIndex();
  const names = idx.mpProfileByNs[idx.ns]?.mpNames ?? {};
  const mp = findMp(query, names);
  if (!mp) {
    return {
      tool: "mpSimilarity",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Не намерих депутат „${query}“ в ${idx.ns}-о НС`
        : `No MP matched "${query}" in the ${idx.ns}th Assembly`,
      viz: "none",
      facts: { query },
      provenance: ["parliament/votes/index.json"],
    };
  }
  const d = await fetchData<DerivedFile<SimilarityEntry>>(
    "/parliament/votes/derived/similarity.json",
  );
  const entry = d.byNs[idx.ns]?.entries?.find((e) => e.mpId === mp.id);
  if (!entry?.topK?.length) {
    return {
      tool: "mpSimilarity",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Няма данни за сходство за ${titleCase(mp.name)}`
        : `No similarity data for ${titleCase(mp.name)}`,
      viz: "none",
      facts: { name: titleCase(mp.name) },
      provenance: ["parliament/votes/derived/similarity.json"],
    };
  }
  const rows: Row[] = entry.topK.slice(0, 10).map((k) => ({
    mp: titleCase(names[String(k.mpId)] ?? `#${k.mpId}`),
    score: round2(k.score * 100),
    overlap: k.overlap,
  }));
  return {
    tool: "mpSimilarity",
    domain: "people",
    kind: "table",
    title: bg
      ? `Кой гласува като ${titleCase(mp.name)}? (${idx.ns}-о НС)`
      : `Who votes like ${titleCase(mp.name)}? (${idx.ns}th Assembly)`,
    columns: [
      { key: "mp", label: bg ? "Депутат" : "MP" },
      {
        key: "score",
        label: bg ? "Сходство" : "Similarity",
        numeric: true,
        format: "pct",
      },
      {
        key: "overlap",
        label: bg ? "Общи гласове" : "Shared votes",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      mp: titleCase(mp.name),
      ns: idx.ns,
      closest: rows[0] ? `${rows[0].mp} (${rows[0].score}%)` : "—",
    },
    provenance: ["parliament/votes/derived/similarity.json"],
  };
};

// ---- vote search (topic / keyword) ------------------------------------------

type TopicEntry = {
  date: string;
  title: string;
  topic: string;
  tally: { yes: number; no: number; abstain: number };
  outcome: string;
  contestScore: number;
};

const OUTCOME_LABEL: Record<string, { bg: string; en: string }> = {
  passed: { bg: "приет", en: "passed" },
  passed_unanimous: { bg: "приет (единодушно)", en: "passed (unanimous)" },
  failed: { bg: "отхвърлен", en: "failed" },
  rejected: { bg: "отхвърлен", en: "rejected" },
  tied: { bg: "равен резултат", en: "tied" },
};
const outcomeLabel = (o: string, lang: ToolContext["lang"]): string =>
  OUTCOME_LABEL[o]?.[lang] ?? o;

export const voteSearch = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const idx = await loadIndex();
  const d = await fetchData<{
    byNs: Record<string, { entries: TopicEntry[] }>;
  }>("/parliament/votes/derived/topic_index.json");
  const all = (d.byNs[idx.ns]?.entries ?? []).filter(
    (e) => typeof e.title === "string" && e.title.length > 0,
  );
  const query = norm(String(args.query ?? ""));
  // a query matches when any 4+ char token's 5-char stem appears in the title
  // (stem so "бюджета" still hits a "бюджет…" title across BG morphology).
  // Procedural words from the question phrasing are dropped so only the real
  // topic survives ("как гласува парламентът за бюджета" -> "бюдже").
  const STOP = new Set([
    "гласу",
    "гласо",
    "парла",
    "народ",
    "събра",
    "заседа",
    "поиме",
    "решен",
    "votes",
    "voted",
    "parli",
    "assem",
  ]);
  const stems = query
    .split(" ")
    .filter((t) => t.length >= 4)
    .map((t) => t.slice(0, 5))
    .filter((s) => !STOP.has(s));
  const matched =
    stems.length > 0
      ? all
          .filter((e) => stems.some((s) => norm(e.title).includes(s)))
          .sort((a, b) => b.contestScore - a.contestScore)
      : [...all].sort((a, b) => b.contestScore - a.contestScore);
  const toks = stems;
  const top = matched.slice(0, 12);
  if (!top.length) {
    return {
      tool: "voteSearch",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Няма намерени гласувания за „${args.query ?? ""}“`
        : `No votes found for "${args.query ?? ""}"`,
      viz: "none",
      facts: { query: String(args.query ?? ""), ns: idx.ns },
      provenance: ["parliament/votes/derived/topic_index.json"],
    };
  }
  const short = (t: string): string =>
    t.length > 80 ? `${t.slice(0, 78)}…` : t;
  const rows: Row[] = top.map((e) => {
    const t = e.tally ?? { yes: 0, no: 0, abstain: 0 };
    return {
      date: e.date,
      title: short(e.title),
      outcome: outcomeLabel(e.outcome ?? "", ctx.lang),
      tally: `${t.yes}–${t.no}–${t.abstain}`,
    };
  });
  return {
    tool: "voteSearch",
    domain: "people",
    kind: "table",
    title: toks.length
      ? bg
        ? `Гласувания за „${args.query}“ (${idx.ns}-о НС)`
        : `Votes on "${args.query}" (${idx.ns}th Assembly)`
      : bg
        ? `Най-оспорваните гласувания (${idx.ns}-о НС)`
        : `Most contested votes (${idx.ns}th Assembly)`,
    subtitle: bg ? "за–против–въздържал се" : "yes–no–abstain",
    columns: [
      { key: "date", label: bg ? "Дата" : "Date" },
      { key: "title", label: bg ? "Гласуване" : "Vote" },
      { key: "outcome", label: bg ? "Резултат" : "Outcome" },
      { key: "tally", label: bg ? "За–Против–Възд." : "Y–N–A" },
    ],
    rows,
    viz: "none",
    facts: {
      ns: idx.ns,
      matches: matched.length,
      top: top[0]
        ? `${short(top[0].title)} — ${outcomeLabel(top[0].outcome, ctx.lang)}`
        : "—",
    },
    provenance: ["parliament/votes/derived/topic_index.json"],
  };
};
