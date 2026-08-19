// Every date formatter in `src/` must say which zone it renders in.
//
// The defect this gates is one bug with three faces, and all three shipped. `new Date("…")`
// on a bare day is a UTC-MIDNIGHT parse, so formatting it in the viewer's zone lands on the
// previous calendar day for everyone west of Greenwich:
//
//   - the article byline read "16 АВГУСТ 2026 Г." for a `publishedAt` of 2026-08-17, while
//     the feed strip on the same page said 17;
//   - a declaration's filing date, a bond's issue/maturity date, a matura exam day, a
//     roll-call session day and an Interreg operation's period each moved a day early;
//   - worst, `new Date(Date.UTC(y, m - 1, 1))` formatted with `{ month: "long" }` rolls back
//     into the PREVIOUS MONTH — the budget "same point last year" heading printed „май"
//     where it meant „юни".
//
// Bulgarian readers (UTC+3) see none of it, which is why it accumulated. So the rule is not
// "pin UTC everywhere" — an instant SHOULD render in the reader's zone — it is that every
// call site has to have made the choice on purpose. A formatter passes by pinning `timeZone`,
// by routing through `@/lib/formatDate` (which pins UTC for the date-only shape only), or by
// being listed below with the reason it needs neither.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../../scripts/lib/strip_comments";

// Call sites that build their Date from PARTS in LOCAL time (`new Date(y, m - 1, d)`) or via
// the shared `parseCalendarDay`, and instants that are genuinely instants. Each entry is a
// decision, so a new one must be argued rather than appended.
const EXEMPT: Record<string, string> = {
  "src/data/utils.ts":
    "localDate/localDateShort split a YYYY_MM_DD key and construct with new Date(y, m-1, d) — already local midnight, so there is no UTC parse to shift.",
  "src/data/prices/usePrices.tsx":
    "parseCalendarDay() — the shared local-midnight parse for a bare day.",
  "src/screens/components/prices/PriceIndexTrendChart.tsx":
    "parseCalendarDay(), same as above; its docblock records the same regression.",
  "src/screens/indicators/IndicatorsEconomyScreen.tsx":
    "new Date(m.year, m.month - 1, 1) — local construction for a month+year label.",
  "src/screens/components/macro/FdiMonthlyTile.tsx":
    "new Date(ytd.current.year, ytd.month - 1, 1) — local construction, month+year label.",
  "src/screens/components/procurement/customs/CustomsExciseRegisterTile.tsx":
    "data.generatedAt is a real instant (new Date().toISOString() at build time), so the reader's own zone is the right answer.",
  "src/screens/procurement/TenderDetailScreen.tsx":
    "The submission deadline is a real instant rendered WITH hour+minute. Note it renders in the reader's zone, not Sofia's — see useOpenCalls, which pins Europe/Sofia deliberately for the same kind of value.",
};

const CALL = /(?:\.toLocaleDateString|new\s+Intl\.DateTimeFormat)\s*\(/g;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });

/** The argument list of the call opening at `from`, by paren balance. */
const argsOf = (src: string, from: number): string => {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(from + 1, i);
  }
  return src.slice(from);
};

const unpinned = (): string[] => {
  const out: string[] = [];
  for (const file of walk("src")) {
    // Comments are stripped first: this file, and the fixes it guards, DISCUSS the forbidden
    // pattern in prose. Scanning the raw text reports ArticleLayout — whose comment says
    // "never a bare new Date(date).toLocaleDateString(...)" — as an offender.
    const src = stripComments(readFileSync(file, "utf8"));
    CALL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CALL.exec(src))) {
      const open = m.index + m[0].length - 1;
      if (/timeZone/.test(argsOf(src, open))) continue;
      out.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  return out;
};

describe("date formatters declare their timezone", () => {
  it("has no formatter that neither pins a zone nor is a reviewed exception", () => {
    const offenders = unpinned().filter(
      (loc) => !(loc.split(":")[0] in EXEMPT),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every exemption live", () => {
    // A stale exemption is as much a defect as a missing one — it silently blesses whatever
    // the file does next.
    const files = new Set(unpinned().map((loc) => loc.split(":")[0]));
    expect([...Object.keys(EXEMPT)].filter((f) => !files.has(f))).toEqual([]);
  });

  it("still discriminates — the scan finds a real unpinned call", () => {
    // Without this the suite passes if `unpinned()` silently stops matching anything (a bad
    // glob, a regex typo), which would retire the gate while staying green.
    const probe = `const s = d.toLocaleDateString("bg-BG", { month: "long" });`;
    CALL.lastIndex = 0;
    const m = CALL.exec(probe)!;
    expect(m).not.toBeNull();
    expect(/timeZone/.test(argsOf(probe, m.index + m[0].length - 1))).toBe(
      false,
    );
  });
});
