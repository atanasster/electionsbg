// Polls — Маркет ЛИНКС (marketlinks.bg). Thin wiring only: the
// monotonic-fingerprint logic (high-water mark, first-run backlog) lives once
// in `makeAgencyPollsWatcher` — see scripts/polls/lib/watcher.test.ts for that
// behaviour. Maps to `update-polls` (decision 2).
// docs/plans/polls-agency-watchers-v1.md §6.1.

import { makeAgencyPollsWatcher } from "../../polls/lib/watcher";
import { marketLinks } from "../../polls/agencies/market_links";

export const pollsMarketLinks = makeAgencyPollsWatcher({
  id: "polls_market_links",
  label: "Polls — Маркет ЛИНКС",
  url: "https://www.marketlinks.bg",
  lister: marketLinks,
});
