export const normalizeChatUrl = (input: string) => {
  const url = new URL(input);
  const legacyLang = url.searchParams.get("lang");
  if (legacyLang === "en" || legacyLang === "bg") {
    const bare = url.pathname.replace(/^\/en(?=\/)/, "");
    url.pathname = `${legacyLang === "en" ? "/en" : ""}${bare}`;
  }
  url.searchParams.delete("lang");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
};

export const chatView = (pathname: string) => {
  const path = pathname.replace(/\/+$/, "");
  return path.endsWith("/evals")
    ? "evals"
    : path.endsWith("/tools")
      ? "tools"
      : "chat";
};
