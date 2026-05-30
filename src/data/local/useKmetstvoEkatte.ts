// Resolve a kметство name to its settlement EKATTE.
//
// The CIK HTML bundle carries kmetstvoName but an empty ekatte, so we read the
// deterministic lookup that scripts/parsers_local/backfill_kmetstvo_ekatte.ts
// builds by name-joining against the settlements catalogue. Keyed
// `<obshtina>:<normalized name>` → ekatte. Lets the município page link each
// kметство to its settlement dashboard.

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { dataUrl } from "@/data/dataUrl";

const normalize = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

const queryFn = async (): Promise<Record<string, string>> => {
  const res = await fetch(dataUrl("/local_mayors/kmetstvo_to_ekatte.json"));
  if (res.status === 404) return {};
  if (!res.ok) {
    throw new Error(`kmetstvo_to_ekatte fetch failed: ${res.status}`);
  }
  return res.json();
};

export const useKmetstvoEkatte = () => {
  const { data } = useQuery({
    queryKey: ["kmetstvo_to_ekatte"],
    queryFn,
  });
  const ekatteFor = useCallback(
    (obshtina: string, kmetstvoName: string): string | undefined =>
      data?.[`${obshtina}:${normalize(kmetstvoName)}`],
    [data],
  );
  return { ekatteFor };
};
