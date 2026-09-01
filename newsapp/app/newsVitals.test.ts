import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeNewsWebVitals } from "./newsVitals";

class FakePerformanceObserver {
  static supportedEntryTypes = [
    "largest-contentful-paint",
    "layout-shift",
    "event",
  ];
  static instances: FakePerformanceObserver[] = [];

  type = "";
  options: PerformanceObserverInit | null = null;
  disconnected = false;

  constructor(private readonly callback: PerformanceObserverCallback) {
    FakePerformanceObserver.instances.push(this);
  }

  observe(options: PerformanceObserverInit) {
    this.type = String(options.type);
    this.options = options;
  }

  disconnect() {
    this.disconnected = true;
  }

  takeRecords(): PerformanceEntryList {
    return [] as unknown as PerformanceEntryList;
  }

  emit(entries: Array<Record<string, unknown>>) {
    this.callback(
      {
        getEntries: () => entries as unknown as PerformanceEntryList,
      } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

const observerFor = (type: string) =>
  FakePerformanceObserver.instances.find((observer) => observer.type === type);

const finaliseDocument = () => window.dispatchEvent(new Event("pagehide"));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakePerformanceObserver.instances = [];
  Reflect.deleteProperty(window, "naiasnoNewsAnalytics");
});

describe("route-level Core Web Vitals", () => {
  it("emits only the final LCP candidate and pins it to the document route", async () => {
    vi.stubGlobal(
      "PerformanceObserver",
      FakePerformanceObserver as unknown as typeof PerformanceObserver,
    );
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    const vitals = observeNewsWebVitals("home");

    observerFor("largest-contentful-paint")?.emit([
      { entryType: "largest-contentful-paint", startTime: 1_200 },
    ]);
    vi.spyOn(performance, "now").mockReturnValue(2_000);
    vitals.markRoute("article");
    observerFor("largest-contentful-paint")?.emit([
      { entryType: "largest-contentful-paint", startTime: 2_612.6 },
    ]);

    expect(sink).not.toHaveBeenCalled();
    finaliseDocument();
    await waitFor(() => expect(sink).toHaveBeenCalledTimes(1));
    expect(sink).toHaveBeenCalledWith({
      name: "web_vital",
      route: "home",
      metric: "LCP",
      value: 2613,
      rating: "needs_improvement",
    });
    finaliseDocument();
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/pathname|element|url/);
  });

  it("uses the five-second CLS session window and retains the maximum", async () => {
    vi.stubGlobal(
      "PerformanceObserver",
      FakePerformanceObserver as unknown as typeof PerformanceObserver,
    );
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    observeNewsWebVitals("home");

    observerFor("layout-shift")?.emit([
      { startTime: 500, value: 0.1, hadRecentInput: false },
      { startTime: 1_400, value: 0, hadRecentInput: false },
      { startTime: 2_300, value: 0, hadRecentInput: false },
      { startTime: 3_200, value: 0, hadRecentInput: false },
      { startTime: 4_100, value: 0, hadRecentInput: false },
      { startTime: 5_000, value: 0, hadRecentInput: false },
      { startTime: 5_200, value: 0.2, hadRecentInput: false },
      { startTime: 6_300, value: 0.05, hadRecentInput: false },
      { startTime: 6_500, value: 0.8, hadRecentInput: true },
    ]);
    finaliseDocument();

    await waitFor(() => expect(sink).toHaveBeenCalledTimes(1));
    expect(sink).toHaveBeenCalledWith({
      name: "web_vital",
      route: "home",
      metric: "CLS",
      value: 0.3,
      rating: "poor",
    });
  });

  it("attributes delayed CLS and INP entries by start time for each route", async () => {
    vi.stubGlobal(
      "PerformanceObserver",
      FakePerformanceObserver as unknown as typeof PerformanceObserver,
    );
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    const vitals = observeNewsWebVitals("home");
    vi.spyOn(performance, "now").mockReturnValue(2_000);
    vitals.markRoute("story");

    observerFor("layout-shift")?.emit([
      { startTime: 1_500, value: 0.05, hadRecentInput: false },
      { startTime: 2_500, value: 0.2, hadRecentInput: false },
    ]);
    observerFor("event")?.emit([
      { startTime: 1_900, duration: 180, interactionId: 1 },
      { startTime: 2_100, duration: 510, interactionId: 2 },
    ]);
    finaliseDocument();

    await waitFor(() => expect(sink).toHaveBeenCalledTimes(4));
    expect(sink.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: "home", metric: "CLS", value: 0.05 }),
        expect.objectContaining({ route: "story", metric: "CLS", value: 0.2 }),
        expect.objectContaining({ route: "home", metric: "INP", value: 180 }),
        expect.objectContaining({ route: "story", metric: "INP", value: 510 }),
      ]),
    );
    expect(observerFor("event")?.options).toMatchObject({
      buffered: true,
      durationThreshold: 40,
    });
  });

  it("disconnects on cleanup without turning partial data into a sample", async () => {
    vi.stubGlobal(
      "PerformanceObserver",
      FakePerformanceObserver as unknown as typeof PerformanceObserver,
    );
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    const vitals = observeNewsWebVitals("article");
    observerFor("largest-contentful-paint")?.emit([{ startTime: 900 }]);

    vitals.stop();
    finaliseDocument();
    await Promise.resolve();

    expect(sink).not.toHaveBeenCalled();
    expect(
      FakePerformanceObserver.instances.every((item) => item.disconnected),
    ).toBe(true);
  });
});
