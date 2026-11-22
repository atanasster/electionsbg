import { afterEach, describe, expect, it } from "vitest";
import {
  BG_NO_PROXY,
  bgFallbackApplies,
  bgPlaywrightProxy,
  bgProxyCandidates,
  bgProxyEnv,
  bgRetryWorthy,
  findBgFallback,
  proxyLabel,
  resetBgProxyCache,
} from "./bg_egress";

afterEach(() => resetBgProxyCache());

describe("bgProxyCandidates", () => {
  it("defaults to the tailnet name, then the LAN name", () => {
    expect(bgProxyCandidates({})).toEqual([
      "http://mac:8118",
      "http://Brooks-Mac-mini.local:8118",
    ]);
  });
  it("takes an override list and normalises bare host:port", () => {
    expect(
      bgProxyCandidates({ BG_EGRESS_PROXY: "10.0.0.5:3128, http://x:1" }),
    ).toEqual(["http://10.0.0.5:3128", "http://x:1"]);
  });
  it("can be switched off", () => {
    expect(bgProxyCandidates({ BG_EGRESS_PROXY: "off" })).toEqual([]);
  });
});

describe("bgProxyEnv", () => {
  it("sets both proxy spellings, Node's opt-in and the marker, and exempts Google/GitHub/localhost", () => {
    const env = bgProxyEnv("http://mac:8118");
    expect(env).toMatchObject({
      HTTPS_PROXY: "http://mac:8118",
      http_proxy: "http://mac:8118",
      NODE_USE_ENV_PROXY: "1",
      BG_EGRESS_VIA: "http://mac:8118",
    });
    for (const h of ["127.0.0.1", ".googleapis.com", "github.com"])
      expect(BG_NO_PROXY.split(",")).toContain(h);
  });
  it("labels a proxy by host:port", () => {
    expect(proxyLabel("http://mac:8118")).toBe("mac:8118");
  });
});

describe("bgRetryWorthy", () => {
  it("accepts the network classes and a refused HTTP status", () => {
    expect(bgRetryWorthy("egress", "")).toBe(true);
    expect(bgRetryWorthy("waf-blocked", "")).toBe(true);
    expect(bgRetryWorthy("upstream-down", "")).toBe(true);
    expect(bgRetryWorthy("unknown", "Error: HTTP 403 for https://x")).toBe(
      true,
    );
    expect(bgRetryWorthy("unknown", "fetch: returned 451")).toBe(true);
  });
  it("rejects code bugs and a 403 that is only a count", () => {
    expect(bgRetryWorthy("code-bug", "TypeError: boom")).toBe(false);
    expect(bgRetryWorthy("unknown", "loaded 403 rows")).toBe(false);
  });
});

describe("findBgFallback", () => {
  const up = async () => true;
  it("returns null from a Bulgarian exit unless forced", async () => {
    expect(
      await findBgFallback({}, { country: async () => "BG", probe: up }),
    ).toBeNull();
    expect(bgFallbackApplies("BG", { BG_EGRESS_FORCE: "1" })).toBe(true);
  });
  it("returns the first answering proxy from a foreign or unknown exit", async () => {
    expect(
      await findBgFallback(
        {},
        { country: async () => "DE", probe: async (u) => u.includes(".local") },
      ),
    ).toBe("http://Brooks-Mac-mini.local:8118");
    resetBgProxyCache();
    expect(
      await findBgFallback({}, { country: async () => null, probe: up }),
    ).toBe("http://mac:8118");
  });
  it("never stacks a fallback inside an already-proxied child", async () => {
    expect(
      await findBgFallback(
        { BG_EGRESS_VIA: "http://mac:8118" },
        { country: async () => "DE", probe: up },
      ),
    ).toBeNull();
  });
});

describe("bgPlaywrightProxy", () => {
  it("adds nothing outside a proxied step", () => {
    expect(bgPlaywrightProxy({})).toEqual({});
  });

  it("points Chromium at the proxy, with NO_PROXY in Chromium's syntax", () => {
    const opt = bgPlaywrightProxy(bgProxyEnv("http://mac:8118"));
    expect(opt.proxy?.server).toBe("http://mac:8118");
    const bypass = opt.proxy!.bypass.split(",");
    expect(bypass).toContain("localhost");
    expect(bypass).toContain("[::1]");
    expect(bypass).toContain("*.googleapis.com");
    expect(bypass).toContain("github.com");
    expect(bypass.some((h) => h.startsWith("."))).toBe(false);
  });
});
