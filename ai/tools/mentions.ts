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
import { ENTITY_ALIASES, type EntityAlias } from "./entityAliases";
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
type NamedRow = {
  fiscalYear: number;
  section: "priority" | "reserve";
  projectCode: string;
  title: string;
  institution: string;
  dvIdMat: string;
  year: number;
  kind: "appropriation" | "forecast" | "indicative";
  amountEur: number;
};
type DecreeRow = {
  idMat: number;
  decreeNo: number;
  decreeDate: string;
  budgetOf: string | null;
  seq: number | null;
  amountEur: number | null;
  upTo: boolean | null;
  purpose: string | null;
};
type ZdoiHit = {
  appId: number;
  regNo: string;
  body: string;
  status: string;
  submittedOn: string | null;
  subjectExcerpt: string;
  decisionExcerpt: string | null;
  /** Amounts the ANSWER names, as written, each with the words around it — a quote,
   *  never a figure: the sum may be what was disclosed, a fee, or the question restated. */
  moneyMentions?: { amount: string; excerpt: string }[];
};
type ZdoiCoverage = {
  requests: number;
  firstSubmitted: string | null;
  lastSubmitted: string | null;
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
// The companies resource is sorted by NAME, so a 20-row page fills alphabetically with
// look-alikes before the real entity: „ИНСАЙТ изследвания и образование" sorted after 20
// "insight" firms and was never shown. Fetch the resource's whole page (its maxPageSize)
// and cap AFTER the word check, so only real matches compete for the 20 slots.
const COMPANY_PAGE = 50;
const PROVENANCE = [
  "db:procurement-search",
  "db:table/companies",
  "db:table/kzk_appeals",
  "db:table/open_calls",
  "db:agri-search",
  "db:vote-item-search",
  "db:zdoi-search",
  "db:entity-appropriations",
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

/** Where `term` first occurs in `text` as whole words — the same rule as
 *  mentionsTerm — as [start, end) character offsets into the ORIGINAL text. */
export const termSpan = (
  text: string,
  term: string,
): [number, number] | null => {
  const t = words(term);
  if (!t.length) return null;
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    key: words(m[0]).join(""),
    start: m.index,
    end: m.index + m[0].length,
  }));
  const same = (tw: string, ww: string) =>
    tw === ww ||
    (tw.length >= 5 && ww.startsWith(tw) && ww.length - tw.length <= 3);
  for (let i = 0; i + t.length <= tokens.length; i++)
    if (t.every((tw, j) => same(tw, tokens[i + j].key)))
      return [tokens[i].start, tokens[i + t.length - 1].end];
  return null;
};

/** Cut `text` to about `n` characters, keeping the matched name visible: a row
 *  that matched on its last words („… - ИНИОКН") must not show the reader a cut
 *  that hides why it is there. Head, „…", then the words around the match. */
/** The words around an amount, at most `n` characters, keeping the amount in view. */
export const aroundAmount = (
  excerpt: string,
  amount: string,
  n = 160,
): string => {
  const quote = (t: string) => `„${t}“`;
  if (excerpt.length <= n) return quote(excerpt);
  const at = excerpt.indexOf(amount);
  if (at < 0) return quote(`${excerpt.slice(0, n).trimEnd()}…`);
  const start = Math.max(
    0,
    Math.min(at - Math.floor((n - amount.length) * 0.65), excerpt.length - n),
  );
  const end = start + n;
  const head = start > 0 || excerpt.startsWith("…") ? "…" : "";
  const body = excerpt.slice(start, end).trim().replace(/^…|…$/g, "");
  const tail = end < excerpt.length || excerpt.endsWith("…") ? "…" : "";
  return quote(`${head}${body}${tail}`);
};

export const clipToMatch = (text: string, terms: string[], n = 140): string => {
  if (text.length <= n) return text;
  const spans = terms
    .map((t) => termSpan(text, t))
    .filter((x): x is [number, number] => x != null)
    .sort((a, b) => a[0] - b[0]);
  const plain = text.slice(0, n - 1) + "…";
  const [start, end] = spans[0] ?? [0, 0];
  if (!spans.length || end <= n - 1) return plain;
  const tailLen = Math.max(end - start + 40, 70);
  const from = Math.max(0, Math.min(start - 20, text.length - tailLen));
  const tail = text.slice(from, from + tailLen);
  const headLen = Math.max(n - tail.length - 4, 20);
  const head = text.slice(0, headLen).replace(/\s+\S*$/u, "");
  return `${head} … ${from > 0 ? tail.replace(/^\S*\s+/u, "") : tail}${from + tailLen < text.length ? "…" : ""}`;
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

const wordKey = (s: string): string => words(s).join(" ");

/** Split the reader's spellings into curated entities (entityAliases.ts) and plain
 *  names. A spelling resolves only when it equals a trigger word for word. */
export const resolveAliases = (
  variants: string[],
): { aliases: EntityAlias[]; rest: string[] } => {
  const aliases: EntityAlias[] = [];
  const rest: string[] = [];
  for (const v of variants) {
    const k = wordKey(v);
    const a = ENTITY_ALIASES.find((e) =>
      e.triggers.some((t) => wordKey(t) === k),
    );
    if (!a) rest.push(v);
    else if (!aliases.includes(a)) aliases.push(a);
  }
  return { aliases, rest };
};

/** Does `text` name the curated entity? With `buyer`, the parent must ALSO be the
 *  buyer — a procurement title naming the institute under some other buyer is a
 *  different thing (and the parent is the only body that buys for it). */
export const aliasMentioned = (
  a: EntityAlias,
  text: string | null | undefined,
  buyer?: string | null,
): boolean => {
  if (!text || !a.matchTerms.some((t) => mentionsTerm(text, t))) return false;
  if (buyer === undefined) return true;
  return !!buyer && a.parent.names.some((n) => mentionsTerm(buyer, n));
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
  const { aliases, rest } = resolveAliases(variants);
  // One search per plain spelling plus each curated entity's own search terms.
  const queries = [...rest, ...aliases.flatMap((a) => a.searchTerms)].filter(
    (q, i, arr) => arr.findIndex((x) => wordKey(x) === wordKey(q)) === i,
  );
  // ЗДОИ requests are matched whole-word on the server (zdoi_mentions), so they are
  // asked with the names themselves — a curated entity's NAMES, not its broader
  // search phrases, which would pull in other institutes' requests.
  const zdoiTerms = [...rest, ...aliases.flatMap((a) => a.matchTerms)].filter(
    (q, i, arr) =>
      [...q].length >= 3 &&
      arr.findIndex((x) => wordKey(x) === wordKey(q)) === i,
  );

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

  // Money a curated entity was given BY NAME — fetched by the alias's explicit list of
  // budget-law codes and decree ids, never by a name search.
  const lines = aliases.flatMap((a) => a.appropriations?.lines ?? []);
  const decreeIds = aliases.flatMap((a) => a.appropriations?.decrees ?? []);
  const curatedMoney = lines.length > 0 || decreeIds.length > 0;
  // null = the lookup failed; the curated money EXISTS, so that is „no data", never „none".
  const appropriationsPending = curatedMoney
    ? settledOr(
        fetchDb<{ named?: NamedRow[]; decrees?: DecreeRow[] }>(
          "entity-appropriations",
          {
            lines: lines.map((l) => `${l.fiscalYear}:${l.code}`).join(","),
            decrees: decreeIds.join(","),
          },
        ),
        null,
      )
    : Promise.resolve(null);
  const zdoiPending = Promise.all(
    zdoiTerms.map((v) =>
      settledOr(
        fetchDb<{ items?: ZdoiHit[]; coverage?: ZdoiCoverage | null }>(
          "zdoi-search",
          { q: v, limit: LIMIT },
        ),
        {} as { items?: ZdoiHit[]; coverage?: ZdoiCoverage | null },
      ),
    ),
  );
  const per = await Promise.all(
    queries.map(async (v) => {
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
              pageSize: COMPANY_PAGE,
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

  const zdoiPer = await zdoiPending;
  const appropriations = await appropriationsPending;
  const named = appropriations?.named ?? [];
  const decreeRows = appropriations?.decrees ?? [];
  const missingDecrees = decreeIds.filter(
    (id) => !decreeRows.some((d) => d.idMat === id),
  );
  const appropriationsSearched =
    curatedMoney && (named.length > 0 || decreeRows.length > 0);
  // Only a database that holds the corpus may be said to have been searched: no coverage
  // row (207 not applied, the route failed) or an empty table must not read as „nobody
  // asked" (207 rule 1).
  const zdoiCoverage = zdoiPer.find((z) => z.coverage)?.coverage ?? null;
  const zdoiSearched = (zdoiCoverage?.requests ?? 0) > 0;
  const zdoiCapped = zdoiPer.some((z) => (z.items?.length ?? 0) >= LIMIT);

  const filmsFile = await settledOr(
    fetchData<{ films?: Film[] } | null>("/culture/films.json"),
    null,
  );

  const plainHit = (text: string | null | undefined) =>
    !!text && rest.some((v) => mentionsTerm(text, v));
  // Records that only MENTION a subject (votes, calls, appeal subjects) may match a
  // curated entity by name. Records that ARE a party — a firm, a beneficiary, a
  // subsidy recipient — never do: for those the entity contributes only its
  // verified ЕИКs, or its name under the parent as the party (name match ≠ identity).
  const hit = (text: string | null | undefined) =>
    plainHit(text) || aliases.some((a) => aliasMentioned(a, text));
  // A curated entity counts only where its parent is the buyer / beneficiary.
  const procHit = (
    text: string | null | undefined,
    buyer: string | null | undefined,
  ) =>
    plainHit(text) ||
    aliases.some((a) => aliasMentioned(a, text, buyer ?? null));
  const aliasOrgs = aliases.flatMap((a) => a.organisations);
  const aliasEiks = new Set(aliasOrgs.map((o) => o.eik));
  const excludedEiks = new Set(aliases.flatMap((a) => a.excludeEiks));
  const keepCompany = (eik: string, name: string) =>
    !excludedEiks.has(eik) && (aliasEiks.has(eik) || plainHit(name));

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
  const zdoi = byKey(
    zdoiPer.flatMap((z) => z.items ?? []),
    (r) => String(r.appId),
  )
    .sort((a, b) => (b.submittedOn ?? "").localeCompare(a.submittedOn ?? ""))
    .slice(0, LIMIT);
  const votesAll = byKey(
    per.flatMap((p) => p.votes),
    (v) => String(v.itemId),
  );

  const contracts = contractsAll.filter((c) => procHit(c.title, c.awarderName));
  const tenders = tendersAll.filter((t) => procHit(t.subject, t.buyerName));
  const funds = fundsAll.filter(
    (f) =>
      !(f.beneficiaryEik && excludedEiks.has(f.beneficiaryEik)) &&
      (plainHit(f.beneficiaryName) ||
        procHit(f.title, f.beneficiaryName) ||
        (!!f.beneficiaryEik && aliasEiks.has(f.beneficiaryEik))),
  );
  const interreg = interregAll.filter(
    (o) => plainHit(o.partnerHit) || procHit(o.title, o.partnerHit),
  );
  // A curated entity's verified organisations lead, whether or not the name search
  // surfaced them; then the word-checked registry hits, capped to the preview size.
  const companies = [
    ...aliases.flatMap((a) =>
      a.organisations.map((o) => ({
        eik: o.eik,
        name: o.name,
        form: (ctx.lang === "bg" ? o.role.bg : o.role.en) as
          | string
          | null
          | undefined,
      })),
    ),
    ...companiesAll.filter(
      (c) => !aliasEiks.has(c.eik) && keepCompany(c.eik, c.name),
    ),
  ].slice(0, Math.max(LIMIT, aliasOrgs.length));
  const awarders = awardersAll.filter((a) => plainHit(a.name));
  const votes = votesAll.filter((v) => hit(v.title));
  const appeals = kzkAll.filter(
    (k) =>
      procHit(k.subject, k.buyerName) ||
      plainHit(k.complainant) ||
      plainHit(k.buyerName),
  );
  const calls = callsAll.filter((c) => hit(c.title) || hit(c.programmeName));
  const agri = agriAll.filter(
    (a) =>
      !excludedEiks.has(a.eik) && (aliasEiks.has(a.eik) || plainHit(a.name)),
  );
  const films = (filmsFile?.films ?? []).filter(
    (f) => hit(f.title) || hit(f.producer),
  );

  // Look-alikes the fuzzy search offered and the word check refused — named so
  // a reader sees they were considered and deliberately left out.
  const lookalikes = [
    ...companiesAll
      .filter((c) => !keepCompany(c.eik, c.name))
      .map((c) => c.name),
    ...awardersAll.filter((a) => !awarders.includes(a)).map((a) => a.name),
    ...fundsAll
      .filter((f) => !funds.includes(f))
      .map((f) => f.beneficiaryName ?? f.title),
    ...agriAll.filter((a) => !agri.includes(a)).map((a) => a.name),
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
    zdoi: bg ? "Заявление по ЗДОИ" : "Access-to-information request",
    law: bg
      ? "Закон за държавния бюджет (поименно)"
      : "State Budget Law (named line)",
    decree: bg
      ? "ПМС за допълнителни средства"
      : "Council of Ministers decree (extra funds)",
  };
  const rows: Row[] = [];
  const cellLinks: TableCellLink[] = [];
  // Every name this answer searched for, so a cut never hides the one that matched.
  const shownTerms = [...rest, ...aliases.flatMap((a) => a.matchTerms)];
  const clip = (s: string, n = 140) => clipToMatch(s, shownTerms, n);
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

  // What the law and the decrees AUTHORISED. Each amount keeps its kind: a forecast
  // or a reserve-list figure is shown as such and never summed into an appropriation.
  const dvLink = (idMat: string | number) =>
    `https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=${idMat}`;
  const namedKind = (r: NamedRow) =>
    r.kind === "appropriation"
      ? bg
        ? `заложени за ${r.year} г.`
        : `set for ${r.year}`
      : r.kind === "forecast"
        ? bg
          ? `прогноза за ${r.year} г. (не е разход по закона)`
          : `forecast for ${r.year} (not an appropriation)`
        : bg
          ? `резервен списък, индикативно за ${r.year} г.`
          : `reserve list, indicative for ${r.year}`;
  for (const r of named)
    push(
      {
        kind: kind.law,
        date: String(r.fiscalYear),
        subject: clip(`${r.projectCode} — ${r.title}`),
        party: `${r.institution} · ${namedKind(r)}`,
        amount: eur(r.amountEur),
      },
      dvLink(r.dvIdMat),
    );
  for (const d of decreeRows)
    push(
      {
        kind: kind.decree,
        date: d.decreeDate.slice(0, 10),
        subject: clip(
          `ПМС № ${d.decreeNo}/${d.decreeDate.slice(0, 4)}${d.purpose ? ` — ${d.purpose}` : ""}`,
        ),
        party: d.budgetOf ?? "—",
        amount:
          d.amountEur == null
            ? "—"
            : `${d.upTo ? (bg ? "до " : "up to ") : ""}${eur(d.amountEur)}`,
      },
      dvLink(d.idMat),
    );
  // The body's own answer, quoted — not data we verified (207 rule 2); the page is
  // on the platform, so the link goes out to it.
  // A request can match on its answer alone; then the row says so and shows the
  // answer's words around the match, or it reads as unrelated to the search.
  const inText = (s: string | null) =>
    !!s && shownTerms.some((t) => termSpan(s, t) != null);
  // An amount the answer names is shown as the answer words it — in quotes, beside the
  // sentence it sits in — never as a number of ours: the INSAIT answer's only sum is the
  // question restated („За какво … сумата от 100 млн. лв.?").
  for (const z of zdoi) {
    const money = z.moneyMentions ?? [];
    const base =
      !inText(z.subjectExcerpt) && inText(z.decisionExcerpt)
        ? `${clip(z.subjectExcerpt, 70)} — ${bg ? "в отговора" : "in the answer"}: ${clip(z.decisionExcerpt!, 100)}`
        : clip(z.subjectExcerpt);
    push(
      {
        kind: kind.zdoi,
        date: (z.submittedOn ?? "").slice(0, 10) || "—",
        subject: money.length
          ? `${base} — ${bg ? "сума в отговора" : "amount in the answer"}: ${aroundAmount(money[0].excerpt, money[0].amount)}`
          : base,
        party: `${z.body} · ${z.status}`,
        amount: money.length
          ? [...new Set(money.map((m) => m.amount))]
              .map((m) => `„${m}“`)
              .join(" · ")
          : "—",
      },
      `https://pitay.government.bg/application/${z.appId}/view`,
    );
  }

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
    access_to_information_requests: zdoi.length,
    similar_names_excluded: lookalikes.length,
  };
  if (aliases.length)
    facts.resolved_entity = aliases
      .map((a) =>
        bg
          ? `${a.name.bg}: няма собствен ЕИК — договори и поръчки само с възложител ${a.parent.names.join("/")} (ЕИК ${a.parent.eik}), организации по проверен ЕИК`
          : `${a.name.en}: no ЕИК of its own — contracts and tenders only where ${a.parent.names.join("/")} (ЕИК ${a.parent.eik}) is the buyer; organisations by verified ЕИК`,
      )
      .join("; ");
  if (lookalikes.length)
    facts.similar_names_not_included = lookalikes.slice(0, 6).join("; ");
  if (appropriationsSearched) {
    // Only appropriations are summed — forecasts and the reserve list are shown as rows
    // and never added — and the years summed are named.
    const set = named.filter((r) => r.kind === "appropriation");
    if (set.length) {
      const years = [...new Set(set.map((r) => r.year))].sort();
      facts.budget_law_appropriated = `${fmtEurCompact(
        set.reduce((a, r) => a + r.amountEur, 0),
        ctx.lang,
      )} (${years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0]})`;
    }
    // A decree with no parsed amount is „no data", never a 0 in the sum.
    const valued = decreeRows.filter((d) => d.amountEur != null);
    if (valued.length)
      facts.decrees_authorised = `${valued.some((d) => d.upTo) ? (bg ? "до " : "up to ") : ""}${fmtEurCompact(
        valued.reduce((a, d) => a + (d.amountEur ?? 0), 0),
        ctx.lang,
      )}`;
    const unvalued = new Set(
      decreeRows.filter((d) => d.amountEur == null).map((d) => d.idMat),
    ).size;
    if (unvalued)
      facts.decrees_without_amount = bg
        ? `${unvalued} ПМС без разчетена сума — няма данни, не 0`
        : `${unvalued} decree(s) with no parsed amount — no data, not 0`;
    facts.appropriations_note = bg
      ? "Заложено по закон и одобрено с ПМС — това не е преведено, нито изразходвано. Данни за превод и разход: няма. Прогнозите и резервният списък не са включени в заложената сума."
      : "Set by the budget law and authorised by decree — not transferred, not spent. Transfer and spending figures: no data. Forecasts and the reserve list are not included in the appropriated sum.";
  }
  if (curatedMoney && (!appropriationsSearched || missingDecrees.length))
    facts.appropriations_unavailable = bg
      ? `Поименните средства по закона и ПМС не можаха да се заредят${missingDecrees.length && appropriationsSearched ? ` (липсват ПМС с idMat ${missingDecrees.join(", ")})` : ""} — няма данни, а не „няма средства“.`
      : `The money named in the budget law and decrees could not be loaded${missingDecrees.length && appropriationsSearched ? ` (missing decree idMat ${missingDecrees.join(", ")})` : ""} — no data, not „no money“.`;
  if (zdoi.length)
    facts.access_to_information_note = bg
      ? "Заявленията по ЗДОИ са подадени през Платформата за достъп до обществена информация (pitay.government.bg); отговорът е на самата институция, не е проверен от нас."
      : "The access-to-information requests were filed through the public-information platform (pitay.government.bg); each answer is the institution's own, not verified by us.";
  const zdoiWithAmounts = zdoi.filter((z) => z.moneyMentions?.length).length;
  if (zdoiWithAmounts)
    facts.access_to_information_answers_naming_amounts = bg
      ? `${zdoiWithAmounts} — сумите са цитат от отговора на институцията, не са проверени и не се събират: може да са предоставената информация, такса или преразказан въпрос.`
      : `${zdoiWithAmounts} — the amounts are quoted from the institution's answer, unverified and not to be added up: they may be the information disclosed, a fee, or the question restated.`;
  if (zdoiCapped) facts.access_to_information_requests_at_least = zdoi.length;
  if (zdoiCoverage && zdoiSearched)
    facts.access_to_information_coverage = bg
      ? `${fmtInt(zdoiCoverage.requests, ctx.lang)} заявления, подадени през ПДОИ (${zdoiCoverage.firstSubmitted ?? "—"} – ${zdoiCoverage.lastSubmitted ?? "—"}); заявления по пощата, имейл или на място не са включени`
      : `${fmtInt(zdoiCoverage.requests, ctx.lang)} requests filed through the platform (${zdoiCoverage.firstSubmitted ?? "—"} – ${zdoiCoverage.lastSubmitted ?? "—"}); requests by post, e-mail or in person are not included`;
  if (cappedContracts) facts.contracts_matching_search_up_to = contractsUpTo;
  if (cappedTenders) facts.tenders_matching_search_up_to = tendersUpTo;
  facts.coverage_note = bg
    ? `Търсени: договори, поръчки, жалби до КЗК, Търговски регистър (вкл. ЮЛНЦ), ЕС фондове, Interreg, субсидии ДФЗ, субсидии НФЦ, процедури за финансиране, гласувания в парламента${zdoiSearched ? ", заявления по ЗДОИ, подадени през ПДОИ" : ""}${appropriationsSearched ? ", Закона за държавния бюджет (поименно) и ПМС" : ""}. Търсене по име — запис, който не споменава името, не се вижда; парите по ЕИК на всяка организация са на страницата ѝ.`
    : `Searched: contracts, tenders, КЗК appeals, the Commerce Registry (incl. NGOs), EU funds, Interreg, ДФЗ farm subsidies, НФЦ film subsidies, funding calls, parliament votes${zdoiSearched ? ", access-to-information requests filed through the platform" : ""}${appropriationsSearched ? ", the State Budget Law's named lines and decrees" : ""}. Name search — a record that does not name it is not found; each organisation's money by EIK is on its own page.`;

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
          ? `Търсих в договори, поръчки, жалби до КЗК, Търговския регистър, ЕС фондове, Interreg, субсидии ДФЗ и НФЦ, процедури за финансиране, гласувания в парламента${zdoiSearched ? " и заявления по ЗДОИ през ПДОИ" : ""}${appropriationsSearched ? ", поименните редове в бюджета и ПМС" : ""}.`
          : `Searched contracts, tenders, КЗК appeals, the Commerce Registry, EU funds, Interreg, ДФЗ and НФЦ subsidies, funding calls, parliament votes${zdoiSearched ? " and access-to-information requests filed through the platform" : ""}${appropriationsSearched ? ", the budget law's named lines and decrees" : ""}.`,
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
    add(zdoi.length, "заявление по ЗДОИ", "заявления по ЗДОИ");
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
    add(zdoi.length, "information request", "information requests");
  }
  let subtitle = parts.join(" · ");
  if (aliases.length)
    subtitle =
      (bg
        ? `${aliases.map((a) => a.name.bg).join("; ")}. Звено без собствен ЕИК — показани са договорите и поръчките на ${aliases.map((a) => a.parent.names.join("/")).join(", ")} за него. `
        : `${aliases.map((a) => a.name.en).join("; ")}. A unit with no ЕИК of its own — showing ${aliases.map((a) => a.parent.names.join("/")).join(", ")}'s contracts and tenders for it. `) +
      subtitle;
  if (contracts.length)
    subtitle += bg
      ? ` · договори общо ${fmtEurCompact(contractEur, ctx.lang)}`
      : ` · contracts total ${fmtEurCompact(contractEur, ctx.lang)}`;
  // Money named by the law and decrees: the same figures as the facts (only
  // appropriations, years named, „до" kept), and never presented as paid out.
  const law = facts.budget_law_appropriated;
  const byDecree = facts.decrees_authorised;
  if (law || byDecree)
    subtitle += bg
      ? ` · ${[law && `заложени по закон ${law}`, byDecree && `по ПМС ${byDecree}`].filter(Boolean).join(", ")} (одобрени, не преведени)`
      : ` · ${[law && `set by the budget law ${law}`, byDecree && `by decree ${byDecree}`].filter(Boolean).join(", ")} (authorised, not paid out)`;
  else if (facts.appropriations_unavailable)
    subtitle += bg
      ? " · поименните средства не можаха да се заредят"
      : " · the named state money could not be loaded";
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
