// Shared HTML text extraction for the scrapers.
//
// Extracted once several ingests had each grown their own copy of the same two
// primitives: decode the entities a Bulgarian government CMS emits, and reduce a
// fragment of markup to its visible text.
//
// MIGRATED CALLERS (this module serves exactly these):
//   * scripts/budget/__write_judiciary.ts   — flatLines
//   * scripts/budget/__write_izdrazhka.ts   — flatLines
//   * scripts/judiciary/sources.ts          — stripHtml (re-exported to the
//     declarations writer and the ИВСС watcher)
// NOT migrated: scripts/local_taxes/* and scripts/budget/capital_programs/*
// still carry private decoders. They are untouched, not overlooked.
//
// `asNum` is deliberately NOT here. The two budget parsers' copies have
// DIFFERENT integer rules — izdrazhka requires >= 3 digits so its dense row
// codes don't parse as values; __write_judiciary accepts any length so a `Резерв`
// of 900 does. Hoisting one over the other silently breaks the loser.
//
// The two call sites need DIFFERENT treatment of an entity nobody decoded, and
// the split below is load-bearing:
//
//   * `decodeEntities` leaves an unknown named entity (`&ndash;`) LITERAL. The
//     ЗДБРБ parser reads its tables positionally — `valAfter` counts lines after
//     a label — and a законов line that is nothing but `&ndash;` must stay a
//     line. Blanking it drops it from `flatLines`, every later index shifts, and
//     the parser silently reads a neighbouring row's figure. (Measured: doing so
//     moves 705 lines across the eight cached laws.)
//
//   * `stripHtml` blanks it, because its output is a person's name or a table
//     cell headed for a committed artifact, where a stray `&ndash;` token would
//     be worse than a space. Its output is also hashed by the ИВСС watcher, so
//     the semantics here are pinned by more than taste.
//
// Both are deliberately regex-based rather than a DOM parse: the inputs are
// single cells and <tr> rows lifted out of already-fetched pages, and a new
// dependency would have to be pinned to keep those watcher hashes stable.

/** The named entities these sources actually emit. Anything outside this set is
 *  left alone by `decodeEntities` — see the note above. */
const NAMED = "bdquo|ldquo|rdquo|laquo|raquo|quot";

/** `&#1042;` / `&#x412;` / `&nbsp;` → their characters; `&amp;` last, so an
 *  escaped entity (`&amp;nbsp;`) survives as the literal text `&nbsp;` rather
 *  than collapsing to a space. Unknown named entities pass through untouched. */
export const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(new RegExp(`&(?:${NAMED});`, "gi"), '"')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");

/** Drop script/style outright, then every remaining tag, leaving a space so
 *  `<td>Иванов</td><td>съдия</td>` does not weld into one word. */
export const stripTags = (s: string): string =>
  s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ");

/** Markup fragment → its visible text, whitespace collapsed. Any named entity
 *  left over after decoding becomes a space rather than a literal token. */
export const stripHtml = (s: string): string =>
  decodeEntities(stripTags(s))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Markup → one entry per text node, whitespace collapsed, blanks dropped.
 *  The ЗДБРБ tables are read positionally off this list, so it must NOT blank
 *  unknown entities: see the note at the top of this file. */
export const flatLines = (html: string): string[] =>
  decodeEntities(html.replace(/<[^>]+>/g, "\n"))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
