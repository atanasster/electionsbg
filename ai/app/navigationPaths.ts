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

/** View changes retain the selected area, not the old question or tool args. */
export const chatToolbarPath = (
  view: "chat" | "tools" | "evals",
  pathname: string,
  search: string,
) => {
  const area = new URLSearchParams(search).get("area");
  return (
    chatPath(view, pathname) + (area ? `?${new URLSearchParams({ area })}` : "")
  );
};
