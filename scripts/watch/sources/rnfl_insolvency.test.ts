// Unit tests for the РНФЛ (личен фалит) watcher. No network: fetchText is mocked.
// Runs in the `node` Vitest project (see docs/testing-standards.md).
//
// The properties worth protecting here are not "does it hash". They are: no probe may
// ever carry a personal identifier or walk a file-number range (the plan's §2 and §4);
// a transient outage must NOT produce a false "changed" line (it throws, so the runner
// keeps the previous state); and neither reported signal may answer "yes" to an input
// that does not mean yes.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../fingerprint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../fingerprint")>()),
  fetchText: vi.fn(),
}));

import { fetchText } from "../fingerprint";
import type { Fingerprint, WatchState } from "../types";
import { rnflInsolvency, RNFL_URLS } from "./rnfl_insolvency";

const mockedFetchText = vi.mocked(fetchText);

const COURTS = JSON.stringify([
  { code: "211", label: "Районен съд – Айтос" },
  { code: "511", label: "Районен съд – Ардино" },
]);
const ACT_TYPES = JSON.stringify([
  { code: "107", label: "Решение за обявяване в несъстоятелност" },
]);
const HOME_HTML = "<!doctype html><html>РНФЛ landing</html>";

/** The live state as of 2026-08-03: no statistics page, no records. */
const wireUpstream = (
  over: { statistics?: string | null; deed?: string | null } = {},
): void => {
  mockedFetchText.mockImplementation(async (url: string) => {
    if (url === RNFL_URLS.statistics)
      return over.statistics === undefined ? null : over.statistics;
    if (url === RNFL_URLS.home) return HOME_HTML;
    if (url === RNFL_URLS.deed) return over.deed === undefined ? "" : over.deed;
    if (url === RNFL_URLS.nomenclatures[0]) return COURTS;
    if (url === RNFL_URLS.nomenclatures[1]) return ACT_TYPES;
    throw new Error(`unexpected probe: ${url}`);
  });
};

/** Wire only the nomenclature probes, leaving the two signals to the caller. */
const wireNomenclatures = (
  courts: string,
  actTypes: string = ACT_TYPES,
): void => {
  mockedFetchText.mockImplementation(async (url: string) => {
    if (url === RNFL_URLS.statistics) return null;
    if (url === RNFL_URLS.home) return HOME_HTML;
    if (url === RNFL_URLS.deed) return "";
    if (url === RNFL_URLS.nomenclatures[0]) return courts;
    return actTypes;
  });
};

const stateFrom = (fp: Fingerprint): WatchState => ({
  fingerprint: fp.value,
  detail: fp.detail,
  meta: fp.meta,
  lastChecked: "2026-08-03T00:00:00Z",
  lastChanged: "2026-08-03T00:00:00Z",
});

const lineFor = (before: Fingerprint, after: Fingerprint): string =>
  rnflInsolvency.describe?.(stateFrom(before), after) ?? "";

describe("rnflInsolvency", () => {
  beforeEach(() => {
    mockedFetchText.mockReset();
  });

  it("declares an irregular upstream, so the cadence invariant does not apply", () => {
    expect(rnflInsolvency.publishes).toBe("irregular");
    expect(rnflInsolvency.cadence).toBe("weekly");
    expect(rnflInsolvency.id).toBe("rnfl_insolvency");
  });

  // ---- the plan's §2 / §4 boundaries, mechanically enforced ----

  it("never probes a route carrying a personal identifier", async () => {
    wireUpstream();
    await rnflInsolvency.fingerprint();
    const probed = mockedFetchText.mock.calls.map(([url]) => url);
    expect(probed.length).toBeGreaterThan(0);
    for (const url of probed) {
      expect(url).not.toContain("/Ident/");
      expect(url).not.toContain("ObjectType");
    }
  });

  it("pins the probed file number to 1 — the plan's §2 refuses a range", () => {
    expect(RNFL_URLS.deed).toMatch(/\/RNFL\/api\/Reports\/1\/Deed$/);
    const everyUrl = Object.values(RNFL_URLS).flat().join(" ");
    expect(everyUrl).not.toMatch(/\/Reports\/\d{2,}/);
  });

  it("probes exactly one file number, never a range", async () => {
    wireUpstream();
    await rnflInsolvency.fingerprint();
    const deedProbes = mockedFetchText.mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes("/Reports/"));
    expect(deedProbes).toEqual([RNFL_URLS.deed]);
  });

  // ---- load-bearing fetch options ----

  it("passes allow404 on the statistics probe — a 404 is its NORMAL state, not an error", async () => {
    mockedFetchText.mockImplementation(
      async (url: string, opts?: { allow404?: boolean }) => {
        if (url === RNFL_URLS.statistics) {
          // Without allow404 this rejects, the source errors on EVERY run, and the T2
          // trigger is never detected — broken while merely looking unreachable.
          if (!opts?.allow404) throw new Error("HTTP 404 Not Found");
          return null;
        }
        if (url === RNFL_URLS.home) return HOME_HTML;
        if (url === RNFL_URLS.deed) {
          if (!opts?.allow404) throw new Error("HTTP 404 Not Found");
          return "";
        }
        if (url === RNFL_URLS.nomenclatures[0]) return COURTS;
        return ACT_TYPES;
      },
    );
    const fp = await rnflInsolvency.fingerprint();
    expect(fp.meta).toMatchObject({ statistics: "absent", register: "empty" });
  });

  it("keeps every probe on the reduced courtesy retry budget", async () => {
    wireUpstream();
    await rnflInsolvency.fingerprint();
    expect(mockedFetchText.mock.calls.length).toBeGreaterThan(0);
    for (const [url, opts] of mockedFetchText.mock.calls)
      expect(
        (opts as { retries?: number } | undefined)?.retries,
        `${url} must not fall back to the default retry budget`,
      ).toBe(1);
  });

  // ---- the two reported signals ----

  it("reads the 2026-08-03 live state as absent statistics and an empty register", async () => {
    wireUpstream();
    const fp = await rnflInsolvency.fingerprint();
    expect(fp.meta).toMatchObject({ statistics: "absent", register: "empty" });
    expect(fp.value).toContain("stats:absent");
    expect(fp.value).toContain("register:empty");
  });

  it("is unchanged across two identical runs", async () => {
    wireUpstream();
    const a = await rnflInsolvency.fingerprint();
    const b = await rnflInsolvency.fingerprint();
    expect(b.value).toBe(a.value);
  });

  it("flips and names the T2 trigger when /statistic-rnfl goes live", async () => {
    wireUpstream();
    const before = await rnflInsolvency.fingerprint();
    wireUpstream({ statistics: "<html>статистика по РНФЛ</html>" });
    const after = await rnflInsolvency.fingerprint();

    expect(after.value).not.toBe(before.value);
    expect(after.meta).toMatchObject({ statistics: "present" });
    const line = lineFor(before, after);
    expect(line).toContain("/statistic-rnfl");
    expect(line).toContain("T2");
  });

  // A 302 back to /home-rnfl is indistinguishable from a real page to fetchText, which
  // follows redirects and exposes neither status nor final URL. Announcing the T2
  // trigger for one would send an operator to build a table over an aggregate that does
  // not exist.
  it("does not read a redirect to the landing page as the aggregate going live", async () => {
    wireUpstream({ statistics: HOME_HTML });
    const fp = await rnflInsolvency.fingerprint();
    expect(fp.meta).toMatchObject({ statistics: "absent" });
    expect(fp.value).toContain("stats:absent");
    expect(fp.detail).toContain("landing page");
  });

  it("carries the statistics body size and hash in meta for eyeballing", async () => {
    const body = "<html>статистика по РНФЛ</html>";
    wireUpstream({ statistics: body });
    const fp = await rnflInsolvency.fingerprint();
    expect(fp.meta?.statsBytes).toBe(body.length);
    expect(typeof fp.meta?.statsHash).toBe("string");
    // meta only — a content hash in `value` would flap on every edit once live.
    expect(fp.value).not.toContain(String(fp.meta?.statsHash));
  });

  it("flips when file number 1 starts returning a record", async () => {
    wireUpstream();
    const before = await rnflInsolvency.fingerprint();
    wireUpstream({ deed: '{"fileNumber":"1","court":"211"}' });
    const after = await rnflInsolvency.fingerprint();

    expect(after.value).not.toBe(before.value);
    expect(after.meta).toMatchObject({ register: "non-empty" });
    expect(lineFor(before, after)).toContain("вписвания");
  });

  it("names the reverse transition when дело №1 stops returning a record", async () => {
    wireUpstream({ deed: '{"fileNumber":"1"}' });
    const before = await rnflInsolvency.fingerprint();
    wireUpstream();
    const after = await rnflInsolvency.fingerprint();

    expect(after.value).not.toBe(before.value);
    const line = lineFor(before, after);
    expect(line).toContain("НЕ връща");
    // Must not degrade to the bare detail line, which reads as routine noise.
    expect(line).not.toContain(after.detail);
  });

  it("treats a 404 on the deed probe as an empty register, not an error", async () => {
    wireUpstream({ deed: null });
    const fp = await rnflInsolvency.fingerprint();
    expect(fp.meta).toMatchObject({ register: "empty" });
  });

  // An empty JSON envelope is what an `Ok(result)` controller returns where this one
  // currently returns 204 — a plausible upstream change that must not read as "the
  // register has entries".
  it.each(["[]", "{}", "null", "   "])(
    "treats an empty deed envelope (%s) as an empty register",
    async (body) => {
      wireUpstream({ deed: body });
      const fp = await rnflInsolvency.fingerprint();
      expect(fp.meta).toMatchObject({ register: "empty" });
    },
  );

  // ---- the schema fold ----

  it("folds nomenclatures order-insensitively", async () => {
    wireUpstream();
    const before = await rnflInsolvency.fingerprint();
    wireNomenclatures(
      JSON.stringify((JSON.parse(COURTS) as unknown[]).slice().reverse()),
    );
    const after = await rnflInsolvency.fingerprint();
    expect(after.value).toBe(before.value);
  });

  it("flips on a genuine nomenclature change", async () => {
    wireUpstream();
    const before = await rnflInsolvency.fingerprint();
    wireNomenclatures(
      JSON.stringify([
        ...(JSON.parse(COURTS) as unknown[]),
        { code: "999", label: "Районен съд – Нов" },
      ]),
    );
    const after = await rnflInsolvency.fingerprint();
    expect(after.value).not.toBe(before.value);
    expect(lineFor(before, after)).toContain("номенклатурите");
  });

  // The two dictionaries are joined into one hash; a delimiter inside the value
  // alphabet would let a swap between them fold to the same string.
  it("distinguishes the two dictionaries from each other", async () => {
    wireUpstream();
    const before = await rnflInsolvency.fingerprint();
    wireNomenclatures(ACT_TYPES, COURTS); // the two payloads swapped
    const after = await rnflInsolvency.fingerprint();
    expect(after.value).not.toBe(before.value);
  });

  // ---- degrade behaviour ----

  // The anti-flap property. A sentinel would make an outage look like a change twice
  // over (in and out); throwing makes the runner report `error` and keep the previous
  // fingerprint, so the cost of an outage is latency, never a false report.
  it("throws when a probe fails, so the runner keeps the previous state", async () => {
    mockedFetchText.mockImplementation(async (url: string) => {
      if (url === RNFL_URLS.statistics) return null;
      if (url === RNFL_URLS.deed) return "";
      throw new Error("HTTP 503 Service Unavailable");
    });
    await expect(rnflInsolvency.fingerprint()).rejects.toThrow("503");
  });

  it("names what the earlier probes saw when a nomenclature is unreachable", async () => {
    mockedFetchText.mockImplementation(async (url: string) => {
      if (url === RNFL_URLS.statistics) return null;
      if (url === RNFL_URLS.deed) return "";
      throw new Error("HTTP 503 Service Unavailable");
    });
    // A week of latency should not also be a week of silence about the PRIMARY signal.
    await expect(rnflInsolvency.fingerprint()).rejects.toThrow(
      /stats:absent register:empty/,
    );
  });

  it("throws rather than folding a non-JSON nomenclature body", async () => {
    wireNomenclatures("<!doctype html><html>SPA shell</html>");
    await expect(rnflInsolvency.fingerprint()).rejects.toThrow(
      /non-JSON nomenclature/,
    );
  });

  it("throws rather than folding a wrapped (non-array) nomenclature payload", async () => {
    wireNomenclatures(JSON.stringify({ items: JSON.parse(COURTS) }));
    await expect(rnflInsolvency.fingerprint()).rejects.toThrow(
      /is not an array/,
    );
  });

  it("throws with a named error on a non-object nomenclature entry", async () => {
    wireNomenclatures(JSON.stringify([null]));
    await expect(rnflInsolvency.fingerprint()).rejects.toThrow(
      /non-object entry/,
    );
  });

  it("throws when a nomenclature body is absent", async () => {
    mockedFetchText.mockImplementation(async (url: string) => {
      if (url === RNFL_URLS.statistics) return null;
      if (url === RNFL_URLS.home) return HOME_HTML;
      if (url === RNFL_URLS.deed) return "";
      return null;
    });
    await expect(rnflInsolvency.fingerprint()).rejects.toThrow(
      /no nomenclature body/,
    );
  });

  // ---- the report line ----

  it("falls back to the current detail when nothing notable moved", async () => {
    wireUpstream();
    const fp = await rnflInsolvency.fingerprint();
    const line = lineFor(fp, fp);
    expect(line).toContain(fp.detail);
    expect(line).toContain("rnfl-insolvency-v1.md");
  });

  it("says the source has no ingest script on every line it emits", async () => {
    wireUpstream();
    const fp = await rnflInsolvency.fingerprint();
    expect(rnflInsolvency.describe?.(null, fp)).toContain(
      "няма скрипт за ингест",
    );
  });
});
