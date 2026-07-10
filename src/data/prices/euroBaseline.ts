// The euro-adoption date — a fixed policy fact (Bulgaria adopted the euro on
// 1 January 2026), NOT a data-derived value. Centralized so the UI copy and the
// prerendered SEO body cite it from one place. Distinct from the *data* baseline
// (`dict.baseline`, the first loaded grid day = 2026-01-02) that the since-euro
// price index is measured against — that one is read from the payload, never
// hardcoded, so a re-base moves the numbers AND the prose together.
export const EURO_ADOPTION: { bg: string; en: string } = {
  bg: "1 януари 2026 г.",
  en: "1 January 2026",
};
