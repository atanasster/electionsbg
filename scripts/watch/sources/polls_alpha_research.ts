// Polls — Алфа Рисърч (alpharesearch.bg). Thin wiring only: the
// monotonic-fingerprint logic (high-water mark, first-run backlog) lives once
// in `makeAgencyPollsWatcher` — see scripts/polls/lib/watcher.test.ts for that
// behaviour. Maps to `update-polls` (decision 2).
// docs/plans/polls-agency-watchers-v1.md §6.1.

import { makeAgencyPollsWatcher } from "../../polls/lib/watcher";
import { alphaResearch } from "../../polls/agencies/alpha_research";

export const pollsAlphaResearch = makeAgencyPollsWatcher({
  id: "polls_alpha_research",
  label: "Polls — Алфа Рисърч",
  url: "https://alpharesearch.bg",
  lister: alphaResearch,
});
