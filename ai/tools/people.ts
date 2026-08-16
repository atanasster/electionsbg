// D1 — people & oversight tools: MP assets/connections, officials assets,
// party-financing filing compliance, polling accuracy.

import { OFFICIAL_CATEGORY_LABELS } from "../../src/lib/officialCategoryLabels";
import { fetchData, fetchDb } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { ALL_ELECTIONS } from "./dataset";
import { matchParty } from "./matchParty";
import { officeLabel } from "./officeLabel";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// ---- MP declared assets -----------------------------------------------------

// One row of the `mp_assets_rankings` registry (matview mp_assets_rankings_table, migration
// 105) as /api/db/table delivers it — camelCase, money columns as STRINGS (Postgres numeric).
// This is the person_wealth_year series, NOT the retired assets-rankings.json figures: 154
// share-declaring MPs read lower here because the JSON also folded company shares in. See the
// registry header in functions/db_table.js. (persons-pg-retirement-v1 T2.5)
type MpRankRow = {
  name: string;
  partyGroupShort: string | null;
  isCurrent: boolean;
  totalAssetsEur: string | null;
  netWorthEur: string | null;
};

export const mpAssetsTop = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  // Registry, national list (defaultScope ns='all'), net-worth-ranked top 12 — the same order
  // and figures the /mp-assets tile renders, replacing the retired assets-rankings-top.json.
  const page = await fetchDb<{ rows: MpRankRow[] }>("table", {
    q: JSON.stringify({
      resource: "mp_assets_rankings",
      page: 0,
      pageSize: 12,
      sort: [{ id: "net_worth_eur", desc: true }],
    }),
  });
  const top = page.rows;
  const columns: Column[] = [
    { key: "mp", label: ctx.lang === "bg" ? "Депутат" : "MP" },
    { key: "group", label: ctx.lang === "bg" ? "Група" : "Group" },
    {
      key: "assets",
      label: ctx.lang === "bg" ? "Активи" : "Assets",
      numeric: true,
    },
  ];
  const rows: Row[] = top.map((m) => ({
    mp: m.name,
    group: m.partyGroupShort ?? "—",
    assets: fmtEurCompact(Number(m.totalAssetsEur ?? 0), ctx.lang),
  }));
  return {
    tool: "mpAssetsTop",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Депутати с най-големи декларирани активи"
        : "MPs by declared assets",
    columns,
    rows,
    viz: "none",
    facts: {
      richest: top[0]?.name ?? "—",
      richest_assets: top[0]
        ? fmtEurCompact(Number(top[0].totalAssetsEur ?? 0), ctx.lang)
        : "—",
    },
    provenance: ["db:mp_assets_rankings"],
  };
};

// ---- MP business connections ------------------------------------------------

type MpConn = {
  label: string;
  partyGroupShort?: string;
  totalDegree: number;
  highConfDegree?: number;
};

export const mpConnectionsTop = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<{ topMps: MpConn[] }>(
    "/parliament/connections-rankings-top.json",
  );
  const top = d.topMps.slice(0, 12);
  const columns: Column[] = [
    { key: "mp", label: ctx.lang === "bg" ? "Депутат" : "MP" },
    { key: "group", label: ctx.lang === "bg" ? "Група" : "Group" },
    {
      key: "links",
      label: ctx.lang === "bg" ? "Връзки" : "Links",
      numeric: true,
      format: "int",
    },
  ];
  const rows: Row[] = top.map((m) => ({
    mp: m.label,
    group: m.partyGroupShort ?? "—",
    links: m.totalDegree,
  }));
  return {
    tool: "mpConnectionsTop",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Депутати с най-много бизнес връзки"
        : "MPs by business connections",
    columns,
    rows,
    viz: "none",
    facts: {
      most_connected: top[0]?.label ?? "—",
      links: top[0]?.totalDegree ?? 0,
    },
    provenance: ["parliament/connections-rankings-top.json"],
  };
};

// ---- per-party rollups of MP assets / connections ---------------------------
// "which party's MPs are richest / most connected" — aggregate the full current
// roster by parliamentary group (the per-MP rankings already carry the group).

type GroupMp = {
  partyGroupShort?: string;
  isCurrent?: boolean;
  totalAssetsEur?: number;
  totalDegree?: number;
};

const cleanGroup = (g?: string): string =>
  (g ?? "—").replace(/^ПГ на\s+/i, "").trim();

const aggregateByParty = (
  mps: GroupMp[],
  value: (m: GroupMp) => number,
): { party: string; mps: number; sum: number; avg: number }[] => {
  const g = new Map<string, { mps: number; sum: number }>();
  for (const m of mps) {
    if (m.isCurrent === false) continue;
    const key = cleanGroup(m.partyGroupShort);
    if (key === "—") continue;
    const cur = g.get(key) ?? { mps: 0, sum: 0 };
    cur.mps += 1;
    cur.sum += value(m) || 0;
    g.set(key, cur);
  }
  return [...g].map(([party, t]) => ({
    party,
    mps: t.mps,
    sum: t.sum,
    avg: t.mps > 0 ? t.sum / t.mps : 0,
  }));
};

export const mpAssetsByParty = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // Registry, national list (defaultScope ns='all'), every CURRENT MP WHO FILED a declaration in
  // one page (maxPageSize 300 covers a full 240-seat parliament), rolled up per party client-side
  // exactly as the old assets-rankings.json pass did. The has_declaration filter matters: ns='all'
  // carries all 240 seats, but ~half have no declaration and would enter the per-party average as
  // €0 members and halve it — the old JSON only ever held the ~declaring MPs. Both filters push
  // server-side, so aggregateByParty's own isCurrent!==false skip is a no-op here.
  const page = await fetchDb<{ rows: MpRankRow[] }>("table", {
    q: JSON.stringify({
      resource: "mp_assets_rankings",
      page: 0,
      pageSize: 300,
      filters: {
        columns: [
          { id: "is_current", value: true },
          { id: "has_declaration", value: true },
        ],
      },
    }),
  });
  const groupMps: GroupMp[] = page.rows.map((m) => ({
    partyGroupShort: m.partyGroupShort ?? undefined,
    isCurrent: m.isCurrent,
    totalAssetsEur: Number(m.totalAssetsEur ?? 0),
  }));
  const rows0 = aggregateByParty(groupMps, (m) => m.totalAssetsEur ?? 0).sort(
    (a, b) => b.avg - a.avg,
  );
  const top = rows0[0];
  const rows: Row[] = rows0.map((r) => ({
    party: r.party,
    mps: r.mps,
    avg: fmtEurCompact(r.avg, ctx.lang),
    total: fmtEurCompact(r.sum, ctx.lang),
  }));
  return {
    tool: "mpAssetsByParty",
    domain: "people",
    kind: "table",
    title: bg
      ? "Декларирани активи по партия (средно на депутат)"
      : "Declared assets by party (average per MP)",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "mps",
        label: bg ? "Депутати" : "MPs",
        numeric: true,
        format: "int",
      },
      { key: "avg", label: bg ? "Средно" : "Average", numeric: true },
      { key: "total", label: bg ? "Общо" : "Total", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      richest_party: top
        ? `${top.party} (${fmtEurCompact(top.avg, ctx.lang)})`
        : "—",
    },
    provenance: ["db:mp_assets_rankings"],
  };
};

export const mpConnectionsByParty = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchData<{ topMps: GroupMp[] }>(
    "/parliament/connections-rankings.json",
  );
  const rows0 = aggregateByParty(d.topMps, (m) => m.totalDegree ?? 0).sort(
    (a, b) => b.sum - a.sum,
  );
  const top = rows0[0];
  const rows: Row[] = rows0.map((r) => ({
    party: r.party,
    mps: r.mps,
    links: Math.round(r.sum),
    avg: Math.round(r.avg * 10) / 10,
  }));
  return {
    tool: "mpConnectionsByParty",
    domain: "people",
    kind: "table",
    title: bg ? "Бизнес връзки по партия" : "Business connections by party",
    subtitle: bg
      ? "Общ брой фирмени връзки на депутатите от групата"
      : "Total company links across the group's MPs",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "mps",
        label: bg ? "Депутати" : "MPs",
        numeric: true,
        format: "int",
      },
      {
        key: "links",
        label: bg ? "Връзки" : "Links",
        numeric: true,
        format: "int",
      },
      { key: "avg", label: bg ? "Средно" : "Avg/MP", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      most_connected_party: top ? `${top.party} (${Math.round(top.sum)})` : "—",
    },
    provenance: ["parliament/connections-rankings.json"],
  };
};

// ---- officials declared assets ----------------------------------------------

type Official = {
  name: string;
  category: string;
  institution?: string | null;
  // Postgres `numeric` arrives as a string over the wire (no lossless JS number); parse
  // with Number() at the point of use.
  totalAssetsEur: string | null;
};
// Derived from the shared vocabulary. A hand-kept copy of four buckets meant
// the `category` argument silently matched nothing for the other 23 and the
// tool answered a narrowing question with the unfiltered list.
const OFFICIAL_CAT: Record<string, { bg: string; en: string }> =
  Object.fromEntries(
    Object.entries(OFFICIAL_CATEGORY_LABELS).map(([k, v]) => [
      k,
      { bg: v.bg.toLowerCase(), en: v.en.toLowerCase() },
    ]),
  );

export const officialsAssetsTop = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const catArg = String(args.category ?? "").toLowerCase();
  const cat = Object.keys(OFFICIAL_CAT).find(
    (k) =>
      catArg.includes(k) ||
      catArg.includes(OFFICIAL_CAT[k].bg) ||
      catArg.includes(OFFICIAL_CAT[k].en),
  );
  // Postgres (matview officials_rankings_table, migration 100) via the generic table
  // registry — replaces the retired data/officials/assets-rankings.json (T1.2). is_exec
  // scopes it to the executive leaderboard, exactly as /officials/assets does; the category
  // narrowing is pushed server-side instead of filtering a 767-row JSON slice, so an
  // uncommon category now ranks over the whole corpus rather than that top slice.
  const filters: Array<{ id: string; value: unknown }> = [
    { id: "is_exec", value: true },
  ];
  if (cat) filters.push({ id: "category", value: [cat] });
  const page = await fetchDb<{ rows: Official[] }>("table", {
    q: JSON.stringify({
      resource: "officials_rankings",
      page: 0,
      pageSize: 12,
      sort: [{ id: "total_assets_eur", desc: true }],
      filters: { columns: filters },
    }),
  });
  const top = page.rows;
  const columns: Column[] = [
    { key: "name", label: ctx.lang === "bg" ? "Лице" : "Official" },
    { key: "inst", label: ctx.lang === "bg" ? "Институция" : "Institution" },
    {
      key: "assets",
      label: ctx.lang === "bg" ? "Активи" : "Assets",
      numeric: true,
    },
  ];
  const rows: Row[] = top.map((o) => ({
    name: o.name,
    inst: o.institution ?? OFFICIAL_CAT[o.category]?.[ctx.lang] ?? o.category,
    assets: fmtEurCompact(Number(o.totalAssetsEur ?? 0), ctx.lang),
  }));
  return {
    tool: "officialsAssetsTop",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Висши служители с най-големи активи${cat ? ` (${OFFICIAL_CAT[cat].bg})` : ""}`
        : `Officials by declared assets${cat ? ` (${OFFICIAL_CAT[cat].en})` : ""}`,
    columns,
    rows,
    viz: "none",
    facts: {
      richest: top[0]?.name ?? "—",
      richest_assets: top[0]
        ? fmtEurCompact(Number(top[0].totalAssetsEur ?? 0), ctx.lang)
        : "—",
    },
    provenance: ["db:officials_rankings"],
  };
};

// ---- party-financing filing compliance --------------------------------------

type FinYear = {
  year: number;
  counts: {
    on_time: number;
    late: number;
    non_compliant: number;
    not_filed: number;
  };
};
type FinReports = {
  totals: { distinctParties: number; filings: number };
  years: FinYear[];
};

export const financingOverview = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<FinReports>("/financing/reports.json");
  const years = [...d.years].sort((a, b) => b.year - a.year).slice(0, 8);
  const columns: Column[] = [
    {
      key: "year",
      label: ctx.lang === "bg" ? "Година" : "Year",
      format: "int",
    },
    {
      key: "on_time",
      label: ctx.lang === "bg" ? "Навреме" : "On time",
      numeric: true,
      format: "int",
    },
    {
      key: "late",
      label: ctx.lang === "bg" ? "Закъснели" : "Late",
      numeric: true,
      format: "int",
    },
    {
      key: "missing",
      label: ctx.lang === "bg" ? "Неподали" : "Not filed",
      numeric: true,
      format: "int",
    },
  ];
  const rows: Row[] = years.map((y) => ({
    year: y.year,
    on_time: y.counts.on_time,
    late: y.counts.late,
    missing: y.counts.non_compliant + y.counts.not_filed,
  }));
  const latest = years[0];
  return {
    tool: "financingOverview",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Партийни финансови отчети — подаване (Сметна палата)"
        : "Party financial reports — filing (Court of Audit)",
    columns,
    rows,
    viz: "none",
    facts: {
      distinct_parties: fmtInt(d.totals.distinctParties, ctx.lang),
      total_filings: fmtInt(d.totals.filings, ctx.lang),
      latest_year: latest?.year ?? "—",
      latest_on_time: latest?.counts.on_time ?? 0,
    },
    provenance: ["financing/reports.json"],
  };
};

// ---- polling accuracy -------------------------------------------------------

type AgencyProfile = {
  name_bg: string;
  name_en: string;
  totalPolls: number;
  overallMAE: number;
  overallRMSE?: number;
  grade?: string;
  barrierCallRate?: number;
};

export const pollAccuracy = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<{ agencyProfiles: AgencyProfile[] }>(
    "/polls/accuracy.json",
  );
  // lower mean absolute error = more accurate
  const ranked = [...d.agencyProfiles]
    .filter((a) => Number.isFinite(a.overallMAE))
    .sort((a, b) => a.overallMAE - b.overallMAE)
    .slice(0, 12);
  const columns: Column[] = [
    { key: "agency", label: ctx.lang === "bg" ? "Агенция" : "Agency" },
    { key: "grade", label: ctx.lang === "bg" ? "Оценка" : "Grade" },
    {
      key: "polls",
      label: ctx.lang === "bg" ? "Проучвания" : "Polls",
      numeric: true,
      format: "int",
    },
    {
      key: "mae",
      label: ctx.lang === "bg" ? "Грешка (MAE)" : "Error (MAE)",
      numeric: true,
    },
    {
      key: "threshold",
      label: ctx.lang === "bg" ? "Праг %" : "Threshold %",
      numeric: true,
    },
  ];
  const rows: Row[] = ranked.map((a) => ({
    agency: ctx.lang === "bg" ? a.name_bg : a.name_en,
    grade: a.grade ?? "—",
    polls: a.totalPolls,
    mae: `${a.overallMAE} pp`,
    threshold:
      a.barrierCallRate != null
        ? `${Math.round(a.barrierCallRate * 100)}%`
        : "—",
  }));
  const best = ranked[0];
  return {
    tool: "pollAccuracy",
    domain: "elections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Точност на социологическите агенции"
        : "Polling-agency accuracy",
    columns,
    rows,
    viz: "none",
    facts: {
      most_accurate: best
        ? ctx.lang === "bg"
          ? best.name_bg
          : best.name_en
        : "—",
      best_grade: best?.grade ?? "—",
      best_mae: best ? `${best.overallMAE} pp` : "—",
    },
    provenance: ["polls/accuracy.json"],
  };
};

// ---- party campaign finance (income / expenses for one party) ---------------
// Reads the per-election filing at {election}/parties/financing.json (Court of
// Audit). financingOverview above is the cross-party *filing-compliance*
// catalogue; this is the actual money for ONE named party in one election.

type CikParty = { number: number; name: string; nickName?: string };
type FinBlock = { monetary: number; nonMonetary: number };
type FinIncome = {
  party: FinBlock;
  donors: FinBlock;
  candidates: FinBlock;
  mediaPackage: number;
};
type FinEntry = {
  party: number;
  filing: { income: FinIncome; expenses: unknown };
};

// recursive sum of every finite number under a value (expenses are deeply nested)
const sumNumbers = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (Array.isArray(v)) return v.reduce<number>((s, x) => s + sumNumbers(x), 0);
  if (v && typeof v === "object")
    return Object.values(v as Record<string, unknown>).reduce<number>(
      (s, x) => s + sumNumbers(x),
      0,
    );
  return 0;
};

const blockSum = (b: FinBlock): number => b.monetary + b.nonMonetary;

// "2024_10_27" -> "27.10.2024"
const electionDate = (name: string): string => {
  const m = name.match(/^(\d{4})_(\d{2})_(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : name;
};

export const partyFinance = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // campaign-finance filings exist only for elections flagged hasFinancials;
  // honour a requested election if it has one, else the latest that does.
  const withFin = ALL_ELECTIONS.filter(
    (e) => (e as { hasFinancials?: boolean }).hasFinancials,
  ).map((e) => e.name);
  const reqEl = args.election ? String(args.election) : "";
  const election = withFin.includes(reqEl)
    ? reqEl
    : withFin.includes(ctx.election)
      ? ctx.election
      : withFin[0];
  const prov = [`${election ?? "—"}/parties/financing.json`];
  if (!election) {
    return {
      tool: "partyFinance",
      domain: "people",
      kind: "scalar",
      title: bg
        ? "Няма данни за партийно финансиране"
        : "No campaign-finance data",
      viz: "none",
      facts: {},
      provenance: prov,
    };
  }
  const parties = await fetchData<CikParty[]>(`/${election}/cik_parties.json`);
  const matched = matchParty(String(args.party ?? ""), parties);
  if (!matched) {
    return {
      tool: "partyFinance",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Не разпознах партия „${args.party ?? ""}“`
        : `No party matched "${args.party ?? ""}"`,
      viz: "none",
      facts: { query: String(args.party ?? "") },
      provenance: prov,
    };
  }
  const label = matched.nickName || matched.name;
  const fin = await fetchData<FinEntry[]>(
    `/${election}/parties/financing.json`,
  );
  const entry = fin.find((f) => f.party === matched.number);
  if (!entry) {
    return {
      tool: "partyFinance",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Няма финансов отчет за ${label} (${electionDate(election)})`
        : `No campaign-finance filing for ${label} (${electionDate(election)})`,
      viz: "none",
      facts: { party: label, election: electionDate(election) },
      provenance: prov,
    };
  }
  const inc = entry.filing.income;
  const fromParty = blockSum(inc.party);
  const fromDonors = blockSum(inc.donors);
  const fromCandidates = blockSum(inc.candidates);
  const media = inc.mediaPackage || 0;
  const totalIncome = fromParty + fromDonors + fromCandidates + media;
  const totalExpenses = sumNumbers(entry.filing.expenses);
  const rows: Row[] = [
    {
      item: bg ? "Собствени средства" : "Party's own funds",
      amount: fmtEurCompact(fromParty, ctx.lang),
    },
    {
      item: bg ? "Дарения" : "Donations",
      amount: fmtEurCompact(fromDonors, ctx.lang),
    },
    {
      item: bg ? "От кандидати" : "From candidates",
      amount: fmtEurCompact(fromCandidates, ctx.lang),
    },
    {
      item: bg ? "Медиен пакет" : "Media package",
      amount: fmtEurCompact(media, ctx.lang),
    },
    {
      item: bg ? "Общо приходи" : "Total income",
      amount: fmtEurCompact(totalIncome, ctx.lang),
    },
    {
      item: bg ? "Общо разходи" : "Total expenses",
      amount: fmtEurCompact(totalExpenses, ctx.lang),
    },
  ];
  return {
    tool: "partyFinance",
    domain: "people",
    kind: "table",
    title: bg
      ? `Кампанийни финанси — ${label} (${electionDate(election)})`
      : `Campaign finance — ${label} (${electionDate(election)})`,
    subtitle: bg ? "Източник: Сметна палата" : "Source: Court of Audit",
    columns: [
      { key: "item", label: bg ? "Перо" : "Item" },
      { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      party: label,
      election: electionDate(election),
      total_income: fmtEurCompact(totalIncome, ctx.lang),
      from_donors: fmtEurCompact(fromDonors, ctx.lang),
      total_expenses: fmtEurCompact(totalExpenses, ctx.lang),
    },
    provenance: prov,
  };
};

// ---- company -> people in public office (by EIK) ---------------------------
// Reads /api/db/company-connections (migration 158, company_political_links) — the gated
// person layer, live from Postgres.
//
// ⚠️ IT USED TO READ `parliament/company-connections/{eik}.json`, AND THAT FILE WAS FROZEN.
// `bucket_sync_paths.ts` excluded the tree from sync, and `gsutil rsync -x` excludes a match
// from DELETION as well as upload — so the 16,609 bucket objects sat at their 2026-07-29
// vintage and this tool answered company questions from that snapshot at a 200, for weeks,
// with nothing red anywhere. „Has a reader" and „is being maintained" are separate facts.
//
// ⚠️ THE ANSWER CHANGED WITH THE MOVE, AND THE COPY BELOW SAYS SO. The shards matched a TR
// officer to a power roster BY NAME, keeping the match only if the name appeared in exactly
// one company, and graded it `medium`/`low` on whether the name had three parts — a name-shape
// test wearing the word confidence. There is no confidence column here. The direct arm is
// `person_role` at source tr/ngo, which refuses a name the Commerce Registry records for more
// than one human (and refuses an UNMEASURED fold too), and each row states its basis:
// „деклариран регистър" or „съвпадение по име". Per-EIK that means fewer links sometimes;
// corpus-wide it is wider on both arms (9,982 direct vs 3,843; 26,047 answerable vs 19,232).
//
// The two arms stay in SEPARATE table sections and never merge into one ranked list: a bridged
// row is a second-degree lead („an officer here also sits at a company where X sits"), and the
// single merged, confidence-graded list is exactly how the shards let that read as a finding.

type PoliticalLinkRow = {
  slug: string;
  name: string;
  office: string;
  officeSource: string;
  officeRole: string;
};
type DirectLinkRow = PoliticalLinkRow & {
  roles: string[];
  linkBasis: "declared" | "name_match";
};
type BridgedLinkRow = PoliticalLinkRow & {
  bridgeName: string;
  bridgeCompanies: number;
  viaEik: string;
  viaCompany: string | null;
  pathCount: number;
};
type CompanyPoliticalLinks = {
  eik: string;
  name: string | null;
  legalForm: string | null;
  status: string | null;
  officerRowCount: number;
  directCount: number;
  bridgedCount: number;
  bridgedPathCount: number;
  bridgeMaxCompanies: number;
  bridgeFoldsSuppressed: number;
  directTruncated: boolean;
  bridgedTruncated: boolean;
  direct: DirectLinkRow[];
  bridged: BridgedLinkRow[];
} | null;

const PROV = ["company_political_links (158_company_political_links.sql)"];

// The two words 082, 150 and 158 all use, so one company cannot be „declared" on the profile
// and „name match" in the chat. `declared` = a curated register put this COMPANY on this
// person; it is NOT a confirmed identity (148 §0.2), which is why neither wording claims one.
const BASIS_LABEL: Record<string, { bg: string; en: string }> = {
  declared: { bg: "деклариран регистър", en: "declared register" },
  name_match: { bg: "съвпадение по име", en: "name match" },
};

export const companyConnections = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.company ?? args.eik ?? "");
  const eik = raw.match(/\d{9,13}/)?.[0];
  if (!eik) {
    return {
      tool: "companyConnections",
      domain: "people",
      kind: "scalar",
      title: bg
        ? "Посочете ЕИК на фирмата (9 или 13 цифри)"
        : "Provide the company's EIK (9 or 13 digits)",
      viz: "none",
      facts: { query: raw },
      provenance: PROV,
    };
  }
  let data: CompanyPoliticalLinks = null;
  try {
    data = await fetchDb<CompanyPoliticalLinks>("company-connections", { eik });
  } catch {
    data = null;
  }
  const coLabel = data?.name || eik;
  if (!data || (data.directCount === 0 && data.bridgedCount === 0)) {
    // „Nothing found" and „nothing traversable" are different answers and the payload can tell
    // them apart, so say which. A company whose every officer sits on scores of boards was not
    // examined and found clean — the bridge simply refuses a registered agent as a link.
    const busy = data?.bridgeFoldsSuppressed ?? 0;
    const cap = data?.bridgeMaxCompanies ?? 0;
    return {
      tool: "companyConnections",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Няма открити връзки с публични длъжности за ЕИК ${eik}`
        : `No links to public office on record for EIK ${eik}`,
      subtitle: busy
        ? bg
          ? `Никой в регистъра на лицата не заема публична длъжност в тази фирма. ${busy} от служителите ѝ участват в над ${cap} фирми всеки — през тях не се търсят връзки от 2-ра степен.`
          : `Nobody in the resolved person layer holds public office at this company. ${busy} of its officers sit in more than ${cap} companies each — second-degree links are not traced through them.`
        : bg
          ? "Никой служител не заема публична длъжност, нито е на една фирмена стъпка от такъв (по търговския регистър)."
          : "No officer holds public office, nor is one company-hop from someone who does (per the Commerce Registry).",
      viz: "none",
      facts: {
        eik,
        company: coLabel,
        officer_rows: data?.officerRowCount ?? 0,
        bridges_too_busy: busy,
      },
      provenance: PROV,
    };
  }
  const basis = (b: string): string => BASIS_LABEL[b]?.[ctx.lang] ?? b;
  const rows: Row[] = [];
  for (const d of data.direct)
    rows.push({
      person: d.name,
      office: officeLabel(d.officeSource, d.officeRole, d.office, bg),
      link: bg ? "пряко (служител)" : "direct (officer)",
      basis: basis(d.linkBasis),
    });
  for (const b of data.bridged)
    rows.push({
      person: b.name,
      office: officeLabel(b.officeSource, b.officeRole, b.office, bg),
      // The bridge person's whole footprint rides in the cell, because it IS the reader's
      // tightness signal: a 2-company bridge is a tie, a 25-company one is barely one.
      link: bg
        ? `чрез ${b.bridgeName} (${fmtInt(b.bridgeCompanies, ctx.lang)} фирми) → ${b.viaCompany ?? b.viaEik}`
        : `via ${b.bridgeName} (${fmtInt(b.bridgeCompanies, ctx.lang)} companies) → ${b.viaCompany ?? b.viaEik}`,
      basis: bg ? "2-ра степен" : "second-degree",
    });
  const first = data.direct[0]?.name ?? data.bridged[0]?.name ?? "—";
  return {
    tool: "companyConnections",
    domain: "people",
    kind: "table",
    title: bg
      ? `Връзки с публични длъжности — ${coLabel}`
      : `Links to public office — ${coLabel}`,
    // Names the basis and the limit of each arm in one line, because the table itself cannot:
    // a „пряко" row rests on a resolved identity, a „2-ра степен" row on a shared officer.
    subtitle: bg
      ? "Преките връзки идват от регистъра на лицата — име, което търговският регистър приписва на повече от един човек, се отказва. Връзките от 2-ра степен са следа, не доказателство."
      : "Direct links come from the resolved person layer — a name the Commerce Registry records for more than one human is refused. Second-degree links are a lead, not proof.",
    columns: [
      { key: "person", label: bg ? "Лице" : "Person" },
      { key: "office", label: bg ? "Длъжност" : "Office" },
      { key: "link", label: bg ? "Връзка" : "Link" },
      { key: "basis", label: bg ? "Основание" : "Basis" },
    ],
    rows: rows.slice(0, 15),
    viz: "none",
    facts: {
      eik,
      company: coLabel,
      officer_rows: data.officerRowCount,
      direct_links: data.directCount,
      bridged_links: data.bridgedCount,
      first_connection: first,
    },
    provenance: PROV,
  };
};
