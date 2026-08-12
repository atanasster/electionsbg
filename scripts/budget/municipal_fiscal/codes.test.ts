// Gates for the МФ/ЕБК → obshtina crosswalk.
//
// Four of these are structural and each catches a different silent failure:
//
//   1. every roster row resolves — an unresolved code means a município never
//      appears on any page;
//   2. the prefix map stays a bijection — what catches МФ renumbering an
//      oblast, which would re-assign a whole region with every row still
//      resolving;
//   3. the crosswalk is INJECTIVE — the one failure the oblast prefix does not
//      close: two МФ rows folding onto one município put two municipalities'
//      arrears on one page and drop the other;
//   4. every real município is covered — the opposite direction, where МФ drops
//      a row and the count moves like ordinary churn.
//
// The Sofia-district test asserts the exclusion on the INDEX rather than on the
// crosswalk output, because on the output it could never fail: districts carry
// oblast S23/S24/S25 and no МФ prefix maps there, so the prefix alone already
// closes that class. See the module header — crediting the filter with that
// work is how the load-bearing half gets removed later.

import { describe, it, expect } from "vitest";
import {
  ABROAD_OBLAST,
  MF_PREFIX_TO_OBLAST,
  MF_ROSTER,
  NAME_ALIASES,
  SOFIA_MF_CODE,
  SOFIA_OBSHTINA,
  buildCrosswalk,
  buildNameIndex,
  diffRoster,
  foldMuniName,
  isSofiaRayonObshtina,
  loadMunicipalities,
  resolveMfCode,
} from "./codes";

describe("municipal fiscal crosswalk", () => {
  const munis = loadMunicipalities();

  it("resolves every roster row", () => {
    // buildCrosswalk throws listing each failure, so a regression names the
    // municipalities rather than just failing a count.
    const xwalk = buildCrosswalk(munis);
    expect(xwalk.size).toBe(MF_ROSTER.length);
    expect(MF_ROSTER.length).toBe(265);
  });

  it("keeps the МФ prefix → oblast map a bijection", () => {
    const oblasts = Object.values(MF_PREFIX_TO_OBLAST);
    expect(new Set(oblasts).size).toBe(oblasts.length);
    // Every roster code's prefix must be known, or resolveMfCode short-circuits
    // to "unknown-prefix" and the município vanishes.
    for (const { mf } of MF_ROSTER) {
      if (mf === SOFIA_MF_CODE) continue;
      expect(MF_PREFIX_TO_OBLAST[String(mf).slice(0, 2)]).toBeDefined();
    }
  });

  it("maps each município to at most one МФ code", () => {
    // Injectivity is the one failure the oblast prefix does NOT close: two МФ
    // rows folding onto one município would put two municipalities' arrears on
    // one page and drop the other, with xwalk.size still equal to the roster.
    const xwalk = buildCrosswalk(munis);
    const byTarget = new Map<string, number[]>();
    for (const [mf, ob] of xwalk)
      byTarget.set(ob, [...(byTarget.get(ob) ?? []), mf]);
    expect([...byTarget].filter(([, mfs]) => mfs.length > 1)).toEqual([]);
    expect(new Set(xwalk.values()).size).toBe(265);
  });

  it("covers every real município, so a dropped МФ row is visible", () => {
    // The denominator is NOT munis.length: 294 rows = 264 real + 24 S2xxx
    // districts + 6 out-of-country pseudo-rows (oblast "32").
    const real = munis.filter(
      (m) => !isSofiaRayonObshtina(m.obshtina) && m.oblast !== ABROAD_OBLAST,
    );
    expect(real).toHaveLength(264);
    const targets = new Set(buildCrosswalk(munis).values());
    expect(
      real.filter((m) => !targets.has(m.obshtina)).map((m) => m.obshtina),
    ).toEqual([]);
    expect(targets.has(SOFIA_OBSHTINA)).toBe(true); // 264 + Sofia = 265
  });

  it("excludes Sofia districts from the candidate set", () => {
    // Discriminating both ways: the input must actually contain districts, or
    // the exclusion assertion is vacuous. (This filter is redundant with the
    // oblast prefix — see the module header — so it is asserted on the INDEX,
    // where it does something, rather than on the crosswalk output, where the
    // assertion could never fail either way.)
    expect(munis.some((m) => isSofiaRayonObshtina(m.obshtina))).toBe(true);
    const values = [...buildNameIndex(munis).values()].flat();
    expect(values.some(isSofiaRayonObshtina)).toBe(false);
  });

  it("splits the two Бяла by oblast prefix, which a name cannot do", () => {
    const idx = buildNameIndex(munis);
    // 5304 = Varna oblast, 6802 = Ruse oblast; both are spelled „Бяла".
    expect(resolveMfCode(5304, "Бяла", idx).obshtina).toBe("VAR05");
    expect(resolveMfCode(6802, "Бяла", idx).obshtina).toBe("RSE04");
  });

  it("prefers the real município over the same-named Sofia district", () => {
    const idx = buildNameIndex(munis);
    // Средец is also Sofia district S2401; Искър is also S2414.
    expect(resolveMfCode(5211, "Средец", idx).obshtina).toBe("BGS06");
    expect(resolveMfCode(6505, "Искър", idx).obshtina).toBe("PVN23");
  });

  it("maps Sofia to the synthetic SOF00, which has no dimension row", () => {
    const idx = buildNameIndex(munis);
    expect(resolveMfCode(SOFIA_MF_CODE, "Столична община", idx).obshtina).toBe(
      SOFIA_OBSHTINA,
    );
    // The premise of the synthetic code: no real município row exists for it.
    expect(munis.some((m) => m.obshtina === SOFIA_OBSHTINA)).toBe(false);
  });

  it("folds whitespace entirely, not merely normalises it", () => {
    // МФ writes „Вълчидол"; municipalities.json has „Вълчи дол".
    expect(foldMuniName("Вълчидол")).toBe(foldMuniName("Вълчи дол"));
    expect(foldMuniName("Генерал  Тошево")).toBe(
      foldMuniName("Генерал-Тошево"),
    );
  });

  it("folds every dash variant, not just the ASCII hyphen", () => {
    // Table-driven so a variant cannot be dropped from the class silently. The
    // source is an Office workbook and en/em dash are what autocorrect
    // produces — yet the only dash anywhere in the corpus is ASCII, so nothing
    // in the DATA exercises this. That is precisely how a broken range shipped
    // green once: U+2011, U+2012, U+2013 and U+2014 were not folded.
    const variants = ["-", "‐", "‑", "‒", "–", "—", "―", "−", "­"];
    for (const d of variants) {
      expect(foldMuniName(`Добрич${d}селска`)).toBe("добричселска");
    }
  });

  it("leaves letters and digits alone", () => {
    // The counterpart to the test above: a character class wide enough to fold
    // every dash must not have become wide enough to eat anything else.
    expect(foldMuniName("Бяла3")).toBe("бяла3");
    expect(foldMuniName("Ямбол")).toBe("ямбол");
  });

  it("keeps the alias table minimal and pointed at a real município", () => {
    // A growing alias table is the smell that someone reached for fuzzy
    // matching instead of the oblast prefix.
    expect(Object.keys(NAME_ALIASES)).toHaveLength(1);
    const idx = buildNameIndex(munis);
    expect(resolveMfCode(5804, "Добричка", idx).obshtina).toBe("DOB15");
  });

  it("reports a failure reason rather than throwing on one bad row", () => {
    const idx = buildNameIndex(munis);
    expect(resolveMfCode(9901, "Несъществуваща", idx)).toEqual({
      obshtina: null,
      reason: "unknown-prefix",
    });
    expect(resolveMfCode(5199, "Несъществуваща", idx)).toEqual({
      obshtina: null,
      reason: "no-match",
    });
  });

  it("rejects a non-4-digit code instead of borrowing a valid prefix", () => {
    // Without the guard both of these returned a confident BLG01 (Банско): the
    // shape a stripped leading zero or an off-by-one column read produces.
    const idx = buildNameIndex(munis);
    expect(resolveMfCode(510, "Банско", idx)).toEqual({
      obshtina: null,
      reason: "malformed-code",
    });
    expect(resolveMfCode(51011, "Банско", idx)).toEqual({
      obshtina: null,
      reason: "malformed-code",
    });
    expect(resolveMfCode(5101, "Банско", idx).obshtina).toBe("BLG01");
  });

  it("reports every candidate when a name is ambiguous within an oblast", () => {
    // The real index has zero ambiguous keys, so this branch — the diagnostic
    // an operator reads when a future workbook actually collides — would
    // otherwise have its first execution in production.
    const idx = new Map([["RSE|бяла", ["RSE04", "RSE99"]]]);
    expect(resolveMfCode(6802, "Бяла", idx)).toEqual({
      obshtina: null,
      reason: "ambiguous",
      candidates: ["RSE04", "RSE99"],
    });
  });

  it("throws naming every unresolved row rather than returning a partial map", () => {
    // The module's central safety promise: a partial crosswalk drops
    // municipalities silently, so buildCrosswalk must refuse to return one.
    // Sofia still resolves (it short-circuits before the index), hence 264.
    expect(() => buildCrosswalk([])).toThrow(/264 of 265 unresolved/);
    expect(() => buildCrosswalk([])).toThrow(/5101 Банско \(no-match\)/);
  });

  describe("diffRoster", () => {
    it("separates a município МФ added from one it dropped", () => {
      const all = MF_ROSTER.map((r) => r.mf);
      expect(diffRoster(all)).toEqual({ added: [], dropped: [] });
      expect(diffRoster(all.filter((mf) => mf !== 5101))).toEqual({
        added: [],
        dropped: [5101],
      });
      expect(diffRoster([...all, 7999])).toEqual({
        added: [7999],
        dropped: [],
      });
    });
  });
});
