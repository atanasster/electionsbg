// Gates for the two decisions that lost общ. Бяла (обл. Русе) from the 2019 and 2023 cycles:
// how a CIK page's município name becomes an obshtinaCode, and what happens when two pages
// claim the same one. Both were previously reachable only through the full orchestration
// (filesystem + section CSV + canonical parties), which is why neither was tested.
// See docs/plans/village-mayor-attribution-v1.md §T0.

import { describe, it, expect } from "vitest";
import { resolveByName, mergeOrCollide } from "./parse_local_elections";
import type { ParsedRezultatiPage } from "./parse_rezultati_html";
import type { LocalMunicipalityBundle } from "./types";

/** Only the two header fields the resolver reads. */
const page = (municipalityName: string, oblastName = "") =>
  ({ municipalityName, oblastName }) as ParsedRezultatiPage;

describe("resolveByName", () => {
  it("routes the two Бяла pages apart by the page's oblast", () => {
    expect(resolveByName("1804", page("Бяла", "Русе"))?.obshtinaCode).toBe(
      "RSE04",
    );
    expect(resolveByName("0305", page("Бяла", "Варна"))?.obshtinaCode).toBe(
      "VAR05",
    );
  });

  // The pre-2019 case: no oblast in the header at all (264/264 pages in 2011, 265/265 in
  // 2015). The OIK's own prefix carries the oblast, so the tiebreak still decides —
  // this is what stops `--all` from re-writing the 2011/2015 loss.
  it("falls back to the OIK prefix when the page carries no oblast", () => {
    const ruse = resolveByName("1804", page("Бяла"));
    expect(ruse?.obshtinaCode).toBe("RSE04");
    expect(ruse?.ambiguous).toBe(false);
    const varna = resolveByName("0305", page("Бяла"));
    expect(varna?.obshtinaCode).toBe("VAR05");
    expect(varna?.ambiguous).toBe(false);
  });

  it("resolves Софийска — the modern spelling, on 22 pages per cycle", () => {
    expect(
      resolveByName("2307", page("Ботевград", "Софийска"))?.obshtinaCode,
    ).toBe("SFO07");
  });

  // Only when BOTH discriminators are unusable does catalogue order decide — and then it is
  // flagged, never silent.
  it("flags a name it can narrow by neither oblast nor OIK", () => {
    const r = resolveByName("9999", page("Бяла"));
    expect(r?.obshtinaCode).toBe("VAR05"); // catalogue order
    expect(r?.ambiguous).toBe(true);
  });

  // The 2011 "Добрич" shape: a UNIQUE name match that contradicts the oblast. There is no
  // tie, so `ambiguous` cannot see it; `oblastMismatch` is what catches it.
  it("flags a unique match whose oblast contradicts the page", () => {
    const r = resolveByName("0815", page("Добрич", "Добрич"));
    expect(r?.obshtinaCode).toBe("DOB28");
    expect(r?.ambiguous).toBe(false);
    expect(r?.oblastMismatch).toBe(false); // DOB28 IS in DOB — the name is the lie, not the oblast
    const wrong = resolveByName("0101", page("Добрич", "Благоевград"));
    expect(wrong?.oblastMismatch).toBe(true);
  });

  // Пловдив-град's catalogue row carries the МИР code PDV-00 while its page says
  // "област Пловдив". Benign, and it must not be reported as a contradiction.
  it("does not flag the PDV / PDV-00 shard pairing", () => {
    const r = resolveByName("1622", page("Пловдив", "Пловдив"));
    expect(r?.obshtinaCode).toBe("PDV22");
    expect(r?.oblastMismatch).toBe(false);
  });

  it("lets the alias table win over the catalogue", () => {
    expect(
      resolveByName("2246", page("Столична", "София (столица)"))?.obshtinaCode,
    ).toBe("SOF");
    expect(
      resolveByName("0815", page("Добричка", "Добрич"))?.obshtinaCode,
    ).toBe("DOB15");
  });

  it("returns null for a name in neither the alias table nor the catalogue", () => {
    expect(resolveByName("9999", page("Атлантида", "Русе"))).toBeNull();
    expect(resolveByName("9999", page(""))).toBeNull();
  });
});

const bundle = (
  obshtinaCode: string,
  oikCode: string,
  obshtinaName: string,
  kmetstva: string[] = [],
): LocalMunicipalityBundle =>
  ({
    obshtinaCode,
    oikCode,
    obshtinaName,
    oblastName: "",
    kmetstva: kmetstva.map((k) => ({
      kmetstvoName: k,
      ekatte: "",
      candidates: [],
    })),
    districts: [],
  }) as unknown as LocalMunicipalityBundle;

describe("mergeOrCollide", () => {
  it("appends a new obshtinaCode and reports no collision", () => {
    const acc: LocalMunicipalityBundle[] = [];
    expect(mergeOrCollide(acc, bundle("VAR05", "0305", "Бяла"))).toBeNull();
    expect(mergeOrCollide(acc, bundle("RSE04", "1804", "Бяла"))).toBeNull();
    expect(acc.map((b) => b.obshtinaCode)).toEqual(["VAR05", "RSE04"]);
  });

  // The exact shape of the defect: the second município's kmetstva are grafted on and its
  // mayor/council vanish. The report is the only trace, so it must name both sides.
  it("reports the collision that drops a município, naming both OIKs", () => {
    const acc = [bundle("VAR05", "0305", "Бяла", ["Господиново"])];
    const msg = mergeOrCollide(
      acc,
      bundle("VAR05", "1804", "Бяла", ["Ботров", "Стърмен"]),
      "Русе",
    );
    expect(msg).toContain("VAR05");
    expect(msg).toContain("0305");
    expect(msg).toContain("1804");
    expect(msg).toContain("Русе");
    expect(acc).toHaveLength(1);
    expect(acc[0].kmetstva.map((k) => k.kmetstvoName)).toEqual([
      "Господиново",
      "Ботров",
      "Стърмен",
    ]);
  });
});
