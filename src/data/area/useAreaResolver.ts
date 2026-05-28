// Resolve a `:id` from the /my-area/:id route into a typed area record.
//
// IDs come in two shapes today:
//   - 5-digit numeric EKATTE  → settlement (e.g. "65231" → Самоков)
//   - alphanumeric obshtina   → municipality (e.g. "SFO00" → Столична)
//
// The discriminator is identical to the one /settlement/:id uses in
// SettlementsScreen.tsx — a single regex on the id. Resolution is cheap:
// both lookup tables (settlements + municipalities) are already React
// Query'd and live in memory after first load.
//
// Returns a discriminated union: callers branch on `kind`.

import { useMemo } from "react";
import { useSettlementsInfo } from "../settlements/useSettlements";
import { useMunicipalities } from "../municipalities/useMunicipalities";
import type { MunicipalityInfo, SettlementInfo } from "../dataTypes";

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

const isNumericEkatte = (id: string): boolean => /^\d+$/.test(id);

export const useAreaResolver = (id?: string | null): ResolvedArea | null => {
  const { findSettlement, settlements } = useSettlementsInfo();
  const { findMunicipality, municipalities } = useMunicipalities();

  return useMemo(() => {
    if (!id) return null;
    // The two data sources may load at different times. Until both are in
    // hand we return null so the screen renders its skeleton instead of an
    // "unknown" flash that would mis-classify a valid id.
    if (!settlements || !municipalities) return null;

    if (isNumericEkatte(id)) {
      const s = findSettlement(id);
      if (s) {
        return {
          kind: "settlement",
          id,
          ekatte: s.ekatte,
          obshtina: s.obshtina,
          oblast: s.oblast,
          settlement: s,
        };
      }
    } else {
      const m = findMunicipality(id);
      if (m) {
        return {
          kind: "municipality",
          id,
          obshtina: m.obshtina,
          oblast: m.oblast,
          municipality: m,
        };
      }
    }
    return { kind: "unknown", id };
  }, [id, settlements, municipalities, findSettlement, findMunicipality]);
};
