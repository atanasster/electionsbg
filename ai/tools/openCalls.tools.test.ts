// The `openCalls` tool. Hermetic — the db fetcher is swapped for an in-memory fixture.
//
// Every assertion here is about a sentence the assistant must not be able to produce. This tool
// is the one the model will reach for when a reader asks „има ли програма за мен", and a wrong
// answer sends someone to a deadline that has passed or to a procedure that does not exist:
//
//   1. AN INDICATIVE WINDOW IS NOT AN OPEN CALL. The ДФЗ schedule publishes month ranges
//      („в периода март-май"), not deadlines. A single „N отворени" that summed them would let
//      the model tell a farmer a forecast is a live procedure.
//   2. A CONSULTATION IS NOT AN OPEN CALL either — you can comment, not apply.
//   3. AN UNPUBLISHED BUDGET IS NOT €0. ИСУН's procedure page carries no budget at all; it lives
//      in the „Условия" documents. Rendering NULL as zero is a fabricated figure.
//   4. FRESHNESS IS PART OF THE ANSWER, because the register is crawled daily and can lag.
//   5. THE COVERAGE BOUNDARY IS DECLARED. Interreg runs on Jems, so „no programme for that" must
//      not be said on a basis that never contained Interreg in the first place.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openCalls, resolveCallAudience } from "./fiscal";
import { setDbFetcher, clearDataCache } from "./dataClient";
import type { ToolContext } from "./types";

const ctxBg = { lang: "bg" } as ToolContext;
const ctxEn = { lang: "en" } as ToolContext;

const call = (over: Record<string, unknown> = {}) => ({
  code: "BG16RFPR001-1.011",
  title: "Внедряване на иновации в МСП",
  programmeName: "Програма „Конкурентоспособност“ 2021-2027",
  status: "open",
  kind: "call",
  closesAt: "2026-09-14T13:30:00.000Z",
  periodLabel: null,
  daysLeft: 37,
  budgetEur: null,
  aidRatePct: null,
  grantMaxEur: null,
  audience: ["business"],
  sourceUrl: "https://eumis2020.government.bg/x",
  source: "isun",
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  calls: [call()],
  indicative: [
    call({
      code: "II.Г.14",
      title: "Първична преработка на дървесина",
      status: "indicative",
      closesAt: null,
      daysLeft: null,
      periodLabel: "В периода март-май за срок не по-кратък от 60 дни",
      budgetEur: 10_000_000,
      source: "sp2023",
      audience: ["farmer"],
    }),
  ],
  consultations: [],
  crawl: [
    { source: "isun", crawledAt: "2026-08-08T03:00:00.000Z", ok: true },
    { source: "sp2023", crawledAt: "2026-08-01T03:00:00.000Z", ok: true },
  ],
  totals: { calls: 45, indicative: 11, consultations: 0 },
  ...over,
});

/** Records what the tool asked for, so the audience wiring is testable. */
let lastParams: Record<string, unknown> = {};
const fixture =
  (body: unknown) => async (route: string, params: Record<string, unknown>) => {
    expect(route).toBe("open-calls");
    lastParams = params;
    return body;
  };

beforeEach(() => {
  clearDataCache();
  lastParams = {};
  setDbFetcher(fixture(payload()) as never);
});
afterEach(() => clearDataCache());

describe("openCalls groups", () => {
  it("names the three groups separately and never sums them", async () => {
    const env = await openCalls({}, ctxBg);
    expect(env.facts.calls).toBeTruthy();
    expect(env.facts.indicative).toBeTruthy();
    expect(env.facts.consultations).toBeTruthy();
    // 45 calls + 11 indicative must not appear anywhere as 56.
    expect(JSON.stringify(env.facts)).not.toContain("56");
  });

  it("does NOT label the open+upcoming sum as open", async () => {
    // The route merges the two into `totals.calls` because the PAGE renders them in one section
    // with a per-row marker. `facts` is a flat key→string map with no marker and is the only thing
    // the narrator and the grounding gate see, so labelling that sum „open" would let a model state
    // a count of things you can apply to that includes ones you cannot yet.
    const env = await openCalls({}, ctxBg);
    expect(env.facts.open).toBeUndefined();
  });

  it("splits `upcoming` out when the group actually contains one", async () => {
    setDbFetcher(
      fixture(
        payload({
          calls: [
            call(),
            call({
              id: 9,
              status: "upcoming",
              closesAt: "2026-12-01T13:30:00.000Z",
            }),
          ],
        }),
      ) as never,
    );
    const env = await openCalls({}, ctxBg);
    expect(env.facts.upcoming).toBe("1");
  });

  it("omits `upcoming` entirely when there is none, rather than showing a zero", async () => {
    const env = await openCalls({}, ctxBg);
    expect(env.facts.upcoming).toBeUndefined();
  });

  it("lists real calls FIRST and marks an indicative window as an expected intake", async () => {
    // A reader scanning the table must never read the month range as a deadline: the indicative
    // row comes after the calls and its deadline cell says „очакван прием" before the range.
    const env = await openCalls({}, ctxBg);
    const rows = env.rows ?? [];
    expect(rows[0].title).toBe("Внедряване на иновации в МСП");
    const ind = rows.find(
      (r) => r.title === "Първична преработка на дървесина",
    );
    expect(ind).toBeDefined();
    expect(String(ind?.deadline)).toMatch(
      /^очакван прием · В периода март-май/u,
    );
    expect(rows.indexOf(ind!)).toBeGreaterThan(0);
  });

  it("shows the expected intakes when there is no real call, rather than an empty table", async () => {
    setDbFetcher(fixture(payload({ calls: [] })) as never);
    const env = await openCalls({ audience: "farmer" }, ctxBg);
    expect(env.rows?.length).toBe(1);
    expect(env.facts.calls).toBe("0");
    expect(String(env.facts.indicative_note)).toMatch(/не са отворени/u);
  });

  it("marks a not-yet-open call rather than giving it a plain deadline", async () => {
    setDbFetcher(
      fixture(
        payload({
          calls: [
            call({ status: "upcoming", closesAt: "2026-12-01T13:30:00.000Z" }),
          ],
        }),
      ) as never,
    );
    const env = await openCalls({}, ctxBg);
    expect(String(env.rows?.[0].deadline)).toMatch(/предстои/u);
  });
});

describe("openCalls money", () => {
  it("says a budget is NOT PUBLISHED rather than rendering €0", async () => {
    const env = await openCalls({}, ctxBg);
    expect(String(env.rows?.[0].budget)).toMatch(/не е публикуван/u);
    expect(String(env.rows?.[0].budget)).not.toMatch(/0/u);
  });

  it("does render a budget the source DID publish", async () => {
    // The ДФЗ XLSX has real budget columns (enrichment='source'), unlike ИСУН.
    setDbFetcher(
      fixture(payload({ calls: [call({ budgetEur: 10_000_000 })] })) as never,
    );
    const env = await openCalls({}, ctxBg);
    expect(String(env.rows?.[0].budget)).not.toMatch(/не е публикуван/u);
  });
});

describe("openCalls over the HARNESS wire shape", () => {
  // `dbFetcherNode` returns the route handler's body IN-PROCESS with no JSON round-trip, so a
  // `timestamptz` arrives as a `Date` and not an ISO string. Every fixture above uses strings, which
  // is production's shape — and that is exactly why a suite of them stayed green while the tool
  // threw `r.closesAt.slice is not a function` on every harness run.
  it("renders a Date-valued deadline and picks the newest Date crawl", async () => {
    setDbFetcher(
      fixture({
        calls: [
          call({ closesAt: new Date("2026-09-14T13:30:00.000Z") as never }),
        ],
        indicative: [],
        consultations: [],
        crawl: [
          {
            source: "isun",
            crawledAt: new Date("2026-08-08T03:00:00.000Z"),
            ok: true,
          },
          {
            source: "sp2023",
            crawledAt: new Date("2026-08-01T03:00:00.000Z"),
            ok: true,
          },
        ],
        totals: { calls: 1, indicative: 0, consultations: 0 },
      }) as never,
    );
    const env = await openCalls({}, ctxBg);
    expect(String(env.rows?.[0].deadline)).toContain("2026-09-14");
    // A lexical sort over Dates orders by WEEKDAY NAME („Fri" < „Sat"), so this is the assertion
    // that catches the second half of the same bug.
    expect(env.facts.checked).toBe("2026-08-08");
  });
});

describe("openCalls freshness and coverage", () => {
  it("reports the newest SUCCESSFUL crawl", async () => {
    const env = await openCalls({}, ctxBg);
    expect(env.facts.checked).toBe("2026-08-08");
  });

  it("ignores a failed crawl when reporting freshness", async () => {
    // A failed run today must not make a week-old list look current.
    setDbFetcher(
      fixture(
        payload({
          crawl: [
            {
              source: "isun",
              crawledAt: "2026-08-08T03:00:00.000Z",
              ok: false,
            },
            {
              source: "sp2023",
              crawledAt: "2026-08-01T03:00:00.000Z",
              ok: true,
            },
          ],
        }),
      ) as never,
    );
    const env = await openCalls({}, ctxBg);
    expect(env.facts.checked).toBe("2026-08-01");
  });

  it("says so when nothing has ever been crawled", async () => {
    setDbFetcher(fixture(payload({ crawl: [] })) as never);
    const env = await openCalls({}, ctxEn);
    expect(String(env.facts.checked)).toMatch(/never loaded/u);
  });

  it("declares the coverage boundary in both languages", async () => {
    // „Няма програма за това" is only honest if the basis is stated: Interreg is in neither
    // register, so its absence is a system boundary rather than a finding.
    for (const ctx of [ctxBg, ctxEn]) {
      const env = await openCalls({}, ctx);
      clearDataCache();
      expect(String(env.facts.coverage)).toMatch(/Interreg/u);
      expect(String(env.facts.coverage)).toMatch(/ИСУН/u);
    }
  });

  it("declares its provenance as the open register, not the awarded corpus", async () => {
    const env = await openCalls({}, ctxBg);
    expect(env.provenance?.join(" ")).toMatch(/open-calls/u);
    expect(env.provenance?.join(" ")).not.toMatch(/fund-payload/u);
  });
});

describe("resolveCallAudience", () => {
  it("maps Bulgarian and English aliases to the eight stored values", () => {
    expect(resolveCallAudience("фирма")).toBe("business");
    expect(resolveCallAudience("МСП")).toBe("business");
    expect(resolveCallAudience("small business")).toBe("business");
    expect(resolveCallAudience("земеделски стопанин")).toBe("farmer");
    expect(resolveCallAudience("нашата община")).toBe("municipality");
    expect(resolveCallAudience("НПО")).toBe("ngo");
    expect(resolveCallAudience("училище")).toBe("school");
  });

  it("lets the MORE SPECIFIC token win when two aliases both match", () => {
    // „земеделска фирма" contains „фирма". In declaration order the business aliases come first, so
    // it resolved to `business` and a farmer got a list of SME calls. The scan is longest-key-first
    // for exactly this.
    // A SECTOR qualifier outranks an organisation-form noun: „земеделска фирма" is a farmer,
    // whatever legal form it takes. Note „предприятие" is LONGER than „земеделск", so a
    // longest-key rule gets this wrong — the tiering is what settles it.
    expect(resolveCallAudience("земеделска фирма")).toBe("farmer");
    expect(resolveCallAudience("земеделско предприятие")).toBe("farmer");
    expect(resolveCallAudience("селскостопанска фирма")).toBe("farmer");
    // And within a tier, the longer key still wins over a shorter one it contains.
    expect(resolveCallAudience("малко предприятие")).toBe("business");
  });

  it("an EXPLICIT audience is not overridden by a noun in the question", async () => {
    // The two used to be concatenated and scanned as one string, so a stray „фирми" in the question
    // beat the facet the caller actually asked for.
    // The concatenated form resolves „ngo предприятие" to `business` (the longer alias wins the
    // substring scan); resolving the fields in order of authority keeps the caller's facet.
    const env = await openCalls(
      { audience: "ngo", query: "предприятие" },
      ctxBg,
    );
    expect(env.facts.audience).toBe("НПО");
  });

  it("reads the SECTOR as the farmer facet — the question names no applicant", () => {
    expect(
      resolveCallAudience("покажи ми европрограми за селско стопанство"),
    ).toBe("farmer");
    expect(resolveCallAudience("програми за земеделие")).toBe("farmer");
    expect(resolveCallAudience("Show me EU programmes for agriculture")).toBe(
      "farmer",
    );
  });

  it("does not read a ministry's NAME as the farmer facet", () => {
    expect(
      resolveCallAudience("има ли нещо за министерство на земеделието"),
    ).not.toBe("farmer");
  });

  it("returns undefined rather than guessing", () => {
    // Undefined means „no facet", i.e. every call. A wrong facet returns an empty list, and
    // „there is nothing for you" is a much worse answer than a broad one.
    expect(resolveCallAudience("")).toBeUndefined();
    expect(resolveCallAudience("нещо съвсем друго")).toBeUndefined();
  });

  it("never sends the facet to the route — membership is decided in the tool", async () => {
    // The route's `audience @> [x]` cannot see a row tagged only by its programme, which is how an
    // open СПРЗСР call vanished from a farming question.
    await openCalls({ audience: "земеделец" }, ctxBg);
    expect(lastParams.audience).toBeUndefined();
  });

  it("reads the facet out of a free-text query too", async () => {
    // „има ли нещо за община" arrives as a query, not as a typed audience arg.
    const env = await openCalls({ query: "има ли нещо за община" }, ctxBg);
    expect(env.facts.audience).toBe("общини");
  });
});

describe("openCalls by sector", () => {
  // The live defect (2026-10-05): „покажи ми европрограми за селско стопанство" answered „0
  // отворени" while BG06AFSP001-1.003, a CAP Strategic Plan procedure, was open — its title names
  // no farmer and ИСУН rows carried an empty audience, so the facet filter dropped it.
  const sprzsr = call({
    code: "BG06AFSP001-1.003",
    title: "Изпълнение на дейности за сътрудничество и тяхната подготовка",
    programmeName:
      "Стратегически план за развитие на земеделието и селските райони",
    audience: [],
  });
  const fisheries = call({
    code: "BG14MFPR001-2.014",
    title: "Аквакултури, предоставящи екологични услуги",
    audience: ["unknown"],
  });
  const asylum = call({
    code: "BG65AMPR001-4.004",
    title: "Солидарност",
    audience: [],
  });
  const sme = call();

  beforeEach(() => {
    setDbFetcher(
      fixture(payload({ calls: [sprzsr, fisheries, asylum, sme] })) as never,
    );
  });

  it("includes a CAP Strategic Plan call for a farmer whatever its title says", async () => {
    const env = await openCalls({ audience: "farmer" }, ctxBg);
    const codes = (env.rows ?? []).map((r) => r.code);
    expect(codes).toContain("BG06AFSP001-1.003");
    // Fisheries is NOT the farming sector — an unclassified ПМДРА row stays out…
    expect(codes).not.toContain("BG14MFPR001-2.014");
    expect(codes).not.toContain("BG65AMPR001-4.004");
    expect(codes).not.toContain("BG16RFPR001-1.011");
    expect(env.facts.calls).toBe("1");
    expect(String(env.facts.sector_note)).toMatch(/по програмата/u);
  });

  it("COUNTS the calls it could not classify instead of saying there is nothing", async () => {
    const env = await openCalls({ audience: "farmer" }, ctxBg);
    // The asylum and the unclassified fisheries call; the СПРЗСР row is claimed by its programme.
    expect(String(env.facts.unclassified)).toMatch(/: 2\.$/u);
  });

  it("lets a fisheries call in through its OWN farmer facet", async () => {
    // …while an aquaculture-farm call whose title-derived audience says farmer is included.
    setDbFetcher(
      fixture(
        payload({ calls: [call({ ...fisheries, audience: ["farmer"] })] }),
      ) as never,
    );
    const env = await openCalls({ audience: "farmer" }, ctxBg);
    expect((env.rows ?? []).map((r) => r.code)).toContain("BG14MFPR001-2.014");
  });

  it("names the audience in words, never the stored code", async () => {
    const env = await openCalls({ audience: "farmer" }, ctxBg);
    expect(env.facts.audience).toBe("земеделски стопани");
    expect(JSON.stringify(env.facts)).not.toMatch(/\bfarmer\b/u);
  });

  it("does not apply a sector programme to a different audience", async () => {
    const env = await openCalls({ audience: "business" }, ctxBg);
    const codes = (env.rows ?? []).map((r) => r.code);
    expect(codes).toEqual(["BG16RFPR001-1.011"]);
  });
});
