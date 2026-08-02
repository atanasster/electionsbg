// The КЗК decisions (Решения/Определения) corpus — shared store + validator.
//
// Sits between the crawler (kzk_decisions.ts, which WRITES it), the Postgres
// loader (scripts/db/load_kzk_decisions_pg.ts, which SHIPS it) and the matcher
// (kzk_match.ts, which JOINS it onto the appeals). All three must agree on what
// a well-formed decision row is, so the shape and the validator live here rather
// than being re-implemented per consumer.
//
// ⚠️ THE VALIDATOR IS NOT DEFENSIVE BOILERPLATE. The corpus produced
// interactively on 2026-07-04 contains 429 of 4,836 rows (8.9%) that are
// COLUMN-SHIFTED — the act description landed in the act-number field, and
// `pron` / `ddate` came out empty:
//
//   { "no": "F788088/26.12.2025 г. на заместник-кмета на община Пловдив… - ОБЩИНА
//            ПЛОВДИВ; Отменя незаконосъобразното действие…",
//     "pron": "", "ddate": null }
//
// ⚠️ `ddate` IS `null` ON THOSE ROWS, NOT `""` — measured, and the distinction has
// already cost one crash: a sort comparator calling `.localeCompare` on it threw
// a TypeError AFTER a multi-minute headed crawl and before the write, discarding
// the whole run. The declared type says `string | null` for that reason, and
// `validateDecisions` narrows to `ValidDecision` so downstream code can rely on a
// real date without re-checking.
//
// A blank `ddate` means those rows can never match an appeal (the matcher keys on
// year) and can never move the freshness gate — so they were silently inflating
// the "unmatched" count while contributing nothing. They are rejected at the
// door, COUNTED, and reported. The same validator runs inside the crawler, which
// is what stops the defect recurring at the source.
//
// THE ON-DISK SHAPE IS THE REGISTER'S, NOT OURS. `no/ddate/pron/kzk/init/resp`
// are the compact keys the existing corpus uses; they are kept so the committed
// generator and the hand-made file describe the same thing. `initiators` in
// particular is stored AS PRINTED — a ';'-joined party list, because КЗК
// consolidates several complaints against one procedure into a single act.
// Splitting it is the matcher's job, not the store's.

/** The register's list page. Shared with the crawler and the watch source. */
export const DECISIONS_LIST_URL =
  "https://reg.cpc.bg/AllResolutions.aspx?dt=2&ot=2";

/** Act numbers are "АКТ-<seq>-<DD.MM.YYYY>" and unique in the register. */
export const ACT_NO_RE = /^АКТ-\d+-\d{2}\.\d{2}\.\d{4}$/;

/**
 * Above this share of rejected rows, a crawl or a load treats the damage as
 * markup/source DRIFT rather than known history and refuses to store.
 *
 * ONE definition: the crawler and the Postgres loader must agree on what counts
 * as "too broken to keep", or one of them silently accepts what the other rejects.
 * The known-historical damage is 8.9%.
 */
export const REJECT_RATE_CEILING = 0.15;

/**
 * Record boundary in the rendered list: a line starting `Акт № <no>`, optionally
 * preceded by the GridView's row ordinal.
 *
 * ⚠️ The gaps are `[^\S\n]` (any whitespace EXCEPT newline), not `\s`: the register
 * separates the ordinal with NON-BREAKING spaces (U+00A0), and `\s` would also
 * match the newline and let a record swallow the previous line.
 *
 * Exported because the parser, the page-turn detector and the in-page
 * `waitForFunction` all need the same boundary — three copies is how they drift.
 */
export const DECISION_RECORD_RE =
  /^[^\S\n]*(?:\d+[^\S\n]+)?Акт[^\S\n]*№[^\S\n]*/gm;

/**
 * Read the register's authoritative "Намерени са общо N" completeness target.
 *
 * ⚠️ The digit-group class must NOT include `\n`. The register groups thousands
 * with a space — plain in some renderings, NON-BREAKING in others — so the class
 * has to allow one; but `[\d\s]+` also crosses a line break and would splice the
 * next line's leading digits onto the total ("4407\n1 акта" → 44071), silently
 * raising the completeness target so every crawl fails its own assertion.
 *
 * Lives here, not in the crawler, because the WATCH SOURCE needs the identical
 * reading — a second copy already drifted once (it omitted the end-of-line
 * alternative and returned null on exactly the input this guards).
 */
export const parseRegisterTotal = (text: string): number | null => {
  const m =
    /Намерени\s+са\s+общо\s+([\d\u0020\u00a0]+?)\s*(?:жалб|акт|решен|определен|броя?|<|$)/im.exec(
      text,
    );
  if (!m) return null;
  // A digitless header ("\u041d\u0430\u043c\u0435\u0440\u0435\u043d\u0438 \u0441\u0430 \u043e\u0431\u0449\u043e  \u0430\u043a\u0442\u0430") must read as UNKNOWN, not as
  // zero: `Number("")` is 0, and a spurious 0 would satisfy the crawler's
  // completeness assertion (`collected 0 === expected 0`) on a page that simply
  // failed to render, turning a broken read into a successful empty year.
  const digits = m[1].replace(/[\u0020\u00a0\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** The first act number rendered in `text`, or null when the page has no records. */
export const firstActNo = (text: string): string | null => {
  const parts = text.split(new RegExp(DECISION_RECORD_RE.source, "gm"));
  const no = parts[1]?.split(/[\n\r]/)[0]?.trim();
  return no ? no : null;
};

/** Same shape, capturing the act's own date so it can be checked against `ddate`. */
const ACT_NO_PARTS_RE = /^АКТ-\d+-(\d{2})\.(\d{2})\.(\d{4})$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a string that is both ISO-shaped AND a date that exists (rejects 2026-13-45). */
const isRealIsoDate = (s: string): boolean => {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** One decision, in the compact on-disk shape. */
export type KzkDecision = {
  /** Act number — "АКТ-608-25.06.2026". Natural key. */
  no: string;
  /**
   * Decision date, ISO YYYY-MM-DD.
   *
   * NULLABLE, and it really is null in the wild — 429 rows of the 2026-07-04
   * corpus carry `null` here because their columns shifted. Anything that sorts,
   * compares or stores this must handle it; `validateDecisions` narrows it away.
   */
  ddate: string | null;
  /** Произнасяне — the free-text ruling. */
  pron?: string | null;
  /** КЗК case number — "КЗК/417/2026". */
  kzk?: string | null;
  /** Жалбоподател(и), ';'-joined AS PRINTED. */
  init?: string | null;
  /** Ответник (buyer, as printed by КЗК). */
  resp?: string | null;
  /** Present on rows written by the crawler; absent on the 2026-07-04 corpus. */
  fetchedAt?: string | null;
  /**
   * The register page this act was read from. Absent on the 2026-07-04 corpus,
   * which predates the `ot`-parameter enumeration — falls back to
   * DECISIONS_LIST_URL on load.
   *
   * Carried per-row rather than assumed constant because §3c of the plan expects
   * a SECOND register (определения, a different `ot` value) to land here. Stamping
   * those with the решения URL would make `source_url` mean "the register we
   * happened to hardcode" instead of provenance, and a column that lies is worse
   * than one that is absent.
   */
  sourceUrl?: string | null;
};

export type DecisionsFile = {
  generatedAt: string;
  decisions: KzkDecision[];
};

export type RejectedDecision = {
  row: KzkDecision;
  reason: string;
};

/** A decision that passed validation: date guaranteed present and well-formed. */
export type ValidDecision = KzkDecision & { ddate: string };

export type ValidationResult = {
  clean: ValidDecision[];
  rejected: RejectedDecision[];
};

/**
 * Split a corpus into rows safe to store and rows that are structurally broken.
 *
 * Returns rather than throws: a crawl or a load should report the damage and
 * carry on with what is sound, not lose a good 4,407 rows over a bad 429. The
 * CALLER decides whether a rejection rate is tolerable — the crawler treats a
 * spike as markup drift and fails; the loader reports and proceeds, because the
 * damage it is looking at is historical and already known.
 */
export const validateDecisions = (
  rows: readonly KzkDecision[],
): ValidationResult => {
  const clean: ValidDecision[] = [];
  const rejected: RejectedDecision[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const no = (row?.no ?? "").trim();
    const ddate = (row?.ddate ?? "").trim();

    if (!no) {
      rejected.push({ row, reason: "empty act number" });
      continue;
    }
    const parts = ACT_NO_PARTS_RE.exec(no);
    if (!parts) {
      // The column-shift signature: the act DESCRIPTION in the act-number field.
      rejected.push({
        row,
        reason: `act number not "АКТ-<n>-<DD.MM.YYYY>" (column shift?)`,
      });
      continue;
    }
    if (!isRealIsoDate(ddate)) {
      rejected.push({
        row,
        reason: "decision date missing, not ISO, or unreal",
      });
      continue;
    }
    // CROSS-CHECK the two dates the register prints for the same act. Today's
    // column shift happens to blank `ddate`, so the check above catches it — but a
    // shift by a different number of columns, or one landing a NEIGHBOURING act's
    // date here, yields a row that passes every shape test and enters the corpus
    // with a wrong date. That is worse than a blank: the matcher keys on year (so
    // it joins the wrong appeal) and the freshness gate reads max(decision_date)
    // (so it moves to a date the register never published). Measured on the
    // 2026-07-04 corpus: 0 disagreements, so the rule costs nothing today and is
    // purely a tripwire for the drift that has already happened once.
    const [, dd, mm, yyyy] = parts;
    if (`${yyyy}-${mm}-${dd}` !== ddate) {
      rejected.push({
        row,
        reason: "decision date disagrees with the act number's own date",
      });
      continue;
    }
    if (seen.has(no)) {
      // The act number is the primary key; a duplicate would abort the COPY at
      // the very end of a long load. Catch it here, name it, and keep the first.
      rejected.push({ row, reason: "duplicate act number" });
      continue;
    }

    seen.add(no);
    clean.push({ ...row, no, ddate });
  }

  return { clean, rejected };
};

/** Group rejections by reason for a one-line-per-cause report. */
export const summarizeRejections = (
  rejected: readonly RejectedDecision[],
): Array<{ reason: string; count: number }> => {
  const by = new Map<string, number>();
  for (const r of rejected) by.set(r.reason, (by.get(r.reason) ?? 0) + 1);
  return [...by.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
};
