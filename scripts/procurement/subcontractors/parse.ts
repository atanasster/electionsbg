// Subcontractor declarations from the rendered ЗОП обявление (plan P8).
//
// „The money on a contract is not the money that reaches the work" — the plan's
// framing. Whether a contract is performed by the winner or handed on is
// declared on the award notice, and until now was only readable by opening one.
//
// ⚠️ THIS IS A PROJECTION, NOT A CRAWL. Everything it reads is already in
// `tender_notice`, loaded by the ЦАИС dossier capture. It was scoped as an
// ingest because the plan assumed the fields lived in documents; they are in the
// notice body, which we already hold for 212,961 notices.
//
// The form prints a fixed sequence, and the LATER fields are optional — that is
// what makes a positional parse wrong and a labelled one necessary:
//
//   участват подизпълнители {Да|Не}
//   [Брой подизпълнители по договора {N}]        ← only when Да
//   [Договорът е изменян {Да|Не}]                ← absent on some forms
//   [Брой изменения по договора {N}]             ← only when изменян = Да

export type SubcontractorFacts = {
  /** Да / Не as declared. `null` = the form does not carry the question, which
   *  is NOT the same as „no subcontractors" and must never be rendered as one. */
  hasSubcontractors: boolean | null;
  /** Declared count. `null` when the form omits it — including when the answer
   *  was Не, where the count line is simply not printed. */
  subcontractorCount: number | null;
  /** Bonus from the same block: whether the contract was later amended. Kept
   *  because it comes free and pairs with `procurement_annexes`. */
  wasAmended: boolean | null;
  amendmentCount: number | null;
};

const EMPTY: SubcontractorFacts = {
  hasSubcontractors: null,
  subcontractorCount: null,
  wasAmended: null,
  amendmentCount: null,
};

/** ⚠️ THE ANSWER MUST END AT A NON-LETTER, or any word starting with „Да"/„Не"
 *  is read as an answer. Demonstrated against the live parser before this
 *  guard: „Дата на сключване …" parsed as **Да** and „Неприложимо" as **Не**.
 *  A fabricated Не breaks the safety property this whole design exists for; a
 *  fabricated Да is worse, because it publishes a claim a named buyer never
 *  made and is shape-identical to the 616 real ones, so no gate here would
 *  catch it. „Дата" occurs in the same documents („Изходящ номер 804 от дата
 *  15-септември-2023"), one blank answer away from firing.
 *
 *  `\p{L}` with the `u` flag, NOT `\b` — JS word boundaries are ASCII-only and
 *  never match after a Cyrillic letter. */
const ANSWER = String.raw`(Да|Не)(?![\p{L}\p{N}])`;

const yesNo = (v: string | undefined): boolean | null => {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  if (t === "да") return true;
  if (t === "не") return false;
  return null;
};

const intOrNull = (v: string | undefined): number | null => {
  if (!v) return null;
  // Bounded to 4 digits by the pattern; a longer run is refused rather than
  // truncated, because a silently-shortened count is a wrong number that looks
  // like a right one.
  const n = Number.parseInt(v.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Whitespace in the rendered notice is not stable — the same field arrives with
 *  newlines, non-breaking spaces or runs of blanks between label and value. */
const flat = (s: string): string => s.replace(/[\s\u00a0]+/g, " ");

export const parseSubcontractorFacts = (
  noticeText: string | null | undefined,
): SubcontractorFacts => {
  if (!noticeText) return EMPTY;
  const t = flat(noticeText);
  // ⚠️ ONE OCCURRENCE, NOT FOUR INDEPENDENT SEARCHES. The four labels were
  // matched separately across the whole document, so a notice containing the
  // block twice — an original award plus a correction, which happens — could
  // take „Да" from the first and its count from the second, producing a row
  // that appears in neither. Anchor on the block, then read inside it.
  const start = t.search(
    new RegExp(String.raw`участват подизпълнители\s*${ANSWER}`, "iu"),
  );
  if (start < 0) return EMPTY;
  // The block runs to the next form SECTION; 600 chars comfortably covers the
  // four fields and stops well short of the following one.
  const block = t.slice(start, start + 600);

  const has = yesNo(
    block.match(
      new RegExp(String.raw`участват подизпълнители\s*${ANSWER}`, "iu"),
    )?.[1],
  );
  if (has === null) return EMPTY;
  return {
    hasSubcontractors: has,
    subcontractorCount: intOrNull(
      block.match(/Брой подизпълнители по договора\s*(\d{1,4})(?!\d)/iu)?.[1],
    ),
    wasAmended: yesNo(
      block.match(
        new RegExp(String.raw`Договорът е изменян\s*${ANSWER}`, "iu"),
      )?.[1],
    ),
    amendmentCount: intOrNull(
      block.match(/Брой изменения по договора\s*(\d{1,4})(?!\d)/iu)?.[1],
    ),
  };
};

/** A declaration is INTERNALLY INCONSISTENT when it says Не and then prints a
 *  count above zero, or says Да with an explicit zero. Both occur in the corpus
 *  (buyers mis-fill the form), and neither may be silently normalised: which
 *  half is right is not knowable from the notice. Reported, not fixed. */
export const isInconsistent = (f: SubcontractorFacts): boolean =>
  (f.hasSubcontractors === false && (f.subcontractorCount ?? 0) > 0) ||
  (f.hasSubcontractors === true && f.subcontractorCount === 0);
