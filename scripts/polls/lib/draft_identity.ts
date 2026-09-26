/** The shared inbox needs distinct race names even when corpus IDs can overlap. */
export const presidentialDraftId = (id: string): string =>
  id.endsWith("-presidential") ? id : `${id}-presidential`;
export const isProvisionalPollId = (id: string): boolean =>
  /^[a-z]+-pub-/i.test(id);
