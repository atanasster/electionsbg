// Resolve a settlement (EKATTE) to its local-elections context.
//
// Sub-municipal villages large enough to elect their own кмет have a kметство
// mayor race; the bundle carries it under kmetstva[] keyed by name (the CIK
// HTML source leaves the EKATTE field empty, so we name-match — the same
// approach MyAreaKmetstvoTile uses). We resolve EKATTE → settlement → parent
// município (via the settlements catalogue), fetch that one município bundle
// (cache-shared with the município page), and return the matched kметство plus
// the parent council context.

import { useMemo } from "react";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useLocalMunicipality } from "./useLocalMunicipality";
import { useLocalAsOf } from "./useLocalAsOf";
import type { LocalKmetstvoResult, LocalMunicipalityBundle } from "./types";

// Lowercase + whitespace-collapse for kметство ↔ settlement name comparison.
const normalize = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

export type LocalSettlementResult = {
  ekatte?: string;
  /** Settlement Bulgarian name — used for the kметство name-match. */
  name?: string;
  /** Parent município code (e.g. "BGS01"). */
  obshtina?: string;
  /** The parent município's full local-election bundle. */
  municipality?: LocalMunicipalityBundle;
  /** The matched kметство mayor race, or null when this settlement has none. */
  kmetstvo: LocalKmetstvoResult | null;
  isLoading: boolean;
  cycle: string;
};

export const useLocalSettlement = (
  ekatte?: string,
  cycle?: string,
): LocalSettlementResult => {
  const { cycle: anchored } = useLocalAsOf();
  const active = cycle ?? anchored;
  const { findSettlement } = useSettlementsInfo();
  const settlement = ekatte ? findSettlement(ekatte) : undefined;
  const obshtina = settlement?.obshtina;
  const { municipality, isLoading } = useLocalMunicipality(obshtina, active);

  const kmetstvo = useMemo<LocalKmetstvoResult | null>(() => {
    if (!municipality?.kmetstva || !settlement) return null;
    const target = normalize(settlement.name);
    return (
      municipality.kmetstva.find((k) => normalize(k.kmetstvoName) === target) ??
      null
    );
  }, [municipality, settlement]);

  return {
    ekatte,
    name: settlement?.name,
    obshtina,
    municipality,
    kmetstvo,
    isLoading,
    cycle: active,
  };
};
