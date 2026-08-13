// An MP's Commerce-Registry management roles, live from Postgres
// (/api/db/mp-management, migration 150). Backs the „Управленски роли" block on the
// /candidate/:id + /person/:slug profile.
//
// Replaces the static `parliament/mp-management/{mpId}.json` shard family. That set was minted
// by a NAME match with its own confidence model, so it published roles the person layer had
// already stopped publishing on the same page: measured 2026-08-12, 410 of its 2,014
// (MP, company) pairs were held by an MP whose name the Commerce Registry says belongs to more
// than one human. The route reads the gated `person_role` set instead — one definition,
// shared with the profile's own companies list.
//
// A `null` body means the mp_id resolves to no active person, exactly as the shard's 404 did;
// the block self-suppresses rather than rendering an empty card.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMpIdForName } from "@/data/candidates/CandidateMpContext";
import type { MpManagementFile } from "@/data/dataTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, number | undefined]
>): Promise<MpManagementFile | null> => {
  const id = queryKey[1];
  if (!id) return null;
  const response = await fetch(`/api/db/mp-management?mp=${id}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`db fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useMpManagement = (name?: string | null) => {
  const id = useMpIdForName(name) ?? undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["mp_management", id] as [string, number | undefined],
    queryFn,
    enabled: !!id,
    staleTime: Infinity,
  });

  return { management: data ?? null, isLoading };
};
