// The module's shared copy — and the two things about it that are not cosmetic.
//
// `numberLocale` is why a Bulgarian page shows „49,3%" and not „49.3%". `formatScopeLabel` is
// the sentence seven pages use to say which window their numbers are for. Both were duplicated
// across ten and seven files respectively before step 8; a test here is what makes the single
// copy worth having, because the failure mode of both is a page that renders perfectly and
// says something slightly false.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";
import { agriLabel, formatScopeLabel, numberLocale } from "./labels";

describe("numberLocale", () => {
  it("gives Bulgarian a decimal COMMA and English a point", () => {
    // The whole reason this is not just a string. A page that hardcodes „en-US" renders
    // „49.3%" in Bulgarian with nothing failing anywhere.
    expect((49.3).toLocaleString(numberLocale(true))).toBe("49,3");
    expect((49.3).toLocaleString(numberLocale(false))).toBe("49.3");
  });

  it("groups thousands the way each language does", () => {
    expect((1234567).toLocaleString(numberLocale(true))).not.toBe(
      (1234567).toLocaleString(numberLocale(false)),
    );
  });
});

describe("formatScopeLabel", () => {
  it("names the financial year when there is one", () => {
    expect(formatScopeLabel(2025, true)).toBe("Финансова година 2025");
    expect(formatScopeLabel(2025, false)).toBe("Financial year 2025");
  });

  it("says all years when the payload covers all of them", () => {
    expect(formatScopeLabel(null, true)).toBe("Всички години");
    expect(formatScopeLabel(null, false)).toBe("All years");
  });

  it("treats an ABSENT year as all years, not as year zero", () => {
    // `undefined` reaches this from `data?.scopeYear` on every call site, so the nullish
    // check has to cover it. A truthy check would too — but `0` must not become „All years"
    // by accident if the payload ever carries one, which is why the guard is `!= null`.
    expect(formatScopeLabel(undefined, true)).toBe("Всички години");
    expect(formatScopeLabel(0, true)).toBe("Финансова година 0");
  });
});

describe("agriLabel", () => {
  it("gives every label both languages, and they differ", () => {
    for (const [name, fn] of Object.entries(agriLabel)) {
      const b = fn(true);
      const e = fn(false);
      expect(b, `${name} has no Bulgarian`).toBeTruthy();
      expect(e, `${name} has no English`).toBeTruthy();
      // A pair that is identical in both languages is either a proper noun (there are none
      // here) or a forgotten translation.
      expect(b, `${name} is the same string in both languages`).not.toBe(e);
    }
  });

  it("writes the Bulgarian with Bulgarian typography, and the English with English", () => {
    // The defect this catches shipped: seven ENGLISH strings in this module OPENED with „ ,
    // the Bulgarian low-9 quote, because the BG was written first and the EN edited beside it.
    //
    // Only „ is checked. The two conventions SHARE “ — it is Bulgarian's CLOSING quote and
    // English's OPENING one — so flagging it would fail every correctly-quoted English string,
    // which is what the first cut of this gate did.
    for (const [name, fn] of Object.entries(agriLabel)) {
      expect(fn(false), `${name}'s English uses the Bulgarian „`).not.toMatch(
        /„/,
      );
    }
  });
});

// ── The reason this file is more than three unit tests ──────────────────────────────────────

const REPO = join(__dirname, "..", "..", "..");
const MODULE_FILES = [
  ...globSync("src/screens/subsidies/*.tsx", { cwd: REPO }),
  "src/screens/SubsidiesDashboardScreen.tsx",
  "src/screens/dev/SubsidiesBrowserDbScreen.tsx",
  "src/screens/dev/FarmDetailScreen.tsx",
].filter((f) => !f.includes(".test."));

const src = (f: string) => readFileSync(join(REPO, f), "utf8");

describe("the module does not re-grow the duplicates this file removed", () => {
  it("finds the module's files at all", () => {
    expect(MODULE_FILES.length).toBeGreaterThan(10);
  });

  it("no page hardcodes an Intl locale", () => {
    // Ten files did. The one that gets it wrong renders a decimal point on a Bulgarian page,
    // which no test of that page would notice.
    const offenders = MODULE_FILES.filter((f) =>
      /"bg-BG"|"en-US"/.test(src(f)),
    );
    expect(
      offenders,
      "use numberLocale(bg) — a hardcoded locale is a decimal point waiting to happen",
    ).toEqual([]);
  });

  it("no page rebuilds the scope label by hand", () => {
    // The literal, not a construction: after step 8 EVERY use of the phrase in this module
    // goes through `formatScopeLabel` or `agriLabel.financialYear`, so its presence in a
    // screen file is by definition a re-implementation. Matching the ternary SHAPE instead
    // was too narrow — a copy written with a trailing space („Финансова година " + year, the
    // exact form the seven originals used) slipped straight past it.
    const offenders = MODULE_FILES.filter((f) =>
      /"Финансова година/.test(src(f)),
    );
    expect(
      offenders,
      "use formatScopeLabel(data?.scopeYear, bg) — seven copies is how six drift",
    ).toEqual([]);
  });

  it("no page spells a shared label its own way", () => {
    // „Област" was rendering as „Province" on three pages and „Region" on two — the exact
    // drift this file exists to stop, present on the day it was written.
    const SHARED: [string, RegExp][] = [
      ["oblast", /bg \? "Област" :/],
      ["recipient", /bg \? "Получател" :/],
      ["scheme", /bg \? "Схема" :/],
      ["payments", /bg \? "Плащания" :/],
      ["paid", /bg \? "Изплатено" :/],
      ["atAGlance", /bg \? "Накратко" :/],
      ["tryAgain", /bg \? "Опитай отново" :/],
      ["financialYear", /bg \? "Финансова година" :/],
    ];
    const offenders: string[] = [];
    for (const f of MODULE_FILES)
      for (const [name, re] of SHARED)
        if (re.test(src(f))) offenders.push(`${f} → agriLabel.${name}(bg)`);
    expect(offenders).toEqual([]);
  });

  it("the English arm never opens a quote the Bulgarian way", () => {
    // Seven strings did. `„` is the Bulgarian low-9 opening quote; English opens with `“`.
    // The CLOSING mark is shared (`“` closes in Bulgarian, opens in English), so only the
    // opening one discriminates — checking both fails every correct English string, which is
    // exactly what this gate did on its first run.
    const offenders: string[] = [];
    for (const f of MODULE_FILES)
      for (const m of src(f).matchAll(
        /bg\s*\?\s*"(?:[^"\\]|\\.)*"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
      ))
        if (/„/.test(m[1])) offenders.push(`${f}: ${m[1].slice(0, 60)}`);
    expect(offenders).toEqual([]);
  });
});
