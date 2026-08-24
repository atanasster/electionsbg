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

/**
 * The register's act-number token — "АКТ-608-25.06.2026". ONE DEFINITION.
 *
 * Every consumer of this shape builds from this string rather than re-typing it:
 * `ACT_NO_RE` (anchored), `DECISION_RECORD_RE`'s lookahead, `countActNumbers`,
 * and `extractTopActs` in scripts/watch/sources/kzk_decisions.ts. The file's own
 * `parseRegisterTotal` records why — "a second copy already drifted once" — and
 * the format is the single assumption the whole record boundary rests on, so a
 * future change to it must not have five places to miss.
 *
 * `ACT_NO_PARTS_RE` below stays hand-written because it needs capture groups;
 * kzk_decisions_store.test.ts asserts the two accept exactly the same strings.
 */
export const ACT_NO_SRC = String.raw`АКТ-\d+-\d{2}\.\d{2}\.\d{4}`;

/** Act numbers are "АКТ-<seq>-<DD.MM.YYYY>" and unique in the register. */
export const ACT_NO_RE = new RegExp(`^${ACT_NO_SRC}$`);

/**
 * Above this share of rejected rows, a crawl or a load treats the damage as
 * markup/source DRIFT rather than known history and refuses to store.
 *
 * ONE definition: the crawler and the Postgres loader must agree on what counts
 * as "too broken to keep", or one of them silently accepts what the other rejects.
 *
 * ⚠️ THREE RATES APPEAR IN THIS FILE FOR THE SAME 429 ROWS, and this ceiling is
 * compared against none of them. 8.9% is 429/4,836 — the 2026-07-04 corpus as it
 * stood when the damage was measured; 8.2% is 429/5,208, the same rows as a share
 * of the file today, which has grown by later crawls. Both are FILE-level rates.
 * `validateOrThrow` evaluates this ceiling against `rejected / recs` per CRAWL
 * BATCH, where the committed crawler's observed rate is 0%.
 */
export const REJECT_RATE_CEILING = 0.15;

/**
 * Record boundary in the rendered list.
 *
 * ⚠️ VERIFIED AGAINST `page.locator("body").innerText()` — the string the crawler
 * ACTUALLY reads — on 2026-08-02. That distinction cost a failed crawl: an
 * earlier fix was verified against a curl fetch rendered by replacing `</td>`
 * with newlines, which splits the row into one field per line. Playwright does
 * not:
 *
 *   curl render   →  "1\nРешение № АКТ-734-23.07.2026"
 *   innerText     →  "1     Решение № АКТ-734-23.07.2026"   ← ordinal INLINE
 *
 * So the optional leading ordinal is load-bearing; without it the boundary
 * matches nothing and the crawl dies at "no records rendered within 15s".
 *
 * The header word is the ACT TYPE, not "Акт" — `Решение №` (ot=2, решения) and
 * `Определение №` (ot=6, определения) — so both must be in the alternation.
 *
 * The gaps stay `[^\S\n]` (any whitespace EXCEPT newline): it matches the
 * non-breaking spaces the ordinal is padded with, but a record cannot swallow the
 * line above it.
 *
 * ⚠️ THE LOOKAHEAD IS THE WHOLE DEFENCE AGAINST A FRACTURED RECORD, and it was
 * added after the damage it prevents had already been measured. Asking only for
 * the WORD is not enough: КЗК's `Произнасяне` quotes the buyer's own annulled
 * decision using the identical words —
 *
 *   отменя незаконосъобразно решение(ОТМЕНЯ КАТО НЕЗАКОНОСЪОБРАЗНО
 *   Решение № РД-25/10.01.2026 г. на кмета на община Х) - "ФИРМА" ЕООД;
 *
 * — so wherever the rendering puts a line break before that quotation, the
 * boundary fires INSIDE a record and splits it in two. Measured on the
 * 2026-07-04 corpus: 429 of 5,208 rows (8.2%) are such fragments, and the damage
 * is NOT the fragments (validateDecisions rejects them). It is that the parent
 * loses `kzk` / `init` / `resp` to the fragment — the labels sit AFTER
 * `Произнасяне` in the record, so they land in the fragment's chunk and
 * `afterLabel` reads them there. 363 real acts are stored with all three NULL,
 * which makes them permanently unmatchable by kzk_match.ts (it joins on
 * complainant + respondent), and 125 of those carry an `уважена` that can never
 * reach upheld_ocids or the contract Corruption Risk Index.
 *
 * EVERY register header carries `АКТ-<n>-<DD.MM.YYYY>` and no quoted buyer
 * decision ever does — the references measured in the corpus are `РД-`, `РД15-`,
 * `СОА19-`, `Р-`, `ОП-`, `ЗОП-`, `F…`, `Ц…`, `ТО-…` and bare integers, not one
 * of them `АКТ-`-shaped. So requiring the act number is what tells a header from
 * a quotation, and it is a LOOKAHEAD so the split still consumes only the header
 * and parseDecisionsText's `part.split(/[\n\r]/)[0]` still yields the act number.
 *
 * The failure direction is deliberate: if КЗК ever changes the act-number format
 * this matches NOTHING, `waitForRecords` times out and `crawlYear` throws
 * "no records rendered within 15s" — loud, and the crawl stores nothing. Against
 * the pre-lookahead regex the same change would silently fracture every record
 * instead. See docs/plans/kzk-columnshift-and-cloud-parity-v1.md §1.2, §1.5.
 *
 * ⚠️ Note the line anchor is why an INLINE quotation was always safe and why the
 * older test "does not fracture a record on 'акт' inside a field value" passed
 * while the defect was live — it exercises the inline case, not the line-start
 * one. `parseDecisionsText` keeps a fixture for each.
 *
 * ⚠️⚠️ THE LOOKAHEAD INVERTS THE FAILURE DIRECTION, and that is the cost of it.
 * Before it, a drifting act-number format produced a FRACTURE — an extra record
 * with no act number, visible in the rejection tally. After it, a header whose
 * act number does not match is not a fracture but a SILENT LOSS: the boundary
 * skips it, the previous record swallows its lines, and `afterLabel`'s
 * first-match-wins means the swallowed act's Дата / Произнасяне / Инициатор /
 * Ответник are discarded outright. Nothing is rejected, so nothing is reported.
 * Measured on the committed parser with one act rendered at an unpadded day:
 * 3 headers → 2 records, 0 rejected.
 *
 * `crawlYear`'s `got.length !== expected` assertion catches that on a FULL
 * crawl — but the incremental daily path sets `earlyStopped` and skips it, and
 * that is the path that runs every day. `countRecordHeaders` below is the
 * tripwire for this direction; keep both, they fail on opposite drifts.
 */
export const DECISION_RECORD_RE = new RegExp(
  String.raw`^[^\S\n]*(?:\d+[^\S\n]+)?(?:Решение|Определение|Акт)[^\S\n]*№[^\S\n]*(?=${ACT_NO_SRC})`,
  "gm",
);

/**
 * How many DISTINCT act numbers the rendered page names.
 *
 * DISTINCT, not occurrences: a rendering that printed an act number twice on one
 * record (a back-reference, a PDF link title, a repeated header cell) would
 * otherwise raise the ceiling with no record behind it and loosen the check in
 * silence.
 *
 * The invariant: a page cannot yield MORE records than it names acts. That
 * catches a fracture whose extra record carries no `АКТ-` token of its own —
 * the measured class, 429 of 5,208 rows in the 2026-07-04 corpus.
 *
 * ⚠️ TWO THINGS IT CANNOT SEE ON ITS OWN, both measured 2026-08-24. This is NOT
 * an independent check on the boundary: it matches the SAME token the lookahead
 * requires, so the two miss together.
 *
 *  - UNDER-parsing. `<=` is satisfied by zero records, and a header the
 *    lookahead skips is absent from BOTH sides of the comparison. Use
 *    `countRecordHeaders` for that direction.
 *  - A quotation that is itself `АКТ-`-shaped — a КЗК act quoting another КЗК
 *    act at the start of a line. It fractures the record AND raises this ceiling
 *    by one, so the comparison passes. 0 of 5,208 `pron` values carry such a
 *    reference today (only 3 quote a decision at all), so the hole is EMPTY, not
 *    closed.
 */
export const countActNumbers = (text: string): number =>
  new Set(text.match(new RegExp(ACT_NO_SRC, "g")) ?? []).size;

/**
 * How many line-start record HEADERS the page renders, whatever follows the `№`.
 *
 * The genuinely boundary-independent counter, and the reason it exists: it keys
 * on the header WORD, which the register prints regardless of how it numbers
 * acts, so it still sees a header whose act number has drifted out of
 * `ACT_NO_SRC` — exactly the case `countActNumbers` and the lookahead miss
 * together.
 *
 * ⚠️ It is an UPPER bound, not a record count: a line-start quotation
 * ("ОТМЕНЯ …\nРешение № РД-25/…") matches it too, which is the whole reason the
 * boundary needs the lookahead. So `records < countRecordHeaders` is normal on a
 * page whose rulings quote a decision, and only a HUMAN reading both numbers
 * against a live page can tell a quotation from a lost record — which is why
 * `probe()` reports the pair rather than asserting on it.
 */
export const countRecordHeaders = (text: string): number =>
  (
    text.match(
      /^[^\S\n]*(?:\d+[^\S\n]+)?(?:Решение|Определение|Акт)[^\S\n]*№/gm,
    ) ?? []
  ).length;

/** The first act number rendered in `text`, or null when the page has no records. */
export const firstActNo = (text: string): string | null => {
  const parts = text.split(new RegExp(DECISION_RECORD_RE.source, "gm"));
  const no = parts[1]?.split(/[\n\r]/)[0]?.trim();
  return no ? no : null;
};

/**
 * The register variants, verified by enumerating `ot` on 2026-08-02.
 *
 * `ot=6` is the определения register plan §3c predicted and nothing had ever
 * crawled — 249 acts for 2026 against решения' 401 — and it is the ONLY
 * authoritative source for `kzk_appeals.suspension`: its `Произнасяне` carries
 * rulings like "оставя без уважение искане за налагане на временна мярка".
 * ot=1/3/4/5 render no result header and no records.
 */
export const REGISTER_VARIANTS = [
  { ot: 2, kind: "решения" as const },
  { ot: 6, kind: "определения" as const },
];

/** Which register an act came from. */
export type DecisionKind = (typeof REGISTER_VARIANTS)[number]["kind"];

/**
 * Derive the kind from the record's own header word, not from the URL that was
 * fetched.
 *
 * The header is the register's own statement of what the act IS ("Решение № …" /
 * "Определение № …"), so a row mis-filed under the wrong `ot` still classifies
 * correctly, and a re-crawl cannot relabel history by changing a constant.
 */
export const kindFromHeader = (header: string): DecisionKind | null =>
  // NOT anchored with `^`: the captured header carries the GridView's row
  // ordinal ("1     Решение № "), so an anchored test silently returns null on
  // every record and the whole corpus loads with no kind. "Определение" contains
  // no "Решение" substring, so the order of these two tests is not load-bearing.
  /Определение/.test(header)
    ? "определения"
    : /Решение/.test(header)
      ? "решения"
      : null;

/**
 * May an act of this kind set a MERITS outcome?
 *
 * ⚠️ `null` (legacy) counts as eligible. The 4,407 rows of the 2026-07-04 corpus
 * predate this column and are the source of every outcome served today; treating
 * an unknown kind as ineligible would silently drop 2,860 matches. Only an act
 * KNOWN to be an определение is excluded.
 *
 * Why exclude them at all, when classifyOutcome already returns null for every
 * temporary-measure phrasing (verified — they lack the word `жалбата`)? Because
 * `outcome` is not the only thing a match writes. An определение would still
 * stamp `decision_date` and `decision_act_no`, making those columns mean "some
 * act" rather than "the merits ruling" — and it would CLAIM the appeal, so the
 * решение that later decides the same case reads as a second claimant and the
 * whole appeal is dropped as ambiguous.
 */
export const setsMeritsOutcome = (kind: string | null | undefined): boolean =>
  kind !== "определения";

/**
 * The SQL twin of `setsMeritsOutcome`, for callers that filter in the database.
 *
 * ONE definition, for the reason `parseRegisterTotal` gives about its own reading:
 * `kzk_rejoin.ts` selects the merits-eligible corpus in SQL while
 * `kzk_appeals_provenance.data.test.ts` filters the same rows in TypeScript, and
 * for the gate to mean anything the two populations must be identical. They were
 * two independent copies until 2026-08-24, and the gate's copy was simply absent
 * — it measured 4,779 rows against the writer's 4,502, handing the ratchet 20
 * matches of slack.
 *
 * ⚠️ `IS DISTINCT FROM`, never `<>`. A plain `<>` is NULL-false, so it would drop
 * the entire legacy corpus — the ~4,402 rows with no `kind`, which are where
 * every outcome served today comes from.
 */
export const MERITS_ELIGIBLE_SQL = "kind IS DISTINCT FROM 'определения'";

/**
 * Read the register's authoritative "Намерени са общо N …" completeness target.
 *
 * VERIFIED live: "Намерени са общо 401 решения по ЗОП за 2026 година." and
 * "Намерени са общо 249 определения по ЗОП за 2026 година." — hence both
 * `решен` and `определен` in the alternation.
 *
 * ⚠️ The digit-group class must NOT include `\n`. The register groups thousands
 * with a space — plain in some renderings, NON-BREAKING in others — so the class
 * has to allow one; but `[\d\s]+` also crosses a line break and would splice the
 * next line's leading digits onto the total ("4407\n1 акта" → 44071), silently
 * raising the target so every crawl fails its own completeness assertion.
 *
 * Lives here, not in the crawler, because the WATCH SOURCE needs the identical
 * reading — a second copy already drifted once.
 */
export const parseRegisterTotal = (text: string): number | null => {
  const m =
    /Намерени\s+са\s+общо\s+([\d\u0020\u00a0]+?)\s*(?:жалб|акт|решен|определен|броя?|<|$)/im.exec(
      text,
    );
  if (!m) return null;
  // A digitless header must read as UNKNOWN, not as zero: `Number("")` is 0, and
  // a spurious 0 satisfies the crawler's completeness assertion on a page that
  // simply failed to render, turning a broken read into a successful empty year.
  const digits = m[1].replace(/[\u0020\u00a0\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** URL for one register variant. */
export const registerUrl = (ot: number): string =>
  DECISIONS_LIST_URL.replace(/([?&]ot=)\d+/, `$1${ot}`);

/** Same shape, capturing the act's own date so it can be checked against `ddate`. */
// EXPORTED only so kzk_decisions_store.test.ts can assert it accepts exactly what
// ACT_NO_RE accepts. It is the one copy of the act-number shape that ACT_NO_SRC
// could not absorb — it needs capture groups — and a drift between the two means
// validateDecisions rejects on a shape scripts/db/tests/kzk_decisions.data.test.ts
// (which checks stored rows against ACT_NO_RE) would accept, or vice versa.
export const ACT_NO_PARTS_RE = /^АКТ-\d+-(\d{2})\.(\d{2})\.(\d{4})$/;

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
  /**
   * Which register this act came from — "решения" or "определения".
   *
   * NULL on the 2026-07-04 corpus, which predates the `ot` enumeration. See
   * setsMeritsOutcome(): a null kind is treated as eligible, because those rows
   * are where today's outcomes come from.
   */
  kind?: DecisionKind | null;
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
