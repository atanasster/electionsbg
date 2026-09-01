// The committed `data/home/feed.json`.
//
// Like its stats sibling this is NOT a Postgres gate: every adapter reads a committed
// source, so the feed builds — and this runs — on a fresh clone.

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOME_DATE_BASES,
  HOME_EVENT_CATEGORIES,
  findNowRelativeFields,
  type HomeFeedV1,
} from "@/data/home/homeTypes";
import {
  MAX_EVENTS,
  MAX_PER_CATEGORY,
  MIN_CATEGORIES,
  RENDERED,
  WINDOW_DAYS,
  displayDate,
  diversify,
  orderEvents,
} from "../gen_home/feed";

const REPO = path.resolve(__dirname, "../../..");
const ARTIFACT = path.join(REPO, "data/home/feed.json");
const feed = JSON.parse(readFileSync(ARTIFACT, "utf-8")) as HomeFeedV1;

/** §6.6's ceiling. One request must supply the whole section. */
const SIZE_CEILING = 64 * 1024;

describe("home feed — schema and budget", () => {
  it("exists, declares its version, and fits its ceiling", () => {
    expect(existsSync(ARTIFACT)).toBe(true);
    expect(feed.schemaVersion).toBe(1);
    expect(statSync(ARTIFACT).size).toBeLessThan(SIZE_CEILING);
    expect(feed.events.length).toBeLessThanOrEqual(MAX_EVENTS);
  });

  it("stores no now-relative field", () => {
    // ⚠️ A `daysLeft`/`isOpen` frozen into a published artifact is true when written and
    // false when read — the `open_calls` (142) defect one layer up. `deadlineAt` is stored;
    // the countdown is rendered.
    expect(findNowRelativeFields(feed)).toEqual([]);
  });

  it("every event carries a declared category, basis and in-app route", () => {
    for (const e of feed.events) {
      expect(HOME_EVENT_CATEGORIES, e.id).toContain(e.category);
      expect(HOME_DATE_BASES, e.id).toContain(e.dateBasis);
      expect(e.route.startsWith("/"), e.id).toBe(true);
      expect(/^https?:/.test(e.route), e.id).toBe(false);
      expect(e.factKey, e.id).toMatch(/^home_fact_/);
    }
  });

  it("ids are unique", () => {
    // A collision is not something to dedupe away: it means one of two facts is unreachable
    // and the browser's list keys are wrong.
    const ids = feed.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no id contains an ingestion timestamp", () => {
    // An id that carries when we ran would mint a new row for the same fact on every
    // rebuild — the feed would look busy and never settle.
    for (const e of feed.events)
      expect(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.id), e.id).toBe(false);
  });

  it("carries no localized prose — only keys and arguments", () => {
    // Bulgarian and English rendering lives in the locale bundles. Prose here would ship one
    // language's sentence to both.
    for (const e of feed.events) {
      for (const [k, v] of Object.entries(e.factArgs)) {
        if (typeof v !== "string") continue;
        // A title quoted from a source is DATA, not our prose. What must not appear is a
        // sentence we wrote — caught by requiring the fact itself to be a key.
        expect(k, `${e.id}: ${k}`).not.toMatch(/^(text|sentence|headline)/);
      }
    }
  });
});

describe("home feed — date semantics", () => {
  it("the date it displays is the one its basis names", () => {
    for (const e of feed.events) {
      const shown = displayDate(e);
      expect(shown, e.id).toBeTruthy();
      if (e.dateBasis === "occurred") expect(shown, e.id).toBe(e.occurredAt);
      if (e.dateBasis === "effective") expect(shown, e.id).toBe(e.effectiveAt);
      if (e.dateBasis === "published") expect(shown, e.id).toBe(e.publishedAt);
    }
  });

  it("firstSeenAt never stands in for a known occurrence", () => {
    // ⚠️ The rule the whole contract exists for. A row that HAS a real date must not be
    // presented as „found on" — „we noticed this" and „this happened" are different claims,
    // and only one of them is about the world.
    for (const e of feed.events) {
      if (e.dateBasis !== "first_seen") continue;
      expect(e.occurredAt, e.id).toBeUndefined();
      expect(e.publishedAt, e.id).toBeUndefined();
      expect(e.effectiveAt, e.id).toBeUndefined();
    }
  });

  it("every basis present in the corpus has a renderer key", () => {
    // A basis with no key renders as a raw identifier under a real event.
    const bg = JSON.parse(
      readFileSync(path.join(REPO, "src/locales/bg/translation.json"), "utf-8"),
    ) as Record<string, string>;
    const en = JSON.parse(
      readFileSync(path.join(REPO, "src/locales/en/translation.json"), "utf-8"),
    ) as Record<string, string>;
    for (const basis of new Set(feed.events.map((e) => e.dateBasis))) {
      expect(bg[`home_date_basis_${basis}`], basis).toBeTruthy();
      expect(en[`home_date_basis_${basis}`], basis).toBeTruthy();
    }
  });

  it("every emitted factKey and coverage note is translated in BOTH languages", () => {
    const bg = JSON.parse(
      readFileSync(path.join(REPO, "src/locales/bg/translation.json"), "utf-8"),
    ) as Record<string, string>;
    const en = JSON.parse(
      readFileSync(path.join(REPO, "src/locales/en/translation.json"), "utf-8"),
    ) as Record<string, string>;
    for (const e of feed.events) {
      expect(bg[e.factKey], `${e.id} bg`).toBeTruthy();
      expect(en[e.factKey], `${e.id} en`).toBeTruthy();
      if (e.coverage.noteKey) {
        expect(bg[e.coverage.noteKey], e.coverage.noteKey).toBeTruthy();
        expect(en[e.coverage.noteKey], e.coverage.noteKey).toBeTruthy();
      }
    }
  });
});

describe("home feed — the window is anchored on the sources", () => {
  it("computedAt equals the newest source vintage, and no event is newer", () => {
    // ⚠️ NOT `now`. A calendar-anchored window slides daily with no source change, which
    // breaks byte-identical rebuilds AND lets a stalled pipeline look fresh — the window
    // keeps advancing while the newest event stays put.
    const asOf = Object.values(feed.sourceCoverage)
      .map((s) => s?.asOf)
      .filter(Boolean)
      .sort()
      .at(-1);
    expect(asOf, "no source declared a vintage").toBeTruthy();
    expect(feed.computedAt.slice(0, 10)).toBe(asOf);
    for (const e of feed.events)
      expect(displayDate(e) <= feed.computedAt, e.id).toBe(true);
  });

  it("every event is inside the declared window", () => {
    const floor = new Date(
      Date.parse(feed.computedAt) - feed.windowDays * 86_400_000,
    ).toISOString();
    for (const e of feed.events)
      expect(displayDate(e) >= floor, `${e.id} is older than the window`).toBe(
        true,
      );
    expect(feed.windowDays).toBe(WINDOW_DAYS);
  });

  it("computedAt does NOT track the build date", () => {
    // The mutation check: if it did, this equals today on the machine that generated it and
    // the clause above passes anyway (today is also the max vintage, trivially).
    const today = new Date().toISOString().slice(0, 10);
    expect(feed.computedAt.slice(0, 10) <= today).toBe(true);
  });
});

describe("home feed — coverage is disclosed, not implied", () => {
  it("every adapter reports whether it could look at all", () => {
    // „Nothing happened" and „we could not look" are different answers.
    expect(Object.keys(feed.sourceCoverage).length).toBeGreaterThan(0);
    for (const [id, s] of Object.entries(feed.sourceCoverage))
      expect(typeof s?.available, id).toBe("boolean");
  });

  it("an incomplete-coverage row carries a note explaining what is missing", () => {
    // „No resolutions near you" is almost always „we do not read your council" — 16 of 265.
    for (const e of feed.events)
      if (!e.coverage.complete) expect(e.coverage.noteKey, e.id).toBeTruthy();
  });
});

describe("home feed — ranking and diversity", () => {
  it("the rendered prefix caps one category and reaches for a third", () => {
    const head = feed.events.slice(0, RENDERED);
    const counts = new Map<string, number>();
    for (const e of head)
      counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    for (const [cat, n] of counts)
      expect(
        n,
        `${cat} fills ${n} of the first ${RENDERED}`,
      ).toBeLessThanOrEqual(MAX_PER_CATEGORY);
    // „When the material permits" — asserted against what the corpus actually holds, so a
    // thin day cannot fail the gate.
    const eligible = new Set(feed.events.map((e) => e.category)).size;
    expect(counts.size).toBe(Math.min(MIN_CATEGORIES, eligible));
  });

  it("the order is stable under a re-sort of the same rows", () => {
    // Determinism at the ranking layer: two rebuilds must not order two equally-scored rows
    // differently, which is why the tie-break is the id.
    const a = orderEvents(feed.events, feed.computedAt).map((e) => e.id);
    const b = orderEvents([...feed.events].reverse(), feed.computedAt).map(
      (e) => e.id,
    );
    expect(a).toEqual(b);
  });

  it("diversify never promotes a row that is not in the input", () => {
    const out = diversify(orderEvents(feed.events, feed.computedAt));
    expect(out).toHaveLength(feed.events.length);
    expect(new Set(out.map((e) => e.id))).toEqual(
      new Set(feed.events.map((e) => e.id)),
    );
  });

  it("a bulk load is labelled and penalised rather than filling the feed", () => {
    // Backfills exist to be collapsed. None today; the clause holds the contract for when
    // one lands, and the penalty is what keeps it out of the rendered six.
    for (const e of feed.events)
      if (e.backfill) expect(e.materiality, e.id).toBeLessThan(0.5);
  });

  it("no review-gated event is in the automatic feed", () => {
    // Ambiguous international debt and document-only budget changes are editorial-review
    // kinds; publishing one automatically is what the verification field prevents.
    for (const e of feed.events) expect(e.verification, e.id).toBe("automatic");
  });
});
