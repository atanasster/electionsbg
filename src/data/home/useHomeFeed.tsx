// The home page's „what changed" feed.
//
// A SECOND, independent request from the stats blob, deliberately: a feed outage must not
// blank the pulse, and a stats outage must not blank the feed. They share nothing but the
// page they land on.
//
// ⚠️ GCS, like the stats — see `useHomeHubStats` for why nothing on the entry page may
// depend on Cloud SQL being warm.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { HomeFeedV1 } from "./homeTypes";

export const HOME_FEED_STALE_MS = 30 * 60 * 1000;

const queryFn = async (): Promise<HomeFeedV1 | null> => {
  const r = await fetch(dataUrl("/home/feed.json"));
  if (!r.ok) return null;
  return (await r.json()) as HomeFeedV1;
};

export const useHomeFeed = (): {
  feed: HomeFeedV1 | undefined;
  settled: boolean;
} => {
  const { data, isFetched } = useQuery({
    queryKey: ["home", "feed"] as const,
    queryFn,
    staleTime: HOME_FEED_STALE_MS,
    // As on the stats hook: the app-wide client disables every refetch trigger, so a stale
    // time alone would leave an open tab on the first payload it ever received.
    refetchOnWindowFocus: true,
  });
  return { feed: data ?? undefined, settled: isFetched };
};
