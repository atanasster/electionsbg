export const themeDark = "sunset";
export const themeLight = "corporate";

export const getStoredTheme = () =>
  typeof window !== "undefined" ? localStorage.getItem("theme") : null;

export const getSystemTheme = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? themeDark
    : themeLight;

export const getTheme = () => getStoredTheme() || getSystemTheme();
