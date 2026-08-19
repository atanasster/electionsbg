// Parsers for the three МК ДКИ listing pages. ONE PARSER PER SHAPE, deliberately
// — the three pages were hand-built in different editors and the fields are
// positional in two of them, so a single tolerant parser is how a director's
// name ends up in an address column.
//
// Everything here is pure: HTML in, records out, no network. `ingest.ts` owns
// fetching and `resolve.ts` owns the (much riskier) name→EIK step.

import type { DkiPage, DkiShape } from "./sources";

export type DkiEntry = {
  /** Exactly as МК prints it, whitespace-collapsed. Never normalised — this is
   *  the evidence, and a folded copy for matching is built downstream. */
  name: string;
  kind: DkiPage["kind"];
  /** The ALL-CAPS section an entry sat under („ФИЛХАРМОНИИ И СИМФОНИЕТИ").
   *  Only the `divs` page has them; null elsewhere rather than invented. */
  category: string | null;
  director: string | null;
  city: string | null;
  /** How `city` was obtained: `postcode` = printed beside one (evidence);
   *  `name` = read off the institute's own title (an inference). */
  cityBasis: "postcode" | "name" | null;
  address: string | null;
  email: string | null;
  website: string | null;
  pageId: string;
};

const ENTITIES: [RegExp, string][] = [
  [/&#8211;|&ndash;/g, "–"],
  [/&#8212;|&mdash;/g, "—"],
  [/&#8222;/g, "„"],
  [/&#8220;/g, "“"],
  [/&#8221;/g, "”"],
  [/&#8216;|&#8217;/g, "’"],
  [/&nbsp;|&#160;/g, " "],
  [/&amp;/g, "&"],
  [/&quot;/g, '"'],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
];

const decode = (s: string): string =>
  ENTITIES.reduce((acc, [re, to]) => acc.replace(re, to), s)
    // fromCodePoint, not fromCharCode — the latter truncates above U+FFFF.
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // Hex entities fell through unchanged. МК's editor emits decimal today, but
    // „unhandled and silently passed through" is the shape that puts „&#x2013;"
    // into an institute's name.
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    );

const clean = (s: string): string =>
  decode(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

/** The Elementor widget that holds the page body. Everything outside it is site
 *  chrome — nav, „Бързи връзки", the footer — and the nav alone contributes ~380
 *  lines, which is what a whole-page text dump drowns in. */
export const contentBlock = (html: string): string => {
  const marker = 'data-widget_type="theme-post-content.default"';
  const i = html.indexOf(marker);
  if (i < 0) return "";
  // The widget's own container closes several divs later; the listings never
  // reach the next widget, so cut at the following widget boundary.
  const rest = html.slice(i);
  // Boundary = the NEXT widget's declaration. An earlier cut looked for the
  // class fragment `elementor-widget elementor-widget-`, which THIS widget's own
  // attributes also contain — so it truncated the music page to its first two
  // sections and published 9 of its institutes as if that were the register.
  const next = rest.indexOf('data-widget_type="', marker.length);
  return next > 0 ? rest.slice(0, next) : rest;
};

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// ⚠️ FOUR SPELLINGS ACROSS THREE PAGES, and each extra one was found only by
// reading the rows that came back null: „Директор – ИМЕ", „ИМЕ, директор",
// „ИМЕ – Директор" and „ИМЕ, и. д. директор" (изпълняващ длъжността). A regex
// fitted to the first entry of a page matches most rows and drops the rest in
// silence — and here it does WORSE than drop, because the name/detail split
// keys on the same predicate, so an unrecognised director line was absorbed
// into the institute's NAME („… – СМОЛЯН Мариан Бозуков").
const DIRECTOR_PREFIX_RE =
  /^(?:и\.?\s*д\.?\s*)?директор[ауъ]?\s*[:–—-]\s*(.+)$/iu; // `[ауъ]?` — МК writes „Директора – ИМЕ" on one school.
// A register is somebody else's typing: absorb the inflection rather than
// dropping the row and calling the institute directorless.
// ⚠️ NO `\b` AFTER A CYRILLIC WORD. JS word-boundaries are ASCII-only, so
// `директор\b` never matches at end-of-string — it silently found 1 director in
// 38 theatres. Anchor on what follows instead.
const DIRECTOR_SUFFIX_RE =
  /^(.+?)\s*[,–—-]\s*(?:и\.?\s*д\.?\s*)?директор(?:\s|$|[,.;])/iu;
const CONTACT_RE = /^(тел|факс|fax|e-?mail|е-?mail|ел\.?\s*поща|моб|http)/i;

/** „Директор – 939 40 11" is a PHONE line on the театър page, in the exact shape
 *  of the name line. A value with no letters is never a person. */
const looksLikePerson = (v: string): boolean =>
  /\p{L}/u.test(v) && (v.match(/\d/g)?.length ?? 0) < 4;

/** Street markers. Used to tell an address line from a phone line, since on the
 *  театър page the street and the postcode are often on DIFFERENT lines. */
const STREET_RE = /(?:^|\s)(ул|бул|пл|кв|ж\.?\s?к|бл)\.?\s*[„“"”]?\S/i;

/** The settlement, recovered from wherever the page happens to put it.
 *
 *  ⚠️ SCAN EVERY LINE, INCLUDING THE NAME. The театър page has THREE layouts in
 *  one document — „ГРАД 5300" on its own line, „… – ЛОВЕЧ 5500" appended to the
 *  institute's name, and „София 1000, ул. …" as a normal address — and reading
 *  only a designated address line found a city for 13 of 38 theatres. The other
 *  25 published with no seat at all, which on a place surface is indistinguishable
 *  from a body that does not exist.
 *
 *  Contact lines are excluded first, because a phone number contains 4-digit
 *  runs („тел.: 02/ 8119 219") that are shaped exactly like a postcode. */
export type CityHit = { city: string; basis: "postcode" | "name" };

export const cityFromLines = (lines: readonly string[]): CityHit | null => {
  for (const line of lines) {
    if (CONTACT_RE.test(line)) continue;
    const m =
      // „ГРАД 5300" / „ЛОВЕЧ 5500," / „София -1504"
      line.match(
        /(\p{Lu}[\p{L}]+(?:\s+\p{Lu}[\p{L}]+)?)\s*[–—-]?\s*(\d{4})(?!\d)/u,
      ) ??
      // „7000 Русе, пл. …"
      line.match(/(?<!\d)(\d{4})\s+(\p{Lu}[\p{L}]+(?:\s+\p{Lu}[\p{L}]+)?)/u);
    if (!m) continue;
    const city = (/^\d{4}$/.test(m[1]) ? m[2] : m[1])
      .replace(/\s+/g, " ")
      .trim();
    if (city && city.length <= 30) return { city, basis: "postcode" };
  }
  // Last resort: the town appended to the institute's own name („КУКЛЕН ТЕАТЪР –
  // БУРГАС"), reached only when the address line carries a BARE postcode
  // („8000; ул. …"). Nine of 38 theatres have a seat by no other route.
  //
  // It is an INFERENCE, not evidence, so it is LABELLED. A consumer that puts a
  // body on a map has to be able to tell the two apart, rather than finding out
  // later that some seats were read off a title.
  const tail = lines[0]?.match(
    /[–—-]\s*([\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)?)\s*$/u,
  );
  if (tail) return { city: tail[1].trim(), basis: "name" };
  return null;
};

/** A trailing „– ГРАД 5500" is a postal tail, not part of the institute's name;
 *  the postcode never is. The CITY is left on, because „Драматичен театър –
 *  Ловеч" IS the body's name and stripping it collides three theatres into one. */
const stripPostalTail = (name: string): string =>
  name
    .replace(/[,;]?\s*(?<!\d)\d{4}(?!\d).*$/u, "")
    .replace(/[\s,;–—-]+$/u, "")
    .trim();

/** „Огнян Драганов Билетна каса: 0887 444 360" — МК runs a box-office number
 *  into the director's line on one entry. Cut at the first contact word or the
 *  first digit run, whichever comes first. */
const cleanDirector = (v: string): string | null => {
  const cut = v
    .replace(
      // No `\b` after a Cyrillic word (see DIRECTOR_SUFFIX_RE) — with one,
      // „Огнян Драганов Билетна каса: 0887 …" kept „Билетна каса" as a surname.
      /\s*(билетна каса|тел|факс|моб|e-?mail|е-?mail|ел\.?\s*поща)(?:\s|:|$|[.,;])[\s\S]*$/iu,
      "",
    )
    .replace(/\s*\d[\d\s/-]{4,}.*$/u, "")
    .replace(/[\s,;:–—-]+$/u, "")
    .trim();
  return cut && looksLikePerson(cut) ? cut : null;
};

/** Lines before the first DETAIL line are all part of the name. МК wraps one
 *  institute over two lines („МУЗИКАЛНО-ДРАМАТИЧЕН ТЕАТЪР" / „«КОНСТАНТИН
 *  КИСИМОВ» – ВЕЛИКО ТЪРНОВО"); taking line 0 alone published it as an unnamed
 *  „Музикално-драматичен театър" that matches nothing. */
const isDetail = (l: string): boolean =>
  CONTACT_RE.test(l) ||
  DIRECTOR_PREFIX_RE.test(l) ||
  DIRECTOR_SUFFIX_RE.test(l) ||
  STREET_RE.test(l) ||
  /(?<!\d)\d{4}(?!\d)/u.test(l);

const splitNameAndRest = (
  lines: readonly string[],
): { name: string; rest: readonly string[] } => {
  let i = 1;
  while (i < lines.length && !isDetail(lines[i])) i++;
  return { name: lines.slice(0, i).join(" "), rest: lines.slice(i) };
};

/** Shared field extraction — both positional pages, one rule set. */
const fieldsFrom = (
  lines: readonly string[],
): Pick<
  DkiEntry,
  "name" | "director" | "city" | "cityBasis" | "address" | "email"
> => {
  const numbered = lines[0].replace(/^\s*\d{1,3}\s*[.)]\s*/, "").trim();
  const { name, rest } = splitNameAndRest([numbered, ...lines.slice(1)]);
  const director =
    rest
      .map((l) =>
        cleanDirector(
          l.match(DIRECTOR_SUFFIX_RE)?.[1] ??
            l.match(DIRECTOR_PREFIX_RE)?.[1] ??
            "",
        ),
      )
      .find(Boolean) ?? null;
  const address =
    rest.find((l) => STREET_RE.test(l) && !CONTACT_RE.test(l)) ?? null;
  return {
    name: stripPostalTail(name),
    director,
    ...(() => {
      const hit = cityFromLines([numbered, ...lines.slice(1)]);
      return { city: hit?.city ?? null, cityBasis: hit?.basis ?? null };
    })(),
    address,
    email: lines.join(" ").match(EMAIL_RE)?.[0] ?? null,
  };
};

// ---------------------------------------------------------------- divs -------

/** Музика и танц: `<div>` per LINE, entries separated by `<p>&nbsp;</p>`, and
 *  ALL-CAPS category headers that look exactly like institute names. The
 *  discriminator is not the casing — it is that a category block is a LONE line
 *  with no address, director or contact under it. */
const parseDivs = (block: string, page: DkiPage): DkiEntry[] => {
  const chunks = block
    .split(/<p>(?:\s|&nbsp;|&#160;)*<\/p>/i)
    .map((c) =>
      [...c.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)]
        .map((m) => clean(m[1]))
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0);

  const out: DkiEntry[] = [];
  let category: string | null = null;
  for (const lines of chunks) {
    // A category header is a LONE line with nothing under it. The casing cannot
    // discriminate — „ФИЛХАРМОНИИ И СИМФОНИЕТИ" and „ПЛЕВЕНСКА ФИЛХАРМОНИЯ" are
    // both all-caps — so the rule is the absence of any detail line beneath.
    if (!lines.slice(1).some(isDetail)) {
      if (lines.length === 1) category = lines[0];
      continue;
    }
    out.push({
      ...fieldsFrom(lines),
      kind: page.kind,
      category,
      website: null,
      pageId: page.id,
    });
  }
  return out;
};

// ----------------------------------------------------------- paragraphs ------

/** Театър: one `<p>` per institute, `<br>`-separated lines, director as
 *  „ИМЕ, директор" rather than the other page's „Директор – ИМЕ". */
const parseParagraphs = (block: string, page: DkiPage): DkiEntry[] => {
  const out: DkiEntry[] = [];
  for (const m of block.matchAll(/<p>([\s\S]*?)<\/p>/gi)) {
    const lines = m[1]
      .split(/<br\s*\/?>/i)
      .map(clean)
      .filter(Boolean);
    if (lines.length < 2) continue;
    // A paragraph with no detail line at all is prose, not an entry.
    if (!lines.slice(1).some(isDetail)) continue;
    const website =
      lines
        .find((l) => /^(https?:\/\/|www\.)/i.test(l))
        ?.replace(/^https?:\/\//i, "")
        .trim() ?? null;
    out.push({
      ...fieldsFrom(lines),
      kind: page.kind,
      category: null,
      website,
      pageId: page.id,
    });
  }
  return out;
};

const PARSERS: Record<DkiShape, (b: string, p: DkiPage) => DkiEntry[]> = {
  divs: parseDivs,
  paragraphs: parseParagraphs,
};

export const parseDkiPage = (html: string, page: DkiPage): DkiEntry[] => {
  const block = contentBlock(html);
  if (!block)
    throw new Error(
      `${page.id}: no theme-post-content widget on the page — МК changed the ` +
        `template. Parsing the whole document instead would pick the nav up as ` +
        `institutes, so this refuses rather than degrades.`,
    );
  return PARSERS[page.shape](block, page);
};
