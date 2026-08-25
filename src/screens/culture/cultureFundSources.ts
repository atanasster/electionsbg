// The four /culture/funds source arms, as data.
//
// Pure data — no JSX — so it stays out of the entry chunk, the same rule
// `cultureRegistry.ts` states for the hub tiles (src/entryGraph.test.ts).
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ THE FOUR ARMS DO NOT SUM, AND EACH PAGE NOW HAS TO SAY SO ON ITS OWN.
//
// /culture/funds carries that warning in its first sentence, above four rows. A
// reader who lands on ONE of these pages from a search result or a shared link
// never sees it — so every field below that a page renders is built to carry the
// basis WITH the number rather than beside it:
//
//   `basis`    what ONE ROW is. A contract value, a published budget, a subsidy.
//   `identity` HOW these rows were reached — an EIK set, a name rule, a theme.
//   `limit`    what this arm CANNOT answer, with its number. Never optional, and
//              never the field to drop when space is short: it is the difference
//              between a page that answers a question and one that looks like it
//              did.
//
// The four euro figures are four different quantities and no surface may add
// them. `functions/db_table.js` carries the same rule structurally (four
// resources, no shared money column name); this file carries it in words.
// ═══════════════════════════════════════════════════════════════════════════════
//
// ⚠️ EVERY FIGURE THAT MOVES WITH THE CORPUS COMES FROM `hub_stats.json`, never
// from a literal here — the prose says what an arm IS, the blob says how big it
// is. That is the split `cultureRegistry.ts` enforces for the hub tiles, and for
// the same reason: the first cut of that page quoted eight figures as frozen
// strings beside figures the prerender interpolated, so half of it self-updated
// and half did not, indistinguishably.
//
// A figure that does NOT move — a one-off measurement cited to explain why an
// arm is shaped the way it is, like the €5,416 of school-food aid that is the
// only EIK-side ДФЗ match — may be a literal, and then it MUST carry its
// measurement date so a reader can tell it apart from a live one. „~4,4 пъти" is
// the same kind of thing: a property of the matching RULE (cultureMatch.ts), not
// of the corpus.
//
// Copy lives here rather than in the i18n corpus, following CULTURE_HUB_COPY:
// these strings exist once, on four pages, and a corpus key per string is a key
// nobody else can reuse.

import { TILE_ACCENTS } from "@/ux/infographic";
import { formatEurCompact, formatInt, formatPct } from "@/lib/currency";
import type { CultureHubStats } from "@/data/culture/hubStats";
import type { CultureFundSourceBreakdowns } from "@/data/culture/fundSources";

/**
 * How many EIK-arm projects the NAME arm does NOT reach — the one derivation of
 * the relationship between the two ИСУН figures.
 *
 * ⚠️ `null` MEANS „SAY NOTHING", NOT ZERO. `eikExactAlsoByName` is optional on
 * the wire: the blob ships via `bucket:sync`, a different command from the
 * bundle, so a page can load against one minted before the field existed.
 * Defaulting the absent case to „all of them overlap" publishes „0 of its
 * projects carry no culture word" — a sentence that denies its own evidence —
 * beside a claim that the arms are not nested.
 *
 * It lives here rather than in either screen because BOTH derive it:
 * `CultureFundsScreen` for the parent row's copy and this registry for the
 * detail page's limit. Two derivations of one relationship is how they end up
 * saying different things about the same two numbers.
 */
export const eikNameMissed = (s: CultureHubStats): number | null =>
  typeof s.funds.eikExactAlsoByName === "number"
    ? s.funds.eikExactProjects - s.funds.eikExactAlsoByName
    : null;

/** Which figures a page shows. Each reads the blob so nothing can freeze. */
export type CultureFundMetric = (s: CultureHubStats) => {
  /** The arm's headline euro figure. */
  eur: number;
  /** Its row count, and what a row IS. */
  rows: number;
  /** ⚠️ THE COUNTING FORM (бройна форма) — the noun as it appears AFTER A
   *  NUMERAL: „47 проекта". */
  rowsLabel: { bg: string; en: string };
  /** ⚠️ THE PLAIN PLURAL — the noun as it appears after an article or an
   *  adjective: „най-големите проекти".
   *
   *  Bulgarian distinguishes the two and English does not, so a single field
   *  reads correctly in one language and wrong in the other: „Най-големите
   *  проекта" is the бройна форма with no numeral in front of it, which is the
   *  same class of error as „1 проекта". Only the ИСУН arms differ (проекта /
   *  проекти); участия and плащания are identical in both forms, which is
   *  exactly why one field looked sufficient. */
  rowsPlural: { bg: string; en: string };
};

export interface CultureFundSource {
  /** Stable identity, and the last path segment. */
  id: string;
  /** Absolute destination. Static — never a `:param` (cultureRegistry's rule). */
  to: string;
  /** The `/api/db/table` resource name (functions/db_table.js). */
  resource: string;
  /** A TILE_ACCENTS token, unique across the four: they render together in the
   *  cross-arm strip, so a repeat reads as „these two are the same kind“. */
  accent: string;
  title: { bg: string; en: string };
  /** Short label for the cross-arm strip, where the full title will not fit. */
  short: { bg: string; en: string };
  /** One sentence: what this page is, and the ONE thing it is not. */
  deck: { bg: string; en: string };
  /** What a single row measures. */
  basis: { bg: string; en: string };
  /** How the rows were reached — the identity, not the quantity. */
  identity: { bg: string; en: string };
  /** ⚠️ What this arm CANNOT answer. Required. See the header. */
  limit: (s: CultureHubStats, lang: string) => { bg: string; en: string };
  metric: CultureFundMetric;
  /** WHAT the head's evidence list is ranked by — the same role `HubKpi.basis`
   *  plays for the band. „Най-големите" is answerable three ways on the ИСУН
   *  arms alone (grant, contracted, paid).
   *
   *  Paired with `rankColumn` so the SENTENCE and the ORDER BY cannot drift: the
   *  list is only the top N while the table is in its default sort, and
   *  `rankColumn` is the camelCased money column that sort produces. */
  evidenceBasis: { bg: string; en: string };
  rankColumn: string;
  /** What this arm's global search ACTUALLY reaches (functions/db_table.js). A
   *  placeholder that under-states the reach makes a reader stop typing the term
   *  that would have worked. */
  searchPlaceholder: { bg: string; en: string };
  /** The KPI band, 3 per arm.
   *
   *  ⚠️ `basis` IS REQUIRED BY `HubKpi` AND THAT IS THE POINT OF THE COMPONENT:
   *  the band is the largest type on the page, so it is the highest-stakes place
   *  for a number that is arithmetically right and false as a sentence. On this
   *  page family it does double duty — the four arms measure four different
   *  things, so the basis is also what stops a reader carrying one arm's figure
   *  onto another.
   *
   *  Every figure comes from the blob; a `null` field yields no cell rather than
   *  a zero, which would be a claim. */
  kpis: (
    s: CultureHubStats,
    lang: string,
  ) => { value: string; label: string; basis: string }[];
  /** The arm's ONE chart — a bar list, from the blob's own per-arm breakdown.
   *
   *  ⚠️ Returns null when the blob cannot support it, never an empty frame: an
   *  empty chart reads as „this arm has no breakdown", which is a claim.
   *
   *  Each arm's is a different question, which is why this is a per-entry
   *  builder rather than one shared shape:
   *    isun-eik   concentration — 47 projects over 31 bodies
   *    isun-name  the programme split, where one instrument is ~80%
   *    interreg   the programme split across 14 cross-border programmes
   *    dfz        a TIME series, because the arm is front-loaded in 2015-2016
   *               and a flat total hides that
   */
  breakdown?: (
    s: CultureHubStats,
    /** From `fund_sources.json` — a SEPARATE artifact from the hub blob, so
     *  /culture does not pay for four sub-pages' per-row payloads. `null` when
     *  it has not loaded or the checkout never ran the generator. */
    d: CultureFundSourceBreakdowns | null,
    lang: string,
  ) => {
    heading: string;
    basis: string;
    rows: { id: string; label: string; eur: number; count?: number }[];
    countNoun?: string;
    note?: string;
  } | null;
  /** One sentence naming the shape a reader would otherwise mis-take from this
   *  arm — the finding the page exists to surface, as opposed to `limit`, which
   *  is what the arm cannot answer. Optional: only the name arm has one today.
   *  Returns null when the blob cannot support the claim. */
  finding?: (
    s: CultureHubStats,
    lang: string,
  ) => { bg: string; en: string } | null;
}

export const CULTURE_FUND_SOURCES: readonly CultureFundSource[] = [
  {
    id: "isun-eik",
    evidenceBasis: { bg: "по безвъзмездна помощ", en: "by grant" },
    rankColumn: "grantEur",
    searchPlaceholder: {
      bg: "Търси бенефициент, програма или проект…",
      en: "Search a beneficiary, programme or project…",
    },
    to: "/culture/funds/isun-eik",
    resource: "culture_isun_eik",
    accent: TILE_ACCENTS.indigo,
    title: {
      bg: "ИСУН — по ЕИК на бенефициента",
      en: "ИСУН — by beneficiary EIK",
    },
    short: { bg: "ИСУН по ЕИК", en: "ИСУН by EIK" },
    deck: {
      bg: "Европейските проекти на институциите от регистъра на сектора, намерени по точно съвпадение на ЕИК. Възпроизводимият ред — но не и пълният.",
      en: "The EU projects of the institutions in the sector register, found by exact EIK match. The reproducible row — but not the complete one.",
    },
    // ⚠️ NAMES THE GRANT, because that is what every figure on the page shows.
    // `eikExactEur`/`byNameEur` are `sum(grant_eur)` in the generator and the
    // table footer sums `sumGrantEur`. This sentence described the CONTRACTED
    // value at first — €160.4m against a published €147.0m on the name arm, 8.4%
    // apart — i.e. a basis line describing a different number from the one
    // beside it, which is the one thing a basis line must never do.
    basis: {
      bg: "Един ред е проект в ИСУН, а числото е БЕЗВЪЗМЕЗДНАТА ПОМОЩ — това, което публичната каса е платила. Колоната „Договорено“ до него е по-голяма: тя включва и собственото съфинансиране на бенефициента.",
      en: "One row is an ИСУН project, and the figure is the GRANT — what the public purse paid. The „Договорено“ column beside it is larger: it also carries the beneficiary's own co-finance.",
    },
    identity: {
      bg: "Точно съвпадение по ЕИК срещу списъка на сектора (kulturaReferenceData.ts) — възпроизводимо от всеки, който има регистъра и корпуса.",
      en: "An exact EIK match against the sector register (kulturaReferenceData.ts) — reproducible by anyone with the register and the corpus.",
    },
    // ⚠️ THREE-WAY, and the third branch is „say nothing". See `eikNameMissed`.
    // Neither language pluralises by template: Bulgarian needs „един проект …
    // няма" at one (not the бройна форма „проекта … нямат") and English needs
    // „carries … its". Today the value IS one, so the singular is the sentence a
    // reader actually meets.
    limit: (s, lang) => {
      const missed = eikNameMissed(s);
      const tailBg =
        missed === null
          ? ""
          : missed <= 0
            ? " Този ред се съдържа изцяло в него."
            : missed === 1
              ? " И този ред не се съдържа изцяло в него: един проект от списъка по ЕИК няма културна дума в името си."
              : ` И този ред не се съдържа изцяло в него: ${formatInt(missed, lang)} проекта от списъка по ЕИК нямат културна дума в името си.`;
      const tailEn =
        missed === null
          ? ""
          : missed <= 0
            ? " This arm is wholly contained by it."
            : missed === 1
              ? " Nor is this arm wholly contained by it: one EIK-listed project carries no culture word in its name."
              : ` Nor is this arm wholly contained by it: ${formatInt(missed, lang)} EIK-listed projects carry no culture word in their name.`;
      return {
        bg: `Само институциите с ЕИК в регистъра. Читалищата — най-широкият културен поток по брой получатели — нямат ЕИК в този списък и не са тук: те се намират само по ИМЕ, на съседния ред.${tailBg}`,
        en: `Only the institutions whose EIK is in the register. Читалища — culture's widest stream by recipient count — carry no EIK in that list and are absent: they are reachable only by NAME, on the neighbouring arm.${tailEn}`,
      };
    },
    kpis: (s, lang) => {
      const b = lang === "bg";
      // The blob's own figure, not `eikExactProjects - missed` — that reaches
      // the same number by subtracting the difference back out, and is one
      // refactor of `eikNameMissed` away from being silently wrong.
      const also = s.funds.eikExactAlsoByName;
      return [
        {
          value: formatEurCompact(s.funds.eikExactEur, lang),
          label: b ? "безвъзмездна помощ" : "grant",
          basis: b ? "по ИСУН, ЕИК-точно съвпадение" : "ИСУН, exact EIK match",
        },
        {
          value: formatInt(s.funds.eikExactProjects, lang),
          label: b ? "проекта" : "projects",
          basis: b ? "един ред = един проект" : "one row = one project",
        },
        // The overlap, as a figure rather than only as prose — and absent
        // entirely when the blob cannot support it (see `eikNameMissed`).
        ...(also == null
          ? []
          : [
              {
                value: formatInt(also, lang),
                label: b ? "и по име" : "also by name",
                basis: b
                  ? `от ${formatInt(s.funds.eikExactProjects, lang)} — не всички`
                  : `of ${formatInt(s.funds.eikExactProjects, lang)} — not all`,
              },
            ]),
      ];
    },
    breakdown: (s, d, lang) => {
      const rows = d?.eikByBeneficiary ?? [];
      if (!rows.length) return null;
      const b = lang === "bg";
      // The distinct bodies this arm actually has, and what the visible bars
      // carry of its money — both derived, so the note cannot describe a
      // different chart from the one above it.
      const shown = d?.eikBodyCount ?? rows.length;
      const shownEur = rows.reduce((a, r) => a + r.eur, 0);
      return {
        heading: b
          ? "Кой получава — институциите от регистъра"
          : "Who receives it — the register's institutions",
        basis: b ? "по безвъзмездна помощ" : "by grant",
        countNoun: b ? "проекта" : "projects",
        rows: rows.map((r) => ({
          // ⚠️ The EIK, never the name: this arm's value is that its identity is
          // exact, and six of its bodies are spelled two or three ways in ИСУН.
          id: r.eik,
          label: r.name,
          eur: r.eur,
          count: r.projects,
        })),
        // ⚠️ DESCRIBES WHAT THE CHART SHOWS, not the arm. The chips sum to the
        // TOP TEN's projects, not to the arm's 47, so quoting the arm's total
        // here put a number over bars that visibly do not add to it. Both
        // figures are derived, so neither can go stale.
        note: b
          ? `Показани са ${formatInt(rows.length, lang)} от общо ${formatInt(shown, lang)} институции с проекти — те носят ${formatPct(shownEur / Math.max(s.funds.eikExactEur, 1), lang)} от помощта по този ред.`
          : `Showing ${formatInt(rows.length, lang)} of the ${formatInt(shown, lang)} institutions with projects — they carry ${formatPct(shownEur / Math.max(s.funds.eikExactEur, 1), lang)} of this arm's grant.`,
      };
    },
    metric: (s) => ({
      eur: s.funds.eikExactEur,
      rows: s.funds.eikExactProjects,
      rowsLabel: { bg: "проекта", en: "projects" },
      rowsPlural: { bg: "проекти", en: "projects" },
    }),
  },
  {
    id: "isun-name",
    evidenceBasis: { bg: "по безвъзмездна помощ", en: "by grant" },
    rankColumn: "grantEur",
    searchPlaceholder: {
      bg: "Търси бенефициент, програма или проект…",
      en: "Search a beneficiary, programme or project…",
    },
    to: "/culture/funds/isun-name",
    resource: "culture_isun_name",
    accent: TILE_ACCENTS.violet,
    title: {
      bg: "ИСУН — по име на бенефициента",
      en: "ИСУН — by beneficiary name",
    },
    short: { bg: "ИСУН по име", en: "ИСУН by name" },
    deck: {
      bg: "Всичко в ИСУН, чието име на бенефициента носи културна дума — предимно читалища. Долна граница с размита граница.",
      en: "Everything in ИСУН whose beneficiary name carries a culture word — mostly читалища. A floor with a fuzzy edge.",
    },
    basis: {
      bg: "Същата величина като реда по ЕИК — БЕЗВЪЗМЕЗДНА ПОМОЩ — но върху друга, по-широка съвкупност.",
      en: "The same quantity as the EIK arm — the GRANT — over a different, wider population.",
    },
    identity: {
      bg: "Съвпадение по име срещу правилото в cultureMatch.ts, с изключенията срещу „аквакултури“ и „изкуствен интелект“. Правило, не оценка: няма степен на сигурност на реда.",
      en: "A name match against the rule in cultureMatch.ts, guarded against „аквакултури“ and „изкуствен интелект“. A rule, not a score: no row carries a confidence grade.",
    },
    // The recipient count is NAME-distinct and the sentence says so — two
    // spellings of one читалище are two names. From the blob, never a literal:
    // the figure moves whenever the corpus does.
    limit: (s, lang) => {
      const names = s.funds.byNameNames;
      const namesBg =
        names == null
          ? "върху по-малко организации, отколкото различни ИМЕНА"
          : `върху ${formatInt(names, lang)} различни ИМЕНА, не непременно толкова организации`;
      const namesEn =
        names == null
          ? "over fewer organisations than distinct NAMES"
          : `over ${formatInt(names, lang)} distinct NAMES rather than that many organisations`;
      return {
        bg: `Едно име може да е изписано по два начина, така че ${formatInt(s.funds.byNameProjects, lang)}-те проекта са ${namesBg}. Обратно — институция без културна дума в името си липсва тук, макар да е в регистъра.`,
        en: `One organisation can be spelled two ways, so these ${formatInt(s.funds.byNameProjects, lang)} projects sit ${namesEn}. Conversely, an institution with no culture word in its name is absent here even though it is in the register.`,
      };
    },
    kpis: (s, lang) => {
      const b = lang === "bg";
      return [
        {
          value: formatEurCompact(s.funds.byNameEur, lang),
          label: b ? "безвъзмездна помощ" : "grant",
          basis: b ? "по ИСУН, съвпадение по име" : "ИСУН, name match",
        },
        {
          value: formatInt(s.funds.byNameProjects, lang),
          label: b ? "проекта" : "projects",
          basis: b ? "един ред = един проект" : "one row = one project",
        },
        // ⚠️ NAME-distinct, and the basis says so: two spellings of one
        // читалище are two names, so this is an upper bound on organisations.
        ...(s.funds.byNameNames == null
          ? []
          : [
              {
                value: formatInt(s.funds.byNameNames, lang),
                label: b ? "различни имена" : "distinct names",
                basis: b ? "не организации — виж по-долу" : "not organisations",
              },
            ]),
        {
          value: formatEurCompact(s.funds.chitalishtaEur, lang),
          label: b ? "от тях към читалища" : "of it to читалища",
          basis: b ? "същият ред, подгрупа" : "same arm, a sub-group",
        },
      ];
    },
    breakdown: (_s, d, lang) => {
      const rows = d?.byNameByProgram ?? [];
      if (!rows.length) return null;
      const b = lang === "bg";
      return {
        heading: b
          ? "Откъде идват парите — по програма"
          : "Which programme pays",
        basis: b ? "по безвъзмездна помощ" : "by grant",
        countNoun: b ? "проекта" : "projects",
        rows: rows.map((r) => ({
          id: r.code,
          label: r.name || r.code,
          eur: r.eur,
          count: r.projects,
        })),
        // The chart exists for this sentence: the first bar dwarfs the rest, and
        // without seeing that a reader takes the arm for a broad mix.
        //
        // ⚠️ THE COUNT IS DERIVED FROM THE ROWS. It said „петнайсет" as a
        // literal — frozen, which this file's header forbids, and wrong twice
        // over: the chart is capped at twelve bars, and the corpus has sixteen
        // programmes. A note must describe the chart above it.
        note: b
          ? `Първата лента е почти целият ред: останалите ${formatInt(rows.length - 1, lang)} показани програми заедно носят по-малко от нея.`
          : `The first bar is nearly the whole arm: the other ${formatInt(rows.length - 1, lang)} programmes shown carry less than it does between them.`,
      };
    },
    metric: (s) => ({
      eur: s.funds.byNameEur,
      rows: s.funds.byNameProjects,
      rowsLabel: { bg: "проекта", en: "projects" },
      rowsPlural: { bg: "проекти", en: "projects" },
    }),
    // ⚠️ „European culture funding" is, on this arm, mostly ONE instrument
    // paying читалища — and a reader who does not see that takes the €147m for a
    // broad mix. The ROW share and the MONEY share are different numbers, so
    // both are stated rather than one being labelled whichever way reads better.
    // Null when the blob predates the field: an unsupported claim is worse than
    // a missing one.
    finding: (s, lang) => {
      const t = s.funds.byNameTopProgram;
      if (!t || !t.projects || !s.funds.byNameProjects) return null;
      // ⚠️ formatPct, not toFixed: Bulgarian writes „82,8%" and toFixed gives
      // „82.8", which is a decimal POINT in a language that uses a comma —
      // wrong in the one sentence on the page a reader is meant to quote.
      const rowPct = formatPct(t.projects / s.funds.byNameProjects, lang);
      const eurPct = s.funds.byNameEur
        ? formatPct(t.eur / s.funds.byNameEur, lang)
        : null;
      return {
        bg: `Една програма носи по-голямата част от този ред: „${t.name}“ (${t.code}) — ${formatInt(t.projects, lang)} от ${formatInt(s.funds.byNameProjects, lang)} проекта (${rowPct})${eurPct ? ` и ${eurPct} от помощта` : ""}. Тоест това не е широка смес от европейски програми за култура, а предимно един инструмент, който плаща на читалища.`,
        en: `One programme carries most of this arm: „${t.name}" (${t.code}) — ${formatInt(t.projects, lang)} of ${formatInt(s.funds.byNameProjects, lang)} projects (${rowPct})${eurPct ? ` and ${eurPct} of the grant` : ""}. So this is not a broad mix of European culture programmes but mostly one instrument paying читалища.`,
      };
    },
  },
  {
    id: "interreg",
    evidenceBasis: {
      bg: "по публикуван бюджет на партньора",
      en: "by the partner's published budget",
    },
    rankColumn: "budgetEur",
    searchPlaceholder: {
      bg: "Търси партньор или операция…",
      en: "Search a partner or an operation…",
    },
    to: "/culture/funds/interreg",
    resource: "culture_interreg",
    accent: TILE_ACCENTS.teal,
    title: {
      bg: "Interreg — тематично (култура и наследство)",
      en: "Interreg — culture and heritage themed",
    },
    short: { bg: "Interreg", en: "Interreg" },
    deck: {
      bg: "Българските партньори по трансгранични проекти, чиято ТЕМА е култура или наследство. Не същите пари като редовете по ИСУН — и не същият въпрос.",
      en: "The Bulgarian partners in cross-border projects whose THEME is culture or heritage. Not the same money as the ИСУН arms — and not the same question.",
    },
    basis: {
      bg: "Един ред е ПУБЛИКУВАН БЮДЖЕТ на един партньор, не стойност на договор. Не е съпоставим с редовете по ИСУН.",
      en: "One row is one partner's PUBLISHED BUDGET, not a contract value. Not comparable with the ИСУН arms.",
    },
    identity: {
      bg: "Свързва се през ТЕМАТА на операцията (заглавието ѝ на английски), не през списък с културни институции. „Колко Interreg пари за култура стигат до България“ и „колко културни институции правят Interreg“ са различни въпроси, ~4,4 пъти един от друг.",
      en: "Joined through the OPERATION's THEME (its English title), not through a list of culture bodies. „How much Interreg culture money reaches Bulgaria“ and „how many culture institutions do Interreg“ are different questions, ~4.4x apart.",
    },
    limit: (s, lang) => ({
      bg: `Само ${formatInt(s.interreg.rowsWithEik, lang)} от ${formatInt(s.interreg.partnerRows, lang)} участия носят ЕИК изобщо, така че филтър или връзка по ЕИК отговаря на около една пета от въпроса. Партньорите тук са предимно общини и НПО, а не държавни културни институти.`,
      en: `Only ${formatInt(s.interreg.rowsWithEik, lang)} of ${formatInt(s.interreg.partnerRows, lang)} participations carry an EIK at all, so an EIK-keyed filter or link answers about a fifth of the question. The partners here are mostly municipalities and NGOs rather than state culture institutes.`,
    }),
    kpis: (s, lang) => {
      const b = lang === "bg";
      return [
        {
          value: formatEurCompact(s.interreg.thematicEur, lang),
          label: b ? "публикуван бюджет" : "published budget",
          basis: b
            ? "на партньора — не договор"
            : "of the partner — not a contract",
        },
        {
          value: formatInt(s.interreg.partnerRows, lang),
          label: b ? "участия" : "participations",
          basis: b
            ? `на ${formatInt(s.interreg.partners, lang)} партньора`
            : `by ${formatInt(s.interreg.partners, lang)} partners`,
        },
        // The coverage figure, in the band rather than only in the basis card:
        // an EIK-keyed surface answers for these rows and no others.
        {
          value: formatInt(s.interreg.rowsWithEik, lang),
          label: b ? "с ЕИК" : "carry an EIK",
          basis: b
            ? `от ${formatInt(s.interreg.partnerRows, lang)} — ~една пета`
            : `of ${formatInt(s.interreg.partnerRows, lang)} — about a fifth`,
        },
      ];
    },
    breakdown: (_s, d, lang) => {
      const rows = d?.interregByProgramme ?? [];
      if (!rows.length) return null;
      const b = lang === "bg";
      return {
        heading: b
          ? "По коя трансгранична програма"
          : "Which cross-border programme",
        basis: b
          ? "по публикуван бюджет на партньора"
          : "by the partner's published budget",
        countNoun: b ? "участия" : "participations",
        rows: rows.map((r) => ({
          id: r.code,
          label: r.code,
          eur: r.eur,
          count: r.rows,
        })),
        // ⚠️ „ВСЯКА ПРОГРАМА Е ЕДНА ГРАНИЦА" WAS FALSE for four of them —
        // Danube (twice), Interreg Europe and Black Sea Basin are multi-country
        // programmes, not bilateral borders, and they carry ~a quarter of the
        // participations. The claim that survives is the one the arm is for:
        // these partners are municipalities and NGOs, not state institutes.
        note: b
          ? "Повечето от тези програми са двустранни — една граница всяка; няколко (Дунав, Черноморски басейн, Interreg Europe) обхващат по-широк регион. Общото е кой получава парите: предимно общини и НПО, а не държавни културни институти."
          : "Most of these are bilateral — one border each; a few (Danube, Black Sea Basin, Interreg Europe) span a wider region. What they share is who receives the money: mostly municipalities and NGOs rather than state culture institutes.",
      };
    },
    metric: (s) => ({
      eur: s.interreg.thematicEur,
      rows: s.interreg.partnerRows,
      rowsLabel: { bg: "участия", en: "participations" },
      rowsPlural: { bg: "участия", en: "participations" },
    }),
  },
  {
    id: "dfz",
    evidenceBasis: { bg: "по изплатена субсидия", en: "by subsidy paid" },
    rankColumn: "subsidyEur",
    searchPlaceholder: { bg: "Търси читалище…", en: "Search a читалище…" },
    to: "/culture/funds/dfz",
    resource: "culture_agri_chitalishta",
    accent: TILE_ACCENTS.amber,
    title: { bg: "ДФЗ — народни читалища", en: "ДФЗ — народни читалища" },
    short: { bg: "ДФЗ читалища", en: "ДФЗ читалища" },
    deck: {
      bg: "Земеделски субсидии, изплатени на народни читалища. Нито един държавен културен институт не получава такива.",
      en: "Farm subsidies paid to народни читалища. No state cultural institution receives one.",
    },
    basis: {
      bg: "Един ред е ИЗПЛАТЕНА земеделска субсидия по схема на ДФ „Земеделие“ — не договор и не грант.",
      en: "One row is a DISBURSED farm subsidy under a State Fund Agriculture scheme — neither a contract nor a grant.",
    },
    identity: {
      bg: "Съвпадение по ИМЕ срещу „читалищ“. Стъблото няма известно съвпадение с друга дума, затова тук няма изключения.",
      en: "A NAME match against „читалищ“. The stem has no known collision, so this arm carries no exclusions.",
    },
    limit: () => ({
      bg: "Достига се САМО по име. Филтър по ЕИК срещу регистъра на сектора връща практически нищо — единственото съвпадение е едно национално музикално училище по „Училищни схеми“ (€5 416 за 2016-2017, измерено 2026-08-19), което е училищна помощ, администрирана от ДФЗ, а не земеделска субсидия за културен институт. Тоест: присъствието на културата тук са читалищата, и никой друг.",
      en: "Reachable ONLY by name. An EIK filter against the sector register returns essentially nothing — the sole match is one national music school on „Училищни схеми“ (€5,416 across 2016-2017, measured 2026-08-19), which is school-food aid ДФЗ merely administers rather than a farm subsidy to a cultural institution. Culture's presence here is читалища and nobody else.",
    }),
    kpis: (s, lang) => {
      const b = lang === "bg";
      return [
        {
          value: formatEurCompact(s.agri.chitalishtaEur, lang),
          label: b ? "изплатени субсидии" : "subsidies paid",
          basis: b ? "по схеми на ДФЗ" : "under ДФЗ schemes",
        },
        {
          value: formatInt(s.agri.chitalishtaRows, lang),
          label: b ? "плащания" : "payments",
          basis: b ? "един ред = едно плащане" : "one row = one payment",
        },
        // The same population, one arm over — the two читалища figures are from
        // DIFFERENT registers and this is where a reader most wants to compare
        // them, so the basis says which is which.
        {
          value: formatEurCompact(s.funds.chitalishtaEur, lang),
          label: b ? "същите по ИСУН" : "the same, in ИСУН",
          basis: b
            ? "друг регистър — не се събират"
            : "another register — do not sum",
        },
      ];
    },
    breakdown: (_s, d, lang) => {
      const rows = d?.agriByYear ?? [];
      if (!rows.length) return null;
      const b = lang === "bg";
      const top = [...rows].sort((x, y) => y.eur - x.eur)[0];
      return {
        heading: b ? "Кога са изплатени" : "When they were paid",
        // ⚠️ A TIME series, so the caption says „по година" and the rows arrive
        // in YEAR order from the blob. Sorted by size this would draw a ranking
        // that looks like a trend.
        basis: b ? "по година, изплатена субсидия" : "by year, subsidy paid",
        countNoun: b ? "плащания" : "payments",
        rows: rows.map((r) => ({
          id: String(r.year),
          label: String(r.year),
          eur: r.eur,
          count: r.rows,
        })),
        note: b
          ? `Редът не е равномерен поток: най-голямата година е ${top.year}. Схемите 321 и 322 по Програмата за развитие на селските райони приключиха, така че това е предимно история, а не текущо финансиране.`
          : `This arm is not a steady flow: its largest year is ${top.year}. The 321 and 322 rural-development schemes have closed, so it is mostly history rather than current funding.`,
      };
    },
    metric: (s) => ({
      eur: s.agri.chitalishtaEur,
      rows: s.agri.chitalishtaRows,
      rowsLabel: { bg: "плащания", en: "payments" },
      rowsPlural: { bg: "плащания", en: "payments" },
    }),
  },
];

export const cultureFundSource = (id: string): CultureFundSource | undefined =>
  CULTURE_FUND_SOURCES.find((s) => s.id === id);
