// The two open-calls watchers. No network — `fetch` is stubbed.
//
// What is worth testing here is exactly what a fingerprint can get WRONG WITHOUT FAILING:
//   * a SWAP (one call closes, one opens the same day) leaving the fingerprint unchanged. That is
//     the single most likely daily change in this dataset, and a count-based fingerprint is blind
//     to it — so the test that earns its place is the one asserting the hash moves.
//   * a WAF interstitial or a markup change parsing to zero rows and being reported as
//     „no open calls" — a silent, confident lie about a register that is never empty.
//   * a tier CROSSING (draft guidance published for consultation becoming an active call): the
//     GUID is the same in both tiers, so a merged hash would miss it entirely.
// Plus the `describe` arms, which are what a human actually reads in the report.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isunProcedures } from "./isun_procedures";
import { sp2023Indicative } from "./sp2023_indicative";
import type { Fingerprint, WatchState } from "../types";

const GUIDS = [
  "543ada87-b33c-4e16-968d-2cef830ccd34",
  "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
  "9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b",
];

/** A minimal ИСУН listing page: `li[data-href]` nodes under a programme `li`. */
const listing = (guids: string[]): string =>
  `<html><body><ul><li>Програма "Тест" 2021-2027 (${guids.length})<ul>` +
  guids
    .map(
      (g, i) =>
        `<li data-href="/bg/s/Procedure/Info/${g}">BG16RFPR001-1.0${i + 1} Процедура ${i + 1}</li>`,
    )
    .join("") +
  `</ul></li></ul></body></html>`;

const state = (meta: Record<string, unknown>): WatchState => ({
  fingerprint: "prev",
  detail: "prev",
  meta,
  lastChecked: "2026-08-07T06:00:00.000Z",
  lastChanged: "2026-08-07T06:00:00.000Z",
});

/** Stub fetch so the ACTIVE and PublicDiscussion tiers can answer differently. */
const stubIsun = (active: string[], consult: string[]) => {
  vi.stubGlobal("fetch", (url: string) =>
    Promise.resolve(
      new Response(
        listing(String(url).includes("PublicDiscussion") ? consult : active),
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    ),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isun_procedures fingerprint", () => {
  it("declares a cadence fast enough for a deadline, and an honest publish period", () => {
    // Daily because the quantity at stake is a DEADLINE, not a total. `irregular` is accurate —
    // a Managing Authority publishes when it is ready — rather than a way to dodge the sampling
    // invariant in cadence.test.ts.
    expect(isunProcedures.cadence).toBe("daily");
    expect(isunProcedures.publishes).toBe("irregular");
  });

  it("is stable across reordering — the SET is the fact, not the order", async () => {
    stubIsun(GUIDS, []);
    const a = await isunProcedures.fingerprint();
    stubIsun([...GUIDS].reverse(), []);
    const b = await isunProcedures.fingerprint();
    expect(b.value).toBe(a.value);
  });

  it("MOVES on a swap that leaves the count identical", async () => {
    // One closes, one opens: 3 → 3. A count- or length-based fingerprint reports "unchanged" and
    // the ingest never re-runs, so the new call is invisible until something else changes.
    stubIsun(GUIDS, []);
    const before = await isunProcedures.fingerprint();
    stubIsun([GUIDS[0], GUIDS[1], "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"], []);
    const after = await isunProcedures.fingerprint();
    expect(after.value).not.toBe(before.value);
    expect(after.detail).toBe(before.detail); // same counts — the detail alone cannot tell you
  });

  it("MOVES when a GUID crosses from consultation to active", async () => {
    // Same union, different tiers. Hashing the union would miss the one transition that changes
    // „you may comment" into „you may apply".
    stubIsun([GUIDS[0]], [GUIDS[1]]);
    const before = await isunProcedures.fingerprint();
    stubIsun([GUIDS[0], GUIDS[1]], []);
    const after = await isunProcedures.fingerprint();
    expect(after.value).not.toBe(before.value);
  });

  it("THROWS on an empty active tier rather than reporting zero open calls", async () => {
    // A WAF interstitial answers 200 with a body that parses to nothing. Reported as a
    // fingerprint it would read as „ИСУН has no open procedures" — false, and the kind of false
    // that stops the ingest from running.
    stubIsun([], []);
    await expect(isunProcedures.fingerprint()).rejects.toThrow(
      /zero procedures/u,
    );
  });

  it("retries a transient upstream failure instead of deferring a day", async () => {
    // A single 502 from a WAF-fronted government portal otherwise marks the source `error`, and the
    // runner does not write state on error — so detection slips to the next daily run, on the one
    // source whose justification is that a week's lag costs a quarter of a preparation window.
    let n = 0;
    vi.stubGlobal("fetch", (url: string) => {
      n++;
      if (n === 1)
        return Promise.resolve(new Response("upstream", { status: 502 }));
      return Promise.resolve(
        new Response(
          listing(String(url).includes("PublicDiscussion") ? [] : GUIDS),
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      );
    });
    const fp = await isunProcedures.fingerprint();
    expect(fp.detail).toMatch(/3 отворени/u);
    expect(n).toBeGreaterThan(2);
  });

  it("tolerates an empty CONSULTATION tier, which is a real state", async () => {
    // Measured 2026-08-08: ИСУН's /PublicDiscussion was genuinely empty.
    stubIsun(GUIDS, []);
    const fp = await isunProcedures.fingerprint();
    expect(fp.detail).toMatch(/3 отворени · 0 за обсъждане/u);
  });
});

describe("isun_procedures describe", () => {
  /** `consult` is the consultation GUID LIST, not a count — the watcher diffs the set so a swap
   *  there is reported rather than vanishing into an unchanged total. */
  const fp = (guids: string[], consult: string[] = []): Fingerprint => ({
    value: "v",
    detail: `${guids.length} отворени · ${consult.length} за обсъждане`,
    meta: {
      active: guids.length,
      consultation: consult.length,
      activeGuids: [...guids].sort(),
      consultGuids: [...consult].sort(),
    },
  });

  it("is just the detail on a first run", () => {
    expect(isunProcedures.describe?.(null, fp(GUIDS))).toBe(fp(GUIDS).detail);
  });

  it("reports CLOSURES as well as openings", () => {
    // A day of pure closures is a real event — it is what the „затвори наскоро" archive and the
    // base rates are built from — and must not read as a no-op.
    const prev = state({
      active: 3,
      consultation: 0,
      activeGuids: [...GUIDS].sort(),
    });
    const line = isunProcedures.describe?.(prev, fp([GUIDS[0]]));
    expect(line).toMatch(/2 затворени/u);
    expect(line).not.toMatch(/нови/u);
  });

  it("reports both directions on a swap", () => {
    const prev = state({
      active: 3,
      consultation: 0,
      activeGuids: [...GUIDS].sort(),
    });
    const line = isunProcedures.describe?.(
      prev,
      fp([GUIDS[0], GUIDS[1], "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]),
    );
    expect(line).toMatch(/1 нови/u);
    expect(line).toMatch(/1 затворени/u);
  });

  it("names a consultation-tier arrival", () => {
    const prev = state({
      active: 3,
      consultation: 0,
      activeGuids: [...GUIDS].sort(),
      consultGuids: [],
    });
    expect(isunProcedures.describe?.(prev, fp(GUIDS, ["c1", "c2"]))).toMatch(
      /обсъждане: \+2/u,
    );
  });

  it("reports a consultation SWAP that leaves the count identical", () => {
    // The same shape the active tier is protected against, one tier over. With only a count delta
    // this produced a line indistinguishable from a no-op — on a day the fingerprint had moved.
    const prev = state({
      active: 3,
      consultation: 2,
      activeGuids: [...GUIDS].sort(),
      consultGuids: ["c1", "c2"],
    });
    expect(isunProcedures.describe?.(prev, fp(GUIDS, ["c1", "c3"]))).toMatch(
      /обсъждане: \+1 -1/u,
    );
  });

  it("says the set changed when no counter can express why", () => {
    // `describe` only runs on a CHANGED fingerprint, so a line identical to a no-op day is itself
    // misleading. There is no longer any input for which it returns the bare detail.
    const prev = state({
      active: 3,
      consultation: 0,
      activeGuids: [...GUIDS].sort(),
      consultGuids: [],
    });
    expect(isunProcedures.describe?.(prev, fp(GUIDS))).toMatch(
      /промяна в набора/u,
    );
  });
});

describe("sp2023_indicative", () => {
  const page = (names: string[]): string =>
    `<html><body>${names
      .map((n) => `<a href="/docs/${n}">график</a>`)
      .join("")}</body></html>`;

  beforeEach(() => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        String(url).endsWith(".xlsx")
          ? new Response(Buffer.from("PKfake-xlsx-bytes"), {
              status: 200,
            })
          : new Response(page(["IGG_2025.xlsx", "IGG_2026.xlsx"]), {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
      ),
    );
  });

  it("samples an annual document weekly", () => {
    expect(sp2023Indicative.cadence).toBe("weekly");
    expect(sp2023Indicative.publishes).toBe("annual");
  });

  it("picks the LATEST year and reports it", async () => {
    const fp = await sp2023Indicative.fingerprint();
    expect(fp.detail).toMatch(/график 2026/u);
    expect((fp.meta as { year: number }).year).toBe(2026);
  });

  it("THROWS when the page yields no XLSX link", async () => {
    // The schedule is a standing document, so zero links means the markup moved — not that ДФЗ
    // has stopped publishing one.
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response("<html><body>nothing here</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(sp2023Indicative.fingerprint()).rejects.toThrow(
      /zero XLSX links/u,
    );
  });

  it("distinguishes a new YEAR from an amendment to the same one", async () => {
    const fp = await sp2023Indicative.fingerprint();
    const meta = fp.meta as {
      url: string;
      year: number;
      bytes: number;
      sha: string;
    };
    expect(
      sp2023Indicative.describe?.(state({ ...meta, year: 2025 }), fp),
    ).toMatch(/нова година: 2025→2026/u);
    expect(
      sp2023Indicative.describe?.(
        state({ ...meta, bytes: meta.bytes - 512 }),
        fp,
      ),
    ).toMatch(/изменен график, \+512 B/u);
    // A SAME-LENGTH amendment — a date or a figure edited in place, which is the common case for
    // this document. It used to render „изменен график, +0 B", i.e. as a no-op on a run where the
    // fingerprint had definitely moved.
    expect(
      sp2023Indicative.describe?.(state({ ...meta, sha: "different" }), fp),
    ).toMatch(/различно съдържание/u);
    expect(
      sp2023Indicative.describe?.(
        state({ ...meta, url: "https://old.xlsx" }),
        fp,
      ),
    ).toMatch(/нов файл за същата година/u);
  });
});
