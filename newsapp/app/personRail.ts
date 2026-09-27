// The person rail's rules, apart from its markup (news-person-sentiment-v1 §5).
//
// ⚠️ ONE ROW PER IDENTITY. The build's merge already folds two spellings of
// one person into one subject; this keeps that true on the page even for a
// bundle built before the merge existed, because the same person twice on
// one rail reads as two people.

import type {
  JevArticleSentiment,
  JevScore,
  JevSubject,
  PersonBaselines,
  PersonIdentity,
  ToneBucket,
} from "./data";
import { bucketOf } from "./jevBucket";
import { bucketLabel, TONE_BUCKET_ORDER } from "./sentimentScale";

export type PlacedScore = JevScore & {
  normalized: number;
  levels: number;
  value: number;
};

export const placed = (s: JevScore | undefined | null): s is PlacedScore =>
  !!s &&
  typeof s.value === "number" &&
  Number.isFinite(s.value) &&
  typeof s.normalized === "number" &&
  Number.isFinite(s.normalized) &&
  typeof s.levels === "number" &&
  Number.isInteger(s.levels) &&
  s.levels >= 2;

export interface RailRow {
  subject: JevSubject;
  identity: PersonIdentity | null;
  tone: PlacedScore | null;
  bucket: ToneBucket | null;
}

export interface RailGroups {
  /** Identified people, then people with no profile — each with a tone. */
  rows: RailRow[];
  /** Named but not tied to anyone: the name matches several public figures. */
  unresolved: JevSubject[];
  /** Named in passing: no tone was asked for. */
  passing: JevSubject[];
  /** A primary or secondary subject whose score did not arrive. */
  unrated: JevSubject[];
}

const ROLE_RANK: Record<string, number> = { primary: 0, secondary: 1 };

/**
 * A refusal the rail explains as AMBIGUITY („matches several public figures")
 * rather than showing a row: the name may belong to someone we know, so a
 * profile-less row would be a false „nobody".
 */
const AMBIGUOUS = new Set([
  "ambiguous",
  "surname_clash",
  "context_required",
  "cue_required",
  "identity_refused",
]);

export const groupPeople = (subjects: JevSubject[]): RailGroups => {
  const out: RailGroups = {
    rows: [],
    unresolved: [],
    passing: [],
    unrated: [],
  };
  const seen = new Set<string>();
  const people = subjects.filter((s) => s.kind === "person");
  for (const s of people) {
    const identity = s.identity ?? null;
    const key = identity ? `${identity.kind}:${identity.id}` : null;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (s.subject_role === "incidental") {
      out.passing.push(s);
      continue;
    }
    if (!identity && s.refused_reason && AMBIGUOUS.has(s.refused_reason)) {
      out.unresolved.push(s);
      continue;
    }
    if (!placed(s.tone)) {
      out.unrated.push(s);
      continue;
    }
    out.rows.push({
      subject: s,
      identity,
      tone: s.tone,
      bucket: bucketOf(s.tone, TONE_BUCKET_ORDER) as ToneBucket,
    });
  }
  // Identified before profile-less; then the article's main subject first;
  // then the most-mentioned.
  out.rows.sort(
    (a, b) =>
      Number(!a.identity) - Number(!b.identity) ||
      (ROLE_RANK[a.subject.subject_role ?? ""] ?? 2) -
        (ROLE_RANK[b.subject.subject_role ?? ""] ?? 2) ||
      (b.subject.mentions ?? 0) - (a.subject.mentions ?? 0),
  );
  return out;
};

/**
 * Did THIS article's pair enter the person's baseline? The build counts an
 * assessed pair: an eligible role, a placeable score on the full text, not a
 * conflict. Only then does the rail subtract it.
 */
export const countedInBaseline = (
  row: RailRow,
  jev: Extract<JevArticleSentiment, { withheld?: undefined }>,
): boolean =>
  !!row.tone &&
  typeof row.tone.bucket_index === "number" &&
  (row.subject.subject_role === "primary" ||
    row.subject.subject_role === "secondary") &&
  !row.subject.conflict &&
  (jev.text_scope?.kind ?? "full") === "full";

export interface Baseline {
  n: number;
  bucket: ToneBucket;
}

/**
 * How the person is covered in OTHER articles: the baseline minus this one.
 * Null when the person has no page (no baseline is published) or when nothing
 * is left after removing this article.
 */
export const baselineFor = (
  row: RailRow,
  jev: Extract<JevArticleSentiment, { withheld?: undefined }>,
  baselines: PersonBaselines | null | undefined,
): Baseline | null => {
  if (!row.identity || !baselines) return null;
  const b = baselines.persons?.[row.identity.id];
  if (
    !b ||
    typeof b.sum !== "number" ||
    !Number.isFinite(b.sum) ||
    typeof b.levels !== "number"
  )
    return null;
  // ⚠️ During an election freeze (§8.2) the baseline is the pre-window
  // snapshot: an article scored after it was never in the sum, so there is
  // nothing of it to subtract.
  const inSnapshot =
    !baselines.frozen ||
    (!!jev.assessed_at &&
      Date.parse(jev.assessed_at) <= Date.parse(baselines.frozen.as_of));
  const self =
    inSnapshot && countedInBaseline(row, jev) && row.tone
      ? row.tone.value
      : null;
  const n = self === null ? b.n : b.n - 1;
  const sum = self === null ? b.sum : b.sum - self;
  if (n < 1) return null;
  // ⚠️ THE SCALE THE VALUES CAME FROM, never the vocabulary's length —
  // `bucketLabel`'s own warning.
  return { n, bucket: bucketLabel(sum / n, b.levels, TONE_BUCKET_ORDER) };
};

/**
 * Every spelling the rail accounts for — the chips and the news-person block
 * leave these out and keep everyone else the article names.
 */
export const railNames = (subjects: JevSubject[] | null | undefined) => {
  const out = new Set<string>();
  for (const s of subjects ?? []) {
    if (s.kind !== "person") continue;
    out.add(s.name);
    for (const m of s.merged_surfaces ?? []) out.add(m);
  }
  return out;
};

/** Whether a person has a news page — a published baseline IS a page. */
export const hasPage = (
  identity: PersonIdentity | null,
  baselines: PersonBaselines | null | undefined,
): boolean => !!identity && !!baselines?.persons?.[identity.id];
