// АХУ (Агенция за хората с увреждания) — the agency's own grant competitions, as open calls.
//
// WHY THIS SOURCE. АХУ funds NGOs, employers, municipalities and people with disabilities
// under several statutory programmes (НПЗХУ by чл. 44 ЗХУ, rehabilitation and integration,
// accessible environment, self-employment by чл. 46, specialised enterprises by чл. 49,
// protected-employment centres by чл. 51). None of it runs through ИСУН, so without this arm
// /funds/calls answers „nothing" to an audience the site otherwise never reaches.
//
// WHERE THE CALLS ARE. Not on the programme pages (boilerplate) and not on /portal/page/123
// (protocols and forms — the RESULTS of past rounds). Each call is an „обявява конкурс"
// announcement on the NEWS page, /portal/page/6, one `portal-news-date` block per item.
// Measured 2026-10-21: seven calls Feb–Apr 2026 among ~125 news items.
//
// THE SAME RULES AS EVERY OTHER ARM, and these specific to this one:
//   * The deadline is read from its LABEL. Four phrasings occur: „Краен срок за подаване на
//     проекти: 17.30 часа на 29.04.2026 година" (time BEFORE date), „Срокът за подаване на
//     проектите е до 17.30 ч. на 12.03.2026 г.", „в периода от 03.02.2026 г. – 04.03.2026 г.,
//     всеки работен ден до 17.30 часа", and „се подават … не по-късно от 17:30 часа на
//     15.04.2026 г." (accepted only inside a clause about submitting projects — see
//     `submissionClause`). Never the latest date on the page.
//   * Staff competitions („конкурс за длъжността …") share the word „конкурс" and live on the
//     same site; only an announcement of a competition for FINANCING is a call.
//   * Two announcements put their window only in an attached .doc. They are REJECTED and
//     counted, never filed as `indicative`: `open_calls` never deletes a row (migration 142) and
//     the view keeps an indicative row indicative for ever, so even a FRESH undated row would
//     sit under „Очаквани приеми" long after its window shut — the forward-looking claim about
//     a dead call that `interreg_parse.ts` refuses for the same case.
//   * No money is read. The ceilings („до 15 338.76 евро") are prose, and migration 142 admits
//     money only from a labelled structured field.

import { createHash } from "node:crypto";
import { deriveAudience } from "./audience";
import { sofiaWallClockToUtc } from "./isun_parse";
import type { CallDoc, OpenCall } from "./types";

export const AHU_ORIGIN = "https://ahu.mlsp.government.bg";
export const AHU_NEWS_URL = `${AHU_ORIGIN}/portal/page/6`;
export const AHU_PROGRAMME = "Агенция за хората с увреждания";
/** Fewer items than this from a 200 is a markup change or an interstitial, not a quiet news
 *  page: it has carried ~125 since 2025. Shared by the crawler and the `ahu_calls` watcher. */
export const MIN_NEWS_ITEMS = 20;

export interface AhuNewsItem {
  /** DD.MM.YYYY as printed. */
  date: string;
  text: string;
  links: string[];
}

const decode = (s: string): string =>
  s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&ndash;|&mdash;/g, "–")
    .replace(/&bdquo;|&ldquo;|&rdquo;|&laquo;|&raquo;/g, '"')
    .replace(/&hellip;/g, "…")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const visible = (html: string): string =>
  decode(
    html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The news page → one item per `portal-news-date` block, in page order. */
export const parseAhuNews = (html: string): AhuNewsItem[] => {
  const parts = html.split(/<div class="portal-news-date">/).slice(1);
  return parts.flatMap((p) => {
    const date = /^\s*(\d{2}\.\d{2}\.\d{4})/.exec(p)?.[1];
    if (!date) return [];
    // A block runs to the next item; drop the trailing page chrome after the last one.
    const body = p.split(/<footer|<div class="portal-footer/)[0];
    const links = [...body.matchAll(/href="([^"]+)"/g)].map((m) =>
      decode(m[1]),
    );
    return [
      { date, text: visible(body.replace(/^[\s\S]*?<\/div>/, "")), links },
    ];
  });
};

/** A competition for FINANCING — not a staff competition, not a protocol of results. */
export const isFundingCall = (text: string): boolean =>
  /обявява\s+конкурс/i.test(text) &&
  /финансиран|програма|проект/i.test(text) &&
  !/длъжност/i.test(text);

const isoAt = (
  d: string,
  hm: { h: number; mi: number } | null,
): string | null => {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(d);
  if (!m) return null;
  const { h, mi } = hm ?? { h: 23, mi: 59 };
  return sofiaWallClockToUtc(+m[3], +m[2], +m[1], h, mi).toISOString();
};

const clock = (h: string, mi: string) => ({ h: Number(h), mi: Number(mi) });
const DATE = String.raw`(\d{1,2}\.\d{1,2}\.\d{4})`;
const TIME = String.raw`(\d{1,2})[.:](\d{2})`;

/**
 * Whether the „не по-късно от" at `at` closes a SUBMISSION of projects — judged on its own
 * clause only (back to the previous sentence end), never a wide lookback: every notice repeats
 * „крайния срок за подаване" somewhere, so a 400-character window let a questions or
 * registration cutoff through.
 */
const submissionClause = (text: string, at: number): boolean => {
  const before = text.slice(Math.max(0, at - 300), at);
  // A sentence end is „. " before a capital — but NOT a numbered-list marker („начини: 1. На
  // място, …"), which is exactly where these notices put the cutoff.
  const ends = [...before.matchAll(/(?<!\d)\.\s+(?=[А-ЯA-Z])/g)];
  const last = ends.at(-1);
  const clause = last ? before.slice(last.index + last[0].length) : before;
  return (
    /пода(?:ват|ване|дат)/i.test(clause) &&
    /проект|предложени|документ/i.test(clause) &&
    !/въпрос|разяснени|регистрац/i.test(clause)
  );
};

/** The labelled window, or nulls. See the header for the four phrasings. */
export const parseAhuWindow = (
  text: string,
): { opensAt: string | null; closesAt: string | null } => {
  // „Краен срок за подаване на проекти: 17.30 часа на 29.04.2026 година" — must name PROJECTS,
  // or „Краен срок за подаване на въпроси: …" would read as the call's close.
  let m = new RegExp(
    String.raw`Краен\s+срок\s+за\s+подаване\s+на\s+проект[^:]{0,40}:\s*${TIME}\s*ч(?:аса|\.)?\s*на\s*${DATE}`,
    "i",
  ).exec(text);
  if (m) return { opensAt: null, closesAt: isoAt(m[3], clock(m[1], m[2])) };
  // „Срокът за подаване на проектите е до 17.30 ч. на 12.03.2026 г."
  m = new RegExp(
    String.raw`Срок(?:ът)?\s+за\s+подаване\s+на\s+проект[^.]{0,40}?до\s*${TIME}\s*ч(?:аса|\.)?\s*на\s*${DATE}`,
    "i",
  ).exec(text);
  if (m) return { opensAt: null, closesAt: isoAt(m[3], clock(m[1], m[2])) };
  // „в периода от 03.02.2026 г. – 04.03.2026 г., всеки работен ден до 17.30 часа"
  m = new RegExp(
    String.raw`в\s+периода\s+от\s*${DATE}\s*г?\.?\s*[–-]\s*${DATE}\s*г?\.?[^.]{0,60}?до\s*${TIME}`,
    "i",
  ).exec(text);
  if (m)
    return {
      opensAt: isoAt(m[1], { h: 0, mi: 0 }),
      closesAt: isoAt(m[2], clock(m[3], m[4])),
    };
  // „…се подават … не по-късно от 17:30 часа на 15.04.2026 г."
  for (const g of text.matchAll(
    new RegExp(
      String.raw`не\s+по-късно\s+от\s*${TIME}\s*ч(?:аса|\.)?\s*на\s*${DATE}`,
      "gi",
    ),
  ))
    if (submissionClause(text, g.index))
      return { opensAt: null, closesAt: isoAt(g[3], clock(g[1], g[2])) };
  return { opensAt: null, closesAt: null };
};

/** The announcement's own words from „обявява конкурс" on, whitespace-collapsed. */
const announcementClause = (text: string): string => {
  const at = text.search(/обявява\s+конкурс/i);
  return (at >= 0 ? text.slice(at) : text).replace(/\s+/g, " ").trim();
};

/**
 * The statutory programmes АХУ runs, recognised in the announcement. A programme name is a
 * better title than the first clause, which is often a legal citation („…съгласно Методиката
 * за финансиране на проекти за създаване на Центрове за защитена заетост, утвърдена от…").
 * Two чл. 49 rounds differ only in their aim, so the aim is part of the name.
 */
const PROGRAMMES: { re: RegExp; title: string }[] = [
  {
    re: /национална\s+програма\s+за\s+заетост/i,
    title: "Национална програма за заетост на хората с увреждания (НПЗХУ)",
  },
  {
    re: /рехабилитация\s+и\s+интеграция/i,
    title: "Проекти за рехабилитация и интеграция на хората с увреждания",
  },
  {
    re: /достъпна\s+(?:архитектурна\s+)?среда/i,
    title:
      "Достъпна архитектурна среда на културни, исторически и спортни обекти",
  },
  {
    re: /самостоятелна\s+стопанска\s+дейност/i,
    title:
      "Започване и развитие на самостоятелна стопанска дейност на хора с увреждания",
  },
  {
    re: /центрове\s+за\s+защитена\s+заетост/i,
    title: "Създаване на центрове за защитена заетост (чл. 51 ЗХУ)",
  },
  {
    re: /социална\s+и\s+стопанска\s+насоченост/i,
    title:
      "Целеви проекти на специализирани предприятия и кооперации (чл. 49 ЗХУ) — заетост",
  },
  {
    re: /социална\s+насоченост[^.]{0,120}условия\s+на\s+труд/i,
    title:
      "Целеви проекти на специализирани предприятия и кооперации (чл. 49 ЗХУ) — условия на труд",
  },
];

/** A call's title: the recognised programme, else the first clause cut at a word boundary. */
export const ahuTitle = (text: string): string => {
  const clause = announcementClause(text);
  const known = PROGRAMMES.find((p) => p.re.test(clause));
  if (known) return `Конкурс: ${known.title}`;
  const first = clause.replace(/^обявява\s+/i, "").split(/\.\s|;\s/)[0];
  const t = first.charAt(0).toUpperCase() + first.slice(1);
  if (t.length <= 160) return t;
  return `${t.slice(0, 160).replace(/\s+\S*$/, "")}…`;
};

/** A call's stable key: its announcement date plus a hash of the RAW announcement clause — the
 *  ONE definition, shared by the crawler and the `ahu_calls` watcher. Hashed from the source's
 *  words, not from `ahuTitle`, so improving a title never mints a second row in a table that
 *  never deletes. (An edit to the announcement itself still does; that is a real change.) */
export const ahuCallKey = (item: AhuNewsItem): string =>
  `ahu:${item.date.split(".").reverse().join("-")}:${createHash("sha1")
    .update(announcementClause(item.text).slice(0, 200).toLowerCase())
    .digest("hex")
    .slice(0, 10)}`;

export type AhuOutcome =
  | { kind: "call"; call: OpenCall }
  | { kind: "rejected"; date: string; title: string; why: string };

/** One funding announcement → a row, or a counted rejection. Non-calls return null. */
export const parseAhuItem = (item: AhuNewsItem): AhuOutcome | null => {
  if (!isFundingCall(item.text)) return null;
  const title = ahuTitle(item.text);
  const { opensAt, closesAt } = parseAhuWindow(item.text);
  if (!closesAt)
    return {
      kind: "rejected",
      date: item.date,
      title,
      why: "no labelled deadline on the page (the window is in the attached notice)",
    };
  const docs: CallDoc[] = item.links
    .filter((u) => /\.(pdf|docx?|xlsx?|zip)$/i.test(u))
    .map((u) => ({
      label: decodeURIComponent(u.split("/").pop() ?? u),
      url: u.startsWith("http") ? u : `${AHU_ORIGIN}${u}`,
    }));

  return {
    kind: "call",
    call: {
      source: "ahu",
      sourceKey: ahuCallKey(item),
      code: null,
      kind: "call",
      title,
      programmeCode: "ahu",
      programmeName: AHU_PROGRAMME,
      objective: null,
      datePrecision: "exact",
      opensAt,
      closesAt,
      periodLabel: null,
      budgetEur: null,
      budgetNote: null,
      aidRatePct: null,
      grantMinEur: null,
      grantMaxEur: null,
      beneficiariesRaw: null,
      // The agency's own name („Агенцията за хората с увреждания") would trip the shared
      // `institution` rule on EVERY row; the audience is who may apply, not who announces.
      audience: deriveAudience(
        null,
        item.text
          .replace(/Агенци\S*\s+за\s+хор\S*\s+с\s+увреждания|\bАХУ\b/gi, " ")
          .slice(0, 4000),
      ),
      territory: null,
      sourceUrl: AHU_NEWS_URL,
      docs,
      enrichment: "none",
    },
  };
};
