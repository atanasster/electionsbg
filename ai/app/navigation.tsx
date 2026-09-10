import { createContext, useContext, useEffect, useState } from "react";
import type { Lang } from "../tools/types";

export type ChatNavigation = {
  pathname: string;
  search: string;
  lang: Lang;
  navigate: (url: string) => void;
};
export const ChatNavigationContext = createContext<ChatNavigation | null>(null);

export const useChatNavigation = () => {
  const integrated = useContext(ChatNavigationContext);
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  useEffect(() => {
    if (integrated) return;
    const restore = () =>
      setLocation({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [integrated]);
  return (
    integrated ?? {
      ...location,
      lang: (new URLSearchParams(location.search).get("lang") === "en"
        ? "en"
        : "bg") as Lang,
      navigate: (url: string) => {
        window.history.pushState(null, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
    }
  );
};
