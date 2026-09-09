// Polls — Сова Харис (sovaharris.com). Thin wiring only: the
// monotonic-fingerprint logic (high-water mark, first-run backlog) lives once
// in `makeAgencyPollsWatcher` — see scripts/polls/lib/watcher.test.ts for that
// behaviour. Maps to `update-polls` (decision 2).
// docs/plans/polls-agency-watchers-v1.md §6.1.

import { makeAgencyPollsWatcher } from "../../polls/lib/watcher";
import { sovaHarris } from "../../polls/agencies/sova_harris";

export const pollsSovaHarris = makeAgencyPollsWatcher({
  id: "polls_sova_harris",
  label: "Polls — Сова Харис",
  url: "https://sovaharris.com",
  lister: sovaHarris,
});
