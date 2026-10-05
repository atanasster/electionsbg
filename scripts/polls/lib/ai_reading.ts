// docs/plans/polls-ai-review-v1.md — the INDEPENDENT reading of one captured
// publication, and the pure comparison that decides whether a deterministic
// draft may be accepted without a human.
//
// The reading is produced inside the Claude Code session (a subagent run by
// the update-polls skill, on the operator's subscription — no API key), from
// the capture directory ALONE: it never sees the extractor's draft. This
// module only validates that file and compares it; it calls no model.

import { normalise } from "../../opencalls/enrich_gate";
import type {
  PollBase,
  PollGenre,
  PollMeasure,
} from "../../../src/data/polls/pollsTypes";
import type { InboxDraft } from "./draft";
import { isBilingualLabel } from "./question_validation";

export const READING_SCHEMA = "polls-ai-reading/v1";

/** How an answer row relates to the corpus shape: `choice` is a party or
 *  candidate (a details row); `none` „Не подкрепям никого"; `other` a
 *  pooled „Друг/Други"; the last three are residuals, never details. */
export type ReadingAnswerKind =
  | "choice"
  | "none"
  | "other"
  | "undecided"
  | "wont_vote"
  | "wont_say";

export interface ReadingAnswer {
  label: string;
  kind: ReadingAnswerKind;
  value: number;
  /** Verbatim text from the article/PDF, or null when read from an image. */
  quote: string | null;
  /** Capture filename the value was read from when it is image-only. */
  image: string | null;
}

export interface ReadingQuestion {
  measure: PollMeasure;
  round: 1 | 2 | null;
  baseKind: PollBase["kind"];
  basePhrase: string | null;
  /** The base as the corpus labels it („Твърдо решили да гласуват" /
   *  "Respondents firmly decided to vote"); used only to fill a base the
   *  extractor left unresolved. */
  baseLabel: { bg: string; en: string } | null;
  answers: ReadingAnswer[];
}

export interface ReadingPoll {
  race: "parliamentary" | "presidential";
  fieldworkStart: string | null;
  fieldworkEnd: string | null;
  fieldworkQuote: string | null;
  respondents: number | null;
  respondentsQuote: string | null;
  publishedAt: string | null;
  genre: PollGenre;
  methodology: { bg: string; en: string } | null;
  methodologyQuote: string | null;
  sponsor: { bg: string; en: string } | null;
  sponsorQuote: string | null;
  questions: ReadingQuestion[];
}

export interface AiReading {
  schema: typeof READING_SCHEMA;
  agencyId: string;
  pubId: string;
  /** The capture version read — a reading of an older capture never
   *  vouches for a re-captured (`.vN`) publication. */
  captureSha256: string;
  model: string;
  readAt: string;
  polls: ReadingPoll[];
  /** Why no poll was read (a topical survey, an exit poll), else null. */
  notAPoll: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: ReadingAnswerKind[] = [
  "choice",
  "none",
  "other",
  "undecided",
  "wont_vote",
  "wont_say",
];

/** Every structural problem with a reading file. Empty = usable. A reading
 *  that fails here is treated as no reading at all (fail closed). */
export const validateReading = (value: unknown): string[] => {
  const errors: string[] = [];
  const r = value as Partial<AiReading> | null;
  if (!r || typeof r !== "object") return ["reading is not an object"];
  if (r.schema !== READING_SCHEMA)
    errors.push(`schema must be ${READING_SCHEMA}`);
  for (const k of [
    "agencyId",
    "pubId",
    "captureSha256",
    "model",
    "readAt",
  ] as const)
    if (typeof r[k] !== "string" || !r[k]) errors.push(`${k} missing`);
  if (!Array.isArray(r.polls)) return [...errors, "polls must be an array"];
  r.polls.forEach((p, i) => {
    const at = `polls[${i}]`;
    if (p.race !== "parliamentary" && p.race !== "presidential")
      errors.push(`${at}.race invalid`);
    for (const k of ["fieldworkStart", "fieldworkEnd", "publishedAt"] as const)
      if (p[k] !== null && !(typeof p[k] === "string" && ISO.test(p[k]!)))
        errors.push(`${at}.${k} must be YYYY-MM-DD or null`);
    if (p.respondents !== null && !Number.isInteger(p.respondents))
      errors.push(`${at}.respondents must be an integer or null`);
    if (p.methodology !== null && !isBilingualLabel(p.methodology))
      errors.push(`${at}.methodology must be {bg, en} or null`);
    if (!Array.isArray(p.questions)) {
      errors.push(`${at}.questions must be an array`);
      return;
    }
    p.questions.forEach((q, j) => {
      if (!Array.isArray(q.answers)) {
        errors.push(`${at}.questions[${j}].answers must be an array`);
        return;
      }
      q.answers.forEach((a, n) => {
        const ap = `${at}.questions[${j}].answers[${n}]`;
        if (typeof a.label !== "string" || !a.label.trim())
          errors.push(`${ap}.label missing`);
        if (!KINDS.includes(a.kind)) errors.push(`${ap}.kind invalid`);
        if (typeof a.value !== "number" || !Number.isFinite(a.value))
          errors.push(`${ap}.value must be a number`);
        if (!a.quote && !a.image)
          errors.push(`${ap} needs a quote or an image source`);
      });
    });
  });
  return errors;
};

/** Label fold for matching an extractor row to a reading row: case, quotes,
 *  dashes and the „Кандидат на" prefix are presentation, not identity. */
export const foldLabel = (label: string): string =>
  normalise(label)
    .replace(/["'„“”«»]/g, "")
    .replace(/^кандидат(?:ът)? на\s+/, "")
    .replace(/[-–—,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string): string[] => foldLabel(s).split(" ").filter(Boolean);

/** Same label, or one is a whole-token subset of the other („ГЕРБ" vs
 *  „ГЕРБ СДС" does NOT match — subset means every token of the shorter
 *  appears in the longer AND the shorter has ≥2 tokens, so a bare acronym
 *  never swallows a coalition). */
export const labelsMatch = (a: string, b: string): boolean => {
  const fa = foldLabel(a);
  const fb = foldLabel(b);
  if (fa === fb) return true;
  const [short, long] =
    tokens(a).length <= tokens(b).length
      ? [tokens(a), tokens(b)]
      : [tokens(b), tokens(a)];
  return short.length >= 2 && short.every((t) => long.includes(t));
};

/** Shares are published to one decimal; anything beyond rounding noise is a
 *  disagreement. */
export const SHARE_TOLERANCE = 0.05;

const detailLabel = (row: InboxDraft["details"][number]): string =>
  "candidateName_bg" in row ? row.candidateName_bg : row.nickName_bg;

const isNoneRow = (row: InboxDraft["details"][number]): boolean =>
  "candidateKey" in row
    ? row.candidateKey === "none"
    : /не подкрепям никого/i.test(row.nickName_bg);

/** A classification the extractor deliberately leaves open and the reader
 *  may supply. Numbers are never filled this way — only agreed. */
export type Fill =
  | { field: "genre"; value: PollGenre }
  | { field: "round"; questionId: string; value: 1 | 2 }
  | {
      field: "base";
      questionId: string;
      kind: PollBase["kind"];
      label: { bg: string; en: string };
      /** The reader's verbatim base text — review.ts grounds it in the
       *  capture before the fill is applied. */
      phrase: string | null;
    };

/** Refusals that are by design rather than a failed parse: the extractor
 *  never resolves methodology (it needs an English translation no quote can
 *  ground), and review.ts fills it from a grounded reader quote instead. */
const READER_FILLED_REFUSALS = new Set(["methodology"]);

export interface Comparison {
  agree: boolean;
  diffs: string[];
  /** Open classifications the reader supplies (applied only on agree). */
  fills: Fill[];
  /** The reading poll matched to the draft, when one was. */
  matched: ReadingPoll | null;
}

/**
 * Decide agreement. EVERY condition must hold, or the draft goes to a human:
 * the extractor refused nothing (methodology aside); the reading has exactly
 * one poll of the draft's race; fieldwork and sample match; and the two
 * answer sets are the same set with the same values. Genre, round and base
 * must match where the extractor resolved them; where it left them open
 * (`unclear` / `null` / `unknown`) the reader's value becomes a `Fill`.
 */
export const compareDraftToReading = (
  draft: InboxDraft,
  reading: AiReading,
  /** Parliamentary short-name → official-name table (party_aliases.ts). */
  aliases: ReadonlyMap<string, string[]> = new Map(),
): Comparison => {
  const sameAnswer = (extracted: string, read: string): boolean =>
    labelsMatch(extracted, read) ||
    (draft.race === "parliamentary" &&
      [extracted, read].some((short, i) => {
        const other = i === 0 ? read : extracted;
        const key = foldLabel(short);
        return [key, key.replace(/^(?:кп|пп|ппк)\s+/, "")].some((k) =>
          (aliases.get(k) ?? []).some((name) => labelsMatch(name, other)),
        );
      }));
  const diffs: string[] = [];
  const fills: Fill[] = [];
  const refusals = draft.refused.filter(
    (r) => !READER_FILLED_REFUSALS.has(r.field),
  );
  if (refusals.length)
    diffs.push(`extractor refused: ${refusals.map((r) => r.field).join(", ")}`);
  if (reading.notAPoll)
    diffs.push(`reader says not a poll: ${reading.notAPoll}`);
  const candidates = reading.polls.filter((p) => p.race === draft.race);
  if (candidates.length !== 1) {
    diffs.push(
      `reader found ${candidates.length} ${draft.race} poll(s) in the publication`,
    );
    return { agree: false, diffs, fills, matched: null };
  }
  const read = candidates[0];
  const prov = draft.poll.provenance;

  if (prov?.sha256 && prov.sha256 !== reading.captureSha256)
    diffs.push("reading is of a different capture version");
  if ((prov?.fieldworkStart ?? null) !== read.fieldworkStart)
    diffs.push(
      `fieldwork start: extractor ${prov?.fieldworkStart ?? "—"} vs reader ${read.fieldworkStart ?? "—"}`,
    );
  if ((prov?.fieldworkEnd ?? null) !== read.fieldworkEnd)
    diffs.push(
      `fieldwork end: extractor ${prov?.fieldworkEnd ?? "—"} vs reader ${read.fieldworkEnd ?? "—"}`,
    );
  if ((draft.poll.respondents ?? null) !== read.respondents)
    diffs.push(
      `sample: extractor ${draft.poll.respondents ?? "—"} vs reader ${read.respondents ?? "—"}`,
    );
  if (read.genre === "unclear") diffs.push("reader finds the genre unclear");
  else if (draft.genre === "unclear")
    fills.push({ field: "genre", value: read.genre });
  else if (draft.genre !== read.genre)
    diffs.push(`genre: extractor ${draft.genre} vs reader ${read.genre}`);

  // The draft's questions (presidential always; parliamentary may have none —
  // then its details are one vote-intention set).
  const draftQuestions = draft.poll.questions ?? [];
  const groups: {
    id: string | undefined;
    measure: PollMeasure;
    round: 1 | 2 | null;
    baseKind?: PollBase["kind"];
  }[] = draftQuestions.length
    ? draftQuestions
        .filter((q) => q.measure !== "participation")
        .map((q) => ({
          id: q.id,
          measure: q.measure,
          round: q.round,
          baseKind: q.base.kind,
        }))
    : [{ id: undefined, measure: "vote_intention", round: 1 }];
  const readQuestions = read.questions.filter(
    (q) => q.measure !== "participation",
  );
  // Fail closed on every published shape this comparison does not cover.
  if (draft.race === "presidential" && draft.runoffs.length)
    diffs.push(`${draft.runoffs.length} runoff(s) are not compared`);
  for (const q of draftQuestions.filter((x) => x.measure === "participation"))
    if (
      q.observations?.length ||
      draft.details.some((d) => d.questionId === q.id)
    )
      diffs.push(`participation question „${q.id}" is not compared`);
  const groupIds = new Set(groups.map((g) => g.id));
  if (!groupIds.has(undefined)) {
    const stray = draft.details.filter((d) => !groupIds.has(d.questionId));
    if (stray.length)
      diffs.push(`${stray.length} row(s) belong to no compared question`);
  }
  if (readQuestions.length !== groups.length)
    diffs.push(
      `questions: extractor ${groups.length} vs reader ${readQuestions.length}`,
    );

  for (const group of groups) {
    // An open round matches the reader's only question of that measure.
    const sameMeasure = readQuestions.filter(
      (q) => q.measure === group.measure,
    );
    const rq =
      group.round === null
        ? sameMeasure.length === 1
          ? sameMeasure[0]
          : undefined
        : sameMeasure.find((q) => q.round === group.round);
    const label = `${group.measure}${group.round ? ` r${group.round}` : ""}`;
    if (!rq) {
      diffs.push(`${label}: reader has no such question`);
      continue;
    }
    if (group.round === null && group.id !== undefined) {
      if (rq.round === null) diffs.push(`${label}: round unresolved by both`);
      else
        fills.push({ field: "round", questionId: group.id, value: rq.round });
    }
    if (group.baseKind === "unknown" && group.id !== undefined) {
      if (rq.baseKind === "unknown" || !rq.baseLabel)
        diffs.push(`${label}: base unresolved by both`);
      else
        fills.push({
          field: "base",
          questionId: group.id,
          kind: rq.baseKind,
          label: rq.baseLabel,
          phrase: rq.basePhrase,
        });
    } else if (group.baseKind && group.baseKind !== rq.baseKind)
      diffs.push(
        `${label} base: extractor ${group.baseKind} vs reader ${rq.baseKind}`,
      );

    const rows = draft.details.filter((d) =>
      group.id === undefined ? true : d.questionId === group.id,
    );
    // Presidential residuals live on the question; parliamentary on the draft.
    const residual =
      draftQuestions.find((q) => q.id === group.id)?.residual ?? draft.residual;
    // A reader „Други" is compared against `otherNamedMinor` when the
    // extractor recorded one; otherwise, on a presidential draft, against a
    // details row („Друг" placeholder). A parliamentary „Други" with no
    // otherNamedMinor is not compared: the corpus stores named parties only.
    const otherAsResidual = residual?.otherNamedMinor != null;
    const otherIsDetail = draft.race === "presidential" && !otherAsResidual;
    const readRows = rq.answers.filter(
      (a) =>
        a.kind === "choice" ||
        a.kind === "none" ||
        (a.kind === "other" && otherIsDetail),
    );

    // Pair rows in two passes so a subset label can never steal the row
    // another answer matches exactly: exact folded labels (and „none")
    // first, then subset/alias matches over the leftovers — refusing a row
    // that could pair with more than one reader answer.
    const pairs = new Map<number, number>();
    const used = new Set<number>();
    rows.forEach((row, r) => {
      const name = foldLabel(detailLabel(row));
      const idx = readRows.findIndex(
        (a, i) =>
          !used.has(i) &&
          (isNoneRow(row) ? a.kind === "none" : foldLabel(a.label) === name),
      );
      if (idx >= 0) {
        pairs.set(r, idx);
        used.add(idx);
      }
    });
    rows.forEach((row, r) => {
      if (pairs.has(r) || isNoneRow(row)) return;
      const options = readRows.flatMap((a, i) =>
        !used.has(i) && sameAnswer(detailLabel(row), a.label) ? [i] : [],
      );
      if (options.length > 1)
        diffs.push(
          `${label}: „${detailLabel(row)}" matches ${options.length} reader answers`,
        );
      else if (options.length === 1) {
        pairs.set(r, options[0]);
        used.add(options[0]);
      }
    });
    rows.forEach((row, r) => {
      const name = detailLabel(row);
      const idx = pairs.get(r);
      if (idx === undefined) {
        diffs.push(
          `${label}: „${name}" ${row.support} — reader has no such answer`,
        );
        return;
      }
      if (Math.abs(readRows[idx].value - row.support) > SHARE_TOLERANCE)
        diffs.push(
          `${label}: „${name}" extractor ${row.support} vs reader ${readRows[idx].value}`,
        );
    });
    readRows.forEach((a, i) => {
      if (!used.has(i))
        diffs.push(
          `${label}: reader has „${a.label}" ${a.value} — extractor does not`,
        );
    });

    // Residuals, both directions: a value only one side states is a diff.
    const residualRead: [
      ReadingAnswerKind,
      keyof NonNullable<typeof residual>,
    ][] = [
      ["undecided", "undecided"],
      ["wont_vote", "wontVote"],
      ["wont_say", "wontSay"],
      ...(otherAsResidual
        ? [
            ["other", "otherNamedMinor"] as [
              ReadingAnswerKind,
              "otherNamedMinor",
            ],
          ]
        : []),
    ];
    for (const [kind, field] of residualRead) {
      const answers = rq.answers.filter((a) => a.kind === kind);
      if (answers.length > 1) {
        diffs.push(`${label}: reader has ${answers.length} „${kind}" answers`);
        continue;
      }
      const read = answers[0]?.value ?? null;
      const have = residual ? (residual[field] as number | null) : null;
      if (read === null && have === null) continue;
      if (
        read === null ||
        have === null ||
        Math.abs(have - read) > SHARE_TOLERANCE
      )
        diffs.push(
          `${label}: ${kind} extractor ${have ?? "—"} vs reader ${read ?? "—"}`,
        );
    }
  }
  return { agree: diffs.length === 0, diffs, fills, matched: read };
};
