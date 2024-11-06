export const themeDark = "sunset";
export const themeLight = "corporate";

export const getTheme = () =>
  (typeof window !== "undefined" && localStorage.getItem("theme")) ||
  themeLight;
