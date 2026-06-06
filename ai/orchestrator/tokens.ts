// Cheap token estimator for context budgeting. Shipping a real tokenizer would
// add hundreds of KB for no real gain here — windowing only needs a rough size,
// not exact counts. Calibrated against the prompt_tokens the cloud proxy reports
// back: Cyrillic BPE runs denser (~1 token per 2.5 chars) than Latin/ASCII (~1
// per 4). We round up, so the estimate skews slightly high — which only compacts
// a touch earlier, the safe direction.

export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  const cyr = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const other = text.length - cyr;
  return Math.ceil(cyr / 2.5 + other / 4);
};
