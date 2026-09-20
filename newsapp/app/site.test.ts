import { describe, expect, it } from "vitest";
import {
  MAIN_SITE_LABEL,
  isMainSiteHref,
  mainSiteHome,
  mainSiteUrl,
  newsUrlFor,
} from "./site";

describe("main-site URLs", () => {
  it("rewrites a legacy host to the serving one", () => {
    // ⚠️ THE CASE THE WHOLE NORMALISER EXISTS FOR. ~8,500 hrefs are baked
    // into already-published, immutable releases under the retired host.
    expect(mainSiteUrl("https://electionsbg.com/person/mp-3643")).toBe(
      "https://naiasno.bg/person/mp-3643",
    );
  });

  it("leaves a current href alone", () => {
    expect(mainSiteUrl("https://naiasno.bg/settlement/00775")).toBe(
      "https://naiasno.bg/settlement/00775",
    );
  });

  it("prefixes /en once, whichever host it came from", () => {
    expect(mainSiteUrl("https://electionsbg.com/company/206268628", true)).toBe(
      "https://naiasno.bg/en/company/206268628",
    );
    expect(mainSiteUrl("https://naiasno.bg/en/company/206268628", true)).toBe(
      "https://naiasno.bg/en/company/206268628",
    );
  });

  it("returns an unparseable href untouched rather than dropping it", () => {
    // A missing link costs a reader one click; a mangled one sends them
    // somewhere we did not intend.
    expect(mainSiteUrl("not a url")).toBe("not a url");
  });

  it("does not touch a third-party host", () => {
    expect(mainSiteUrl("https://example.test/person/x")).toBe(
      "https://example.test/person/x",
    );
  });

  it("accepts BOTH hosts as main-site hrefs", () => {
    // ⚠️ Narrowing this to the new host alone would silently reject every
    // reviewed link in a release published before the rebrand.
    expect(isMainSiteHref("https://naiasno.bg/person/mp-1")).toBe(true);
    expect(isMainSiteHref("https://electionsbg.com/person/mp-1")).toBe(true);
  });

  it("refuses a bare origin, plain http and a lookalike host", () => {
    expect(isMainSiteHref("https://naiasno.bg/")).toBe(false);
    expect(isMainSiteHref("http://naiasno.bg/person/mp-1")).toBe(false);
    expect(isMainSiteHref("https://naiasno.bg.evil.test/person/mp-1")).toBe(
      false,
    );
    expect(isMainSiteHref("https://evil-naiasno.bg/person/mp-1")).toBe(false);
  });

  it("names the serving host in the reader-facing label", () => {
    expect(MAIN_SITE_LABEL).toBe("naiasno.bg");
    expect(mainSiteHome(false)).toBe("https://naiasno.bg");
    expect(mainSiteHome(true)).toBe("https://naiasno.bg/en");
  });

  it("still builds news-site URLs against the news host", () => {
    // ⚠️ news.naiasno.bg does not resolve; the news app's own canonical is
    // deliberately NOT part of the rebrand.
    expect(newsUrlFor("/outlets")).toBe("https://news.electionsbg.com/outlets");
  });
});
