import { SITE_ORIGIN } from "@/lib/siteOrigin";

export const isLegacyPage = (pathname: string) =>
  /^\/(?:tools\/?|evals\/?|legacy-export\/?)?$/.test(pathname);

// Preserve the URL contract, but never construct a destination from user input.
export const integratedLegacyUrl = (pathname: string, search: string) => {
  const params = new URLSearchParams(search);
  const lang = params.get("lang") === "en" ? "/en" : "";
  params.delete("lang");
  const view = /^\/tools\/?$/.test(pathname)
    ? "/tools"
    : /^\/evals\/?$/.test(pathname)
      ? "/evals"
      : "";
  const query = params.toString();
  return `${SITE_ORIGIN}${lang}/chat${view}${query ? `?${query}` : ""}`;
};
