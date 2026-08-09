// Parser gates for the ДФЗ Strategic-Plan indicative schedule.
//
// The fixture is the REAL 2026 sheet frozen to a JSON grid (the XLSX itself is a binary in a
// gitignored cache). Every expectation below was read off the published file, not invented.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BGN_PER_EUR,
  parseSp2023,
  readLeadingAmount,
  readSingleRate,
} from "./sp2023_parse";
import { findXlsxCandidates, pickCandidate, sheetToGrid } from "./sp2023_fetch";
import { deriveAudience } from "./audience";
import { validateCall } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const grid = JSON.parse(
  readFileSync(
    path.join(here, "__fixtures__", "sp2023_igg_2026.grid.json"),
    "utf-8",
  ),
) as unknown[][];

const rows = parseSp2023(grid, 2026);
const calls = rows.map((r) => r.call);

describe("readLeadingAmount", () => {
  test("takes an amount the cell LEADS with", () => {
    assert.equal(readLeadingAmount("68 716 487,5 евро").eur, 68716487.5);
    assert.equal(readLeadingAmount("до 400 000 евро").eur, 400000);
    assert.equal(
      readLeadingAmount("235 838 246 евро, от които: 212 254 421,40 евро").eur,
      235838246,
    );
  });

  test("REFUSES a number buried in prose", () => {
    // The one that matters: a per-unit simplified cost. A first-number-wins parser stores €18
    // as this intervention's project ceiling.
    const r = readLeadingAmount(
      "Помощта се предоставя под формата на опростен разход в размер на 18, 38 или 54 евро",
    );
    assert.equal(r.eur, null);
    assert.match(r.skipped ?? "", /no leading amount/u);

    assert.equal(
      readLeadingAmount(
        "Максималният размер на допустимите разходи за индивидуален кандидат е до 2 000 000 евро",
      ).eur,
      null,
      "conservative: missing beats wrong, because these columns are sortable",
    );
  });

  test("requires an explicit currency word", () => {
    // „До левовата равностойност на" in the column HEADER is legal boilerplate, not a unit.
    assert.equal(readLeadingAmount("5 000 000").eur, null);
    assert.equal(readLeadingAmount("").eur, null);
  });

  test("converts an explicit lev amount at the fixed rate", () => {
    const r = readLeadingAmount("1 955 830 лв.");
    assert.ok(r.eur);
    assert.equal(Math.round(r.eur), 1000000);
    assert.equal(BGN_PER_EUR, 1.95583);
  });
});

describe("readSingleRate", () => {
  test("takes a rate the row states unambiguously", () => {
    assert.equal(readSingleRate("50 % от размера на одобрените разходи"), 50);
    assert.equal(readSingleRate("Финансовата помощ е в размер на 100% "), 100);
    assert.equal(readSingleRate("65 % от размера на допустимите разходи"), 65);
  });

  test("REFUSES a row stating two different rates", () => {
    // No single number is true of the row; picking the first invents a fact.
    assert.equal(
      readSingleRate("по т. 1.1. - до 100%, а по т. 1.2 - до 50%"),
      null,
    );
  });

  test("a repeated identical rate is still one rate", () => {
    assert.equal(
      readSingleRate("до 100% за текущи разходи и до 100% за други"),
      100,
    );
  });

  test("reads a FRACTIONAL rate instead of its decimal tail", () => {
    // `(\d{1,3})\s*%` backtracks past „37," and matches „5 %" → 5. The multi-rate guard then
    // INVERTS: one distinct value looks unambiguous, so the wrong number is accepted rather
    // than declined. Not triggered by the 2026 sheet — live the first time ДФЗ publishes a
    // 37,5% co-financing rate.
    assert.equal(readSingleRate("37,5 % от размера"), 37.5);
    assert.equal(readSingleRate("12.5%"), 12.5);
    assert.equal(readSingleRate("до 66,67 % съфинансиране"), 66.67);
  });
});

describe("the 2026 schedule", () => {
  test("parses all 11 interventions", () => {
    assert.equal(rows.length, 11);
    for (const c of calls) assert.deepEqual(validateCall(c), []);
  });

  test("EVERY row is indicative and carries no deadline", () => {
    // The DDL refuses closes_at on an indicative row precisely so a forecast („В периода
    // октомври-декември") can never be rendered as a deadline.
    for (const c of calls) {
      assert.equal(c.datePrecision, "indicative");
      assert.equal(c.closesAt, null);
      assert.ok(c.periodLabel, `${c.code} has no period label`);
    }
  });

  test("codes with an internal space still parse (2 of 11 real rows)", () => {
    // „II. Г.4" and „II. Г.14" carry a space after the numeral in the published file. The first
    // regex rejected them, leaving code=null and degrading sourceKey to a 40-char title prefix
    // — which forks the row permanently on this never-deleted table if the title is ever edited.
    for (const c of calls)
      assert.ok(c.code, `code=null for ${c.title.slice(0, 40)}`);
    assert.ok(
      calls.some((c) => c.code === "II.Г.4"),
      "II. Г.4 should normalise to II.Г.4",
    );
    assert.ok(calls.some((c) => c.code === "II.Г.14"));
    for (const c of calls)
      assert.ok(!/\s/u.test(c.code ?? ""), `code has whitespace: ${c.code}`);
  });

  test("II.Д.1 Млад фермер carries the figures the register publishes", () => {
    const y = calls.find((c) => c.code === "II.Д.1");
    assert.ok(y, "the young-farmer intervention should be present");
    assert.equal(y.budgetEur, 68716487.5);
    assert.equal(y.aidRatePct, 100);
    assert.equal(y.grantMaxEur, 40000);
    assert.deepEqual(y.audience, ["farmer"]);
    assert.match(y.beneficiariesRaw ?? "", /18 до 40 години/u);
    assert.match(y.periodLabel ?? "", /октомври-декември/u);
    assert.equal(y.enrichment, "source");
  });

  test("prose budgets keep their text and take no number", () => {
    const prose = calls.filter((c) => c.budgetEur === null);
    assert.equal(prose.length, 2, "two rows state a residual budget in words");
    for (const c of prose) {
      assert.ok(c.budgetNote, "the raw string must survive");
      assert.equal(c.budgetEur, null);
    }
  });

  test("declines more ceilings than it takes — that is the point", () => {
    const taken = calls.filter((c) => c.grantMaxEur !== null).length;
    assert.equal(taken, 3);
    assert.ok(
      rows.flatMap((r) => r.skipped).length >= 8,
      "the declined figures are reported, not silently dropped",
    );
  });

  test("a row with any figure claims 'source' provenance, others 'none'", () => {
    for (const c of calls) {
      const hasFigure =
        c.budgetEur !== null || c.grantMaxEur !== null || c.aidRatePct !== null;
      assert.equal(
        c.enrichment,
        hasFigure ? "source" : "none",
        c.code ?? c.title,
      );
    }
  });

  test("sourceKey is year-scoped so 2027 cannot overwrite 2026", () => {
    for (const c of calls) assert.match(c.sourceKey, /^2026:/u);
    const next = parseSp2023(grid, 2027).map((r) => r.call.sourceKey);
    assert.equal(
      next.filter((k) => calls.some((c) => c.sourceKey === k)).length,
      0,
      "a later schedule must not collide with this one",
    );
  });

  test("refuses a sheet whose header row is missing", () => {
    assert.throws(
      () => parseSp2023([["junk"], ["also junk"]], 2026),
      /ИНТЕРВЕНЦИЯ header not found/u,
    );
  });
});

describe("choosing the schedule file", () => {
  const html = `<a href="/images/IGG/x_2025.xlsx">a</a>
                <a href="/images/IGG/x_2026.xlsx">b</a>`;

  test("finds every candidate and reads the year from the name", () => {
    const c = findXlsxCandidates(html);
    assert.equal(c.length, 2);
    assert.deepEqual(c.map((x) => x.year).sort(), [2025, 2026]);
  });

  test("picks the highest year — the page really does list both", () => {
    // Measured 2026-08-08: sp2023.bg lists 2025 AND 2026. Failing on >1 candidate, as an
    // earlier draft of the plan specified, would have broken on the first run.
    assert.equal(pickCandidate(findXlsxCandidates(html)).year, 2026);
  });

  test("throws rather than falling back to a hardcoded URL", () => {
    assert.throws(() => pickCandidate([]), /no \.xlsx link found/u);
    assert.throws(
      () =>
        pickCandidate(findXlsxCandidates('<a href="/x/undated.xlsx">a</a>')),
      /no year in any filename/u,
    );
  });

  test("resolves a relative href against the site origin", () => {
    assert.match(
      findXlsxCandidates(html)[0].url,
      /^https:\/\/www\.sp2023\.bg\//u,
    );
  });
});

describe("column mapping", () => {
  test("resolves columns by HEADER, so an inserted column cannot shift fields", () => {
    // The regression this replaces: only ИНТЕРВЕНЦИЯ was verified and indices 3-9 trusted, so
    // splicing one column in kept all 11 rows and passed validateCall AND the shrink guard,
    // while periodLabel filled with the territory text and the money columns quietly emptied.
    const shifted = grid.map((r, i) =>
      i === 0 ? r : [...r.slice(0, 3), "ВСТАВЕНА КОЛОНА", ...r.slice(3)],
    );
    const out = parseSp2023(shifted, 2026);
    assert.equal(out.length, 11, "row count unchanged — that was the trap");
    const y = out.find((r) => r.call.code === "II.Д.1");
    assert.ok(y, "II.Д.1 still found after the shift");
    assert.equal(y.call.budgetEur, 68716487.5, "budget followed its header");
    assert.match(y.call.periodLabel ?? "", /октомври-декември/u);
  });

  test("throws, naming the missing column, when a header disappears", () => {
    const dropped = grid.map((r, i) =>
      i === 0 ? r : (r as unknown[]).filter((_c, ci) => ci !== 7),
    );
    assert.throws(() => parseSp2023(dropped, 2026), /missing column/u);
    assert.throws(() => parseSp2023(dropped, 2026), /ПЕРИОД НА ПРИЕМ/u);
  });

  test("the fixture still carries every header the parser requires", () => {
    // Fixture drift: if the live sheet is re-frozen with different headers, fail HERE rather
    // than at the next ingest.
    const header = (grid[1] ?? []) as unknown[];
    for (const label of [
      "ИНТЕРВЕНЦИЯ",
      "БЮДЖЕТ ЗА ПРИЕМ",
      "БЕНЕФИЦИЕНТИ",
      "ПЕРИОД НА ПРИЕМ",
      "РАЗМЕР НА ФИНАНСОВАТА ПОМОЩ",
      "РАЗМЕР НА РАЗХОДИТЕ ЗА ЕДИН ПРОЕКТ",
    ])
      assert.ok(
        header.some((h) =>
          String(h ?? "")
            .replace(/\s+/gu, " ")
            .toUpperCase()
            .startsWith(label),
        ),
        `fixture lost the ${label} column`,
      );
  });
});

describe("sheetToGrid", () => {
  test("reads the cached XLSX and agrees with the committed fixture", () => {
    // Regenerate: `npx tsx scripts/opencalls/sp2023_fetch.ts` (writes the gitignored cache),
    // then re-freeze the grid. Skips when the cache is absent, e.g. on a fresh clone.
    const xlsx = "raw_data/opencalls/sp2023/igg_2026.xlsx";
    if (!existsSync(xlsx)) return;
    const live = sheetToGrid(readFileSync(xlsx));
    assert.equal(
      parseSp2023(live, 2026).length,
      rows.length,
      "the committed fixture has drifted from the cached XLSX",
    );
  });
});

describe("audience derivation", () => {
  test("does not tag an NGO row as a farm", () => {
    // /стопан/ also matches „неСТОПАНска цел" — the over-match that made every NGO a farm.
    const a = deriveAudience(
      "юридически лица с нестопанска цел, регистрирани в обществена полза",
    );
    assert.ok(a.includes("ngo"));
    assert.ok(!a.includes("farmer"), `over-matched: ${a.join(",")}`);
  });

  test("catches the WIDEST eligibility statement in the schedule", () => {
    // „физически и юридически лица" — /физически лица/ misses it, so the one intervention open
    // to everybody resolved to unknown.
    const a = deriveAudience(
      "Всички физически и юридически лица, които разполагат с експертен капацитет",
    );
    assert.ok(a.includes("individual"), `got ${a.join(",")}`);
    assert.ok(!a.includes("unknown"));
  });

  test("institution is reachable — it was not", () => {
    assert.deepEqual(deriveAudience(null, "Техническа помощ"), ["institution"]);
    assert.deepEqual(deriveAudience(null, "Бюджетни линии"), ["institution"]);
  });

  test("no text at all is unknown, not a guess", () => {
    assert.deepEqual(deriveAudience(null, null), ["unknown"]);
    assert.deepEqual(deriveAudience("", ""), ["unknown"]);
  });
});
