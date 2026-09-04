// The order articles are PLACED in, shared by both candidate surfaces.
//
// `SectionArticlesProvider` assigns each article to the FIRST topic it matches in this list,
// so the order decides which section an article tagged both `votes` and `geography` appears
// under. One definition because an article's placement must not depend on which URL a reader
// arrived by — /candidate/:id and /person/:slug describe the same human, and the whole point
// of docs/plans/person-candidate-display-unification-v1.md is that they agree.

import type { DashboardSectionId } from "@/data/articles/useArticles";

export const SECTION_TOPICS: readonly DashboardSectionId[] = [
  "votes",
  "geography",
  "financing",
];
