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
import { censusRoutes } from "../../prerender/routerCensus";
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
import { intlDebtAdapter } from "../gen_home/events/adapters";

const REPO = path.resolve(__dirname, "../../..");
const ARTIFACT = path.join(REPO, "data/home/feed.json");
// ⚠️ READ CONDITIONALLY. Parsing at module scope throws during COLLECTION when the artifact is
// absent, so the `existsSync` clause below never runs and vitest reports a suite error instead
// of the message that names the fix.
const present = existsSync(ARTIFACT);
const feed = present
  ? (JSON.parse(readFileSync(ARTIFACT, "utf-8")) as HomeFeedV1)
  : ({ events: [], sourceCoverage: {} } as unknown as HomeFeedV1);

/** §6.6's ceiling. One request must supply the whole section. */
const SIZE_CEILING = 64 * 1024;

describe("home feed — schema and budget", () => {
  it("exists, declares its version, and fits its ceiling", () => {
    expect(
      present,
      `${ARTIFACT} is committed — run npm run db:gen-home-feed`,
    ).toBe(true);
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

describe("home feed — the copy and its arguments agree", () => {
  const corpus = (lang: "bg" | "en"): Record<string, string> =>
    JSON.parse(
      readFileSync(
        path.join(REPO, `src/locales/${lang}/translation.json`),
        "utf-8",
      ),
    ) as Record<string, string>;

  it("every emitted fact supplies every placeholder its copy interpolates", () => {
    // ⚠️ i18next v24 DEFAULTS `interpolation.skipOnVariables` TO TRUE, so a missing argument
    // does not render as empty — it renders the LITERAL `{{yieldPct}}` on the home page, at a
    // 200, in both languages. Three arguments were spread conditionally against templates that
    // interpolate them unconditionally, and 9 of 67 domestic emissions carry no settlement
    // yield, so it was one auction away. `HomeChangeCard` calls `t(factKey, factArgs)` directly
    // — there is no second line of defence.
    for (const lang of ["bg", "en"] as const) {
      const c = corpus(lang);
      for (const e of feed.events) {
        const template = c[e.factKey];
        expect(
          template,
          `${e.id}: ${e.factKey} is untranslated in ${lang}`,
        ).toBeTruthy();
        for (const m of template.matchAll(/{{(\w+)}}/g))
          expect(
            e.factArgs,
            `${e.id} · ${lang} · ${e.factKey} interpolates {{${m[1]}}}`,
          ).toHaveProperty(m[1]);
      }
    }
  });

  it("ships no argument the copy never renders", () => {
    // The converse, and it is not tidiness: `budgetEur` carried a careful NULL-vs-zero comment
    // for a value no template read, which reads as a rule being enforced when nothing renders
    // the field at all.
    const bg = corpus("bg");
    const en = corpus("en");
    for (const e of feed.events) {
      const used = new Set(
        [...bg[e.factKey].matchAll(/{{(\w+)}}/g)].map((m) => m[1]),
      );
      for (const m of en[e.factKey].matchAll(/{{(\w+)}}/g)) used.add(m[1]);
      for (const k of Object.keys(e.factArgs))
        expect(
          used.has(k),
          `${e.id}: factArgs.${k} is rendered by no locale`,
        ).toBe(true);
    }
  });

  it("quotes no parser-failure placeholder as the substance of a fact", () => {
    // ⚠️ WRITTEN OVER VALUES, not key names. The council scraper writes „(no title parsed)"
    // when it cannot extract one, and it is TRUTHY — 21 of the first artifact's 40 rows
    // published it as the subject of a municipal decision, in Bulgarian and in English, with a
    // working link. The existing „carries no localized prose" clause tests key names and could
    // not see it. Written this way it also catches the next placeholder a scraper invents.
    const MARKERS =
      /\(no [a-z ]*parsed\)|^(n\/?a|null|undefined|tbd|unknown)$|^-+$/i;
    for (const e of feed.events)
      for (const [k, v] of Object.entries(e.factArgs))
        if (typeof v === "string")
          expect(
            MARKERS.test(v.trim()),
            `${e.id}: factArgs.${k} = ${JSON.stringify(v)}`,
          ).toBe(false);
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
  it("computedAt equals the newest OBSERVATION, and no event is newer", () => {
    // ⚠️ NOT `now`. A calendar-anchored window slides daily with no source change, which
    // breaks byte-identical rebuilds AND lets a stalled pipeline look fresh — the window keeps
    // advancing while the newest event stays put.
    //
    // ⚠️ AND NOT `max(asOf)` EITHER, which is what this compared against until a review found
    // the hole. `asOf` is each family's own claim, and an event-dated family can claim a date
    // in the FUTURE — a scheduled election, a call published before it opens. `observedAt` is
    // recorded only by families with an observation clock (a crawl timestamp, a corpus day, a
    // publisher's release stamp), none of which can be ahead of the present.
    const observed = Object.values(feed.sourceCoverage)
      .map((s) => s?.observedAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    expect(observed, "no source declared an observation date").toBeTruthy();
    expect(feed.computedAt.slice(0, 10)).toBe(observed);
    for (const e of feed.events)
      expect(displayDate(e) <= feed.computedAt, e.id).toBe(true);
  });

  it("a family's disclosed vintage may lag the observation it was folded from", () => {
    // Not a defect — the point. `openCallsAdapter` reads three independent snapshots and
    // discloses the STALEST (ДФЗ and Interreg were 23 and 21 days behind ИСУН on 2026-09-01)
    // while the window is anchored on the newest crawl. Both numbers are in the artifact so a
    // reader can see the difference rather than infer it.
    for (const [id, c] of Object.entries(feed.sourceCoverage))
      if (c?.observedAt && c?.asOf)
        expect(
          c.asOf <= c.observedAt,
          `${id} claims to be newer than we looked`,
        ).toBe(true);
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

  it("is never dated in the future", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(feed.computedAt.slice(0, 10) <= today).toBe(true);
  });

  it("moves with the sources, not the calendar", () => {
    // ⚠️ THE CLAUSE THAT ACTUALLY DISCRIMINATES, and it replaced one that could not. The old
    // one asserted `computedAt <= today`, which a run-clock `computedAt` satisfies on the day
    // it was generated AND on every day after — so it could only ever fail on a future-dated
    // artifact, which is a different property (kept, above, under its own name).
    //
    // This one re-derives the value from `sourceCoverage`, which the generator fills from each
    // adapter's own `newest` — a different code path from the vintage fold. A `computedAt`
    // taken from the clock cannot equal it except by coincidence on one day.
    const maxObserved = Object.values(feed.sourceCoverage)
      .map((s) => s?.observedAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    expect(feed.computedAt).toBe(`${maxObserved}T23:59:59.999Z`);
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

describe("home feed — every row goes somewhere real", () => {
  it("every route resolves against the router", () => {
    // ⚠️ THE ONE DEFECT NO OTHER CLAUSE CAN SEE. `route.startsWith("/")` is satisfied by
    // `/budget/documents` and `/governance/debt`, neither of which exists — both were in the
    // first cut of the budget and debt adapters, and both would have shipped a feed row whose
    // only job is to be clicked straight into the SPA's not-found page. The adapters name
    // destinations by hand, so nothing but the router can confirm them.
    const routes = censusRoutes(
      readFileSync(path.join(REPO, "src/routes.tsx"), "utf-8"),
    ).filter((r) => r.hasElement && !r.unresolved);
    const matches = (route: string): boolean => {
      const segs = route.replace(/^\/+/, "").split("/").filter(Boolean);
      return routes.some((r) => {
        const pat = r.path.split("/").filter(Boolean);
        if (pat.length !== segs.length) return false;
        return pat.every((p, i) => p.startsWith(":") || p === segs[i]);
      });
    };
    for (const e of feed.events)
      expect(matches(e.route), `${e.id} -> ${e.route}`).toBe(true);
  });
});

describe("home feed — the review gate", () => {
  it("no review-gated row reaches the artifact", () => {
    // Phase 5's fifth item. `intlDebtAdapter` builds Eurobond rows from a hand-maintained
    // file with no crawler and no watcher behind it; `feed.ts` drops them before writing.
    for (const e of feed.events) expect(e.verification, e.id).toBe("automatic");
  });

  it("…and the gate is not vacuous — the generator really does stage rows", () => {
    // ⚠️ The mutation check the clause above needs. „Every published row is automatic" is
    // trivially true of a generator that never builds a staged one, so this asserts the
    // staged family EXISTS and is non-empty. Without it, deleting `intlDebtAdapter` outright
    // would leave both clauses green.
    const staged = intlDebtAdapter({
      root: REPO,
      readJson: <T>(rel: string): T | null => {
        const f = path.join(REPO, rel);
        return existsSync(f)
          ? (JSON.parse(readFileSync(f, "utf-8")) as T)
          : null;
      },
    });
    expect(staged.available).toBe(true);
    expect(staged.events.length).toBeGreaterThan(0);
    for (const e of staged.events)
      expect(e.verification, e.id).toBe("editorial_review");
    // And none of them is in the published set.
    const published = new Set(feed.events.map((e) => e.id));
    for (const e of staged.events)
      expect(published.has(e.id), e.id).toBe(false);
  });
});

describe("home feed — a budget row is a document notice", () => {
  it("no budget/debt fact carries a money argument it did not derive", () => {
    // §6.2: „document notice automatic; numeric 'budget changed' remains review-gated".
    // A debt AUCTION is the exception and states its own principal — that figure comes from
    // БНБ's own result, not from a diff of appropriations nobody reconciled.
    for (const e of feed.events) {
      if (e.category !== "budget_debt") continue;
      if (e.kind === "debt_auction") continue;
      for (const k of Object.keys(e.factArgs))
        expect(k, `${e.id}: ${k}`).not.toMatch(/eur|bgn|amount|delta|pct/i);
    }
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
