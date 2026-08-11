// Resolve a settlement (EKATTE) to its local-elections context.
//
// Sub-municipal villages large enough to elect their own кмет have a kметство
// mayor race; the bundle carries it under kmetstva[] keyed by name (the CIK
// HTML source leaves the EKATTE field empty, so we name-match — the same
// approach MyAreaKmetstvoTile uses). We resolve EKATTE → settlement → parent
// município (via the settlements catalogue), fetch that one município bundle
// (cache-shared with the município page), and return the matched kметство plus
// the parent council context.
//
// SOFIA IS THE ONE PLACE WHERE THOSE TWO BUNDLES DIFFER. settlements.json puts
// the city's villages (Владая, Бистрица, Лозен, Мърчаево…) in their район
// (S2317, S2323, S2414 …), and a район shard carries ZERO kmetstva in every
// cycle — all 32/33 races are published on the city-wide SOF bundle, and their
// by-elections are filed under obshtinaCode 'SOF' too. Resolving the race from
// the район therefore rendered "това населено място няма собствено кметство"
// for 32 villages that have one, on a page a /person office badge links to by
// the name of the person holding that very office. So the RACE comes from the
// city bundle while the parent-context card keeps the район (which has its own
// районен кмет and council vote): two different questions, only one of which
// folds.

import { useMemo } from "react";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useLocalMunicipality } from "./useLocalMunicipality";
import { useLocalAsOf } from "./useLocalAsOf";
import { isSofiaRayonObshtina } from "./placeViews";
import type { LocalKmetstvoResult, LocalMunicipalityBundle } from "./types";

// Lowercase + whitespace-collapse for kметство ↔ settlement name comparison.
const normalize = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

export type LocalSettlementResult = {
  ekatte?: string;
  /** Settlement Bulgarian name — used for the kметство name-match. */
  name?: string;
  /** Parent município code (e.g. "BGS01"); a Sofia village's own район (S2xxx). */
  obshtina?: string;
  /** The code whose bundle PUBLISHES this settlement's кметство race and by-elections —
   *  the same as `obshtina` everywhere except Sofia, where it is the city bundle `SOF`. */
  kmetstvoObshtina?: string;
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
  const kmetstvoObshtina = isSofiaRayonObshtina(obshtina) ? "SOF" : obshtina;
  const { municipality, isLoading } = useLocalMunicipality(obshtina, active);
  // Outside Sofia this is the SAME query key as the line above, so React Query serves it from
  // cache and no second bundle is fetched.
  const { municipality: kmetstvoSource, isLoading: kmetstvoLoading } =
    useLocalMunicipality(kmetstvoObshtina, active);

  const kmetstvo = useMemo<LocalKmetstvoResult | null>(() => {
    if (!kmetstvoSource?.kmetstva || !settlement) return null;
    const target = normalize(settlement.name);
    return (
      kmetstvoSource.kmetstva.find(
        (k) => normalize(k.kmetstvoName) === target,
      ) ?? null
    );
  }, [kmetstvoSource, settlement]);

  return {
    ekatte,
    name: settlement?.name,
    obshtina,
    kmetstvoObshtina,
    municipality,
    kmetstvo,
    // Both bundles, because on a PARTIAL cycle only one of them tends to exist: a chmi
    // folder carries just the municipalities that voted, so a Sofia village's район shard is
    // absent while the SOF bundle holding its by-election is there. Reporting only the parent
    // query's state flashed "no data" before the race arrived.
    isLoading: isLoading || kmetstvoLoading,
    cycle: active,
  };
};
