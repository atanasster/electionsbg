// The adapters' two dangerous judgements: what counts as an event, and what dates the feed.
//
// Both were wrong in the first cut and both were latent — the corpus happens not to contain
// the shapes that expose them today, which is exactly why they are pinned here with
// synthetic input rather than left to the committed artifact.

import { describe, expect, it } from "vitest";
import {
  budgetAdapter,
  domesticDebtAdapter,
  intlDebtAdapter,
  macroAdapter,
  openCallsAdapter,
  parliamentAdapter,
  pricesAdapter,
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

describe("pricesAdapter — it renders measurements, it does not take them", () => {
  const src = {
    schemaVersion: 1,
    computedAt: "2026-08-31",
    thresholds: { basketWindowDays: 7 },
    basketMoves: [
      {
        peakDay: "2026-08-16",
        startDay: "2026-08-14",
        endDay: "2026-08-21",
        pctChange: 3.23,
        costEur: 16.6,
        prevCostEur: 16.08,
        cohortCells: 1824,
        cohortShare: 0.82,
      },
    ],
    promotions: [
      {
        slug: "limoni",
        title: "ЛИМОНИ",
        startDay: "2026-08-31",
        promoEur: 1.28,
        regularEur: 2.57,
        discountPct: 50,
        stores: 315,
        chains: 5,
      },
    ],
  };

  it("dates the basket move by the day it was measured THROUGH", () => {
    // Not the start of the week it covers: on 14 August nothing had yet been measured.
    const r = pricesAdapter(ctxOf({ "data/home/price_events.json": src }));
    const move = r.events.find((e) => e.kind === "basket_moved")!;
    expect(move.dateBasis).toBe("occurred");
    expect(move.occurredAt).toBe("2026-08-16T00:00:00.000Z");
    expect(move.id).toBe("prices:basket_moved:2026-08-16");
  });

  it("picks the direction key from the sign, and states the magnitude unsigned", () => {
    const up = pricesAdapter(ctxOf({ "data/home/price_events.json": src }));
    expect(up.events[0].factKey).toBe("home_fact_basket_up");
    expect(up.events[0].factArgs.pct).toBe("3.2");
    const down = pricesAdapter(
      ctxOf({
        "data/home/price_events.json": {
          ...src,
          basketMoves: [{ ...src.basketMoves[0], pctChange: -2.5 }],
        },
      }),
    );
    // ⚠️ „поевтиня с 2.5%", never „поскъпна с −2.5%" — the direction is in the sentence.
    expect(down.events[0].factKey).toBe("home_fact_basket_down");
    expect(down.events[0].factArgs.pct).toBe("2.5");
  });

  it("links a promotion to that product's own page", () => {
    const r = pricesAdapter(ctxOf({ "data/home/price_events.json": src }));
    const promo = r.events.find((e) => e.kind === "promotion_started")!;
    expect(promo.route).toBe("/product/limoni");
    expect(promo.factArgs.chains).toBe(5);
    // The corroboration is why this row exists; the countdown is not stored.
    expect(Object.keys(promo)).not.toContain("daysLeft");
  });

  it("declares the crawl's coverage as partial", () => {
    // „The basket fell" is about the chains that publish, not about every shop.
    const r = pricesAdapter(ctxOf({ "data/home/price_events.json": src }));
    for (const e of r.events) expect(e.coverage.complete).toBe(false);
  });

  it("reports unavailable when the measurements were never generated", () => {
    // ⚠️ On a fresh clone with no Postgres this file may be missing. „No price events" and
    // „we could not measure" are different answers, and only the second is this one.
    const r = pricesAdapter(ctxOf({}));
    expect(r.available).toBe(false);
    expect(r.events).toEqual([]);
  });
});

describe("macroAdapter — the release date is Eurostat's own", () => {
  const macro = {
    latestMonthly: {
      inflation: {
        period: "2026-07",
        value: 4.4,
        datasetCode: "prc_hicp_minr",
      },
    },
  };
  const watch = {
    meta: { datasets: { prc_hicp_minr: "2026-08-19T11:00:00+0200" } },
  };

  it("dates the figure by when it was PUBLISHED, not by the month it covers", () => {
    // ⚠️ The reason this adapter reads two files. Dated by the period, the July figure would
    // sit at 31 July — a month before Eurostat released it, and outside the feed's window on
    // the very day it was news.
    const r = macroAdapter(
      ctxOf({ "data/macro.json": macro, "state/watch/eurostat.json": watch }),
    );
    expect(r.events[0].dateBasis).toBe("published");
    expect(r.events[0].publishedAt?.slice(0, 10)).toBe("2026-08-19");
    expect(r.newest).toBe("2026-08-19");
  });

  it("keys the id on the PERIOD, so a revision updates the row instead of doubling it", () => {
    const r = macroAdapter(
      ctxOf({ "data/macro.json": macro, "state/watch/eurostat.json": watch }),
    );
    expect(r.events[0].id).toBe("macro:cpi_release:prc_hicp_minr:2026-07");
    const revised = macroAdapter(
      ctxOf({
        "data/macro.json": macro,
        "state/watch/eurostat.json": {
          meta: { datasets: { prc_hicp_minr: "2026-08-26T11:00:00+0200" } },
        },
      }),
    );
    expect(revised.events[0].id).toBe(r.events[0].id);
    expect(revised.events[0].publishedAt).not.toBe(r.events[0].publishedAt);
  });

  it("publishes NOTHING rather than inventing a date when the stamp is absent", () => {
    // The watcher state is the only place the release timestamp lives. Without it the honest
    // answer is „we read the source and it says nothing about when this was released".
    const r = macroAdapter(ctxOf({ "data/macro.json": macro }));
    expect(r.available).toBe(true);
    expect(r.events).toEqual([]);
    expect(r.newest).toBeNull();
  });
});

describe("budgetAdapter — a document notice, never a numeric claim", () => {
  const docs = {
    documents: [
      {
        id: "fund-law-nzok-2026-0",
        kind: "fund-law",
        title: "Закон за бюджета на НЗОК за 2026 г.",
        fiscalYear: 2026,
        promulgationDate: "2026-07-28",
      },
      {
        id: "exec-admin-x-2024",
        kind: "execution-report",
        title: "Отчет",
        reportDate: "2024-12-31",
      },
      {
        id: "law-no-date",
        kind: "law",
        title: "Закон без дата",
        promulgationDate: null,
      },
    ],
  };

  it("emits only promulgated laws and amendments, and only with a real date", () => {
    const r = budgetAdapter(ctxOf({ "data/budget/documents.json": docs }));
    expect(r.events.map((e) => e.id)).toEqual([
      "budget:promulgated:fund-law-nzok-2026-0",
    ]);
    expect(r.events[0].dateBasis).toBe("published");
    expect(r.events[0].publishedAt).toBe("2026-07-28T00:00:00.000Z");
  });

  it("carries NO money argument — the corpus holds the index, not the diff", () => {
    // ⚠️ §6.2's last row: „document notice automatic; numeric 'budget changed' remains
    // review-gated". „Обнародван е Законът…" is a fact about a publication; „бюджетът се
    // промени с X" is a claim about appropriations nothing here has reconciled.
    const r = budgetAdapter(ctxOf({ "data/budget/documents.json": docs }));
    for (const e of r.events)
      for (const k of Object.keys(e.factArgs))
        expect(k, `${e.id}: ${k}`).not.toMatch(/eur|bgn|amount|delta|pct/i);
  });

  it("dates the КФП row by the end of the period it reports on", () => {
    const r = budgetAdapter(
      ctxOf({
        "data/budget/kfp.json": {
          observations: [{ period: "2026-05" }, { period: "2026-06" }],
        },
      }),
    );
    const kfp = r.events.find((e) => e.kind === "kfp_release")!;
    expect(kfp.id).toBe("budget:kfp_release:2026-06");
    expect(kfp.dateBasis).toBe("effective");
    // June has 30 days — a naive `${period}-31` would be 1 July, i.e. a month it is not about.
    expect(kfp.effectiveAt).toBe("2026-06-30T00:00:00.000Z");
  });

  it("reports unavailable only when neither source is readable", () => {
    expect(budgetAdapter(ctxOf({})).available).toBe(false);
    expect(
      budgetAdapter(ctxOf({ "data/budget/documents.json": docs })).available,
    ).toBe(true);
  });
});

describe("debt — the domestic arm publishes and the international arm does not", () => {
  const dom = {
    emissions: [
      {
        id: "BG-2026-08-24-218",
        issueDate: "2026-08-24",
        termYears: 10,
        currency: "EUR",
        principalMillion: 95.003,
        settlementYieldPct: 4.39,
      },
      { id: "no-amount", issueDate: "2026-08-01" },
    ],
  };

  it("publishes a БНБ auction as something that happened", () => {
    const r = domesticDebtAdapter(
      ctxOf({ "data/debt-emissions-domestic.json": dom }),
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0].verification).toBe("automatic");
    expect(r.events[0].dateBasis).toBe("occurred");
    expect(r.events[0].factArgs.yieldPct).toBe("4.39");
    expect(r.newest).toBe("2026-08-24");
  });

  it("holds every Eurobond row for editorial review", () => {
    // ⚠️ Phase 5's fifth item. `debt-emissions.json` is hand-maintained — no crawler, no
    // watcher — so a terms error would be published as a claim about the Republic's own
    // borrowing with nothing able to catch it. The rows are BUILT so the family can be
    // promoted by changing one field; `feed.ts` is what drops them.
    const r = intlDebtAdapter(
      ctxOf({
        "data/debt-emissions.json": {
          emissions: [
            {
              id: "EU-2026-07-2032tap",
              issueDate: "2026-07-07",
              termYears: 8,
              currency: "EUR",
              principalMillion: 1000,
            },
          ],
        },
      }),
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0].verification).toBe("editorial_review");
  });

  it("contributes NO vintage, so a staged family cannot move the window", () => {
    // `newest` feeds the feed's `computedAt` — the end of the window every OTHER adapter is
    // measured against. A family that publishes nothing must not decide where it ends.
    const r = intlDebtAdapter(
      ctxOf({
        "data/debt-emissions.json": {
          emissions: [
            {
              id: "EU-9999",
              issueDate: "2099-01-01",
              currency: "EUR",
              principalMillion: 1,
            },
          ],
        },
      }),
    );
    expect(r.newest).toBeNull();
  });
});
