import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { emitNewsEvent, newsRouteFamily } from "../analytics";

export const AnalyticsRouteTracker = () => {
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    emitNewsEvent({ name: "page_view", route: newsRouteFamily(pathname) });
  }, [pathname]);
  return null;
};
