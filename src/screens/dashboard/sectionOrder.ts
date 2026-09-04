// The order deeper sections appear in, declared once (§Phase 7 item 4).
//
// ⚠ IT WAS SEVEN HAND-WRITTEN LISTS THAT HAPPENED TO AGREE. Every `*DashboardCards.tsx` carries
// its own `SECTION_TOPICS` AND its own sequence of `<DashboardSection>` elements — two
// independent orderings per file, times seven files, with nothing comparing any of them. They
// were consistent on 2026-09-04 by coincidence, not by construction, and the failure mode is
// invisible: a reader who learns the shape of one place page finds the next one arranged
// differently, and no test says a word.
//
// ⚠ THE SEQUENCE IS §Phase 7 ITEM 4's, NOT THE ONE THAT WAS THERE. It asks for
// "Outcome detail → Geography → Comparison/history → People/representation → Review signals →
// Data/method", and the pages had review signals THIRD — „Аномалии" and „Рискови гласове" ahead
// of everything about who was elected or how the campaign was funded. A page leads with what a
// reader came for; review flags are what to check afterwards.
//
// Each id's slot is recorded with WHY, because two of the assignments are judgements rather than
// readings and a later reader deserves the argument rather than the result:

import type { DashboardSectionId } from "@/data/articles/useArticles";

export type SectionSlot =
  | "outcome"
  | "geography"
  | "comparison"
  | "people"
  | "review"
  | "method";

/** ⚠ NOT EVERY ID IS PLACED — only the ones the place pages actually render. `procurement`,
 *  `budget`, `history`, `parliament`, `governance` and `local_government` belong to other page
 *  families (party, candidate, governance) whose ordering §Phase 7 does not cover; giving them a
 *  slot here would assert an order nothing checks and no plan asked for. */
export const SECTION_SLOT: Partial<Record<DashboardSectionId, SectionSlot>> = {
  // „Гласове и депутати" — the result the reader came for.
  votes: "outcome",
  // „География" — where it happened.
  geography: "geography",
  // ⚠ A JUDGEMENT. „Социологически агенции" is what the polls said against what the vote did,
  // which is the comparison slot's whole subject. It is not history, and §Phase 7 pairs the two.
  polling: "comparison",
  // „Финансиране на кампаниите" — who paid for the representation.
  financing: "people",
  // „Декларации на депутати" — what the elected declared.
  declarations: "people",
  // „Аномалии" and „Рискови гласове" are BOTH review signals, which is why the old third and
  // fourth positions were one slot wearing two hats.
  anomalies: "review",
  neighborhoods: "review",
};

/** The FAQ block on the abroad region page. Not a `DashboardSectionId` — it is a `<
 *  DashboardSection>` with a literal id — but it renders in the same column and so has to be
 *  placed, or "consistent order" stops at the one page that has it.
 *  ⚠ Data/method's ONLY owner today. Without it that slot would be empty, and an empty slot in a
 *  declared order invites the next person to drop anything into it. */
export const EXTRA_SECTION_SLOT: Record<string, SectionSlot> = {
  diaspora_faq: "method",
};

const SLOT_ORDER: readonly SectionSlot[] = [
  "outcome",
  "geography",
  "comparison",
  "people",
  "review",
  "method",
];

/** Where an id sits, or `null` for one this plan does not place. Ids sharing a slot keep the
 *  order they are listed in above — arbitrary between them, but fixed, so two pages carrying
 *  both cannot disagree. */
export const sectionRank = (id: string): number | null => {
  const slot = SECTION_SLOT[id as DashboardSectionId] ?? EXTRA_SECTION_SLOT[id];
  if (!slot) return null;
  const within = Object.keys({
    ...SECTION_SLOT,
    ...EXTRA_SECTION_SLOT,
  }).indexOf(id);
  return SLOT_ORDER.indexOf(slot) * 100 + within;
};

/** Sort a screen's section ids into the canonical order. Ids with no slot keep their relative
 *  position at the END rather than being dropped — a page must not lose a section because this
 *  module has not placed it. */
export const orderSections = <T extends string>(ids: readonly T[]): T[] =>
  [...ids].sort((a, b) => {
    const ra = sectionRank(a);
    const rb = sectionRank(b);
    if (ra === null && rb === null) return ids.indexOf(a) - ids.indexOf(b);
    if (ra === null) return 1;
    if (rb === null) return -1;
    return ra - rb;
  });
