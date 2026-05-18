// Shared between scripts/polls/analyze_accuracy.ts and the polls UI.
// Keep this module DOM/React-free so tsx can import it from a node script.

// Normalize a party label so polled-name and actual-name converge.
// "ГЕРБ – СДС" / "ГЕРБ-СДС" / "ГЕРБ - СДС" → "ГЕРБ-СДС"
export const normKey = (s: string): string =>
  s
    .normalize("NFC")
    .replace(/\s*[–—-]\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

// Manual aliases for polled labels that don't normalize to the same key as the actual
// election-summary nickName. Keep tight — only entries we've confirmed are the same party.
export const POLL_TO_ACTUAL: Record<string, string> = {
  "Прогресивна България": "ПрБ",
  "Прогресивна България (Радев)": "ПрБ",
  "Синя България": "СБ",
  "Солидарна България": "СБГ",
  "БСП за България": "БСП",
  "Коалиция за България (БСП)": "БСП",
  "Демократична България": "ДБ",
  "Алианс за права и свободи": "АПС",
  "Български възход": "БВ",
  "Обединени патриоти": "ОП",
  "Български патриоти": "БГ Патриоти",
  "Българско лято": "БГ Лято",
  // Изправи се! Мутри вън! (ИСМВ) ran in 2021-04 and 2021-07 as "ПП ИСМВ".
  // After a rebrand for 2021-11 it ran as "ПП ИСБ" (Изправи се БГ! Ние идваме).
  "Изправи се! Мутри вън!": "ПП ИСМВ",
  "Изправи се БГ! Ние идваме": "ПП ИСБ",
  "Изправи се БГ": "ПП ИСБ",
  "Изправи се.БГ": "ПП ИСБ",
  ИБГНИ: "ПП ИСБ",
  "Реформаторски блок-Глас народен": "РБ-ГН",
  "Реформаторски блок": "РБ-ГН",
  "Патриотичен фронт": "ПФ",
  "България без цензура": "ББЦ",
  "Левицата!": "Левицата",
  Воля: "ВОЛЯ",
  // ГЕРБ alone (older poll label) maps to "ГЕРБ-СДС" in coalition cycles; in pre-2017
  // cycles where "ГЕРБ" is the actual key, the normKey fallthrough catches it.
  ГЕРБ: "ГЕРБ-СДС",
  // ДПС - Ново Начало (long form) → "ДПС-НН" in 2024-10; the ДПС/ДПС-НН ambiguity rule
  // below handles the 2026 cycle where the actual key is plain "ДПС".
  "ДПС - Ново Начало": "ДПС-НН",
  // Поляризация: polls call it "ДПС" pre-2024, "ДПС-НН" after the split. The actual
  // 2024-10-27 result has "ДПС-НН"; the actual 2024-06 has "ДПС". We let the year resolve it
  // — see resolveActualKey below.
};

// Strip a "Коалиция " ("Coalition ") prefix that some agencies — notably ML in
// their 2024+ xlsx — prepend to alliance labels. Without this, "Коалиция
// Прогресивна България" silently fails to match the actual-result key "ПрБ".
export const stripCoalitionPrefix = (s: string): string =>
  s.replace(/^\s*Коалиция\s+/i, "").trim();

// Resolve a poll's party label to the matching actual-results nickName for that election.
// Returns null if no match — those parties are excluded from MAE (the agency didn't poll
// or the actual result doesn't list it; either way it's noise for the metric).
export const resolveActualKey = (
  polledBg: string,
  actualKeys: Set<string>,
): string | null => {
  // ДПС / ДПС-НН and БСП / БСП-ОЛ are renamed across cycles — same party, different
  // ballot abbreviation. Resolve a candidate target against the election's actual keys.
  const resolveAmbiguous = (candidate: string): string | null => {
    if (actualKeys.has(candidate)) return candidate;
    if (candidate === "ДПС-НН" && actualKeys.has("ДПС")) return "ДПС";
    if (candidate === "ДПС" && actualKeys.has("ДПС-НН")) return "ДПС-НН";
    if (candidate === "БСП" && actualKeys.has("БСП-ОЛ")) return "БСП-ОЛ";
    if (candidate === "БСП-ОЛ" && actualKeys.has("БСП")) return "БСП";
    return null;
  };
  const tryOne = (label: string): string | null => {
    const direct = POLL_TO_ACTUAL[label.trim()];
    if (direct) {
      const resolved = resolveAmbiguous(direct);
      if (resolved) return resolved;
    }
    return resolveAmbiguous(normKey(label));
  };
  const first = tryOne(polledBg);
  if (first) return first;
  const stripped = stripCoalitionPrefix(polledBg);
  if (stripped !== polledBg) return tryOne(stripped);
  return null;
};
