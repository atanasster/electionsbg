import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import type { CandidatesInfo } from "@/data/dataTypes";
import type { MpIndexEntry } from "@/data/parliament/useMps";
import { transliterateName } from "./transliterateName";

// Centralized language-aware name picker for candidates and MPs. Mirrors the
// shape of `useCanonicalParties.displayNameFor`: read `i18n.language` once,
// return the right field for every consumer without having to plumb the lang
// flag through.
//
// Falls back gracefully when `name_en` is missing (older cached data, or
// freshly scraped MPs whose pipeline hasn't been re-run): transliterates the
// Bulgarian name on the fly so the UI never shows Cyrillic in EN routes.
export const useCandidateName = () => {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";

  const candidateName = useCallback(
    (c: Pick<CandidatesInfo, "name" | "name_en"> | null | undefined): string =>
      !c ? "" : isEn ? (c.name_en ?? transliterateName(c.name)) : c.name,
    [isEn],
  );

  const mpName = useCallback(
    (mp: Pick<MpIndexEntry, "name" | "name_en"> | null | undefined): string =>
      !mp ? "" : isEn ? (mp.name_en ?? transliterateName(mp.name)) : mp.name,
    [isEn],
  );

  // Pick the right English form when only a raw Bulgarian name is in hand
  // (e.g., legacy /candidate/{bare-name} URLs, search results that haven't
  // been resolved yet). Used by call sites that don't have a CandidatesInfo
  // record but need to show a name in the active locale.
  const nameForBg = useCallback(
    (bgName: string | null | undefined, enHint?: string | null): string => {
      if (!bgName) return "";
      if (!isEn) return bgName;
      return enHint ?? transliterateName(bgName);
    },
    [isEn],
  );

  return { isEn, candidateName, mpName, nameForBg };
};
