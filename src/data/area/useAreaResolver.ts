// Resolve a `:id` from the /my-area/:id route into a typed area record.
//
// IDs come in a few shapes:
//   - 5-digit numeric EKATTE          → settlement (e.g. "65231" → Самоков)
//   - composite "EKATTE-NNNN"         → Sofia район-as-settlement
//                                       (e.g. "68134-2401" — Sofia city
//                                       EKATTE 68134, район-sub-code 2401)
//   - alphanumeric obshtina           → municipality (e.g. "S2410",
//                                       "BGS01", "SOF00")
//
// Município codes always start with letters; settlement IDs always start
// with a digit. We use that as the primary dispatch, and fall back to the
// other lookup if the primary one misses — keeps the resolver robust to
// any future EKATTE shape changes (e.g. a new region introduces another
// composite form).
//
// Resolution is cheap: both lookup tables (settlements + municipalities)
// are already React Query'd and live in memory after first load.

import { useMemo } from "react";
import { useSettlementsInfo } from "../settlements/useSettlements";
import { useMunicipalities } from "../municipalities/useMunicipalities";
import type { MunicipalityInfo, SettlementInfo } from "../dataTypes";
import { findCityRayon, isCityRayonId } from "../local/cityRayonCatalog";

export type ResolvedArea =
  | {
      kind: "settlement";
      id: string;
      ekatte: string;
      obshtina: string;
      oblast: string;
      settlement: SettlementInfo;
    }
  | {
      kind: "municipality";
      id: string;
      obshtina: string;
      oblast: string;
      municipality: MunicipalityInfo;
    }
  | { kind: "unknown"; id: string };

// True when the id looks settlement-shaped: starts with a digit. Settlement
// EKATTEs include both purely-numeric (`65231`) and hyphenated composite
// forms (`68134-2401` for Sofia райони), so a starts-with-digit check is
// broader than the old `/^\d+$/` and catches both cases.
const looksLikeSettlementId = (id: string): boolean => /^\d/.test(id);

// Sofia city has no single município row in municipalities.json — the city is
// split into 24 районы (S2xxx) across МИР 23/24/25. But it does have a
// city-wide My-Area dashboard, keyed SOF00 (the code officials / LISI /
// indicators / transfers use; the local bundle is the synthetic SOF). We
// synthesize the município record here so the generic MyAreaScreen can render
// it like any other obshtina. oblast S23 is a representative МИР (the
// oblast-keyed strips show one МИР's slice); obshtina-keyed governance tiles
// derive the SOF shard from the code and cover the whole city.
const SOFIA_CITY_MUNICIPALITY: MunicipalityInfo = {
  ekatte: "68134",
  name: "София (столица)",
  name_en: "Sofia (capital)",
  obshtina: "SOF00",
  oblast: "S23",
  loc: "23.3219,42.6977",
};
const isSofiaCityId = (id: string): boolean => id === "SOF00" || id === "SOF";

export const useAreaResolver = (id?: string | null): ResolvedArea | null => {
  const { findSettlement, settlements } = useSettlementsInfo();
  const { findMunicipality, municipalities } = useMunicipalities();

  return useMemo(() => {
    if (!id) return null;
    // The two data sources may load at different times. Until both are in
    // hand we return null so the screen renders its skeleton instead of an
    // "unknown" flash that would mis-classify a valid id.
    if (!settlements || !municipalities) return null;

    // Пловдив/Варна административен район ("PDV22-01") — a derived sub-city
    // place with no obshtina/settlement row of its own. We synthesize a
    // município record (same trick as the Sofia city aggregate above) so the
    // generic MyAreaScreen renders it like any Sofia район instead of a
    // bespoke layout: obshtina is the район id (PDV22-01) so the район shard
    // drives the parliamentary/summary tiles and the obshtina-grain tiles
    // self-hide for want of район-level data; oblast is the PARENT city's
    // oblast (PDV-00 / VAR), the МИР that the район belongs to, so the
    // МИР-scoped MP roster + roll-call tiles resolve to the right МИР.
    if (isCityRayonId(id)) {
      const rayon = findCityRayon(id)!;
      const parent = findMunicipality(rayon.obshtina);
      const oblast = parent?.oblast ?? "";
      return {
        kind: "municipality",
        id,
        obshtina: rayon.id,
        oblast,
        municipality: {
          ekatte: parent?.ekatte ?? "",
          name: rayon.labelBg,
          name_en: rayon.labelEn,
          obshtina: rayon.id,
          oblast,
          loc: parent?.loc ?? "",
        },
      };
    }

    // Sofia city aggregate — synthetic município (not in municipalities.json).
    if (isSofiaCityId(id)) {
      return {
        kind: "municipality",
        id,
        obshtina: SOFIA_CITY_MUNICIPALITY.obshtina,
        oblast: SOFIA_CITY_MUNICIPALITY.oblast,
        municipality: SOFIA_CITY_MUNICIPALITY,
      };
    }

    // Primary dispatch by shape, with cross-lookup fallback so a settlement
    // id we don't yet recognise can still hit the município table and
    // vice-versa — defensive against any future ID-shape changes upstream.
    const tryAsSettlement = (): ResolvedArea | null => {
      const s = findSettlement(id);
      if (!s) return null;
      return {
        kind: "settlement",
        id,
        ekatte: s.ekatte,
        obshtina: s.obshtina,
        oblast: s.oblast,
        settlement: s,
      };
    };
    const tryAsMunicipality = (): ResolvedArea | null => {
      const m = findMunicipality(id);
      if (!m) return null;
      return {
        kind: "municipality",
        id,
        obshtina: m.obshtina,
        oblast: m.oblast,
        municipality: m,
      };
    };

    if (looksLikeSettlementId(id)) {
      const hit = tryAsSettlement() ?? tryAsMunicipality();
      if (hit) return hit;
    } else {
      const hit = tryAsMunicipality() ?? tryAsSettlement();
      if (hit) return hit;
    }
    return { kind: "unknown", id };
  }, [id, settlements, municipalities, findSettlement, findMunicipality]);
};
