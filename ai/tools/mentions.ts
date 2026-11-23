// "Всички данни за X" — every place a name is mentioned across the money corpora
// the site serves: contract titles, tender subjects, КЗК appeals, the Commerce
// Registry (incl. NGOs), buyers, ИСУН projects, Interreg operations, ДФЗ farm
// subsidies, НФЦ film subsidies, the open-calls register and parliament votes.
//
// The point is an exhaustive answer for an entity that has NO key of its own —
// INSAIT is a unit of Sofia University, so it exists in our data only as words
// in titles. The searches behind this are fuzzy (trigram + FTS prefix), which is
// right for a search box and wrong here: for "INSAIT" they return Инсас ООД,
// Инса Ойл and Инсайт Ивентс, three unrelated firms. So every hit is re-checked
// against the term as WHOLE WORDS, and what fails is counted and named as
// "similar names, not included" — a similar name is never presented as the
// entity (name match ≠ identity).

import { fetchData, fetchDb } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { translitKey } from "./translit";
import type {
  Column,
  Envelope,
  Row,
  TableCellLink,
  ToolArgs,
  ToolContext,
} from "./types";

type SearchBody = {
  companies?: { eik: string; name: string }[];
  awarders?: { eik: string; name: string }[];
  contracts?: {
    key: string;
    title: string;
    date: string | null;
    awarderName: string | null;
    contractorName: string | null;
    amountEur: number | null;
  }[];
  tenders?: {
    unp: string;
    subject: string;
    publicationDate: string | null;
    buyerName: string | null;
    estimatedValueEur: number | null;
  }[];
  funds?: {
    contractNumber: string;
    title: string;
    beneficiaryEik: string | null;
    beneficiaryName: string | null;
    programName: string | null;
    totalEur: number | null;
  }[];
  interreg?: {
    keepId: string | number;
    title: string;
    programmeBg: string | null;
    period: string | null;
    bgBudgetEur: number | null;
    partnerHit?: string | null;
  }[];
  contractsTotal?: number;
  tendersTotal?: number;
};

type CompanyRow = {
  uic: string;
  name: string;
  legalForm?: string | null;
  status?: string | null;
};
type VoteItem = {
  itemId: number | string;
  ns: number;
  date: string;
  title: string;
  yes?: number | null;
  no?: number | null;
};

type KzkRow = {
  complaintNo: string;
  complaintDate: string | null;
  unp: string | null;
  buyerName: string | null;
  complainant: string | null;
  subject: string | null;
  outcome: string | null;
};
type OpenCallRow = {
  id: number;
  title: string;
  code: string | null;
  status: string | null;
  programmeName: string | null;
  closesAt: string | null;
  budgetEur: number | null;
};
type AgriHit = {
  eik: string;
  name: string;
  oblast: string | null;
  totalEur: number | null;
};
type Film = {
  year: number;
  title: string;
  producer: string;
  subsidyEur: number | null;
};

const LIMIT = 20;
const PROVENANCE = [
  "db:procurement-search",
  "db:table/companies",
  "db:table/kzk_appeals",
  "db:table/open_calls",
  "db:agri-search",
  "db:vote-item-search",
  "culture/films.json",
];

/** One page of a DbDataTable resource, searched with its own free-text arm. */
const tableSearch = <T>(
  resource: string,
  q: string,
  sort: [string, boolean][],
) =>
  fetchDb<{ rows: T[] }>("table", {
    q: JSON.stringify({
      resource,
      page: 0,
      pageSize: LIMIT,
      sort: sort.map(([id, desc]) => ({ id, desc })),
      filters: { global: q, columns: [] },
    }),
  });

/** Words in one comparable space: romanized, lowercase, punctuation dropped. */
const words = (s: string): string[] =>
  translitKey(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);

/** Does `text` contain the term as a run of whole words? A long term word may
 *  carry an inflection ("университет" → "университета"); a short one must be
 *  exact, so "insa" never matches "insait" and "insait" never matches "insas". */
export const mentionsTerm = (text: string, term: string): boolean => {
  const t = words(term);
  const w = words(text);
  if (!t.length) return false;
  const same = (tw: string, ww: string) =>
    tw === ww ||
    (tw.length >= 5 && ww.startsWith(tw) && ww.length - tw.length <= 3);
  for (let i = 0; i + t.length <= w.length; i++)
    if (t.every((tw, j) => same(tw, w[i + j]))) return true;
  return false;
};

/** "INSAIT, ИНСАИТ" / "INSAIT или ИНСАИТ" → distinct spellings. Two spellings
 *  that romanize alike ("INSAIT" and "ИНСАИТ") are one search. A bare „и“ is
 *  NOT a separator — it is inside too many names („Министерство на труда и …“). */
export const termVariants = (raw: string): string[] => {
  const parts = raw
    .replace(/[„“”"«»]/g, " ")
    .split(/\s*(?:,|;|\/|\s(?:или|or|aka)\s)\s*/iu)
    .map((p) => p.replace(/[?!.:]+$/u, "").trim())
    .filter((p) => [...p].length >= 3);
  const seen = new Set<string>();
  return parts.filter((p) => {
    const k = words(p).join(" ");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const settledOr = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};

export const entityMentions = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.term ?? args.company ?? "").trim();
  const variants = termVariants(raw);
  const label = variants.join(" / ") || raw;

  if (!variants.length)
    return {
      tool: "entityMentions",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Какво име да потърся?" : "Which name should I search for?",
      subtitle: bg
        ? "Напишете име от поне 3 знака, напр. „всички данни за INSAIT“."
        : "Type a name of at least 3 characters, e.g. “everything about INSAIT”.",
      facts: {},
      viz: "none",
      provenance: [],
    };

  const per = await Promise.all(
    variants.map(async (v) => {
      const [search, companies, votes, kzk, calls, agri] = await Promise.all([
        settledOr(
          fetchDb<SearchBody>("procurement-search", { q: v, limit: LIMIT }),
          {} as SearchBody,
        ),
        settledOr(
          fetchDb<{ rows: CompanyRow[] }>("table", {
            q: JSON.stringify({
              resource: "companies",
              page: 0,
              pageSize: LIMIT,
              sort: [
                { id: "name", desc: false },
                { id: "uic", desc: false },
              ],
              filters: { global: v, columns: [] },
            }),
          }),
          { rows: [] },
        ),
        settledOr(
          fetchDb<{ items: VoteItem[] }>("vote-item-search", {
            q: v,
            limit: 25,
          }),
          { items: [] },
        ),
        settledOr(
          tableSearch<KzkRow>("kzk_appeals", v, [["complaint_date", true]]),
          { rows: [] },
        ),
        settledOr(
          tableSearch<OpenCallRow>("open_calls", v, [["closes_at", true]]),
          { rows: [] },
        ),
        settledOr(
          fetchDb<AgriHit[]>("agri-search", { q: v, limit: LIMIT }),
          [] as AgriHit[],
        ),
      ]);
      return {
        v,
        search,
        companies: companies.rows ?? [],
        votes: votes.items ?? [],
        kzk: kzk.rows ?? [],
        calls: calls.rows ?? [],
        agri: Array.isArray(agri) ? agri : [],
      };
    }),
  );

  const filmsFile = await settledOr(
    fetchData<{ films?: Film[] } | null>("/culture/films.json"),
    null,
  );

  const hit = (text: string | null | undefined) =>
    !!text && variants.some((v) => mentionsTerm(text, v));

  // Dedup across variants by each corpus's own key.
  const byKey = <T>(items: T[], key: (t: T) => string): T[] => {
    const m = new Map<string, T>();
    for (const it of items) if (!m.has(key(it))) m.set(key(it), it);
    return [...m.values()];
  };
  const all = <K extends keyof SearchBody>(k: K) =>
    per.flatMap((p) => (p.search[k] as unknown[] | undefined) ?? []);

  const contractsAll = byKey(
    all("contracts") as NonNullable<SearchBody["contracts"]>,
    (c) => c.key,
  );
  const tendersAll = byKey(
    all("tenders") as NonNullable<SearchBody["tenders"]>,
    (t) => t.unp,
  );
  const fundsAll = byKey(
    all("funds") as NonNullable<SearchBody["funds"]>,
    (f) => f.contractNumber,
  );
  const interregAll = byKey(
    all("interreg") as NonNullable<SearchBody["interreg"]>,
    (o) => String(o.keepId),
  );
  const companiesAll = byKey(
    [
      ...per.flatMap((p) =>
        p.companies.map((c) => ({
          eik: c.uic,
          name: c.name,
          form: c.legalForm,
        })),
      ),
      ...(all("companies") as { eik: string; name: string }[]).map((c) => ({
        ...c,
        form: null as string | null | undefined,
      })),
    ],
    (c) => c.eik,
  );
  const awardersAll = byKey(
    all("awarders") as NonNullable<SearchBody["awarders"]>,
    (a) => a.eik,
  );
  const kzkAll = byKey(
    per.flatMap((p) => p.kzk),
    (k) => k.complaintNo,
  );
  const callsAll = byKey(
    per.flatMap((p) => p.calls),
    (c) => String(c.id),
  );
  const agriAll = byKey(
    per.flatMap((p) => p.agri),
    (a) => a.eik,
  );
  const votesAll = byKey(
    per.flatMap((p) => p.votes),
    (v) => String(v.itemId),
  );

  const contracts = contractsAll.filter((c) => hit(c.title));
  const tenders = tendersAll.filter((t) => hit(t.subject));
  const funds = fundsAll.filter((f) => hit(f.title) || hit(f.beneficiaryName));
  const interreg = interregAll.filter((o) => hit(o.title) || hit(o.partnerHit));
  const companies = companiesAll.filter((c) => hit(c.name));
  const awarders = awardersAll.filter((a) => hit(a.name));
  const votes = votesAll.filter((v) => hit(v.title));
  const appeals = kzkAll.filter(
    (k) => hit(k.subject) || hit(k.complainant) || hit(k.buyerName),
  );
  const calls = callsAll.filter((c) => hit(c.title) || hit(c.programmeName));
  const agri = agriAll.filter((a) => hit(a.name));
  const films = (filmsFile?.films ?? []).filter(
    (f) => hit(f.title) || hit(f.producer),
  );

  // Look-alikes the fuzzy search offered and the word check refused — named so
  // a reader sees they were considered and deliberately left out.
  const lookalikes = [
    ...companiesAll.filter((c) => !hit(c.name)).map((c) => c.name),
    ...awardersAll.filter((a) => !hit(a.name)).map((a) => a.name),
    ...fundsAll
      .filter((f) => !hit(f.title) && !hit(f.beneficiaryName))
      .map((f) => f.beneficiaryName ?? f.title),
    ...agriAll.filter((a) => !hit(a.name)).map((a) => a.name),
  ].filter((n, i, arr) => n && arr.indexOf(n) === i);

  // A capped preview means there may be more than we show; the route counts the
  // full set (bounded at 100), though over its own fuzzy predicate — so it is an
  // upper bound on mentions, shown only when the preview was actually capped.
  const cappedContracts = per.some(
    (p) => (p.search.contracts?.length ?? 0) >= LIMIT,
  );
  const cappedTenders = per.some(
    (p) => (p.search.tenders?.length ?? 0) >= LIMIT,
  );
  const contractsUpTo = Math.max(
    ...per.map((p) => p.search.contractsTotal ?? 0),
  );
  const tendersUpTo = Math.max(...per.map((p) => p.search.tendersTotal ?? 0));

  const kind = {
    contract: bg ? "Договор" : "Contract",
    tender: bg ? "Обществена поръчка" : "Tender",
    company: bg ? "Фирма / организация" : "Company / organisation",
    awarder: bg ? "Възложител" : "Buyer",
    fund: bg ? "Проект по ЕС фондове" : "EU-funds project",
    interreg: bg ? "Проект Interreg" : "Interreg project",
    vote: bg ? "Гласуване в парламента" : "Parliament vote",
    appeal: bg ? "Жалба до КЗК" : "КЗК appeal",
    agri: bg ? "Земеделски субсидии (ДФЗ)" : "Farm subsidies (ДФЗ)",
    film: bg ? "Филмова субсидия (НФЦ)" : "Film subsidy (НФЦ)",
    call: bg ? "Процедура за финансиране" : "Funding call",
  };
  const rows: Row[] = [];
  const cellLinks: TableCellLink[] = [];
  const clip = (s: string, n = 140) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;
  const push = (r: Row, href?: string) => {
    rows.push(r);
    if (href && typeof r.subject === "string")
      cellLinks.push({
        row: rows.length - 1,
        column: "subject",
        text: r.subject,
        href,
      });
  };
  const eur = (n: number | null | undefined) =>
    n == null ? "—" : fmtEurCompact(n, ctx.lang);

  for (const c of [...contracts].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  ))
    push(
      {
        kind: kind.contract,
        date: (c.date ?? "").slice(0, 10) || "—",
        subject: clip(c.title),
        party:
          [c.awarderName, c.contractorName].filter(Boolean).join(" → ") || "—",
        amount: eur(c.amountEur),
      },
      `/procurement/contract/${encodeURIComponent(c.key)}`,
    );
  for (const t of [...tenders].sort((a, b) =>
    (b.publicationDate ?? "").localeCompare(a.publicationDate ?? ""),
  ))
    push(
      {
        kind: kind.tender,
        date: (t.publicationDate ?? "").slice(0, 10) || "—",
        subject: clip(t.subject),
        party: t.buyerName ?? "—",
        amount:
          t.estimatedValueEur == null
            ? "—"
            : `${eur(t.estimatedValueEur)} ${bg ? "(прогнозна)" : "(estimate)"}`,
      },
      `/procurement/tenders?q=${encodeURIComponent(t.unp)}`,
    );
  for (const k of [...appeals].sort((a, b) =>
    (b.complaintDate ?? "").localeCompare(a.complaintDate ?? ""),
  ))
    push(
      {
        kind: kind.appeal,
        date: (k.complaintDate ?? "").slice(0, 10) || "—",
        subject: clip(k.subject ?? k.complaintNo),
        party:
          [k.complainant, k.buyerName && `→ ${k.buyerName}`, k.outcome]
            .filter(Boolean)
            .join(" ") || "—",
        amount: "—",
      },
      `/procurement/appeals?q=${encodeURIComponent(k.unp ?? k.complaintNo)}`,
    );
  for (const c of companies)
    push(
      {
        kind: kind.company,
        date: "—",
        subject: clip(c.name),
        party: `ЕИК ${c.eik}${c.form ? ` · ${c.form}` : ""}`,
        amount: "—",
      },
      `/company/${encodeURIComponent(c.eik)}`,
    );
  for (const a of awarders)
    push(
      {
        kind: kind.awarder,
        date: "—",
        subject: clip(a.name),
        party: `ЕИК ${a.eik}`,
        amount: "—",
      },
      `/company/${encodeURIComponent(a.eik)}`,
    );
  for (const f of funds)
    push(
      {
        kind: kind.fund,
        date: "—",
        subject: clip(f.title),
        party:
          [f.beneficiaryName, f.programName].filter(Boolean).join(" · ") || "—",
        amount: eur(f.totalEur),
      },
      `/funds/contract/${encodeURIComponent(f.contractNumber)}`,
    );
  for (const o of interreg)
    push(
      {
        kind: kind.interreg,
        date: o.period ?? "—",
        subject: clip(o.title),
        party: o.programmeBg ?? "—",
        amount: eur(o.bgBudgetEur),
      },
      `/funds/interreg/${encodeURIComponent(String(o.keepId))}`,
    );
  for (const a of agri)
    push(
      {
        kind: kind.agri,
        date: "—",
        subject: clip(a.name),
        party: [`ЕИК ${a.eik}`, a.oblast].filter(Boolean).join(" · "),
        amount: eur(a.totalEur),
      },
      `/farm/${encodeURIComponent(a.eik)}`,
    );
  for (const f of [...films].sort((a, b) => b.year - a.year))
    push(
      {
        kind: kind.film,
        date: String(f.year),
        subject: clip(f.title),
        party: f.producer,
        amount: eur(f.subsidyEur),
      },
      `/culture`,
    );
  for (const c of calls)
    push(
      {
        kind: kind.call,
        date: (c.closesAt ?? "").slice(0, 10) || "—",
        subject: clip(c.title),
        party:
          [c.code, c.programmeName, c.status].filter(Boolean).join(" · ") ||
          "—",
        amount: eur(c.budgetEur),
      },
      `/funds/calls?q=${encodeURIComponent(c.code ?? c.title)}`,
    );
  for (const v of votes)
    push(
      {
        kind: kind.vote,
        date: v.date.slice(0, 10),
        subject: clip(v.title),
        party: bg
          ? `${v.ns}-то НС · за ${v.yes ?? "—"} / против ${v.no ?? "—"}`
          : `${v.ns}th NA · yes ${v.yes ?? "—"} / no ${v.no ?? "—"}`,
        amount: "—",
      },
      `/votes/${encodeURIComponent(v.date.slice(0, 10))}`,
    );

  const contractEur = contracts.reduce((s, c) => s + (c.amountEur ?? 0), 0);
  const facts: Record<string, string | number> = {
    term: label,
    contracts: contracts.length,
    contracts_value: fmtEurCompact(contractEur, ctx.lang),
    tenders: tenders.length,
    companies: companies.length,
    buyers: awarders.length,
    eu_funds_projects: funds.length,
    interreg_projects: interreg.length,
    parliament_votes: votes.length,
    kzk_appeals: appeals.length,
    farm_subsidy_recipients: agri.length,
    farm_subsidies_value: fmtEurCompact(
      agri.reduce((s, a) => s + (a.totalEur ?? 0), 0),
      ctx.lang,
    ),
    film_subsidies: films.length,
    funding_calls: calls.length,
    similar_names_excluded: lookalikes.length,
  };
  if (lookalikes.length)
    facts.similar_names_not_included = lookalikes.slice(0, 6).join("; ");
  if (cappedContracts) facts.contracts_matching_search_up_to = contractsUpTo;
  if (cappedTenders) facts.tenders_matching_search_up_to = tendersUpTo;
  facts.coverage_note = bg
    ? "Търсени: договори, поръчки, жалби до КЗК, Търговски регистър (вкл. ЮЛНЦ), ЕС фондове, Interreg, субсидии ДФЗ, субсидии НФЦ, процедури за финансиране, гласувания в парламента. Търсене по име — запис, който не споменава името, не се вижда; парите по ЕИК на всяка организация са на страницата ѝ."
    : "Searched: contracts, tenders, КЗК appeals, the Commerce Registry (incl. NGOs), EU funds, Interreg, ДФЗ farm subsidies, НФЦ film subsidies, funding calls, parliament votes. Name search — a record that does not name it is not found; each organisation's money by EIK is on its own page.";

  if (!rows.length)
    return {
      tool: "entityMentions",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? `Не открих споменавания на „${label}“`
        : `No mentions of “${label}” found`,
      subtitle: lookalikes.length
        ? bg
          ? `Сходни, но различни имена (не са включени): ${lookalikes.slice(0, 4).join(", ")}`
          : `Similar but different names (not included): ${lookalikes.slice(0, 4).join(", ")}`
        : bg
          ? "Търсих в договори, поръчки, жалби до КЗК, Търговския регистър, ЕС фондове, Interreg, субсидии ДФЗ и НФЦ, процедури за финансиране и гласувания в парламента."
          : "Searched contracts, tenders, КЗК appeals, the Commerce Registry, EU funds, Interreg, ДФЗ and НФЦ subsidies, funding calls and parliament votes.",
      facts,
      viz: "none",
      provenance: [...PROVENANCE],
    };

  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n) parts.push(`${fmtInt(n, ctx.lang)} ${n === 1 ? one : many}`);
  };
  if (bg) {
    add(contracts.length, "договор", "договора");
    add(tenders.length, "поръчка", "поръчки");
    add(companies.length + awarders.length, "организация", "организации");
    add(appeals.length, "жалба", "жалби");
    add(funds.length + interreg.length, "проект", "проекта");
    add(agri.length, "получател на субсидии", "получатели на субсидии");
    add(films.length, "филм", "филма");
    add(calls.length, "процедура", "процедури");
    add(votes.length, "гласуване", "гласувания");
  } else {
    add(contracts.length, "contract", "contracts");
    add(tenders.length, "tender", "tenders");
    add(companies.length + awarders.length, "organisation", "organisations");
    add(appeals.length, "appeal", "appeals");
    add(funds.length + interreg.length, "project", "projects");
    add(agri.length, "subsidy recipient", "subsidy recipients");
    add(films.length, "film", "films");
    add(calls.length, "call", "calls");
    add(votes.length, "vote", "votes");
  }
  let subtitle = parts.join(" · ");
  if (contracts.length)
    subtitle += bg
      ? ` · договори общо ${fmtEurCompact(contractEur, ctx.lang)}`
      : ` · contracts total ${fmtEurCompact(contractEur, ctx.lang)}`;
  if (lookalikes.length)
    subtitle += bg
      ? `. Сходни, но различни имена не са включени: ${lookalikes.slice(0, 3).join(", ")}${lookalikes.length > 3 ? "…" : ""}`
      : `. Similar but different names left out: ${lookalikes.slice(0, 3).join(", ")}${lookalikes.length > 3 ? "…" : ""}`;

  const columns: Column[] = [
    { key: "kind", label: bg ? "Вид" : "Kind" },
    { key: "date", label: bg ? "Дата" : "Date" },
    { key: "subject", label: bg ? "Какво" : "What" },
    { key: "party", label: bg ? "Страни" : "Parties" },
    { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
  ];

  return {
    tool: "entityMentions",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Всичко за „${label}“ в данните`
      : `Everything on “${label}” in the data`,
    subtitle,
    columns,
    rows,
    cellLinks,
    viz: "none",
    facts,
    provenance: [...PROVENANCE],
  };
};
