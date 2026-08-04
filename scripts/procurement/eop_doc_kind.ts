// Classify a ЦАИС ЕОП attachment by its FILENAME.
//
// ⚠️ THIS IS A CLASSIFICATION, NOT A FACT. Buyers name their files freely; the
// register carries no document-type field. Measured on a 56-tender / 246-file sample
// (plan §2.2): a "техническа спецификация" pattern hits 68% of tenders. The other
// 32% either name the spec something else ("Част II", "Приложение № 1.1") or publish
// none at all — and those two are indistinguishable from the name alone.
//
// So `unclassified` is a real answer, not a gap to be papered over, and
// `spec === null` must never be rendered as "no technical specification published".
// The honest version of that claim needs the whole manifest plus a human-checked
// sample; the risk signal in the plan (§5 A9) is deliberately phrased against the
// manifest, not against this classifier.

export type DocKind =
  | "spec" // техническа спецификация
  | "documentation" // документация / указания
  | "methodology" // методика за оценка / критерии
  | "contract_draft" // проект на договор
  | "espd" // ЕЕДОП / ESPD
  | "form" // образци, предложения (техническо/ценово)
  | "decision" // решение / обявление
  | "boq" // КСС / количествено-стойностна сметка
  | "project_docs" // проектна документация, чертежи
  | "unclassified";

/** Normalise for matching: lowercase, collapse separators. Bulgarian filenames mix
 *  `_`, `-` and spaces freely, and the same buyer is inconsistent between files. */
const norm = (s: string): string =>
  s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/** Ordered: first match wins. Order matters — "Приложение № 1 Техническа
 *  спецификация" must classify as `spec`, not as `form`, so `spec` precedes the
 *  generic patterns. */
const RULES: { kind: DocKind; re: RegExp }[] = [
  // "техническа спецификация", "тех. спец.", bare "спецификация"
  { kind: "spec", re: /(техн\w*\s*спец|тех\s*спец|спецификаци)/ },
  { kind: "boq", re: /(количествен\w*\s*(стойностн\w*\s*)?сметк|\bкс{1,2}\b|остойност)/ },
  { kind: "methodology", re: /(методик|критери\w*\s*за\s*оценк|показател\w*\s*за\s*оценк)/ },
  { kind: "espd", re: /(еедоп|espd)/ },
  { kind: "contract_draft", re: /(проект\w*\s*на\s*договор|договор)/ },
  { kind: "decision", re: /(решение|обявление)/ },
  { kind: "project_docs", re: /(проектн\w*\s*документаци|чертеж|архитектурн|конструктивн)/ },
  { kind: "documentation", re: /(документаци|указани)/ },
  { kind: "form", re: /(образец|образци|приложение|предложение|деклараци)/ },
];

/** Classify one attachment name. Returns `unclassified` when nothing matches — which
 *  is a third of the corpus and must stay visible as such. */
export const classifyDocName = (name: string): DocKind => {
  const n = norm(name);
  for (const { kind, re } of RULES) if (re.test(n)) return kind;
  return "unclassified";
};

/** Extensions we can extract text from today. Archives are deliberately absent:
 *  they are 6.5% of files and 88% of bytes (plan §2.2), overwhelmingly CAD and
 *  scans, and tier B does not fetch them. */
const TEXT_EXT = new Set([".pdf", ".doc", ".docx", ".rtf", ".odt", ".txt"]);

export const isExtractable = (ext: string | null | undefined): boolean =>
  !!ext && TEXT_EXT.has(ext.toLowerCase());

/**
 * Pick the ONE document per tender that tier B fetches: the technical specification.
 *
 * Ties are broken by size (largest), because a buyer who publishes both
 * "Техническа спецификация.pdf" and "Техническа спецификация - приложение.pdf"
 * almost always puts the substance in the bigger one.
 *
 * Returns null when no extractable spec-named file exists — the ~32% case above.
 */
export const pickSpec = <
  T extends { Name?: string; Extension?: string | null; Size?: number },
>(
  docs: readonly T[],
): T | null => {
  const cands = docs.filter(
    (d) =>
      d?.Name &&
      isExtractable(d.Extension) &&
      classifyDocName(d.Name) === "spec",
  );
  if (!cands.length) return null;
  return cands.reduce((a, b) => ((b.Size ?? 0) > (a.Size ?? 0) ? b : a));
};
