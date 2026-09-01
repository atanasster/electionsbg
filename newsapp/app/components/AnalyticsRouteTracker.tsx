import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { emitNewsEvent, newsRouteFamily } from "../analytics";
import {
  observeNewsWebVitals,
  type NewsWebVitalsObserver,
} from "../newsVitals";

export const AnalyticsRouteTracker = () => {
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);
  const route = newsRouteFamily(pathname);
  const initialRoute = useRef(route);
  const vitals = useRef<NewsWebVitalsObserver | null>(null);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    emitNewsEvent({ name: "page_view", route });
  }, [pathname, route]);
  // Layout effects run before the newly committed route can paint, so layout
  // shifts from that paint land after this boundary. The click that initiated
  // navigation still has an earlier Event Timing startTime and stays on the
  // originating route.
  useLayoutEffect(() => vitals.current?.markRoute(route), [pathname, route]);
  useEffect(() => {
    const observer = observeNewsWebVitals(initialRoute.current);
    vitals.current = observer;
    return () => {
      observer.stop();
      if (vitals.current === observer) vitals.current = null;
    };
  }, []);
  return null;
};
