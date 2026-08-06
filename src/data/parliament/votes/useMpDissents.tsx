import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpProfile } from "./useMpProfile";
import { useMpShard } from "./useMpShard";
import type { DissentEntry, DissentFile, DissentSlice } from "./types";

/** One dissent row as /api/db/mp-dissents returns it (135 mp_dissent). */
interface PgDissents {
  dissent_count: number;
  total_cast: number | null;
  rows: PgDissentRow[];
}

interface PgDissentRow {
  date: string;
  item_no: number;
  slug: string | null;
  title: string | null;
  topic: string | null;
  vote: string;
  party_vote: string;
  party: string | null;
  party_members: number;
}

/** 'y' | 'n' | 'a' as the matview stores it → the vote word the client type uses. */
const VOTE_WORD: Record<string, "yes" | "no" | "abstain"> = {
  y: "yes",
  n: "no",
  a: "abstain",
};

// PRIMARY source: the precompute. The two paths below it stay as fallbacks rather than
// being deleted, because the JSON tree is still what a build without a database reads —
// but the ordering matters far more than it looks. `dissents.json` is 31 MB and the
// aggregate branch fires whenever the per-MP shard is missing, which it is for 36 members
// today (24 of them in the 50th NS). Putting Postgres first means those pages stop paying
// it, and the aggregate is now reached only when BOTH the route and the shard fail.
const pgQueryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string, number];
}): Promise<PgDissents | null> => {
  const [, ns, mpId] = queryKey;
  const r = await fetch(
    `/api/db/mp-dissents?ns=${encodeURIComponent(ns)}&mp=${mpId}`,
  );
  if (!r.ok) return null;
  const body = (await r.json()) as PgDissents | null;
  return body && Array.isArray(body.rows) ? body : null;
};

const queryFn = async (): Promise<DissentFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/dissents.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

const pickSlice = (
  file: DissentFile | undefined,
  ns: string | null,
): DissentSlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

// Same two-step MP lookup as useMpLoyalty: prefer roster id, fall back to
// the CSV id resolved by name via the per-NS mpNames embedded in the
// rollcall index.
export const useMpDissents = (mpId?: number | null, name?: string | null) => {
  const { selected } = useElectionContext();

  // Fast-path: shard hit avoids the ~1.3 MB dissents aggregate fetch.
  // csvId, not mpId: parliament.bg recycles member ids across parliaments, so the roster
  // id is not necessarily this NS's id for this person. Keying the Postgres tier on the
  // roster id while it OUTRANKS the shard would serve another member's record for the 26
  // ids that name two people.
  const {
    shard,
    csvId,
    isLoading: shardLoading,
  } = useMpShard(mpId ?? undefined, name ?? undefined);

  const ns = electionToNsFolder(selected);

  // Tier 1 — the precompute. Only asked for when we already know which member, which is
  // the case on every candidate page; the aggregate branch below still serves the
  // whole-slice callers.
  const { data: pgRows, isLoading: pgLoading } = useQuery({
    queryKey: ["rollcall_dissents_pg", ns ?? "", csvId ?? 0] as [
      string,
      string,
      number,
    ],
    queryFn: pgQueryFn,
    staleTime: Infinity,
    enabled: Boolean(ns) && csvId != null,
  });
  const pgHit = pgRows != null && pgRows.rows.length > 0;

  const aggregateEnabled =
    !mpId && !name ? true : !pgHit && !pgLoading && !shard && !shardLoading;
  const { data, isLoading: aggregateLoading } = useQuery({
    queryKey: ["rollcall_dissents"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: aggregateEnabled,
  });

  const slice = pickSlice(data, ns);

  const { mpNames } = useMpProfile();

  const byMpId = useMemo(() => {
    const m = new Map<number, DissentEntry>();
    for (const e of slice?.entries ?? []) m.set(e.mpId, e);
    return m;
  }, [slice]);

  const fallbackCsvId = useMemo(() => {
    if (!name) return null;
    const target = name.toLocaleLowerCase("bg");
    for (const [idStr, mpName] of Object.entries(mpNames)) {
      if (mpName.toLocaleLowerCase("bg") === target) {
        const n = Number(idStr);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }, [name, mpNames]);

  const shardEntry: DissentEntry | undefined = shard
    ? {
        mpId: shard.mpId,
        partyShort: shard.partyShort,
        totalCast: shard.dissents.totalCast,
        dissentCount: shard.dissents.dissentCount,
        recent: shard.dissents.recent,
      }
    : undefined;

  const aggregateEntry =
    (mpId != null ? byMpId.get(mpId) : undefined) ??
    (fallbackCsvId != null ? byMpId.get(fallbackCsvId) : undefined);

  // The precompute answers with the member's dissent ROWS; the entry shape the consumers
  // expect is a count plus the most recent few, so it is assembled here rather than
  // changing every caller.
  const pgEntry: DissentEntry | undefined = pgHit
    ? {
        mpId: csvId!,
        partyShort: pgRows!.rows[0].party ?? "",
        // The denominator comes from mp_attendance via the route. A dissent-only view has
        // none of its own, and leaving it 0 rendered "31 / 0" in MpDissentsSection.
        totalCast: pgRows!.total_cast ?? 0,
        // The route's own COUNT, not rows.length — the row list is capped at 200 and the
        // largest real dissent count is 621.
        dissentCount: pgRows!.dissent_count,
        recent: pgRows!.rows.slice(0, 5).flatMap((r) => {
          const mpVote = VOTE_WORD[r.vote];
          const majorityVote = VOTE_WORD[r.party_vote];
          // A row whose vote char is not one of the three is not a dissent we can
          // describe, and rendering it with a guessed word would put a claim about how a
          // named MP voted on their own page.
          if (!mpVote || !majorityVote) return [];
          return [
            {
              date: r.date,
              item: r.item_no,
              slug: r.slug ?? String(r.item_no),
              title: r.title ?? undefined,
              mpVote,
              majorityVote,
              groupSize: r.party_members,
            },
          ];
        }),
      }
    : undefined;

  const entry = pgEntry ?? shardEntry ?? aggregateEntry;

  return {
    entry,
    slice,
    isLoading: aggregateEnabled ? aggregateLoading : false,
  };
};
