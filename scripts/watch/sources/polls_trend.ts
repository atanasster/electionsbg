// Polls — Тренд (rctrend.bg). Thin wiring only: the monotonic-fingerprint
// logic (high-water mark, first-run backlog) lives once in
// `makeAgencyPollsWatcher` — see scripts/polls/lib/watcher.test.ts for that
// behaviour. Maps to `update-polls` (decision 2).
// docs/plans/polls-agency-watchers-v1.md §6.1.

import { makeAgencyPollsWatcher } from "../../polls/lib/watcher";
import { trend } from "../../polls/agencies/trend";

export const pollsTrend = makeAgencyPollsWatcher({
  id: "polls_trend",
  label: "Polls — Тренд (rctrend.bg)",
  url: "https://rctrend.bg",
  lister: trend,
});
