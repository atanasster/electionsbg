// The /parliament hub's per-NS feed shard — the wire line, the lead, the news rail and the
// session strip's outcome split.
//
// Separate from useParliamentHubStats because the two have different shapes of cost: the
// stats blob is ~6 KB for all nine parliaments and every visitor needs it, while this one
// carries Bulgarian bill titles and is fetched only for the parliament on screen. React
// Query runs both in parallel, so the split costs no latency.

import { useQuery } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import type { FeedTarget, HubFeedFile } from "./hubFeedTypes";

export type {
  FeedTarget,
  FeedKind,
  FeedItem,
  HubLead,
  StripDay,
  HubWire,
  HubFeedFile,
} from "./hubFeedTypes";

/** The one place a FeedTarget becomes a URL.
 *
 *  The generator ships discriminators rather than hrefs on purpose: /candidate/mp-<id> is
 *  candidateSlug.ts's rule, and a second copy of it in scripts/ would keep emitting the old
 *  shape after the rule moved, green on both sides. */
export const feedHref = (target: FeedTarget): string => {
  switch (target.kind) {
    case "session":
      // #absent when the card is the absence aggregate: the card states a count, and the
      // section it anchors is the only place that names the people in it. Landing on the
      // top of a 219-item agenda instead is how a reader concludes we do not have it.
      return target.anchor
        ? `/votes/${target.date}#${target.anchor}`
        : `/votes/${target.date}`;
    case "item":
      return `/votes/${target.date}/${target.slug}`;
    case "mp":
      return candidateUrlForMp(target.mpId);
  }
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string]>): Promise<
  HubFeedFile | undefined
> => {
  const r = await fetch(
    dataUrl(`/parliament/votes/derived/hub_feed/${queryKey[2]}.json`),
  );
  // 404 is an ANSWER — four of the thirteen elections in the picker map to a parliament
  // that published no roll-call votes at all.
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`hub-feed fetch failed: ${r.status}`);
  return r.json();
};

export const useParliamentHubFeed = (): {
  feed: HubFeedFile | undefined;
  isLoading: boolean;
} => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  const { data, isLoading } = useQuery({
    queryKey: ["parliament", "hub-feed", ns ?? ""] as [string, string, string],
    queryFn,
    enabled: !!ns,
    staleTime: Infinity,
  });
  return { feed: data, isLoading: !!ns && isLoading };
};
