// The /governance finder's sources — pure data, no JSX.
//
// /governance is a HUB OF HUBS: 21 of its 23 tiles point at another hub. So a reader who
// already knows the subject they want („Желязков", „Пътища", „АПИ") has to guess which of
// five bands contains the hub that contains it — two levels of guessing before they can
// type. This box is the way past both.
//
// THREE GROUPS, TWO ROUTES, ONE REQUEST EACH PER KEYSTROKE. `person-search` answers the
// people group; `procurement-search` answers institutions AND companies — and a naive
// second source would issue that call TWICE per keystroke for the same needle, which is the
// duplicated-request defect declarationsSearch.ts records under its removed "officials"
// group. `sharedProcurementSearch` below is the one-line fix: both sources await the SAME
// in-flight promise.
//
// ⚠️ THE SHARED REQUEST NOW LIVES IN `@/screens/components/search/procurementSearchSource`,
// because the global home offers the same two groups and a second private copy would put the
// duplicate back — one per hub instead of one per group.
//
// SCOPE RANKS, IT NEVER FILTERS — the hub-level rule. There is no scope on this page to
// filter by, but the same instinct applies to the money: an institution with no contracts
// is still the right answer to somebody typing its name, so nothing here is gated on
// having a figure.

import type { HubSearchSource } from "@/ux/search/hubSearchSources";
import {
  fetchProcurementAwarders,
  fetchProcurementCompanies,
} from "@/screens/components/search/procurementSearchSource";
import {
  fetchPublicPeople,
  personAltQuery,
} from "@/screens/components/search/personSearchSource";

export const governanceSearchSources = (bg: boolean): HubSearchSource[] => [
  {
    id: "people",
    label: { bg: "Хора", en: "People" },
    limit: 5,
    kind: "server",
    fetch: (q, s) => fetchPublicPeople(q, s, bg),
    // VERIFIED destination: /persons reads ?q (useUrlPersonFilters). `altQuery` because the
    // browse table runs its own search WITHOUT the shliokavitsa rewrite, so a link built
    // from what was typed advertises rows the destination cannot find.
    seeAll: (q) => ({
      label: bg ? "Виж всички хора" : "See all people",
      to: `/persons?q=${encodeURIComponent(personAltQuery(q))}`,
    }),
  },
  {
    id: "awarders",
    label: { bg: "Институции", en: "Institutions" },
    limit: 4,
    kind: "server",
    fetch: fetchProcurementAwarders,
    // No see-all: there is no awarders browse page that reads ?q, and a link advertising a
    // filtered destination that delivers an unfiltered one is worse than none (§4).
  },
  {
    id: "companies",
    label: { bg: "Фирми", en: "Companies" },
    limit: 4,
    kind: "server",
    fetch: fetchProcurementCompanies,
    seeAll: (q) => ({
      label: bg ? "Виж всички фирми" : "See all companies",
      // ?pscope=all: the browse table defaults to the selected parliament's window, so a
      // company whose contracts predate it would land on zero rows.
      to: `/procurement/contractors?q=${encodeURIComponent(q)}&pscope=all`,
    }),
  },
];
