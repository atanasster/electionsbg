export const chatPath = (
  view: "chat" | "tools" | "evals",
  pathname: string,
) => {
  const integrated = /^\/(en\/)?chat(?:\/|$)/.test(pathname);
  const prefix = integrated
    ? `${pathname.startsWith("/en/") ? "/en" : ""}/chat`
    : "";
  return view === "chat" ? prefix || "/" : `${prefix}/${view}`;
};
