// The hub_feed/<ns>.json contract — ONE declaration, imported by both the generator that
// writes the shard and the hook that reads it.
//
// It lived in two hand-copied halves for exactly one review cycle, and in that cycle they had
// already drifted on the single field whose nullability the generator spends nine lines
// explaining: `HubWire.attendance` was `number | null` in scripts/ and `number` in src/, while
// hub_feed/49.json shipped a null. Nothing broke, because the one consumer happened to guard —
// but the compiler had stopped watching, and the next consumer to write `attendance.toFixed(0)`
// would have type-checked and thrown on the 49th parliament.
//
// It lives on the src/ side because that is the side with the stricter compiler settings, and
// because scripts/parliament/derived/index.ts already imports `mostDivergentPairSlug` and
// `NS_TERM_START` across the same boundary.

/** Where a feed item points. Resolved to an href in the SPA (`feedHref`), never in the
 *  generator: /candidate/mp-<id> is candidateSlug.ts's rule, and a second copy of it in
 *  scripts/ would keep emitting the old shape after the rule moved, green on both sides. */
export type FeedTarget =
  | { kind: "session"; date: string }
  | { kind: "item"; date: string; slug: string }
  | { kind: "mp"; mpId: number };

export type FeedKind = "session" | "bill" | "dissent" | "absence";

export interface FeedItem {
  id: string;
  /** The EVENT's own date, always present. §4.1 makes this unconditional rather than
   *  recess-only: a date that appears in some states and not others is exactly the
   *  conditional presentation this page's audits kept finding defects in. */
  at: string;
  kind: FeedKind;
  /** Source text — a bill title or an MP's name. May be "" when the corpus has no title for
   *  the day, in which case the card composes one from `stats`. */
  title: string;
  /** Party short name, where the source carries one. Source text, not a status label. */
  badge?: string;
  /** Per-kind numbers. The card formats them under an i18n key chosen by `kind`; the shard
   *  itself carries no glue prose, so the English hub is not a Bulgarian one with English
   *  headings. Keys are documented at each builder in hub_feed.ts. */
  stats: Record<string, number>;
  target: FeedTarget;
}

export interface HubLead extends FeedItem {
  /** Which reading the item belongs to. The corpus has NO adoption marker (§4.2), so the card
   *  names the STAGE and prints the tally; it never says „приет".
   *
   *  MEASURED 2026-08-06: all nine parliaments' automatic leads are `other`, because
   *  importanceScore ranks a confidence vote, a cabinet election and a constitutional
   *  resolution above any reading — and those are решения, not bills. The `second`/`first`
   *  branches exist for a CURATED lead (leads.json can name a budget article vote) and are
   *  correct rather than dead, but nothing on today's data exercises them. */
  stage: "second" | "first" | "other";
  source: "auto" | "curated";
}

export interface StripDay {
  date: string;
  /** Post-dedupe items voted that day — the same basis as every other number on the hub. */
  items: number;
  yes: number;
  no: number;
  abstain: number;
}

export interface HubWire {
  /** The last plenary day. The SPA compares it to the reader's today rather than trusting a
   *  build-time "days in recess", so the line is right on a page cached for a week. */
  date: string;
  items: number;
  /** Distinct second-reading BILLS voted that day, not article votes. */
  bills: number;
  /** Weighted attendance for that day: cast / (cast + absent).
   *
   *  NULL when the day recorded no cast votes at all — which happens: the 49th's final sitting
   *  holds two items and zero casts. Emitting 0 there would have the wire assert „0%
   *  присъствие", i.e. that the chamber was empty, when what the corpus says is that it has no
   *  roll call for those items. A figure that cannot be derived is absent, not zero. */
  attendance: number | null;
}

export interface HubFeedFile {
  computedAt: string;
  ns: string;
  wire: HubWire | null;
  lead: HubLead | null;
  feed: Record<"sessions" | "bills" | "dissents" | "absences", FeedItem[]>;
  /** Recent sittings with their outcome split — the strip's v2 source (§4.1). */
  strip: StripDay[];
}
