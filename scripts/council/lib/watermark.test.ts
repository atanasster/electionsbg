// Gates for the watermark rule.
//
// The defect these close is the quietest one in the pipeline: parsers
// filter candidates on `date > sinceDate`, so a watermark that advances
// past a protocol which failed to download removes it from consideration
// for ever. It is reported once, as one line among "N fetch error(s)", and
// the next run cannot even see it. Nothing is red; the protocol is simply
// never in the data.

import { describe, expect, it } from "vitest";
import {
  computeWatermark,
  MAX_BLOCKING_ATTEMPTS,
  MAX_DEFERRED_ENTRIES,
} from "./watermark";
import type { MuniScrapeError } from "./types";

const res = (date: string, sourceUrl = `https://x/${date}.pdf`) => ({
  date,
  sourceUrl,
});
const NOW = "2026-08-09T10:00:00.000Z";

const run = (over: {
  previous?: string;
  resolutions?: { date: string; sourceUrl: string }[];
  errors?: MuniScrapeError[];
  candidatesDropped?: number;
  previousDeferred?: Parameters<typeof computeWatermark>[0]["previousDeferred"];
}) =>
  computeWatermark({
    previous: over.previous,
    resolutions: over.resolutions ?? [],
    errors: over.errors ?? [],
    candidatesDropped: over.candidatesDropped,
    previousDeferred: over.previousDeferred,
    now: NOW,
  });

describe("watermark advance", () => {
  it("advances to the newest date when nothing failed", () => {
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-07-01"), res("2026-07-15")],
    });
    expect(d.next).toBe("2026-07-15");
    expect(d.heldBy).toBeUndefined();
  });

  it("does NOT advance past a protocol that failed to download", () => {
    // The original defect, exactly: 07-01 times out, 07-15 parses.
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-07-15")],
      errors: [
        {
          url: "https://x/07-01.pdf",
          date: "2026-07-01",
          kind: "fetch",
          message: "timeout",
        },
      ],
    });
    // Not 2026-07-15 — that would make 07-01 unreachable for ever.
    expect(d.next).toBe("2026-06-01");
    expect(d.heldBy?.date).toBe("2026-07-01");
  });

  it("advances up to the newest protocol strictly older than the failure", () => {
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-06-10"), res("2026-07-15")],
      errors: [
        {
          url: "https://x/07-01.pdf",
          date: "2026-07-01",
          kind: "fetch",
          message: "timeout",
        },
      ],
    });
    // 06-10 is safely complete; the next run's `date > 2026-06-10` filter
    // still includes the failed 07-01.
    expect(d.next).toBe("2026-06-10");
  });

  it("freezes completely on a DISCOVERY failure, which has no date", () => {
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-07-15")],
      errors: [
        { url: "https://x/2026-index", kind: "discovery", message: "HTTP 520" },
      ],
    });
    // An un-enumerated index could have hidden anything, so no date after
    // `previous` can be claimed complete.
    expect(d.next).toBe("2026-06-01");
    expect(d.heldBy?.url).toBe("https://x/2026-index");
  });

  it("is not held by a `content` skip, which retrying cannot fix", () => {
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-07-15")],
      errors: [
        {
          url: "https://x/07-01.pdf",
          date: "2026-07-01",
          kind: "content",
          message: "scanned PDF",
        },
      ],
    });
    expect(d.next).toBe("2026-07-15");
    // ...but it is not forgotten.
    expect(d.deferred.map((x) => x.url)).toEqual(["https://x/07-01.pdf"]);
  });

  it("is not held by an `enrich` failure, and does not defer it", () => {
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-07-15")],
      errors: [
        {
          url: "https://x/protokol-9.pdf",
          date: "2026-07-15",
          kind: "enrich",
          message: "OCR failed",
        },
      ],
    });
    // The protocol itself landed; only the per-councillor extra did not.
    expect(d.next).toBe("2026-07-15");
    expect(d.deferred).toEqual([]);
  });

  it("never moves backwards", () => {
    const d = run({
      previous: "2026-07-01",
      resolutions: [],
      errors: [
        {
          url: "https://x/06-01.pdf",
          date: "2026-06-01",
          kind: "fetch",
          message: "timeout",
        },
      ],
    });
    expect(d.next).toBe("2026-07-01");
  });

  it("holds on the EARLIEST failure when several fail", () => {
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-06-05"), res("2026-06-20")],
      errors: [
        {
          url: "https://x/b.pdf",
          date: "2026-06-25",
          kind: "fetch",
          message: "timeout",
        },
        {
          url: "https://x/a.pdf",
          date: "2026-06-10",
          kind: "fetch",
          message: "timeout",
        },
      ],
    });
    expect(d.next).toBe("2026-06-05");
    expect(d.heldBy?.date).toBe("2026-06-10");
  });
});

describe("a truncated candidate list", () => {
  // F-001. `--max N` sorts newest-first and drops the rest; a dropped
  // candidate raises NO error, so before this the run looked perfectly
  // clean and the watermark jumped to the newest of the N it read —
  // filtering everything older out of every future run. SKILL.md
  // documented `--max 5` without `--dry`.
  it("does not advance when candidates were dropped", () => {
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-07-20"), res("2026-07-15")], // the 2 newest of 30
      candidatesDropped: 28,
    });
    expect(d.next).toBe("2026-06-01");
    expect(d.heldByTruncation).toBe(28);
  });

  it("advances normally when nothing was dropped", () => {
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-07-20")],
      candidatesDropped: 0,
    });
    expect(d.next).toBe("2026-07-20");
    expect(d.heldByTruncation).toBeUndefined();
  });

  it("reports truncation rather than blaming an error", () => {
    // Both are "we did not look at everything", but they send the operator
    // to different places — one to a URL, one to their own command line.
    const d = run({
      previous: "2026-06-01",
      resolutions: [res("2026-07-20")],
      candidatesDropped: 3,
      errors: [
        {
          url: "https://x/a.pdf",
          date: "2026-07-01",
          kind: "fetch",
          message: "timeout",
        },
      ],
    });
    expect(d.heldByTruncation).toBe(3);
    expect(d.heldBy).toBeUndefined();
  });
});

describe("deferred ledger", () => {
  it("keeps the first-seen date across runs while the failure repeats", () => {
    const err: MuniScrapeError = {
      url: "https://x/a.pdf",
      date: "2026-07-01",
      kind: "fetch",
      message: "timeout",
    };
    const first = run({ previous: "2026-06-01", errors: [err] });
    expect(first.deferred[0].attempts).toBe(1);

    const second = computeWatermark({
      previous: "2026-06-01",
      resolutions: [],
      errors: [err],
      previousDeferred: first.deferred,
      now: "2026-08-10T10:00:00.000Z",
    });
    expect(second.deferred[0].attempts).toBe(2);
    // "stuck since the 9th", not "stuck since today".
    expect(second.deferred[0].firstSeen).toBe(NOW);
  });

  it("clears an entry when the protocol finally lands", () => {
    const first = run({
      errors: [
        {
          url: "https://x/a.pdf",
          date: "2026-07-01",
          kind: "fetch",
          message: "timeout",
        },
      ],
    });
    const second = computeWatermark({
      previous: "2026-06-01",
      resolutions: [res("2026-07-01", "https://x/a.pdf")],
      errors: [],
      previousDeferred: first.deferred,
      now: NOW,
    });
    expect(second.deferred).toEqual([]);
    expect(second.resolved.map((d) => d.url)).toEqual(["https://x/a.pdf"]);
    expect(second.next).toBe("2026-07-01");
  });

  it("drops a still-blocking entry that stopped being reported", () => {
    // It is not given up on, so the next run re-attempts it; silence means
    // it succeeded. Carrying it would leave a permanent phantom.
    const first = run({
      errors: [
        {
          url: "https://x/a.pdf",
          date: "2026-07-01",
          kind: "fetch",
          message: "timeout",
        },
      ],
    });
    const second = computeWatermark({
      previous: "2026-06-01",
      resolutions: [res("2026-07-05")],
      errors: [],
      previousDeferred: first.deferred,
      now: NOW,
    });
    expect(second.deferred).toEqual([]);
  });

  it("keeps a `content` skip even though it is never re-attempted", () => {
    const first = run({
      errors: [
        {
          url: "https://x/scan.pdf",
          date: "2026-07-01",
          kind: "content",
          message: "scanned PDF",
        },
      ],
    });
    expect(first.deferred[0].givenUp).toBe(true);
    // A later run does not see it at all — the watermark has passed it —
    // and it must still be on the ledger.
    const second = computeWatermark({
      previous: "2026-07-01",
      resolutions: [res("2026-07-20")],
      errors: [],
      previousDeferred: first.deferred,
      now: NOW,
    });
    expect(second.deferred.map((d) => d.url)).toEqual(["https://x/scan.pdf"]);
  });

  it("defers a discovery failure, so the attempts valve can reach it", () => {
    // It has to be on the ledger to accumulate `attempts` — otherwise a
    // year index that 404s for ever freezes the município's watermark for
    // ever, with nothing red anywhere.
    const d = run({
      errors: [
        { url: "https://x/index", kind: "discovery", message: "HTTP 520" },
      ],
    });
    expect(d.deferred.map((x) => x.url)).toEqual(["https://x/index"]);
    expect(d.deferred[0].givenUp).toBe(false);
  });

  it("clears a discovery entry by silence — it is re-attempted every run", () => {
    // Unlike a `content` skip, a year index is read on every pass whatever
    // the watermark says. So a run that does not report it has read it,
    // and carrying it would leave a permanent phantom.
    const first = run({
      errors: [
        { url: "https://x/index", kind: "discovery", message: "HTTP 520" },
      ],
    });
    const second = computeWatermark({
      previous: "2026-06-01",
      resolutions: [res("2026-07-01")],
      errors: [],
      previousDeferred: first.deferred,
      now: NOW,
    });
    expect(second.deferred).toEqual([]);
    expect(second.next).toBe("2026-07-01");
  });

  it("keeps clearing a GIVEN-UP discovery entry by silence too", () => {
    // The valve stops it blocking; it does not stop it being re-attempted,
    // so silence still means the index came back.
    let deferred = run({
      errors: [
        { url: "https://x/index", kind: "discovery", message: "HTTP 520" },
      ],
    }).deferred;
    for (let i = 1; i < MAX_BLOCKING_ATTEMPTS; i++) {
      deferred = computeWatermark({
        previous: "2026-06-01",
        resolutions: [],
        errors: [
          { url: "https://x/index", kind: "discovery", message: "HTTP 520" },
        ],
        previousDeferred: deferred,
        now: NOW,
      }).deferred;
    }
    expect(deferred[0].givenUp).toBe(true);
    const recovered = computeWatermark({
      previous: "2026-06-01",
      resolutions: [res("2026-07-01")],
      errors: [],
      previousDeferred: deferred,
      now: NOW,
    });
    expect(recovered.deferred).toEqual([]);
  });

  it("caps the ledger and reports what it evicted", () => {
    // Several parsers defer a PAGE url while resolutions carry a DOCUMENT
    // url, so those entries can never match and are immortal. Unbounded,
    // the state file grows for the life of the município.
    const many = Array.from({ length: MAX_DEFERRED_ENTRIES + 5 }, (_, i) => ({
      url: `https://x/scan-${String(i).padStart(3, "0")}.pdf`,
      kind: "content" as const,
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      message: "scanned PDF",
    }));
    const d = run({ errors: many });
    expect(d.deferred.length).toBe(MAX_DEFERRED_ENTRIES);
    expect(d.evicted.length).toBe(5);
    // Nothing vanishes without being named.
    expect(d.evicted.every((e) => e.url.startsWith("https://x/scan-"))).toBe(
      true,
    );
  });
});

describe("the escape valve", () => {
  it("stops blocking after MAX_BLOCKING_ATTEMPTS and says so", () => {
    const err: MuniScrapeError = {
      url: "https://x/dead.pdf",
      date: "2026-07-01",
      kind: "fetch",
      message: "HTTP 404",
    };
    let deferred = run({ previous: "2026-06-01", errors: [err] }).deferred;
    for (let i = 2; i < MAX_BLOCKING_ATTEMPTS; i++) {
      const d = computeWatermark({
        previous: "2026-06-01",
        resolutions: [res("2026-07-20")],
        errors: [err],
        previousDeferred: deferred,
        now: NOW,
      });
      // Still holding the line.
      expect(d.next).toBe("2026-06-01");
      deferred = d.deferred;
    }
    const last = computeWatermark({
      previous: "2026-06-01",
      resolutions: [res("2026-07-20")],
      errors: [err],
      previousDeferred: deferred,
      now: NOW,
    });
    // One dead URL must not wedge the município's ingest for ever.
    expect(last.next).toBe("2026-07-20");
    expect(last.gaveUp.map((d) => d.url)).toEqual(["https://x/dead.pdf"]);
    expect(last.deferred[0].attempts).toBe(MAX_BLOCKING_ATTEMPTS);
    expect(last.deferred[0].givenUp).toBe(true);
  });

  it("reports giving up exactly once, not on every later run", () => {
    const err: MuniScrapeError = {
      url: "https://x/dead.pdf",
      date: "2026-07-01",
      kind: "fetch",
      message: "HTTP 404",
    };
    let deferred = run({ errors: [err] }).deferred;
    let gaveUpCount = 0;
    for (let i = 0; i < MAX_BLOCKING_ATTEMPTS + 3; i++) {
      const d = computeWatermark({
        previous: "2026-06-01",
        resolutions: [],
        errors: [err],
        previousDeferred: deferred,
        now: NOW,
      });
      gaveUpCount += d.gaveUp.length;
      deferred = d.deferred;
    }
    expect(gaveUpCount).toBe(1);
  });
});
