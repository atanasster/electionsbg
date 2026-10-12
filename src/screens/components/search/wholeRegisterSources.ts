// The two WHOLE-REGISTER groups a sector hub's finder carries beside its own
// sector-scoped index: contractors and contracts, from the shared
// `procurement-search` route. Pure data, no JSX. Shared by the roads and water
// hubs (and the next one) so the rules below live once:
//
//   · ONE memoised request per needle serves both groups (dashboard-hub §4).
//   · The route takes no sector argument, so both labels SAY they search the
//     whole register — a group that cannot be scoped is labelled, never
//     presented as scoped.
//   · See-all goes to the SAME set the group searched: a ?sector=… see-all would
//     drop the out-of-sector rows the preview just showed.

import { Briefcase, Receipt } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import { seeAllAbove, type ServerSource } from "@/ux/search/hubSearchSources";
import {
  companyItems,
  contractItems,
  sharedProcurementSearch,
} from "./procurementSearchSource";

const QUOTA = 5;

export const wholeRegisterSources = (bg: boolean): ServerSource[] => [
  {
    kind: "server",
    id: "contractors",
    label: {
      bg: "Изпълнители — в целия регистър",
      en: "Contractors — across the whole register",
    },
    icon: Briefcase,
    limit: QUOTA,
    fetch: async (q: string, signal: AbortSignal): Promise<SearchItem[]> =>
      companyItems(await sharedProcurementSearch(q, signal), bg).slice(
        0,
        QUOTA,
      ),
  },
  {
    kind: "server",
    id: "contracts",
    label: {
      bg: "Договори — в целия регистър",
      en: "Contracts — across the whole register",
    },
    icon: Receipt,
    limit: QUOTA,
    fetch: async (q: string, signal: AbortSignal): Promise<SearchItem[]> =>
      contractItems(await sharedProcurementSearch(q, signal)).slice(0, QUOTA),
    seeAll: seeAllAbove(
      bg ? "Всички договори" : "All contracts",
      (q) => `/procurement/contracts?pscope=all&q=${encodeURIComponent(q)}`,
    ),
  },
];
