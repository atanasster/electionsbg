// Polls — Глобал Метрикс (globalmetrics.eu). Thin wiring only: the
// monotonic-fingerprint logic (high-water mark, first-run backlog) lives once
// in `makeAgencyPollsWatcher` — see scripts/polls/lib/watcher.test.ts for that
// behaviour. Maps to `update-polls` (decision 2).
// docs/plans/polls-agency-watchers-v1.md §6.1.

import { makeAgencyPollsWatcher } from "../../polls/lib/watcher";
import { globalMetrics } from "../../polls/agencies/global_metrics";

export const pollsGlobalMetrics = makeAgencyPollsWatcher({
  id: "polls_global_metrics",
  label: "Polls — Глобал Метрикс",
  url: "https://globalmetrics.eu",
  lister: globalMetrics,
});
