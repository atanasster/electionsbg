// PURE parsers for ИСУН 2020's procedure register. No network, no clock, no fs — so the
// unit tests run against committed fixtures and a parser change is reviewable in a diff.
//
// TWO PAGES.
//   * the LISTING (/bg/s/Procedure/Active, /bg/s/Procedure/PublicDiscussion) is a nested
//     <ul> tree: a programme node carrying "Name (N)" whose children are
//     `<li data-href="/bg/s/Procedure/Info/<GUID>">CODE - TITLE</li>`. Note the rows are
//     `li[data-href]`, NOT anchors — `a[href]` finds only the comment/permalink links.
//   * the DETAIL (/bg/s/Procedure/Info/<GUID>) carries the objective, the two deadlines as
//     `<p><b>Начален срок:</b> <span>10.07.2026 г. 14:00 ч.</span></p>`, and the document
//     list as `a[href*="/Procedure/InfoDownload/"]`.
//
// Both pages are SERVER-RENDERED — no JS is required, which is the whole reason this ingest
// is a plain fetch rather than a headless browser.
//
// THE TIMEZONE IS THE EASIEST THING TO GET WRONG HERE. ИСУН prints Sofia WALL-CLOCK time and
// Sofia observes EET (+02) in winter and EEST (+03) in summer. A fixed +02:00 offset puts
// every summer deadline an hour early — on a 16:30 cut-off that is a wrong countdown on the
// number a reader is acting on. `sofiaWallClockToUtc` resolves the offset per date instead,
// and the tests pin one winter and one summer date.

import * as cheerio from "cheerio";
import type { CallDoc, CallKind, OpenCall } from "./types";

/** Minutes Europe/Sofia is ahead of UTC at a given instant (+120 winter, +180 summer). */
const sofiaOffsetMinutes = (utcMs: number): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Sofia",
    // hourCycle h23, NOT hour12:false. The latter can format midnight as "24", and Date.UTC
    // would then read it as the next day — a 1440-minute offset instead of 120. Node 22
    // happens to emit "00" here, so the bug would be dormant rather than absent.
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asIfUtc = Date.UTC(
    g("year"),
    g("month") - 1,
    g("day"),
    g("hour"),
    g("minute"),
    g("second"),
  );
  return (asIfUtc - utcMs) / 60_000;
};

/** A Sofia wall-clock reading → the UTC instant it denotes, DST-correct.
 *
 *  Two passes: the first guesses the offset from the naive instant, the second re-reads it at
 *  the corrected instant. That settles readings within a few hours of a DST boundary, where
 *  the naive guess lands on the wrong side of the transition. */
export const sofiaWallClockToUtc = (
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): Date => {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let ms = naive - sofiaOffsetMinutes(naive) * 60_000;
  ms = naive - sofiaOffsetMinutes(ms) * 60_000;
  return new Date(ms);
};

/** „10.07.2026 г. 14:00 ч." → ISO, or null.
 *
 *  ANCHORED and RANGE-CHECKED, both deliberately. Unanchored, the fallback call sites can pick
 *  up a stray earlier date from surrounding prose instead of the deadline. Un-range-checked,
 *  `Date.UTC` rolls over silently: `31.13.2026` becomes 30 Jan 2027 and `29.02.2026` becomes
 *  1 Mar — a deadline that is wrong rather than absent, which is the worse of the two failures
 *  because nothing downstream can tell. Rejecting makes the caller drop the row and the
 *  parse-rate guard notice. */
export const parseSofiaStamp = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const m = raw
    .trim()
    .match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*г\.?(?:\s*(\d{1,2}):(\d{2}))?/u);
  if (!m) return null;
  const [d, mo, y, h, mi] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0"].map(
    Number,
  );
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59) return null;
  const dt = sofiaWallClockToUtc(y, mo, d, h, mi);
  if (Number.isNaN(dt.getTime())) return null;
  // Round-trip through Sofia: a rolled-over date (29.02 in a non-leap year) comes back as a
  // different day/month than it went in as.
  const back = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
  const want = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return back === want ? dt.toISOString() : null;
};

const clean = (s: string | undefined | null): string =>
  (s ?? "").replace(/\s+/gu, " ").trim();

export interface IsunListingRow {
  guid: string;
  /** "BG16RFPR001-1.011", when the row's text carries one. */
  code: string | null;
  title: string;
  programmeName: string | null;
  /** The programme prefix implied by the procedure code ("BG16RFPR001"). */
  programmeCode: string | null;
}

/** Split "BG16RFPR001-1.011 -  Внедряване на иновации…" into its two halves.
 *
 *  Anchored at the start and non-greedy on the code, so only the FIRST separator splits —
 *  many titles contain their own hyphens („Процедура № 2, Специфична цел 1 …-…").
 *
 *  Accepts hyphen, en-dash and em-dash as the separator. ИСУН uses a plain hyphen today, but
 *  an editor pasting from Word is how a whole page of rows silently loses its `code`, and a
 *  null code is invisible downstream: the row still renders, just unlinkable by procedure. */
export const splitCodeTitle = (
  text: string,
): { code: string | null; title: string } => {
  const t = clean(text);
  const m = t.match(/^([A-Z]{2}[A-Z0-9]*-[\d.]+)\s*[-–—]\s*(.*)$/u);
  if (m) return { code: m[1], title: clean(m[2]) || m[1] };
  return { code: null, title: t };
};

/** Rows from a listing tier. `html` may be a FRAGMENT — the fixtures are trimmed. */
export const parseIsunListing = (html: string): IsunListingRow[] => {
  const $ = cheerio.load(html);
  const rows: IsunListingRow[] = [];
  $("li[data-href]").each((_, el) => {
    const href = $(el).attr("data-href") ?? "";
    const guid = href.match(/\/Procedure\/Info\/([0-9a-f-]{36})/iu)?.[1];
    if (!guid) return;
    // .text() would include nested children; a procedure node has none, but guard anyway by
    // taking only the direct text nodes.
    const own = $(el)
      .contents()
      .filter((_i, n) => n.type === "text")
      .text();
    const { code, title } = splitCodeTitle(own || $(el).text());
    if (!title) return;
    // The programme is the nearest ancestor <li>'s own text, e.g. „Програма "Образование"
    // 2021-2027 (7)". Strip the trailing count — it is a UI affordance, not part of the name.
    const parentLi = $(el).parent().closest("li");
    const progRaw = clean(
      parentLi
        .contents()
        .filter((_i, n) => n.type === "text")
        .text(),
    );
    const programmeName = progRaw
      ? clean(progRaw.replace(/\s*\(\d+\)\s*$/u, ""))
      : null;
    rows.push({
      guid,
      code,
      title,
      programmeName: programmeName || null,
      programmeCode: code?.match(/^([A-Z]{2}[A-Z0-9]*)-/u)?.[1] ?? null,
    });
  });
  return rows;
};

export interface IsunDetail {
  objective: string | null;
  opensAt: string | null;
  closesAt: string | null;
  docs: CallDoc[];
  /** The „Въпроси и отговори (Дата на актуализация: …)" stamp, used by the fetcher to decide
   *  whether a procedure needs re-reading. Null when the page carries none. */
  qaUpdatedAt: string | null;
}

export const parseIsunDetail = (html: string): IsunDetail => {
  const $ = cheerio.load(html);

  // SCOPED TO THE LABEL'S OWN SIBLINGS, never to the parent's descendants at large.
  //
  // The two deadlines sit in ONE `div.procedure-info`, as `<p><b>Начален срок:</b><span>…`
  // and `<p><b>Краен срок:</b><span>…`. Searching `parent().find("span")` is only correct
  // while each label has its own <p>: drop those wrappers and both labels share a parent, so
  // „Краен срок" would read the FIRST span — the opening date, 66 days early. `validateCall`
  // cannot catch it either, because opensAt and closesAt would be equal rather than inverted.
  //
  // `nextAll()` reads only what follows THIS label within its own parent, so the pairing
  // survives the wrappers being removed.
  const stampAfterLabel = (label: string): string | null => {
    let found: string | null = null;
    $("b, strong").each((_, el) => {
      if (found) return;
      if (!clean($(el).text()).startsWith(label)) return;
      const sib = clean($(el).nextAll("span").first().text());
      found =
        parseSofiaStamp(sib) ||
        // Fallback for a layout with no span: the text that FOLLOWS the label, not the whole
        // parent (which also contains the other label's value).
        parseSofiaStamp(
          clean(
            $(el)
              .nextAll()
              .addBack()
              .not(el)
              .map((_i, n) => $(n).text())
              .get()
              .join(" "),
          ),
        );
    });
    return found;
  };

  const docs: CallDoc[] = [];
  $('a[href*="/Procedure/InfoDownload/"]').each((_, el) => {
    const url = $(el).attr("href") ?? "";
    const label = clean($(el).text());
    if (url && label) docs.push({ label, url });
  });

  // THE OBJECTIVE IS THE `div.procedure-info` THAT CARRIES THE CODE — not "the first
  // substantial <p>".
  //
  // Two traps a looser heuristic walks into, both present on every real page:
  //   * `div.info-block` above it holds ИСУН's static help boilerplate („В тази страница
  //     имате възможност…"), which is byte-identical on all 55 procedures — so the naive
  //     version gives every call the same "objective";
  //   * there are TWO `div.procedure-info` blocks; the second holds the deadlines.
  //     Distinguish by the code `<strong>`, which only the objective block has.
  //
  // The text is also split across several <p>s mid-sentence, so they are JOINED rather than
  // first-one-wins, which would truncate the objective at a comma.
  let objective: string | null = null;
  $("div.procedure-info").each((_, el) => {
    if (objective) return;
    const block = $(el);
    if (block.children("strong").length === 0) return; // the deadlines block
    const text = clean(
      block
        .children("p")
        .map((_i, p) => clean($(p).text()))
        .get()
        .filter(Boolean)
        .join(" "),
    );
    if (text) objective = text;
  });

  let qaUpdatedAt: string | null = null;
  const qa = $("body")
    .text()
    .match(/Дата на актуализация:\s*([^)]+)/u);
  if (qa) qaUpdatedAt = parseSofiaStamp(qa[1]);

  return {
    objective,
    opensAt: stampAfterLabel("Начален срок"),
    closesAt: stampAfterLabel("Краен срок"),
    docs,
    qaUpdatedAt,
  };
};

const BASE = "https://eumis2020.government.bg";

/** Combine a listing row and its detail page into the shared OpenCall shape.
 *
 *  Returns null when the detail carries no `Краен срок`. That is deliberate: ИСУН rows are
 *  `date_precision: 'exact'`, and an exact call with no deadline is exactly what the DDL
 *  refuses. Dropping it here (and letting the parse-rate guard notice) beats inventing one. */
export const toOpenCall = (
  row: IsunListingRow,
  detail: IsunDetail,
  kind: CallKind,
): OpenCall | null => {
  if (!detail.closesAt) return null;
  return {
    source: "isun",
    sourceKey: row.guid,
    code: row.code,
    kind,
    title: row.title,
    programmeCode: row.programmeCode,
    programmeName: row.programmeName,
    objective: detail.objective,
    datePrecision: "exact",
    opensAt: detail.opensAt,
    closesAt: detail.closesAt,
    periodLabel: null,
    // ИСУН's procedure page publishes none of these — they live in the „Условия" documents,
    // which Stage 7 reads. Never guessed here.
    budgetEur: null,
    budgetNote: null,
    aidRatePct: null,
    grantMinEur: null,
    grantMaxEur: null,
    beneficiariesRaw: null,
    audience: [],
    territory: null,
    sourceUrl: `${BASE}/bg/s/Procedure/Info/${row.guid}`,
    docs: detail.docs.map((d) => ({
      label: d.label,
      url: d.url.startsWith("http") ? d.url : `${BASE}${d.url}`,
    })),
  };
};
