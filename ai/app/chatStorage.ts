export const CHAT_STORAGE_KEY = "naiasno.chat.v1";

export const clearSavedChat = () => {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // The mounted conversation can still reset when browser storage is denied.
  }
};
