// The adapters' two dangerous judgements: what counts as an event, and what dates the feed.
//
// Both were wrong in the first cut and both were latent — the corpus happens not to contain
// the shapes that expose them today, which is exactly why they are pinned here with
// synthetic input rather than left to the committed artifact.

import { describe, expect, it } from "vitest";
import {
  openCallsAdapter,
  parliamentAdapter,
  type AdapterContext,
} from "./adapters";

/** A context whose `readJson` answers from a literal map. */
const ctxOf = (files: Record<string, unknown>): AdapterContext => ({
  root: "/nowhere",
  readJson: <T>(rel: string) => (files[rel] as T) ?? null,
});

const call = (over: Record<string, unknown> = {}) => ({
  source: "isun",
  sourceKey: "K1",
  kind: "call",
  title: "Прием",
  opensAt: "2026-08-20T09:00:00.000Z",
  closesAt: "2026-10-01T17:00:00.000Z",
  ...over,
});

const snapshot = (
  calls: unknown[],
  crawledAt = "2026-09-01T06:00:00.000Z",
) => ({
  source: "isun",
  crawledAt,
  calls,
});

describe("openCallsAdapter — what counts as an event", () => {
  it("publishes an open call", () => {
    const r = openCallsAdapter(
      ctxOf({ "data/opencalls/isun.json": snapshot([call()]) }),
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0].kind).toBe("call_opened");
  });

  it("REFUSES a consultation — its deadline is for comments, not for applying", () => {
    // ⚠️ The ИСУН snapshot holds `/Active` procedures AND `/PublicDiscussion` ones in the
    // SAME `calls` array. Published through this adapter a consultation reads „Отворен
    // прием: …" at actionability 0.9 with „остават N дни" — telling a reader to apply for
    // something that does not exist yet. `/funds/calls` keeps the two apart and refuses the
    // urgency badge on a consultation for the same reason.
    const r = openCallsAdapter(
      ctxOf({
        "data/opencalls/isun.json": snapshot([
          call(),
          call({ sourceKey: "K2", kind: "consultation", title: "Обсъждане" }),
        ]),
      }),
    );
    expect(r.events.map((e) => e.id)).toEqual(["funds:call_opened:isun:K1"]);
  });

  it("REFUSES a call that has not opened yet", () => {
    // `upcoming` is a first-class status: a call can be published before it opens. It
    // becomes an event on its opening day, not before.
    const r = openCallsAdapter(
      ctxOf({
        "data/opencalls/isun.json": snapshot([
          call(),
          call({ sourceKey: "FUTURE", opensAt: "2026-12-01T09:00:00.000Z" }),
        ]),
      }),
    );
    expect(r.events.map((e) => e.id)).toEqual(["funds:call_opened:isun:K1"]);
  });
});

describe("openCallsAdapter — the vintage", () => {
  it("is the CRAWL date, not the newest event date", () => {
    // ⚠️ THE ONE THAT COLLAPSED THE WHOLE FEED. `newest` feeds the feed's `computedAt`, and
    // `computedAt` is where the 30-day window ends — so a single row opening in December
    // dragged the window three months into the future. Measured on the real corpus with one
    // such row injected: 65 in-window events became 1, one category survived, and the page
    // announced „данни към 01.12.2026" for a corpus crawled in August.
    const r = openCallsAdapter(
      ctxOf({
        "data/opencalls/isun.json": snapshot(
          [
            call(),
            call({ sourceKey: "FUTURE", opensAt: "2026-12-01T09:00:00.000Z" }),
          ],
          "2026-09-01T06:00:00.000Z",
        ),
      }),
    );
    expect(r.newest).toBe("2026-09-01");
  });

  it("has no vintage at all when the snapshot carries none", () => {
    // A bare array (an older snapshot shape) states no crawl date. Claiming one from the
    // rows would be inventing the very thing this field exists to avoid.
    const r = openCallsAdapter(ctxOf({ "data/opencalls/isun.json": [call()] }));
    expect(r.newest).toBeNull();
  });

  it("reports unavailable when no snapshot is present at all", () => {
    // „Nothing is open" and „we could not look" are different answers.
    const r = openCallsAdapter(ctxOf({}));
    expect(r.available).toBe(false);
    expect(r.events).toEqual([]);
  });
});

describe("openCallsAdapter — date semantics", () => {
  it("dates a call by when it takes EFFECT and stores the deadline as a fact", () => {
    const r = openCallsAdapter(
      ctxOf({ "data/opencalls/isun.json": snapshot([call()]) }),
    );
    const e = r.events[0];
    expect(e.dateBasis).toBe("effective");
    expect(e.effectiveAt).toBe("2026-08-20T09:00:00.000Z");
    // Stored as an instant. „остават N дни" is computed by the renderer.
    expect(e.deadlineAt).toBe("2026-10-01T17:00:00.000Z");
    expect(Object.keys(e)).not.toContain("daysLeft");
  });

  it("declares its coverage as partial", () => {
    // ИСУН + ДФЗ + two of six Interreg programmes. „Nothing is open" would otherwise read
    // as a statement about every programme.
    const r = openCallsAdapter(
      ctxOf({ "data/opencalls/isun.json": snapshot([call()]) }),
    );
    expect(r.events[0].coverage.complete).toBe(false);
    expect(r.events[0].coverage.noteKey).toBeTruthy();
  });

  it("omits money it was never given rather than publishing a zero", () => {
    // ИСУН's procedure page frequently carries no budget. NULL is „not published", and a
    // zero would be a claim about the size of the call.
    const r = openCallsAdapter(
      ctxOf({
        "data/opencalls/isun.json": snapshot([call({ budgetEur: null })]),
      }),
    );
    expect(r.events[0].factArgs.budgetEur).toBeUndefined();
  });
});

describe("parliamentAdapter", () => {
  it("dates a sitting by the day it happened", () => {
    const r = parliamentAdapter(
      ctxOf({
        "data/parliament/votes/index.json": [
          { date: "2026-08-28", items: 12, ns: "52" },
        ],
      }),
    );
    expect(r.events[0].dateBasis).toBe("occurred");
    expect(r.events[0].occurredAt).toBe("2026-08-28T00:00:00.000Z");
    expect(r.newest).toBe("2026-08-28");
  });

  it("mints an id from the sitting, not from the run", () => {
    // An id carrying ingestion time would produce a new row for the same sitting on every
    // rebuild — the feed would look busy and never settle.
    const r = parliamentAdapter(
      ctxOf({
        "data/parliament/votes/index.json": [{ date: "2026-08-28", items: 1 }],
      }),
    );
    expect(r.events[0].id).toBe("parliament:sitting:2026-08-28");
  });

  it("skips a row with no usable item count", () => {
    const r = parliamentAdapter(
      ctxOf({
        "data/parliament/votes/index.json": [
          { date: "2026-08-28" },
          { date: "2026-08-27", items: 3 },
        ],
      }),
    );
    expect(r.events).toHaveLength(1);
  });
});
