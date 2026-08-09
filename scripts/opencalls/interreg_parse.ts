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
// own CMS with its own phrasing and its own date format (`22/06/2026` vs `28 June, 2024`).
// A single „smart" extractor over both is how a change on one site starts silently mis-parsing
// the other.

import { deriveAudience } from "./audience";
import { sofiaWallClockToUtc } from "./isun_parse";
import type { CallDoc, OpenCall } from "./types";

export type ProgrammeKind = "gbg" | "bsb";

export interface Programme {
  /** `sourceKey` prefix and the stable id in `programme_code`. */
  code: string;
  name: string;
  kind: ProgrammeKind;
  indexUrl: string;
  /** Only links under this prefix are calls; everything else on the index is navigation. */
  callPrefix: string;
}

/**
 * The programmes this arm covers, and ONLY those it can actually read.
 *
 * Bulgaria participates in six cross-border programmes. Three are absent by measurement, not by
 * oversight — `ipacbc-bgrs.eu` (Serbia), `ipa-cbc-007.eu` (North Macedonia) and `ipacbc-bgtr.eu`
 * (Turkey) reset the connection on both port 443 and port 80, with DNS resolving, from two
 * independent clients (curl and a browser), on 2026-08-09. Romania-Bulgaria serves its homepage
 * but publishes no calls index at any guessed path. Listing an unreadable programme here would
 * turn a known gap into a crawler that reports zero and looks healthy.
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
    let href = m[1];
    if (href.startsWith("/")) href = new URL(href, p.indexUrl).toString();
    if (!href.startsWith(p.callPrefix)) continue;
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
  const text = visibleText(html);
  const { opensAt, closesAt } = parseWindow(text, p.kind);

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
    title: parseTitle(html, callSlug(url)),
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
