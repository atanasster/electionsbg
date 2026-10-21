// Stage 8 — Interreg calls. The third open-calls source, and the one that falls on a specific
// population rather than diffusely.
//
// WHY THIS ARM EXISTS. Interreg runs on Jems, not ИСУН, so an Interreg call can never appear in
// `/Active` (plan §2.3b). That is a system boundary, not a filter — and it lands on the border
// municipalities §2.3a measured, where 29 of 29 money-gaining municipalities sit. Without this,
// `/funds/calls` answers „nothing" to exactly the askers with the least alternative.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE DEADLINE IS READ FROM ITS LABEL, NEVER FROM „the latest date on the page". That rule is
// the whole parser, and it is not defensive padding — it is what the corpus forced.
//
// Measured on Interreg VI-A Greece-Bulgaria's 6th call (2026-08-09):
//     latest date on the page   31.12.2029   ← the programme period, in a legal-framework
//                                              paragraph about state aid
//     labelled deadline         22/06/2026   ← „…until, exclusively, 22/06/2026 (deadline for
//                                              submission of proposals…"
// A max-date heuristic would have published that call as open for another three years. On this
// dataset a wrong date does not make a number look odd — it makes a reader miss a deadline, or
// prepare an application for a call that shut seven weeks ago.
//
// So: a call with no LABELLED deadline gets `date_precision='indicative'` and a period label,
// never an invented `closesAt`. 142's CHECK enforces the pairing; this is where it is honoured.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// ONE PARSER PER PROGRAMME SHAPE, because there is no shared platform: each programme runs its
// own CMS with its own phrasing and its own date format (`22/06/2026` vs `28 June, 2024`). The
// one exception proves the rule — the three МРРБ-hosted IPA programmes share a Drupal layout and
// therefore share the `mrrb` kind.
// A single „smart" extractor over both is how a change on one site starts silently mis-parsing
// the other.

import { deriveAudience } from "./audience";
import { sofiaWallClockToUtc } from "./isun_parse";
import type { CallDoc, OpenCall } from "./types";

export type ProgrammeKind = "gbg" | "bsb" | "mrrb" | "robg";

export interface Programme {
  /** `sourceKey` prefix and the stable id in `programme_code`. */
  code: string;
  name: string;
  kind: ProgrammeKind;
  indexUrl: string;
  /** Further index pages read alongside `indexUrl` and unioned with it (RO-BG keeps its closed
   *  and its open calls on different pages). */
  extraIndexUrls?: readonly string[];
  /** Only links under this prefix are calls; everything else on the index is navigation. */
  callPrefix: string;
  /** When set, a link is a call iff its URL matches — for a programme whose call slugs do not
   *  share a prefix (RO-BG: `/en/call-5-…` closed, `/en/open-calls-for-proposals-call-6` open). */
  callPattern?: RegExp;
}

/**
 * The programmes this arm covers — all six cross-border programmes Bulgaria takes part in.
 *
 * ⚠️ UNTIL 2026-10-21 THIS LISTED TWO, and the reason it gave was a measurement against the
 * WRONG HOSTS. `ipacbc-bgrs.eu`, `ipa-cbc-007.eu` and `ipacbc-bgtr.eu` did reset the connection
 * on 2026-08-09 — but they are the 2014–2020 sites. The 2021–2027 programmes live at
 * `ipa-bgrs.mrrb.bg`, `ipa-bgmk.mrrb.bg` and `ipa-bgtr.mrrb.bg` (one shared МРРБ Drupal
 * layout, hence one `mrrb` kind), and Romania–Bulgaria at `interregviarobg.eu`, which DOES
 * publish a calls index (`interregrobg.eu` is the 2014–2020 site). Found by the
 * 2026-10-21 deferred-followups audit, row 12 of
 * docs/audits/deferred-followups-verification-2026-10.md.
 *
 * Those four sites send an incomplete TLS chain, which is what a Node client sees as
 * „unreachable"; `interreg_tls.ts` supplies the missing intermediates with verification on.
 * An unreachable programme is still a FAILURE the crawler counts and the watcher excludes from
 * its fingerprint — never „0 calls".
 */
export const PROGRAMMES: readonly Programme[] = [
  {
    code: "interreg-gr-bg",
    name: "Interreg VI-A Greece-Bulgaria",
    kind: "gbg",
    indexUrl: "https://www.greece-bulgaria.eu/calls/",
    callPrefix: "https://www.greece-bulgaria.eu/call/",
  },
  {
    code: "interreg-bsb",
    name: "Interreg NEXT Black Sea Basin",
    kind: "bsb",
    indexUrl:
      "https://blacksea-cbc.net/interreg-next-bsb-2021-2027/calls-for-proposals",
    callPrefix:
      "https://blacksea-cbc.net/interreg-next-bsb-2021-2027/calls-for-proposals/",
  },
  // ── the МРРБ-hosted IPA programmes: the home page's „Calls for proposals" dropdown lists one
  //    taxonomy term per call; the deadline lives in one of that term's news nodes. ──
  {
    code: "interreg-bg-rs",
    name: "Interreg VI-A IPA Bulgaria-Serbia",
    kind: "mrrb",
    indexUrl: "https://ipa-bgrs.mrrb.bg/",
    callPrefix: "https://ipa-bgrs.mrrb.bg/",
  },
  {
    code: "interreg-bg-mk",
    name: "Interreg VI-A IPA Bulgaria-North Macedonia",
    kind: "mrrb",
    indexUrl: "https://ipa-bgmk.mrrb.bg/",
    callPrefix: "https://ipa-bgmk.mrrb.bg/",
  },
  {
    code: "interreg-bg-tr",
    name: "Interreg VI-A IPA Bulgaria-Türkiye",
    kind: "mrrb",
    indexUrl: "https://ipa-bgtr.mrrb.bg/",
    callPrefix: "https://ipa-bgtr.mrrb.bg/",
  },
  {
    code: "interreg-ro-bg",
    name: "Interreg VI-A Romania-Bulgaria",
    kind: "robg",
    // The CLOSED list carries every past call; the main calls page is where an open one
    // appears. Both are read so a call is found on either side of its deadline.
    indexUrl: "https://interregviarobg.eu/en/calls-for-proposals-1",
    extraIndexUrls: ["https://interregviarobg.eu/en/calls-for-proposals"],
    callPrefix: "https://interregviarobg.eu/en/",
    callPattern:
      /^https:\/\/interregviarobg\.eu\/en\/(?:open-calls-for-proposals-)?call-\d+[^/]*$/,
  },
];

/** Every index page of a programme, `indexUrl` first. */
export const indexUrlsOf = (p: Programme): string[] => [
  p.indexUrl,
  ...(p.extraIndexUrls ?? []),
];

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Strip tags and collapse whitespace — the parsers work on visible text, not on markup, so a
 *  theme change that moves a `<span>` cannot break a date. */
export const visibleText = (html: string): string => {
  const noScript = html.replace(
    /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,
    " ",
  );
  const noTags = noScript.replace(/<[^>]+>/g, " ");
  return (
    noTags
      .replace(/&nbsp;|&#160;/g, " ")
      // NUMERIC entities as well as named ones: WordPress emits `&#038;` for an ampersand in a
      // <title>, so a named-only decoder leaves „PRIORITY 1 &#038; RSO2.6" in a call's name.
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, d) =>
        String.fromCodePoint(parseInt(d, 16)),
      )
      .replace(/&amp;/g, "&")
      .replace(/&rsquo;|&lsquo;/g, "'")
      .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
      .replace(/&ndash;|&mdash;/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
};

/**
 * A calendar date plus a wall-clock time → the UTC INSTANT it denotes.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * THE TIME OF DAY IS NOT DECORATION. Both programmes print one — „14.00 Eastern European Time"
 * on Greece-Bulgaria, „(14:00 hrs, Romania time)" on Black Sea Basin — and storing a bare date
 * resolves to MIDNIGHT, which marks a call closed for the whole of its final day and NULLs
 * `days_left` a day early. On this dataset that is precisely the harm the feature exists to
 * prevent.
 *
 * Both zones are EET/EEST, the same as Sofia, so `sofiaWallClockToUtc` is correct for both and
 * is DST-aware — a fixed +02:00 would be an hour wrong for every summer deadline, which is most
 * of them. Reused from `isun_parse` rather than re-derived; one timezone bug in this repo is
 * enough.
 *
 * DEFAULT WHEN NO TIME IS PRINTED: 23:59 local. A call is open through the whole of its stated
 * last day unless the page says otherwise, and the alternative (midnight) is the failure above.
 * ═════════════════════════════════════════════════════════════════════════════════════════
 */
const toInstant = (
  y: number,
  mo: number,
  d: number,
  hm: { h: number; mi: number } | null,
): string | null => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const { h, mi } = hm ?? { h: 23, mi: 59 };
  const dt = sofiaWallClockToUtc(y, mo, d, h, mi);
  // Range-check by round-trip: Date.UTC rolls 31/02 over to 3 March silently, which is a
  // deadline that is WRONG rather than absent — the worse of the two, because nothing
  // downstream can tell.
  const back = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
  const want = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return back === want ? dt.toISOString() : null;
};

/** The time printed beside a deadline, if any. Both `14.00` and `14:00` occur. */
export const parseClockTime = (
  context: string,
): { h: number; mi: number } | null => {
  const m =
    /\b([01]?\d|2[0-3])[.:]([0-5]\d)\b\s*(?:hrs|h\b|ч|Eastern|Romania|EET|EEST|\()/i.exec(
      context,
    );
  return m ? { h: Number(m[1]), mi: Number(m[2]) } : null;
};

/** `22/06/2026` (+ optional time) → an ISO instant. Day-first: both programmes are European. */
export const parseSlashDate = (
  s: string,
  hm: { h: number; mi: number } | null = null,
): string | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? toInstant(Number(m[3]), Number(m[2]), Number(m[1]), hm) : null;
};

/** `28 June, 2024` / `30 March 2023` (+ optional time) → an ISO instant. */
export const parseWordDate = (
  s: string,
  hm: { h: number; mi: number } | null = null,
): string | null => {
  const m = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  return mon ? toInstant(Number(m[3]), mon, Number(m[1]), hm) : null;
};

/**
 * A euro amount in the European format both sites use: `3.000.000,00€`.
 *
 * Written out rather than reusing the enrichment gate's `numbersIn`, which deliberately returns
 * EVERY plausible reading of an ambiguous separator. That generosity is right when checking a
 * model's quote and wrong here: this is a labelled, structured field, so exactly one reading is
 * correct and a second candidate would be a silent 1000× error.
 */
export const parseEuroAmount = (s: string): number | null => {
  const m = /([\d.,]+)\s*(?:€|EUR)/i.exec(s);
  if (!m) return null;
  const raw = m[1].replace(/\.(?=\d{3}\b)/g, ""); // dots are thousands separators
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Call URLs from a programme's index page, deduped and in document order. */
export const parseIndex = (html: string, p: Programme): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    // A trailing encoded space is a typo on the source page (RO-BG Call 7). Kept, it becomes part
    // of the sourceKey, and the day the site fixes the link the call gets a SECOND row — which
    // `open_calls` never deletes.
    let href = m[1].replace(/(?:%20|\s)+$/i, "");
    if (href.startsWith("/")) href = new URL(href, p.indexUrl).toString();
    if (!href.startsWith(p.callPrefix)) continue;
    if (p.callPattern && !p.callPattern.test(href.split("#")[0])) continue;
    // The prefix itself is the index; a bare anchor is navigation.
    if (href.replace(/\/$/, "") === p.callPrefix.replace(/\/$/, "")) continue;
    const clean = href.split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
};

/** The slug that identifies a call within its programme — stable across a title edit. */
export const callSlug = (url: string): string =>
  url.replace(/\/$/, "").split("/").pop() ?? url;

interface Window {
  opensAt: string | null;
  closesAt: string | null;
}

/**
 * The submission window, read from its LABEL. Returns nulls rather than a guess.
 *
 * Each pattern is anchored on the phrase the programme actually prints — see the header for the
 * 2029-vs-2026 measurement that makes this non-negotiable.
 */
export const parseWindow = (text: string, kind: ProgrammeKind): Window => {
  if (kind === "robg" || kind === "mrrb")
    return {
      opensAt: parseLaunchingDate(text),
      closesAt: latestLabelledDeadline(text),
    };
  if (kind === "gbg") {
    // „…from 15/05/2026 (start date for submission of proposals), time 12.00 … until,
    //   exclusively, 22/06/2026 (deadline for submission of proposals…"
    const close =
      /(\d{1,2}\/\d{1,2}\/\d{4})\s*\((?:the\s+)?deadline for submission/i.exec(
        text,
      ) ??
      /deadline for submission[^.]{0,80}?(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
    const open =
      /(\d{1,2}\/\d{1,2}\/\d{4})\s*\((?:the\s+)?start date for submission/i.exec(
        text,
      ) ??
      /start date for submission[^.]{0,80}?(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(
        text,
      );
    // The time sits AFTER the date in both phrasings, so the clock is looked for in the 160
    // characters FOLLOWING the match rather than anywhere on the page — these pages carry other
    // times (office hours, meeting times) that a page-wide search would happily pick up.
    const closeHm = close
      ? parseClockTime(text.slice(close.index, close.index + 160))
      : null;
    const openHm = open
      ? parseClockTime(text.slice(open.index, open.index + 160))
      : null;
    return {
      opensAt: open ? parseSlashDate(open[1], openHm) : null,
      closesAt: close ? parseSlashDate(close[1], closeHm) : null,
    };
  }
  // bsb: „Start date of the calls : 29 March, 2024   Deadline for submission of Applications :
  //       28 June, 2024 (14:00 hrs, Romania time)"
  const close =
    /deadline for submission[^:]{0,40}:\s*(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})/i.exec(
      text,
    );
  const open =
    /start date of the calls?[^:]{0,20}:\s*(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})/i.exec(
      text,
    );
  // The time sits AFTER the date in both phrasings, so the clock is looked for in the 160
  // characters FOLLOWING the match rather than anywhere on the page — these pages carry other
  // times (office hours, meeting times) that a page-wide search would happily pick up.
  const closeHm = close
    ? parseClockTime(text.slice(close.index, close.index + 160))
    : null;
  const openHm = open
    ? parseClockTime(text.slice(open.index, open.index + 160))
    : null;
  return {
    opensAt: open ? parseWordDate(open[1], openHm) : null,
    closesAt: close ? parseWordDate(close[1], closeHm) : null,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE PROSE-DEADLINE PROGRAMMES (`mrrb`, `robg`). These print the deadline in a sentence, not a
// field, in ~ten date spellings and half a dozen clock spellings — measured over every call
// page and every news node under a call, 2026-10-21. The labelled-only rule still governs, and
// two consequences of it are worth stating because the obvious implementation gets both wrong:
//
// 1. THE LABEL IS AN ALLOW-LIST OF WHAT IS BEING SUBMITTED. The same pages print „Deadline for
//    Submission of Questions: … by May 21, 2025", „Deadline for registration: April 14, 2025"
//    and „Comments … are welcome until 27 October 2025" — all labelled, all deadlines, none of
//    them the call's. A generic /deadline/ match publishes the questions deadline, three weeks
//    early, as the day a call shuts.
// 2. THE LATEST LABELLED DEADLINE WINS — not the latest date on the page. Extensions are
//    printed BESIDE the original („…is: 30th of June 2026 … The new deadline … is: 15 th of
//    July 2026"; „…has been extended until 22 nd of December 2025"), and reminder nodes repeat
//    the date. Taking the first would publish a call as closed for the whole extension. RO-BG
//    Call 1 lists three operations with three deadlines; the latest is the call's own close.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const ORDINAL = String.raw`(?:\s*(?:st|nd|rd|th|-th))?`;
/** The date spellings measured on these sites. Month names are checked against `MONTHS`, so
 *  „8 529 412 Euro" cannot read as a date. */
const DATE_RES: readonly RegExp[] = [
  // 15 September 2023 · 15th of August 2023 · 31 th of July 2023 · 3th of January 2024
  new RegExp(
    String.raw`^(\d{1,2})${ORDINAL}\s+(?:of\s+)?([A-Za-z]+),?\s+(\d{4})`,
  ),
  // June 6, 2025 · March 20, 2024 · March, 20-th, 2024
  new RegExp(String.raw`^([A-Za-z]+),?\s+(\d{1,2})${ORDINAL},?\s+(\d{4})`),
  // 02.09.2024 · 15/09/2025 — day first
  /^(\d{1,2})[./](\d{1,2})[./](\d{4})/,
];

/** A date at the START of `s` → its calendar parts, or null. */
export const parseProseDate = (
  s: string,
): { y: number; mo: number; d: number; length: number } | null => {
  const t = s.trimStart();
  const lead = s.length - t.length;
  for (const [i, re] of DATE_RES.entries()) {
    const m = re.exec(t);
    if (!m) continue;
    if (i === 0) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) return { y: +m[3], mo, d: +m[1], length: lead + m[0].length };
    } else if (i === 1) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return { y: +m[3], mo, d: +m[2], length: lead + m[0].length };
    } else {
      return { y: +m[3], mo: +m[2], d: +m[1], length: lead + m[0].length };
    }
  }
  return null;
};

/**
 * The clock printed right after a deadline date, or null. Spellings measured: „17:00 EEST",
 * „17.00 h.", „23:59 h.", „5:00 p.m.", „5 p.m.", „12.00 (PM)", „13.00 (PM)", „13:00 o'clock",
 * „at 17:00 (EET)", „24:00 h.".
 *
 * Only the first ~30 characters after the date are read, and a sentence break ends the window,
 * so an office-hours time later in the paragraph cannot attach itself to the deadline.
 * „24:00" is end-of-day and becomes 23:59 — `toInstant` would otherwise roll it into the next
 * morning. A PM marker only moves an hour below 12 („13.00 (PM)" is already 13:00).
 */
export const parseDeadlineClock = (
  after: string,
): { h: number; mi: number } | null => {
  const win = after.slice(0, 30).split(/\.\s+[A-ZА-Я]/)[0];
  const m =
    // `(?![./]\d)`: „20.10.2024" after a deadline is a DATE, not 20:10.
    /\b(\d{1,2})[.:](\d{2})\b(?![./]\d)\s*(?:\(?\s*([ap])\.?\s*m\b\.?\)?)?/i.exec(
      win,
    ) ?? /\b(\d{1,2})\s*()([ap])\.\s*m\./i.exec(win);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  if (h === 24 && mi === 0) return { h: 23, mi: 59 };
  if (m[3]?.toLowerCase() === "p" && h < 12) h += 12;
  if (h > 23 || mi > 59) return null;
  return { h, mi };
};

/** What is being submitted — the allow-list (header, point 1). */
const SUBMITTED = String.raw`(?:the\s+)?(?:full\s+)?(?:(?:strategic|governance)\s+)?(?:project\s+proposals?|concept\s+notes|applications|osi|fpp)`;
const DEADLINE_LABEL = new RegExp(
  [
    // „deadline for submission of project proposals", „…for submitting full project proposals",
    // — but NOT a HEADLINE announcing a change: „…and extension of the deadline for project
    //   submission 08.02.2024 Dear applicants" is followed by the node's PUBLISH date (bg-tr).
    // „…for uploading applications", „…for submitting of the OSI", „deadlines for submitting the applications"
    String.raw`(?<!extension\s+of\s+(?:the\s+)?)deadlines?\s+for\s+(?:the\s+)?(?:submission|submitting|uploading)\s+(?:of\s+)?${SUBMITTED}`,
    // „Deadline for project submission"
    String.raw`(?<!extension\s+of\s+(?:the\s+)?)deadline\s+for\s+project\s+submission`,
    // „Application deadline:", „Submission Deadline:", a bare „Deadline:"
    String.raw`(?:application\s+|submission\s+)?deadline\s*:`,
    // RO-BG Call 1's per-operation list: „Rail connectivity - deadline 3th of January 2024"
    String.raw`-\s*deadline(?=\s+\d)`,
  ].join("|"),
  "gi",
);
/** How far past a label its date may sit: „in Jems is", „has been extended until", „of the
 *  Programme is set for", „under Call 2 is". A sentence break ends the window — a date in the
 *  NEXT sentence is not this label's. */
const LABEL_WINDOW = 110;

/**
 * The first DATE within the label's window — scanning every candidate start, not stopping at the
 * first digit. „…proposals under Call 2 is 15 September 2023" carries a digit that is not a date
 * before the one that is; stopping there lost the deadline (and let an older node's date win).
 */
const dateAfterLabel = (
  rest: string,
): { d: NonNullable<ReturnType<typeof parseProseDate>>; at: string } | null => {
  const win = rest.slice(0, LABEL_WINDOW);
  const stop = /\.\s+[A-ZА-Я]/.exec(win)?.index ?? win.length;
  for (const m of win
    .slice(0, stop)
    .matchAll(
      /\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi,
    )) {
    const at = rest.slice(m.index);
    const d = parseProseDate(at);
    if (d) return { d, at };
  }
  return null;
};

/** The bare „Deadline:" alternative — the one form that carries no „what is submitted". */
const BARE_LABEL = /^deadline\s*:/i;

/**
 * Whether a bare „deadline:" is qualified by a word naming SOMETHING ELSE: „Registration
 * deadline:", „Questions deadline:", „Payment deadline:". The allow-list is the point (header,
 * point 1), so the bare form is accepted only when no plain word precedes it — a URL, a colon or
 * the start of a paragraph is fine. „Application"/„Submission" never reach here: their own
 * alternatives match first and include the qualifier.
 */
const qualifiedByOther = (text: string, at: number): boolean =>
  /(?:^|\s)[A-Za-zА-Яа-я]+\s+$/.test(text.slice(Math.max(0, at - 40), at));

export interface LabelledDeadline {
  iso: string;
  /** Whether a clock was printed beside the date (otherwise the instant is 23:59 local). */
  timed: boolean;
}

/** Every labelled application deadline in `text`, in document order. */
export const labelledDeadlines = (text: string): LabelledDeadline[] => {
  const out: LabelledDeadline[] = [];
  for (const m of text.matchAll(DEADLINE_LABEL)) {
    if (BARE_LABEL.test(m[0]) && qualifiedByOther(text, m.index)) continue;
    const found = dateAfterLabel(text.slice(m.index + m[0].length));
    if (!found) continue;
    const { d, at } = found;
    const hm = parseDeadlineClock(at.slice(d.length));
    const iso = toInstant(d.y, d.mo, d.d, hm);
    if (iso) out.push({ iso, timed: hm !== null });
  }
  return out;
};

const sofiaDay = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/**
 * The call's close: the LATEST labelled deadline (header, point 2), or null.
 *
 * Within ONE calendar day, a printed time beats none. A reminder that restates „30 July 2024"
 * without a clock defaults to 23:59 and would otherwise outrank the announcement's „17:00" —
 * publishing the call as open for seven hours after it shut (bg-mk, Territorial Strategy).
 */
export const latestLabelledDeadline = (text: string): string | null => {
  const all = labelledDeadlines(text);
  if (!all.length) return null;
  const timedDays = new Set(
    all.filter((d) => d.timed).map((d) => sofiaDay(d.iso)),
  );
  const kept = all.filter((d) => d.timed || !timedDays.has(sofiaDay(d.iso)));
  return kept.map((d) => d.iso).reduce((a, b) => (b > a ? b : a));
};

/** RO-BG's „Launching date: 10th of May 2023" / „Launching date - 23rd of June 2025". */
export const parseLaunchingDate = (text: string): string | null => {
  const m = /launching\s+date\s*[:\-–]\s*/i.exec(text);
  if (!m) return null;
  const d = parseProseDate(text.slice(m.index + m[0].length));
  return d ? toInstant(d.y, d.mo, d.d, { h: 0, mi: 0 }) : null;
};

/** The visible text of one region of a page — the article, not the nav or the news sidebar,
 *  which on RO-BG carries its own dated headlines. Falls back to the whole page. */
export const regionText = (html: string, kind: ProgrammeKind): string => {
  if (kind === "robg") {
    const i = html.indexOf("article_item-content");
    if (i >= 0) {
      // Start AFTER the opening tag's `>` — slicing at the class name would leave the rest of
      // the attribute list as leading „text" — and stop at the article's end, before the
      // news sidebar.
      const start = html.indexOf(">", i) + 1;
      const end = html.indexOf("</article>", start);
      return visibleText(html.slice(start, end < 0 ? undefined : end));
    }
  }
  if (kind === "mrrb") {
    const m = /<main[\s\S]*?<\/main>/i.exec(html);
    if (m) return visibleText(m[0]);
  }
  return visibleText(html);
};

/**
 * An МРРБ programme's calls: the entries of its home page's „Calls for proposals" dropdown,
 * one taxonomy term per call. „Timetables of planned calls" sits in the same menu and is a
 * schedule, not a call.
 */
export const parseMrrbCallTerms = (
  homeHtml: string,
  p: Programme,
): { url: string; title: string }[] => {
  const at = homeHtml.indexOf(">Calls for proposals<");
  if (at < 0) return [];
  const ul = homeHtml.indexOf("<ul", at);
  const end = homeHtml.indexOf("</ul>", ul);
  if (ul < 0 || end < 0) return [];
  const out: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const m of homeHtml
    .slice(ul, end)
    .matchAll(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = visibleText(m[2]);
    if (!title || /timetable/i.test(title)) continue;
    const url = new URL(m[1], p.indexUrl).toString();
    if (!/\/term\/\d+$/.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title });
  }
  return out;
};

/** The news nodes a call's term page lists (its „Read more" links), in page order. */
export const parseMrrbNodeLinks = (
  termHtml: string,
  p: Programme,
): string[] => {
  const out: string[] = [];
  for (const m of termHtml.matchAll(
    /href="([^"]*\/node\/\d+)"[^>]*rel="tag"/g,
  )) {
    const url = new URL(m[1], p.indexUrl).toString();
    if (!out.includes(url)) out.push(url);
  }
  return out;
};

/** The next page of a term's node listing (Drupal's `rel="next"` pager), or null. The
 *  announcement that carries a call's deadline is often OLDER than the first page's ten nodes —
 *  bg-rs „Open call for SMEs" keeps it on page 2 — so reading page one only rejects real calls. */
export const parseMrrbNextPage = (
  termHtml: string,
  termUrl: string,
): string | null => {
  const m =
    /<a[^>]*href="([^"]*\?page=\d+)"[^>]*rel="next"|<a[^>]*rel="next"[^>]*href="([^"]*\?page=\d+)"/.exec(
      termHtml,
    );
  const href = m?.[1] ?? m?.[2];
  return href ? new URL(href, termUrl).toString() : null;
};

/** The call URLs a programme's index page(s) list — ONE definition for the crawler and the
 *  watcher, so the two cannot disagree about what a programme's calls are. */
export const listCallUrls = (html: string, p: Programme): string[] =>
  p.kind === "mrrb"
    ? parseMrrbCallTerms(html, p).map((t) => t.url)
    : parseIndex(html, p);

/**
 * One МРРБ call (a taxonomy term) → one `OpenCall`, from the term page plus its news nodes.
 * Same contract as `parseCall`: null when no LABELLED application deadline is found anywhere,
 * never an invented date. No budget — these programmes state it in prose („The total budget
 * of the call is EUR 8 529 412"), and 142 admits money only from a labelled structured field.
 */
export const parseMrrbCall = (
  term: { url: string; title: string; html: string },
  nodes: readonly { url: string; html: string }[],
  p: Programme,
): OpenCall | null => {
  const texts = [term.html, ...nodes.map((n) => n.html)].map((h) =>
    regionText(h, "mrrb"),
  );
  const closesAt = latestLabelledDeadline(texts.join(" \n "));
  if (!closesAt) return null;
  const tid = /\/term\/(\d+)$/.exec(term.url)?.[1] ?? callSlug(term.url);
  const docs: CallDoc[] = [];
  for (const n of nodes)
    for (const d of parseDocs(n.html, n.url))
      if (docs.length < 25 && !docs.some((x) => x.url === d.url)) docs.push(d);
  return {
    source: "interreg",
    sourceKey: `${p.code}:term-${tid}`,
    code: null,
    kind: "call",
    title: term.title,
    programmeCode: p.code,
    programmeName: p.name,
    objective: null,
    datePrecision: "exact",
    opensAt: null,
    closesAt,
    periodLabel: null,
    budgetEur: null,
    budgetNote: null,
    aidRatePct: null,
    grantMinEur: null,
    grantMaxEur: null,
    beneficiariesRaw: null,
    audience: deriveAudience(null, texts.join(" ").slice(0, 4000)),
    territory: null,
    sourceUrl: term.url,
    docs,
    enrichment: "none",
  };
};

/**
 * The call's own title: the LAST `<h1>`, falling back to `<title>`, minus the site suffix.
 *
 * Last, not first — Black Sea Basin renders a breadcrumb `<h1>Calls for proposals</h1>` above
 * the real `<h1>Second Calls for Proposals</h1>`, so taking the first gave every call on that
 * programme the same generic name. Greece-Bulgaria has exactly one, so „last" is right for both.
 */
export const parseTitle = (html: string, fallback: string): string => {
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  const fromH1 = h1s.length ? visibleText(h1s[h1s.length - 1][1]) : "";
  const fromTitle = visibleText(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "",
  );
  const raw = fromH1.length > 3 ? fromH1 : fromTitle;
  const clean = raw
    .replace(/\s*[-–]\s*(Cross-Border|Interreg|Black Sea)[\s\S]*$/i, "")
    .trim();
  return clean.length > 3 ? clean : fallback;
};

/**
 * A Romania–Bulgaria call's title. NOT the `<h1>`: the site truncates it („Call 2 - Competitive
 * call for...") on Calls 1–5, and on Call 6 it is a bare „Call 6". The `<title>` carries the full
 * name behind a site prefix („Interreg VI A RO-BG - Call 2 - …"). Where even that is a bare call
 * number, the name is the article's first SENTENCE, which runs into „Launching date".
 */
export const robgTitle = (
  html: string,
  text: string,
  fallback: string,
): string => {
  const fromTitle = visibleText(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "",
  )
    .replace(/^Interreg\s+VI\s*-?\s*A\s+RO-BG\s*[-–]\s*/i, "")
    .trim();
  if (fromTitle && !/^call\s*\d+$/i.test(fromTitle)) return fromTitle;
  const lead = text
    .split(/\s+launching\s+date/i)[0]
    .split(/\.\s/)[0]
    .trim();
  if (/^call\s*\d+\s*[-–]/i.test(lead) && lead.length <= 400) return lead;
  return fromTitle || fallback;
};

/** Documents linked from the call page — the application pack, guidance, annexes. */
export const parseDocs = (html: string, baseUrl: string): CallDoc[] => {
  const docs: CallDoc[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<a[^>]+href="([^"]+\.(?:pdf|docx?|xlsx?|zip))"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = m[1].startsWith("http")
      ? m[1]
      : new URL(m[1], baseUrl).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const label = visibleText(m[2]).slice(0, 200);
    if (label) docs.push({ label, url });
    if (docs.length >= 25) break;
  }
  return docs;
};

/**
 * One call page → one `OpenCall`.
 *
 * `enrichment` is `'source'` when a budget was read, because the programme publishes it as a
 * labelled structured field („Call Budget 3.000.000,00€") — the same standing as the ДФЗ XLSX
 * columns, and what 142's CHECK requires before money may reach a sortable column. Nothing here
 * is inferred from prose; that is Stage 7's job and it needs a human.
 */
export const parseCall = (
  html: string,
  url: string,
  p: Programme,
): OpenCall | null => {
  const text = regionText(html, p.kind);
  const { opensAt, closesAt } = parseWindow(text, p.kind);
  const title =
    p.kind === "robg"
      ? robgTitle(html, text, callSlug(url))
      : parseTitle(html, callSlug(url));

  // NO READABLE DEADLINE → NO ROW. This is `isun_fetch`'s rule („that is a REJECTION, not a
  // silent skip"), and it is right here for a second reason found in review: the only bucket an
  // undated row could land in is `indicative`, which the UI labels „Очаквани приеми" — expected
  // intakes, hinted „период, не краен срок". The two Greece-Bulgaria pages that reach this
  // branch are its 1st and 2nd calls, both long dead. Refusing to invent a date is right;
  // filing a dead call under „expected" turns that honesty into a forward-looking claim, which
  // is worse than saying nothing at all.
  //
  // Null rather than a throw: the caller counts and reports these, so a programme that changes
  // its phrasing surfaces as a rejection rate instead of a silent shortfall.
  if (!closesAt) return null;
  const budgetMatch = /call budget\s*([\d.,]+\s*(?:€|EUR))/i.exec(text);
  const budgetEur = budgetMatch ? parseEuroAmount(budgetMatch[1]) : null;

  return {
    source: "interreg",
    sourceKey: `${p.code}:${callSlug(url)}`,
    code: null,
    kind: "call",
    title,
    programmeCode: p.code,
    programmeName: p.name,
    objective: null,
    // Always exact — a row with no readable deadline was rejected above, so 142's
    // exact-has-close pairing holds by construction.
    datePrecision: "exact",
    opensAt,
    closesAt,
    periodLabel: null,
    budgetEur,
    budgetNote: budgetMatch ? budgetMatch[1].trim() : null,
    aidRatePct: null,
    grantMinEur: null,
    grantMaxEur: null,
    beneficiariesRaw: null,
    // THE SHARED DERIVATION, not a hard-coded facet and not an empty array.
    //
    // Empty would be wrong in a way that is easy to miss: `[]` reads as „no data at all", while
    // `['unknown']` is a real answer that renders „не е уточнено" and keeps a cross-border call
    // out of a small business's default view. `deriveAudience` returns exactly that here,
    // because its rules are Bulgarian and these pages are English — so today this is a
    // deliberate `unknown` rather than a guess, and it starts working the day a programme
    // publishes a Bulgarian eligibility line. Hard-coding „institution" would be the guess: the
    // eligible-applicant list is per-call prose and several of these calls are municipal.
    audience: deriveAudience(null, text.slice(0, 4000)),
    territory: null,
    sourceUrl: url,
    docs: parseDocs(html, url),
    enrichment: budgetEur !== null ? "source" : "none",
  };
};
