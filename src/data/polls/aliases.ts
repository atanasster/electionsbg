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
  "Ляв съюз за чиста и свята република": "ЛСЧСР",
  // April 2021 ballot 24: Volya + NFSB ran as a coalition with nick "ВОЛЯ/НФСБ".
  "Патриотична коалиция Воля-НФСБ": "ВОЛЯ/НФСБ",
  // April 2021 ballot 21: Републиканци за България has actual nickName "РБГ".
  "Републиканци за България": "РБГ",
  // March 2017 small parties.
  "АБВ-Движение 21": "АБВ/Д21",
  "Нова република": "Нова Република",
  "Да, България": "ДаБГ",
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
  // "Има такъв народ" is how agencies (Trend measured 2026-09-09) write out the
  // ballot nickname "ИТН" in full — the ballot never abbreviates it in prose.
  "Има такъв народ": "ИТН",
  // The definite-article form ("the Alliance") a declined Bulgarian sentence
  // uses instead of the bare name — same party as "Алианс за права и свободи"
  // above (Trend, measured 2026-09-09: "Алиансът за права и свободи разполага
  // с 1,7%").
  "Алиансът за права и свободи": "АПС",
  // Global Metrics' presidential placeholder table (July 2026 capture,
  // pubId 658): the candidate-of-party row for ПП-ДБ wraps its label
  // across a line break with the percentage sandwiched in the middle
  // ("Кандидат на Продължаваме промяната –\n...\nДемократична България"),
  // so `scripts/polls/extractors/global_metrics.ts` deliberately captures
  // only the truncated form (through the trailing en-dash) rather than
  // reconstructing the wrapped continuation — see that file's own header
  // for why.
  //
  // ⚠ Unlike the ДПС/БСП cycle-rename pair `resolveAmbiguous` handles
  // below, this entry has no cross-cycle counterpart: ПП ran as the bare
  // ballot nickname "ПП" in 2021-11/2022-10 and only as "ПП-ДБ" from
  // 2023-04 onward, and `resolveActualKey` has no ПП ↔ ПП-ДБ rename rule.
  // That is a pre-existing, unchanged scope limit (the bare full name
  // never matched the bare abbreviation either way, before or after this
  // entry) rather than a regression — it just means this alias only ever
  // helps a 2023+ actual-key set. `global_metrics.ts`'s own use of this
  // table (via `placeholderPartyKey`, a direct dictionary lookup with no
  // `actualKeys` set at all) is unaffected either way. "БСП – Обединена
  // левица" is that same table's single-line ballot spelling of БСП-ОЛ,
  // and DOES ride the existing БСП ↔ БСП-ОЛ rename rule below.
  "Продължаваме промяната": "ПП-ДБ",
  "БСП – Обединена левица": "БСП-ОЛ",
};

// Strip a "Коалиция " ("Coalition ") prefix that some agencies — notably ML in
// their 2024+ xlsx — prepend to alliance labels. Without this, "Коалиция
// Прогресивна България" silently fails to match the actual-result key "ПрБ".
export const stripCoalitionPrefix = (s: string): string =>
  s.replace(/^\s*Коалиция\s+/i, "").trim();

// A case-folded index of POLL_TO_ACTUAL's keys, built once — the fallback
// path below for a label whose CASE differs from the table's own spelling
// (e.g. an agency headline in all caps). Keyed on `normKey(...).toLowerCase()`
// so it folds the same dash/whitespace variants `normKey` already does, on
// top of case.
const POLL_TO_ACTUAL_FOLDED: Record<string, string> = Object.fromEntries(
  Object.entries(POLL_TO_ACTUAL).map(([k, v]) => [normKey(k).toLowerCase(), v]),
);

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
    const viaNormKey = resolveAmbiguous(normKey(label));
    if (viaNormKey) return viaNormKey;
    // Case-insensitive fallback — a poll-extraction pipeline (e.g. the
    // sentence-rule extractor in scripts/polls/lib/sentence_rule.ts, which
    // deliberately recognises a label regardless of case) can hand this a
    // label whose casing differs from the table's own, and the exact-match
    // paths above would otherwise refuse it even though the party is known.
    const folded = POLL_TO_ACTUAL_FOLDED[normKey(label).toLowerCase()];
    return folded ? resolveAmbiguous(folded) : null;
  };
  const first = tryOne(polledBg);
  if (first) return first;
  const stripped = stripCoalitionPrefix(polledBg);
  if (stripped !== polledBg) return tryOne(stripped);
  return null;
};
