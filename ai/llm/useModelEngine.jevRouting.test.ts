// @vitest-environment jsdom
// Jev routing is ON unless explicitly switched off. The default lives in code
// because the only other place for it, .env.production, is gitignored — a
// deploy from another machine would ship the lane off without anyone noticing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { jevRoutingEnabled } from "./useModelEngine";

afterEach(() => {
  // Stubs first: the storage cleanup below needs the real localStorage back.
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.removeItem("naiasno:jev-routing");
});

describe("jevRoutingEnabled", () => {
  it("is on with no setting at all", () => {
    expect(jevRoutingEnabled()).toBe(true);
  });

  it("is off in one browser with the localStorage switch", () => {
    localStorage.setItem("naiasno:jev-routing", "0");
    expect(jevRoutingEnabled()).toBe(false);
    // The old opt-in value keeps working rather than reading as „off".
    localStorage.setItem("naiasno:jev-routing", "1");
    expect(jevRoutingEnabled()).toBe(true);
  });

  it("is off for everyone with the build switch, whatever the browser says", () => {
    vi.stubEnv("VITE_JEV_ROUTING", "0");
    localStorage.setItem("naiasno:jev-routing", "1");
    expect(jevRoutingEnabled()).toBe(false);
  });

  it("stays on when storage is unreadable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(jevRoutingEnabled()).toBe(true);
  });
});
