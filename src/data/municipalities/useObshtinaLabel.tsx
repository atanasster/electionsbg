// An obshtina CODE → the name a reader can read.
//
// It exists because the app's obshtina namespace has three synonyms for Sofia and two sources
// for every name, and every surface that renders a bare code has to get both right:
//
//   `canonicalObshtina`          folds `SOF` / `SOF00` onto `SFO_CITY` (obshtinaPlace.ts's
//                                header explains why that is the survivor);
//   `SYNTHETIC_OBSHTINA_LABELS`  names the codes that are NOT EKATTE municipalities, which is
//                                exactly the one `municipalities.json` cannot supply;
//   `municipalities.json`        names the other 288.
//
// ⚠️ IT FALLS BACK TO THE CODE, NEVER TO NOTHING. This is used for the /persons chip naming an
// active `?obshtina` filter, and that chip is the ONLY surface where the filter exists — it has
// no picker. An empty label there is a filter applied and named nowhere, which is the state the
// chip was built to end; „BGS04" is ugly and honest, and it still tells a reader what to remove.
//
// The fetch is deferred: only a page with an obshtina in hand needs municipalities.json — 40.9 KB
// raw, 9.7 KB gzipped, measured 2026-08-26 — and a chip that is not rendered should not pay for
// it. On /persons that is the common case: `?obshtina` has no picker, so the only way to have
// one is to arrive with it in the URL.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMunicipalities } from "./useMunicipalities";
import {
  canonicalObshtina,
  SYNTHETIC_OBSHTINA_LABELS,
} from "@/lib/obshtinaPlace";

/** Resolve an obshtina code to its display name.
 *
 *  @param enabled whether to fetch `municipalities.json` at all. It is REACTIVE, not read once:
 *    a caller may pass `false` on mount and flip it when a filter appears, and the returned
 *    resolver then re-renders with the names. Until the fetch lands the resolver returns the
 *    CODE, so a caller that defers gets a legible label immediately and a better one shortly —
 *    never an empty one. */
export const useObshtinaLabel = (enabled = true) => {
  const { i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const { findMunicipality } = useMunicipalities(enabled);

  return useCallback(
    (code?: string | null): string => {
      // CANONICALISE FIRST. `useUrlPersonFilters` already folds `?obshtina` on read, so the
      // /persons chip never reaches here with a synonym — but this helper is not only for that
      // caller, and a code arriving from anywhere else (a roster, a shard, a place-view id) has
      // the same three spellings. Folding here too costs one comparison and means no future
      // caller has to know.
      const c = canonicalObshtina(code);
      if (!c) return "";
      const synthetic = SYNTHETIC_OBSHTINA_LABELS[c];
      if (synthetic) return isBg ? synthetic.bg : synthetic.en;
      const m = findMunicipality(c);
      // `||`, not `??`: `name_en` is typed as required and populated on all 294 rows today, so
      // the only value that can reach the fallback is an EMPTY string — which `??` would pass
      // through, dropping the reader to the CODE when the Bulgarian name was right there.
      const name = isBg ? m?.name : m?.name_en || m?.name;
      return name || c;
    },
    [findMunicipality, isBg],
  );
};
