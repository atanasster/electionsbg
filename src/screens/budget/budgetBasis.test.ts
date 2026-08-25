// The DECLARED-BASIS gates for /budget (plan §11).
//
// Three clauses the plan specified and nobody built. Each defends the same
// class: a figure that is arithmetically right and false as a sentence, because
// the denominator it is read against is not the one it was computed against.
//
// These are SOURCE gates. That is a deliberate choice rather than a shortcut —
// the failure they catch is a line of code that has not been written yet, on a
// page that does not exist yet, and no behavioural test can be written for it.
// What they can do is make the next reader declare their intent.

import { describe, it, expect } from "vitest";
import { BUDGET_BASIS_KEYS } from "./budgetHubFigures";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "src/screens/budget");
const TILES = join(process.cwd(), "src/screens/components/budget");

/** Every non-test source file in the budget screens directory. */
const sources = (): Array<{ name: string; text: string }> =>
  readdirSync(DIR)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));

/** …and in the LEGACY tile directory, which `/budget/deep-dive` still serves.
 *  Those files are arithmetic-heavy — they predate the server-side basis — so
 *  the rule reaches them with a named allowlist rather than not at all. */
const tileSources = (): Array<{ name: string; text: string }> =>
  readdirSync(TILES)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .map((name) => ({ name, text: readFileSync(join(TILES, name), "utf8") }));

/** Reduce a source file to the text these gates may match on: no comments
 *  (including trailing ones) and no string literals.
 *
 *  Both removals are load-bearing, and each was learned from a false positive:
 *
 *   * COMMENTS, because the files in this module are heavily commented and
 *     several comments quote the very patterns being forbidden — `actual/gdp`
 *     appears in one explaining why it is wrong.
 *   * STRING LITERALS, because an import path is a string containing a slash:
 *     `from "@/data/macro/gdp"` and `"@/data/population"` both match a naive
 *     „divided by GDP" rule, and the natural repair for a gate that fires on a
 *     correct import is to delete the rule.
 *
 *  Line comments are stripped BEFORE block comments: a `/*` inside a `//` line
 *  would otherwise open a block that runs to the next `*&#47;`. `routes.tsx` has
 *  exactly that (`/api/sql/*`) and it cost the sibling gate 15 edges. */
/** Comments only — for gates that must still see string literals (a basis name
 *  is one). */
const comments = (text: string): string =>
  text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const code = (text: string): string =>
  text
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

describe("§7.1 — every basis is resolved server-side", () => {
  /** Shared by both scopes below. The rule is not „no division": dividing two
   *  figures from the SAME payload to get a share — `executedEur / total` — is
   *  arithmetic over one basis and is fine. What may not happen client-side is
   *  a basis CHANGE, because then the same question has two implementations and
   *  they drift. `budget_apply_basis` (migration 155) is the one place for it.
   *
   *  Denominators are matched as IDENTIFIERS, after `code()` has removed string
   *  literals — otherwise `from "@/data/macro/gdp"` and `"@/data/population"`
   *  both fire, and the natural repair for a gate that flags a correct import
   *  is to delete the gate. This cannot catch every evasion (a local alias, a
   *  helper call, bracket access); it catches the shape people actually write. */
  const forbidden: Array<{ re: RegExp; what: string }> = [
    {
      re: /\/\s*\(?\s*[A-Za-z_$][\w$.]*population\w*/i,
      what: "division by population",
    },
    { re: /\/\s*\(?\s*[A-Za-z_$][\w$.]*gdp\w*/i, what: "division by GDP" },
    { re: /[*/]\s*1\.95583/, what: "client-side BGN↔EUR conversion" },
  ];

  it("divides no figure by a BASIS denominator in the screens", () => {
    // The rule is not „no division". Dividing two figures from the SAME payload
    // to get a share — `executedEur / total` — is arithmetic over one basis and
    // is fine. What may not happen here is a basis CHANGE: dividing by
    // population, by GDP, or converting a currency, because then the same
    // question has two implementations and they drift. `budget_apply_basis` in
    // migration 155 is the one place that does it.
    const hits: string[] = [];
    for (const { name, text } of sources()) {
      const body = code(text);
      for (const { re, what } of forbidden) {
        if (re.test(body)) hits.push(`${name}: ${what}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("holds in the LEGACY tiles too, except where it is the tile's whole job", () => {
    // `/budget/deep-dive` still serves these, so „the migration replaced them"
    // is not a reason to leave them unchecked — a new one added there would be
    // as live as anything under `src/screens/budget/`.
    //
    // ONE allowlisted file, with its reason: `BudgetPolicySimulator` is a
    // client-side what-if tool. Its whole purpose is arithmetic the server
    // cannot precompute, because the inputs are the reader's slider positions —
    // so its `total / baseline.gdpEur` is the feature, not the drift §7.1 is
    // about.
    const ALLOW: Record<string, string> = {
      "BudgetPolicySimulator.tsx":
        "client-side what-if: the denominators move with the reader's sliders",
    };
    const hits: string[] = [];
    for (const { name, text } of tileSources()) {
      if (name in ALLOW) continue;
      const body = code(text);
      for (const { re, what } of forbidden) {
        if (re.test(body)) hits.push(`${name}: ${what}`);
      }
    }
    expect(hits).toEqual([]);
    // …and the allowlist is not stale: the file still needs its exemption, or
    // it should not be carrying one.
    for (const name of Object.keys(ALLOW)) {
      const body = code(readFileSync(join(TILES, name), "utf8"));
      expect(
        forbidden.some(({ re }) => re.test(body)),
        `${name} no longer needs its exemption — drop it`,
      ).toBe(true);
    }
  });
});

describe("§11 — capita is never the default, and never uncaptioned", () => {
  /** The screens that offer a per-resident basis at all. A REGISTRY, asserted
   *  rather than discovered, so a new page offering one has to come here and say
   *  so — and so the behavioural gates below have a known set to cover.
   *
   *  ⚠️ THE TWO SUBSTANTIVE CLAUSES ARE BEHAVIOURAL AND LIVE BESIDE THE SCREEN
   *  (`BudgetMunicipalScreen.test.tsx`). A first cut pinned them here with
   *  source regexes — `basisParam === "capita" ? "capita" : "(\w+)"` — which
   *  broke under a prettier reflow AND under a correct refactor to
   *  `BASES.includes(...)`, reporting „no recognisable resolver" against code
   *  that was right. A rendered page cannot be fooled that way. */
  const CAPITA_SCREENS = ["BudgetMunicipalScreen.tsx"];

  it("finds exactly the per-resident screens this file knows about", () => {
    // Discovery keeps STRING LITERALS (the basis name is one) but drops
    // comments, and looks for any of the three spellings this module uses, so a
    // page adopting `perCapita`/`per_capita` is not invisible.
    const offering = sources()
      .filter(({ text }) =>
        /"capita"|perCapita|per_capita/.test(comments(text)),
      )
      .map(({ name }) => name)
      .sort();
    expect(offering).toEqual(CAPITA_SCREENS);
  });

  it("backs each per-resident screen with its two behavioural gates", () => {
    // Asserted by the NAME of the assertion rather than by a fixture value, so
    // gutting the test while keeping its title fails here. That is the fix for
    // the weaker join a first cut had.
    for (const name of CAPITA_SCREENS) {
      const suite = readFileSync(
        join(DIR, name.replace(".tsx", ".test.tsx")),
        "utf8",
      );
      expect(suite, `${name}: no default-basis gate`).toMatch(
        /defaults to the TOTAL/,
      );
      expect(suite, `${name}: no uncaptioned-denominator gate`).toMatch(
        /no census vintage/,
      );
    }
  });
});

describe("§2.2 — months_available is never rendered as coverage", () => {
  /** Every file that reads the month count, and HOW each one is safe.
   *
   *  ⚠️ THE RULE IS MIGRATION 152's, NOT THIS FILE'S. Its `COMMENT ON COLUMN`
   *  says the column counts КФП observations CAPTURED and adds that „a renderer
   *  treating it as coverage states something false about a complete year".
   *  FY2021 is `complete` with SIX, because the feed is cumulative year-to-date
   *  and its December row is the whole year.
   *
   *  This shipped once, in T9.11: `/budget/law` printed „Отчетени 6 мес. по КФП"
   *  for a year that was fully reported — the page under-reporting the state, on
   *  the page whose subject is the gap between our coverage and the state's
   *  record. The plan had specified this gate; it had not been written. */
  const READERS: Record<string, string> = {
    "BudgetLawScreen.tsx":
      "renders the count only inside the not-`complete` branch; leads with lastPeriod",
  };

  it("has an entry for every file that reads the month count", () => {
    const readers = sources()
      .filter(({ text }) => /monthsAvailable/.test(code(text)))
      .map(({ name }) => name)
      .sort();
    // A NEW reader must come here and state how it is safe. That is the whole
    // gate: the two current ones are correct, so nothing behavioural can fail
    // today — what can fail is the third one, silently.
    expect(readers).toEqual(Object.keys(READERS).sort());
  });

  it("backs every rendering reader with a CLOSED-year behavioural gate", () => {
    // ⚠️ THE DIVISION OF LABOUR, stated because a first cut got it wrong. This
    // file cannot check the guard itself: „does the file mention `complete`"
    // is true of the broken version too, so that assertion passed under a
    // mutation that moved the count out of the not-complete arm. What proves
    // the guard is a RENDER of a complete year carrying fewer than twelve
    // months — FY2021, the live instance — and that has to live beside the
    // screen. So this asserts the behavioural gate EXISTS; deleting it there
    // fails here.
    const suite = readFileSync(join(DIR, "BudgetLawScreen.test.tsx"), "utf8");
    // Pinned on the ASSERTIONS, not just the fixture and the title: gutting the
    // test body while leaving both in place kept this green, which is how a
    // first cut overstated the join.
    expect(suite).toMatch(/CLOSED year/);
    expect(suite).toMatch(/monthsAvailable: 6/);
    expect(suite).toMatch(/not\.toContain\("6 месечни снимки"\)/);
    expect(suite).toMatch(/not\.toContain\("годината не е приключила"\)/);
  });
});

describe("§2.3 — a basis caption names the basis of the figure beside it", () => {
  /** ⚠️⚠️ `budget_fiscal_year_figure.basis` HAS THREE VALUES AND TWO OF THEM ARE NOT THE LAW.
   *
   *    actual    — executed so far. The tiles' job; never a headline (six months of FY2026 is
   *                €14,15 млрд. against €29,58 млрд. for the year).
   *    planned   — МФ's own budget-law column off the КФП report. What the Assembly voted.
   *    projected — OURS. This year's actuals scaled through a prior year's monthly profile
   *                (`scripts/budget/kfp.ts`, projectFigures).
   *
   *  Captioning a `projected` figure „план" asserts that parliament appropriated a number we
   *  forecast. It shipped: the /budget head published €29,58 млрд. under „ПЛАН ЗА 2026" with a
   *  note reading „Числата горе са планът по закона за бюджета", for a fiscal year that
   *  carries NO `planned` row at all. Arithmetically right, false as a sentence — the class
   *  this whole file defends.
   *
   *  The gate reads the PAIRING REGISTRY the builder resolves through, not the builder's
   *  source: a grep for „план" near a ternary goes vacuous the moment the ternary moves into
   *  a map, which is exactly the refactor this rule invites. */
  const PLAN_WORDS =
    /план|закона за бюджета|budget act|appropriation|\bplan(ned)?\b/i;
  const FORECAST_WORDS = /прогноз|project(ed|ion)/i;

  const corpora = { bg: bgCorpus, en: enCorpus };

  it("puts no plan word on a projected figure", () => {
    for (const [lang, corpus] of Object.entries(corpora))
      for (const [kind, byBasis] of Object.entries(BUDGET_BASIS_KEYS)) {
        const key = byBasis.projected;
        const text = corpus[key];
        expect(text, `${lang}: ${key} is missing from the corpus`).toBeTruthy();
        expect(
          text,
          `${lang}: ${key} (${kind}) captions OUR forecast as the budget law`,
        ).not.toMatch(PLAN_WORDS);
      }
  });

  it("says so on a projected figure, rather than leaving the basis unstated", () => {
    // The complement, and it is not redundant: „разходи за 2026" contains no plan word and
    // is still an unlabelled forecast presented as a fact.
    for (const [lang, corpus] of Object.entries(corpora))
      for (const byBasis of Object.values(BUDGET_BASIS_KEYS))
        expect(
          corpus[byBasis.projected],
          `${lang}: ${byBasis.projected} does not say the figure is a forecast`,
        ).toMatch(FORECAST_WORDS);
  });

  it("names the seasonal anchor on the money forecast", () => {
    // „прогноза за 2026" alone is a forecast from nowhere. `projectionBasisYear` is on the
    // wire precisely so the caption can say whose profile produced it.
    for (const [lang, corpus] of Object.entries(corpora))
      expect(
        corpus[BUDGET_BASIS_KEYS.money.projected],
        `${lang}: the money forecast caption drops {{basisYear}}`,
      ).toContain("{{basisYear}}");
  });

  it("puts no forecast word on the budget-law figure", () => {
    for (const [lang, corpus] of Object.entries(corpora))
      for (const byBasis of Object.values(BUDGET_BASIS_KEYS)) {
        const text = corpus[byBasis.planned];
        expect(
          text,
          `${lang}: ${byBasis.planned} is missing from the corpus`,
        ).toBeTruthy();
        expect(
          text,
          `${lang}: ${byBasis.planned} calls the budget law a forecast`,
        ).not.toMatch(FORECAST_WORDS);
      }
  });

  it("names the КФП perimeter on the GDP share, in both bases", () => {
    // /budget/execution renders 41,7% of GDP one click away — Eurostat, general government —
    // against this cell's ~23-27% on the КФП state budget. Both are right, and a caption
    // naming neither invites the reader to conclude one of the pages is broken.
    for (const basis of ["planned", "projected"] as const) {
      expect(bgCorpus[BUDGET_BASIS_KEYS.share[basis]]).toContain("КФП");
      expect(enCorpus[BUDGET_BASIS_KEYS.share[basis]]).toContain("CFP");
    }
  });
});
