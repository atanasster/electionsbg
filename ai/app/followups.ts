// Clickable follow-ups carry catalog identities; translations cannot change the
// selected capability. Entity-specific continuations are added separately.
import { STARTERS } from "./starters";
import type { Envelope } from "../tools/types";
import type { Suggestion } from "./suggestions";

export type FollowUp = Suggestion;

export const followUps = (env: Envelope): FollowUp[] => {
  const source = STARTERS.find((s) => s.tool === env.tool);
  if (!source || env.clarify) return [];
  return STARTERS.filter(
    (s) =>
      s.tool !== env.tool &&
      s.category === source.category &&
      s.subcategory === source.subcategory,
  )
    .slice(0, 3)
    .map((s) => ({ questionId: s.id, bg: s.bg, en: s.en }));
};
