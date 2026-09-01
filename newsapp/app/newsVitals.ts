import {
  emitNewsEvent,
  newsVitalRating,
  type NewsRouteFamily,
  type NewsVitalName,
} from "./analytics";

type LayoutShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
};

type InteractionEntry = PerformanceEntry & {
  duration: number;
  interactionId: number;
};

interface RouteBoundary {
  route: NewsRouteFamily;
  startTime: number;
}

interface ClsAggregate {
  sessionValue: number;
  sessionFirst: number | null;
  sessionLast: number | null;
  maximum: number;
}

export interface NewsWebVitalsObserver {
  /** Record a client-side route boundary on the performance timeline. */
  markRoute: (route: NewsRouteFamily) => void;
  /** Disconnect without manufacturing a sample during React cleanup. */
  stop: () => void;
}

const canObserve = (type: string): boolean => {
  const supported = PerformanceObserver.supportedEntryTypes;
  return !supported || supported.includes(type);
};

const observe = (
  type: string,
  callback: PerformanceObserverCallback,
  extra: Record<string, unknown> = {},
): PerformanceObserver | null => {
  if (typeof PerformanceObserver === "undefined" || !canObserve(type))
    return null;
  try {
    const observer = new PerformanceObserver(callback);
    observer.observe({
      type,
      buffered: true,
      ...extra,
    } as PerformanceObserverInit);
    return observer;
  } catch {
    return null;
  }
};

const report = (route: NewsRouteFamily, metric: NewsVitalName, value: number) =>
  emitNewsEvent({
    name: "web_vital",
    route,
    metric,
    value,
    rating: newsVitalRating(metric, value),
  });

const nowOnTimeline = (): number =>
  typeof performance === "undefined" ? 0 : performance.now();

/**
 * Collect a final-only field sample for one document lifecycle.
 *
 * LCP belongs to the route that loaded the document. CLS and INP entries are
 * grouped by the route active at their `startTime`, never the route active when
 * the observer happens to deliver them. On the first hidden/pagehide event we
 * emit at most one LCP plus one final CLS/INP aggregate per route family. SPA
 * transition timing is deliberately out of scope and must not be called LCP.
 */
export const observeNewsWebVitals = (
  initialRoute: NewsRouteFamily,
): NewsWebVitalsObserver => {
  if (typeof window === "undefined") {
    return { markRoute: () => undefined, stop: () => undefined };
  }

  const observers: PerformanceObserver[] = [];
  const routeBoundaries: RouteBoundary[] = [
    { route: initialRoute, startTime: Number.NEGATIVE_INFINITY },
  ];
  const routeAt = (startTime: number): NewsRouteFamily => {
    for (let index = routeBoundaries.length - 1; index >= 0; index -= 1) {
      if (startTime >= routeBoundaries[index].startTime)
        return routeBoundaries[index].route;
    }
    return initialRoute;
  };

  let finalised = false;
  let lcpValue: number | null = null;
  const consumeLcp = (entries: PerformanceEntry[]) => {
    const entry = entries[entries.length - 1];
    if (entry) lcpValue = entry.startTime;
  };
  const lcp = observe("largest-contentful-paint", (list) =>
    consumeLcp(list.getEntries()),
  );
  if (lcp) observers.push(lcp);

  const clsByRoute = new Map<NewsRouteFamily, ClsAggregate>();
  const consumeCls = (entries: PerformanceEntry[]) => {
    for (const raw of entries) {
      const entry = raw as LayoutShiftEntry;
      if (entry.hadRecentInput) continue;
      const route = routeAt(entry.startTime);
      const aggregate = clsByRoute.get(route) ?? {
        sessionValue: 0,
        sessionFirst: null,
        sessionLast: null,
        maximum: 0,
      };
      const startsNewSession =
        aggregate.sessionFirst === null ||
        aggregate.sessionLast === null ||
        entry.startTime - aggregate.sessionLast > 1_000 ||
        entry.startTime - aggregate.sessionFirst > 5_000;
      if (startsNewSession) {
        aggregate.sessionValue = entry.value;
        aggregate.sessionFirst = entry.startTime;
      } else {
        aggregate.sessionValue += entry.value;
      }
      aggregate.sessionLast = entry.startTime;
      aggregate.maximum = Math.max(aggregate.maximum, aggregate.sessionValue);
      clsByRoute.set(route, aggregate);
    }
  };
  const cls = observe("layout-shift", (list) => consumeCls(list.getEntries()));
  if (cls) observers.push(cls);

  const interactionsByRoute = new Map<NewsRouteFamily, Map<number, number>>();
  const consumeInp = (entries: PerformanceEntry[]) => {
    for (const raw of entries) {
      const entry = raw as InteractionEntry;
      if (!entry.interactionId || entry.duration <= 0) continue;
      const route = routeAt(entry.startTime);
      const interactions = interactionsByRoute.get(route) ?? new Map();
      interactions.set(
        entry.interactionId,
        Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration),
      );
      interactionsByRoute.set(route, interactions);
    }
  };
  const inp = observe("event", (list) => consumeInp(list.getEntries()), {
    durationThreshold: 40,
  });
  if (inp) observers.push(inp);

  const stop = () => {
    observers.forEach((observer) => observer.disconnect());
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", finalise);
  };

  const finalise = () => {
    if (finalised) return;
    finalised = true;
    // Flush records queued by the browser before disconnecting at lifecycle
    // end. Otherwise the last paint, shift, or interaction could be dropped.
    if (lcp) consumeLcp(lcp.takeRecords());
    if (cls) consumeCls(cls.takeRecords());
    if (inp) consumeInp(inp.takeRecords());
    if (lcpValue !== null) report(initialRoute, "LCP", lcpValue);
    for (const [route, aggregate] of clsByRoute) {
      report(route, "CLS", aggregate.maximum);
    }
    for (const [route, interactions] of interactionsByRoute) {
      const descending = [...interactions.values()].sort((a, b) => b - a);
      const candidate = descending[Math.floor(descending.length / 50)];
      if (candidate !== undefined) report(route, "INP", candidate);
    }
    stop();
  };

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") finalise();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", finalise, { once: true });

  return {
    markRoute: (route) => {
      const previous = routeBoundaries[routeBoundaries.length - 1];
      if (previous.route === route) return;
      routeBoundaries.push({ route, startTime: nowOnTimeline() });
    },
    stop,
  };
};
