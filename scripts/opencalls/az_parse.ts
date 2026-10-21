// АЗ (Агенция по заетостта) — intake windows announced in its news, as open calls.
//
// WHAT АЗ PUBLISHES. Not a calls register: news items („От 19 октомври 2026 г. Агенцията по
// заетостта започва прием на заявления по …"). Most intakes are OPEN-ENDED — they run until the
// money is spent and stop by a later notice („временно спира приемът …"). Only some state a
// labelled END: „областните и общинските администрации могат да заявяват работни места от 16
// до 26 октомври 2026 г. включително", or a stop notice that gives the last moment to apply
// („могат да подават заявки … до 17:00 ч. на 25 септември 2026 г.").
//
// ⚠️ EXACT ROWS ONLY — decided 2026-10-21. An open-ended intake has no deadline, and the only
// other shape migration 142 offers is `indicative`, which the view shows as „Очаквани приеми"
// FOR EVER (open_calls never deletes). „От 19 октомври започва прием" would still read as an
// expected intake months after the money ran out. So an item becomes a row only when an END
// date sits in a clause about applying; open-ended intakes and pure stop notices are REJECTED
// and counted, and stay visible in the crawl log. Revisit when the view can expire a stale
// indicative row.
//
// Never a date from elsewhere on the page: the article body only (`txtNews`), never the page
// chrome, which carries order numbers dated „от 11.07.2025".

import { deriveAudience } from "./audience";
import { sofiaWallClockToUtc } from "./isun_parse";
import type { OpenCall } from "./types";

export const AZ_ORIGIN = "https://www.az.government.bg";
export const AZ_NEWS_URL = `${AZ_ORIGIN}/bg/news/`;
export const AZ_PROGRAMME = "Агенция по заетостта";

const MONTHS: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};

const decode = (s: string): string =>
  s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&ndash;|&mdash;/g, "–")
    .replace(/&bdquo;/g, "„")
    .replace(/&ldquo;|&rdquo;/g, "“")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const visible = (html: string): string =>
  decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** The news list → item URLs, in page order. */
export const parseAzNewsList = (html: string): string[] => {
  const out: string[] = [];
  for (const m of html.matchAll(
    /href=["']((?:https:\/\/www\.az\.government\.bg)?\/bg\/news\/view\/[^"']+)["']/g,
  )) {
    const url = m[1].startsWith("http") ? m[1] : `${AZ_ORIGIN}${m[1]}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
};

export interface AzItem {
  id: string;
  url: string;
  /** DD.MM.YYYY as printed. */
  date: string;
  title: string;
  /** The article body only — `txtNews`, never the page chrome. */
  body: string;
}

/** One news view page → its date, title and body, or null when the markup is not a news item. */
export const parseAzItem = (html: string, url: string): AzItem | null => {
  const date = /<p class="dateNews">\s*(\d{2}\.\d{2}\.\d{4})\s*<\/p>/.exec(
    html,
  )?.[1];
  const title = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1];
  const start = html.indexOf('<div class="txtNews">');
  if (!date || !title || start < 0) return null;
  const end = html.indexOf("</li>", start);
  const id = /-(\d+)\/?$/.exec(url)?.[1] ?? url;
  return {
    id,
    url,
    date,
    title: visible(title),
    body: visible(html.slice(start, end > 0 ? end : undefined)),
  };
};

/** „26 октомври 2026" → parts, or null. */
const wordDate = (d: string, mon: string, y: string) => {
  const mo = MONTHS[mon.toLowerCase()];
  return mo ? { y: Number(y), mo, d: Number(d) } : null;
};
const iso = (
  p: { y: number; mo: number; d: number },
  h: number,
  mi: number,
): string => sofiaWallClockToUtc(p.y, p.mo, p.d, h, mi).toISOString();

const MON = String.raw`(януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември)`;
/** A clause about APPLYING — the subject of every labelled end this source prints. */
const APPLY = /(?:подава|заявява|кандидатства|подаване|кандидатстване)/i;

export interface AzWindow {
  opensAt: string | null;
  closesAt: string;
  /** The verbatim clause the window was read from — shown, and pinned in tests. */
  clause: string;
  /** „По „X" …" — the programme the clause is about, when it names one. */
  programme: string | null;
}

/** Sentence boundaries. „ч." / „ал." / „чл." / „т." stay inside their sentence — with a
 *  Unicode-aware boundary, because `\b` never matches after a Cyrillic letter. „г." is
 *  deliberately NOT guarded: before a capital it is a real sentence end in this prose, and
 *  merging across it would let one sentence's „подават" license the next sentence's date. */
const SENTENCE = /(?<!(?<![\p{L}])(?:ч|ал|чл|т))\.\s+(?=[А-ЯA-Z„])/u;

const D = String.raw`(\d{1,2})`;
const Y = String.raw`(\d{4})`;
/** „от 16 до 26 октомври 2026" — a range in one month. */
const RANGE_ONE_MONTH = new RegExp(
  String.raw`от\s+${D}\s+до\s+${D}\s+${MON}\s+${Y}`,
  "i",
);
/** „от 28 септември до 9 октомври 2026" — a range across months, one year. */
const RANGE_TWO_MONTHS = new RegExp(
  String.raw`от\s+${D}\s+${MON}(?:\s+(\d{4})\s*г\.?)?\s+до\s+${D}\s+${MON}\s+${Y}`,
  "i",
);
/** „до 17:00 ч. на 25 септември 2026" */
const UNTIL_TIME = new RegExp(
  String.raw`до\s+(\d{1,2})[.:](\d{2})\s*ч\.?\s+на\s+${D}\s+${MON}\s+${Y}`,
  "i",
);
/** „до 30 октомври 2026 г. включително" — a whole final day. */
const UNTIL_DAY = new RegExp(String.raw`до\s+${D}\s+${MON}\s+${Y}`, "i");

/** One sentence → its labelled end, or null. Patterns in order of specificity, so a range is
 *  never read as its bare „до" half. */
const windowOf = (sentence: string): AzWindow | null => {
  const s = sentence.trim();
  if (!APPLY.test(s)) return null;
  const programme = /^По\s+„([^“"]+)[“"]/.exec(s)?.[1] ?? null;
  const at = (opensAt: string | null, closesAt: string): AzWindow => ({
    opensAt,
    closesAt,
    clause: s,
    programme,
  });

  let m = RANGE_ONE_MONTH.exec(s);
  if (m) {
    const a = wordDate(m[1], m[3], m[4]);
    const b = wordDate(m[2], m[3], m[4]);
    if (a && b) return at(iso(a, 0, 0), iso(b, 23, 59));
  }
  m = RANGE_TWO_MONTHS.exec(s);
  if (m) {
    // The start's own year when printed; otherwise the end's — or the year before it when the
    // range crosses New Year („от 28 декември до 9 януари 2027"). Reading 2027 for both ends
    // would open the window after it closed.
    const endYear = Number(m[6]);
    const b = wordDate(m[4], m[5], m[6]);
    const startMonth = MONTHS[m[2].toLowerCase()];
    const startYear = m[3]
      ? Number(m[3])
      : b && startMonth > b.mo
        ? endYear - 1
        : endYear;
    const a = wordDate(m[1], m[2], String(startYear));
    if (a && b) return at(iso(a, 0, 0), iso(b, 23, 59));
  }
  m = UNTIL_TIME.exec(s);
  if (m) {
    const b = wordDate(m[3], m[4], m[5]);
    if (b) return at(null, iso(b, Number(m[1]), Number(m[2])));
  }
  m = UNTIL_DAY.exec(s);
  if (m) {
    const b = wordDate(m[1], m[2], m[3]);
    if (b) return at(null, iso(b, 23, 59));
  }
  return null;
};

/** EVERY labelled end in clauses about applying — one item can carry several (employers by
 *  26 October, the young graduates themselves by 30 October) — plus how many labelled windows
 *  were refused because they open after they close (a misread or a source typo, never a row). */
export const scanAzWindows = (
  body: string,
): { windows: AzWindow[]; inverted: number } => {
  const windows: AzWindow[] = [];
  let inverted = 0;
  for (const s of body.split(SENTENCE)) {
    const w = windowOf(s);
    if (!w) continue;
    if (w.opensAt && w.opensAt > w.closesAt) {
      inverted++;
      continue;
    }
    if (!windows.some((o) => o.closesAt === w.closesAt)) windows.push(w);
  }
  return { windows, inverted };
};

/** The windows alone — empty when open-ended. */
export const parseAzWindows = (body: string): AzWindow[] =>
  scanAzWindows(body).windows;

/** The first labelled end, or null when open-ended. */
export const parseAzWindow = (body: string): AzWindow | null =>
  parseAzWindows(body)[0] ?? null;

export type AzOutcome =
  | { kind: "calls"; calls: OpenCall[] }
  | { kind: "rejected"; date: string; title: string; why: string };

/** „прием" / „приемът" / „приема" as a WHOLE word. A Unicode-aware boundary, because `\b` never
 *  matches after a Cyrillic letter — and the bare substring also hits „приемане", which is how
 *  monthly labour-market statistics read as intakes. */
const INTAKE_WORD = /(?<![\p{L}])прием(?:ът|а)?(?![\p{L}])/iu;

/** An item that announces an intake at all: the word in its title or opening, plus applying. */
export const isIntakeNews = (item: AzItem): boolean =>
  INTAKE_WORD.test(`${item.title} ${item.body.slice(0, 400)}`) &&
  APPLY.test(`${item.title} ${item.body}`);

/** The key is the item AND the window's closing day: stable across re-crawls, distinct for the
 *  several windows one item can state, and independent of the clause's wording. */
export const azCallKey = (itemId: string, closesAt: string): string =>
  `az:${itemId}:${closesAt.slice(0, 10)}`;

/** One news item → its rows with a labelled end, a counted rejection, or null (not an intake). */
export const parseAzOutcome = (item: AzItem): AzOutcome | null => {
  if (!isIntakeNews(item)) return null;
  const { windows, inverted } = scanAzWindows(item.body);
  if (!windows.length)
    return {
      kind: "rejected",
      date: item.date,
      title: item.title,
      why: inverted
        ? "a labelled window that opens after it closes — a misread or a source typo, check the item"
        : "open-ended intake or stop notice — no labelled end in a clause about applying",
    };
  // Each row's audience comes from ITS OWN clause, which names who applies („работодателите",
  // „областните и общинските администрации", „младежите"). The whole article is the wrong
  // haystack: „Агенцията по заетостта" and „дирекция „Бюро по труда"" — the announcer and the
  // office where you apply — both trip the shared `institution` rule on every row.
  const audienceOf = (clause: string) =>
    deriveAudience(
      null,
      clause.replace(
        /Агенци\S*\s+по\s+заетостта|(?<![\p{L}])АЗ(?![\p{L}])|дирекци\S*\s+„?Бюро по труда“?/giu,
        " ",
      ),
    );
  return {
    kind: "calls",
    calls: windows.map((w) => ({
      source: "az",
      sourceKey: azCallKey(item.id, w.closesAt),
      code: null,
      kind: "call",
      // A window with no „По „X"" lead keeps the item's headline rather than borrowing a
      // programme from a neighbouring sentence.
      title: w.programme ? `„${w.programme}“` : item.title,
      programmeCode: "az",
      programmeName: AZ_PROGRAMME,
      objective: w.clause.slice(0, 600),
      datePrecision: "exact",
      opensAt: w.opensAt,
      closesAt: w.closesAt,
      periodLabel: null,
      budgetEur: null,
      budgetNote: null,
      aidRatePct: null,
      grantMinEur: null,
      grantMaxEur: null,
      beneficiariesRaw: null,
      audience: audienceOf(w.clause),
      territory: null,
      sourceUrl: item.url,
      docs: [],
      enrichment: "none",
    })),
  };
};

/** The committed snapshot is an ARCHIVE, while the list page shows only the latest ten items:
 *  a dated window that scrolled off is still a fact, so the previous rows are kept and a
 *  re-crawled row replaces its own previous version by key. */
export const mergeAzCalls = (
  prev: readonly OpenCall[],
  next: readonly OpenCall[],
): OpenCall[] => {
  const byKey = new Map(prev.map((c) => [c.sourceKey, c]));
  for (const c of next) byKey.set(c.sourceKey, c);
  return [...byKey.values()];
};
