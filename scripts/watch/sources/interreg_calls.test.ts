// The Interreg watcher, and specifically what happens when a programme's site is DOWN.
//
// That is the whole reason this watcher differs from `isun_procedures`: ИСУН is one register, so
// a failed fetch is a failed probe. Here there are independent sites, three of Bulgaria's six
// cross-border programmes are already unreachable, and Black Sea Basin went down mid-crawl on
// the very first real run. A watcher that folds an outage in as „zero calls" reports every one
// of that programme's calls as closed, then as new when the site returns — crying wolf on
// exactly the signal a reader is supposed to trust.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Fingerprint, WatchState } from "../types";

const fetchText = vi.hoisted(() => vi.fn());
vi.mock("../fingerprint", async (orig) => ({
  ...(await orig<typeof import("../fingerprint")>()),
  fetchText,
}));

const { interregCalls } = await import("./interreg_calls");
const { PROGRAMMES } = await import("../../opencalls/interreg_parse");
const [GBG, BSB] = PROGRAMMES;

/** An index page listing the given call slugs under a programme's own prefix. */
const indexHtml = (p: (typeof PROGRAMMES)[number], slugs: string[]) =>
  slugs.map((s) => `<a href="${p.callPrefix}${s}/">${s}</a>`).join("\n");

const serve = (gbg: string[] | null, bsb: string[] | null) =>
  fetchText.mockImplementation(async (url: string) => {
    if (url === GBG.indexUrl) return gbg === null ? null : indexHtml(GBG, gbg);
    if (url === BSB.indexUrl) return bsb === null ? null : indexHtml(BSB, bsb);
    return null;
  });

/** A prior run, as the runner would have persisted it. `meta` is the only field `describe`
 *  reads, but the shape is built in full so a change to `WatchState` breaks here loudly rather
 *  than being papered over by a cast through `unknown`. */
const asState = (fp: Fingerprint): WatchState => ({
  fingerprint: fp.value,
  detail: fp.detail,
  meta: fp.meta,
  lastChecked: "2026-08-09T00:00:00.000Z",
  lastChanged: "2026-08-09T00:00:00.000Z",
});

afterEach(() => fetchText.mockReset());

describe("fingerprint", () => {
  it("hashes the call slugs of every programme that answered", async () => {
    serve(["a", "b"], ["x"]);
    const fp = await interregCalls.fingerprint();
    expect(fp.detail).toContain("3 покани от 2 програми");
    expect(fp.detail).not.toContain("недостъпни");
  });

  it("is STABLE across runs with the same slugs in a different link order", async () => {
    // The slugs are sorted before hashing; a CMS that reorders its list must not read as change.
    serve(["b", "a"], ["x"]);
    const first = await interregCalls.fingerprint();
    serve(["a", "b"], ["x"]);
    expect((await interregCalls.fingerprint()).value).toBe(first.value);
  });

  it("MOVES when a call appears, and when one is taken down", async () => {
    serve(["a"], ["x"]);
    const base = (await interregCalls.fingerprint()).value;
    serve(["a", "b"], ["x"]);
    expect((await interregCalls.fingerprint()).value).not.toBe(base);
    serve([], ["x"]); // gbg now lists nothing → treated as down, see below
    const gone = await interregCalls.fingerprint();
    expect(gone.value).not.toBe(base);
  });

  it("moves when a slug changes PROGRAMME, even though the union does not", async () => {
    serve(["a"], ["b"]);
    const one = (await interregCalls.fingerprint()).value;
    serve(["b"], ["a"]);
    // The union {a,b} is unchanged; only the attribution moved. Note this is carried by the
    // sorted-code ordering and the separator, not by the programme code in the hashed string —
    // see the comment on that line for why the code is there anyway.
    expect((await interregCalls.fingerprint()).value).not.toBe(one);
  });

  it("names a down programme in the detail line instead of counting it as zero", async () => {
    serve(["a", "b"], null);
    const fp = await interregCalls.fingerprint();
    expect(fp.detail).toContain("2 покани от 1 програми");
    expect(fp.detail).toContain("недостъпни: interreg-bsb");
  });

  it("treats a 200 with ZERO call links as down, not as an emptied programme", async () => {
    // A markup change or a WAF interstitial returns 200 and parses to nothing. Both indexes have
    // always listed at least two calls, so zero means „we could not read it" — and reporting it
    // as an empty programme would mark every one of its calls closed.
    serve(["a"], []);
    const fp = await interregCalls.fingerprint();
    expect(fp.detail).toContain("недостъпни: interreg-bsb");
  });

  it("THROWS when no programme could be read — a probe failure is not a finding", async () => {
    serve(null, null);
    await expect(interregCalls.fingerprint()).rejects.toThrow(/probe failure/);
  });

  it("a null from fetchText counts as down, not as an empty page", async () => {
    // `fetchText` returns null rather than throwing. Relying on a downstream crash would work by
    // accident and break the moment `parseIndex` grew a null guard — with the failure mode being
    // „programme up, 0 calls", i.e. every call reported closed.
    serve(["a"], null);
    expect((await interregCalls.fingerprint()).detail).toContain("недостъпни");
  });
});

describe("describe — an outage must read as an outage", () => {
  it("reports a new call and a withdrawn one, in both directions", async () => {
    serve(["a"], ["x"]);
    const prev = asState(await interregCalls.fingerprint());
    serve(["a", "b"], []);
    const curr = await interregCalls.fingerprint();
    const line = interregCalls.describe?.(prev, curr) ?? "";
    expect(line).toContain("interreg-gr-bg: 1 нови");
    // bsb went dark — it must be named as unreachable, NOT reported as „1 свалени".
    expect(line).toContain("недостъпни: interreg-bsb");
    expect(line).not.toContain("interreg-bsb: 1 свалени");
  });

  it("does NOT report a down programme's calls as withdrawn", async () => {
    // THE test. Folding an outage in as zero calls is what makes a watcher cry wolf.
    serve(["a"], ["x", "y"]);
    const prev = asState(await interregCalls.fingerprint());
    serve(["a"], null);
    const line =
      interregCalls.describe?.(prev, await interregCalls.fingerprint()) ?? "";
    expect(line).not.toMatch(/2 свалени/);
    expect(line).toContain("недостъпни: interreg-bsb");
  });

  it("on recovery reports the programme as back, not every call as new", async () => {
    serve(["a"], null);
    const prev = asState(await interregCalls.fingerprint());
    serve(["a"], ["x", "y"]);
    const line =
      interregCalls.describe?.(prev, await interregCalls.fingerprint()) ?? "";
    expect(line).toContain("interreg-bsb: отново достъпна");
    expect(line).not.toMatch(/2 нови/);
  });

  it("falls back to the detail line on a first run", async () => {
    serve(["a"], ["x"]);
    const fp = await interregCalls.fingerprint();
    expect(interregCalls.describe?.(null, fp)).toBe(fp.detail);
  });

  it("says something rather than nothing when the hash moved for no diffable reason", async () => {
    serve(["a"], ["x"]);
    const fp = await interregCalls.fingerprint();
    expect(interregCalls.describe?.(asState(fp), fp)).toBe(fp.detail);
  });
});

describe("cadence", () => {
  it("is daily and irregular — the quantity at stake is a deadline", () => {
    expect(interregCalls.cadence).toBe("daily");
    expect(interregCalls.publishes).toBe("irregular");
  });
});
