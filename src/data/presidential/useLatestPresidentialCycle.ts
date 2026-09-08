// The presidential cycle to anchor PlaceViewNav's presidential pill to — the React wrapper
// around presidentialAsOf (pure, see ../presidentialAsOf.ts), mirroring useLocalAsOf /
// useLatestLocalCycle for the local pill.

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { presidentialAsOf, type PresidentialAsOf } from "../presidentialAsOf";

export const usePresidentialAsOf = (): PresidentialAsOf => {
  const { selected } = useElectionContext();
  return useMemo(() => presidentialAsOf(selected), [selected]);
};

export const useLatestPresidentialCycle = (): string =>
  usePresidentialAsOf().cycle;
