// T5.2 — the ONE rule for what a story's assessed coverage licenses a page or
// a card to say about an axis, as an explicit state table:
//
//   none            zero members carry a positioned label on this axis
//   single_source   every positioned label comes from ONE outlet
//   uniform         ≥2 outlets, all on the same label — matching framing
//   distribution    ≥2 outlets and ≥2 labels — a real spread to draw
//
// ⚠️ TWO RULES, NOT ONE. `StoryCard` used to count distinct LABELS, so two
// articles from one outlet with different labels passed as „framing differs"
// — a claim about named outlets that one outlet cannot make. The unit here is
// the OUTLET: a story is a comparison between publications, and a bar segment
// still counts ARTICLES (the page says so beside it). `not_applicable` is not
// a position on either count — it is the majority verdict in this corpus and
// gating on it would make every story „uniform" by default.
//
// Matching framing is not agreement on facts.

import { isScopedObservation, type StoryMember } from "./data";

export type DivergenceState =
  | "none"
  | "single_source"
  | "uniform"
  | "distribution";

export interface AxisDivergence {
  state: DivergenceState;
  /**
   * Distinct outlets holding a POSITIONED label on this axis. ⚠️ Not
   * `AxisCompleteness.outlets`, which counts outlets with ANY verdict,
   * `not_applicable` included — the two figures differ by design.
   */
  positionedOutlets: number;
  /** Distinct positioned labels on this axis. */
  labels: number;
  /** Members holding a positioned label. */
  articles: number;
}

/** A label is positioned iff it is present and not `not_applicable`. */
export const isPositioned = (label: string | null | undefined): boolean =>
  Boolean(label) && label !== "not_applicable";

export const divergenceState = ({
  labels,
  outlets,
}: {
  labels: number;
  outlets: number;
}): DivergenceState =>
  outlets === 0 || labels === 0
    ? "none"
    : outlets === 1
      ? "single_source"
      : labels >= 2
        ? "distribution"
        : "uniform";

/** From the members themselves — the story page's basis. */
export const axisDivergence = (
  members: StoryMember[],
  value: (member: StoryMember) => string | null | undefined,
): AxisDivergence => {
  const outlets = new Set<string>();
  const labels = new Set<string>();
  let articles = 0;
  for (const member of members) {
    // T4.1c — a scoped observation is not a position.
    if (isScopedObservation(member)) continue;
    const label = value(member);
    if (!isPositioned(label)) continue;
    articles += 1;
    outlets.add(member.domain);
    labels.add(label as string);
  }
  return {
    state: divergenceState({ labels: labels.size, outlets: outlets.size }),
    positionedOutlets: outlets.size,
    labels: labels.size,
    articles,
  };
};

/**
 * From a card's aggregates — label counts plus the build's per-axis distinct
 * positioned-outlet count. ⚠️ A bundle built before that count existed has
 * `outlets` undefined; the card then cannot tell one outlet from two and
 * must NOT claim a difference — it degrades to `single_source`-or-`none`,
 * never to the old label rule, so the page and the card can disagree only
 * in the direction of the card saying less.
 */
export const aggregateDivergence = (
  counts: Record<string, number | undefined>,
  outlets: number | undefined,
): AxisDivergence => {
  let labels = 0;
  let articles = 0;
  for (const [label, count] of Object.entries(counts)) {
    if (!isPositioned(label) || !(count && count > 0)) continue;
    labels += 1;
    articles += count;
  }
  const known = outlets ?? (articles > 0 ? 1 : 0);
  return {
    state: divergenceState({ labels, outlets: known }),
    positionedOutlets: known,
    labels,
    articles,
  };
};
