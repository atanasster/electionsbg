// The office+place phrase on the 19,506 prerendered /person pages of local officials.
//
// Three things are worth a gate. The redundancy this module exists to remove must stay
// removed — "Кмет на кметство в с. Цветино" and "Кмет на община в Исперих" both named their
// place twice. The SHORT form must be licensed by the place label rather than by the role,
// because 77 village-mayor cards carry the ОБЩИНА the кметство sits in instead of the
// village, and there "Кмет на Омуртаг" would name a different office held by a different
// person. And the composed word "община" must never double up on the one label that already
// carries it (Столична община, 172 cards).

import { describe, it, expect } from "vitest";
import {
  isSettlementLabel,
  localOfficePhraseBg,
  localOfficePhraseEn,
  stripSettlementMarker,
} from "./localOfficePhrase";

describe("localOfficePhraseBg", () => {
  it("names the village once for a village mayor", () => {
    expect(localOfficePhraseBg("village_mayor", "с. Цветино")).toBe(
      "Кмет на с. Цветино",
    );
    expect(localOfficePhraseBg("village_mayor", "гр. Българово")).toBe(
      "Кмет на гр. Българово",
    );
  });

  it("names the obshtina once for a municipal mayor", () => {
    expect(localOfficePhraseBg("mayor", "Исперих")).toBe(
      "Кмет на община Исперих",
    );
    expect(localOfficePhraseBg("mayor", "Добрич-селска")).toBe(
      "Кмет на община Добрич-селска",
    );
  });

  it("never doubles a label that already says община", () => {
    expect(localOfficePhraseBg("mayor", "Столична община")).toBe(
      "Кмет на Столична община",
    );
  });

  it("keeps the кметство and the preposition when the place fell back to the obshtina", () => {
    // resolve_persons falls back to the ОБЩИНА when a кметство name does not resolve; the
    // short form there would claim the municipal mayor's office.
    expect(localOfficePhraseBg("village_mayor", "Омуртаг")).toBe(
      "Кмет на кметство в община Омуртаг",
    );
  });

  it("keeps the preposition for offices that sit inside a wider place", () => {
    expect(localOfficePhraseBg("councillor", "Опака")).toBe(
      "Общински съветник в Опака",
    );
    expect(localOfficePhraseBg("rayon_mayor", "Пловдив")).toBe(
      "Районен кмет в Пловдив",
    );
    expect(localOfficePhraseBg("deputy_mayor", "Крумовград")).toBe(
      "Заместник-кмет в Крумовград",
    );
  });

  it("calls a Sofia район a район, on the code and never on the name", () => {
    // "Средец" is a Sofia район AND a Бургас община — the same label, two different
    // offices. The code is the only thing that separates them.
    expect(localOfficePhraseBg("mayor", "Средец", "S2401")).toBe(
      "Кмет на район Средец",
    );
    expect(localOfficePhraseBg("mayor", "Средец", "BGS16")).toBe(
      "Кмет на община Средец",
    );
    expect(localOfficePhraseBg("deputy_mayor", "Овча Купел", "S2518")).toBe(
      "Заместник-кмет в район Овча Купел",
    );
    expect(localOfficePhraseEn("mayor", "Средец", "S2401")).toBe(
      "District mayor of Средец",
    );
    expect(localOfficePhraseEn("chief_architect", "Витоша", "S2317")).toBe(
      "Chief architect in Витоша district",
    );
  });

  it("reads a card minted before place_code shipped as an obshtina", () => {
    expect(localOfficePhraseBg("mayor", "Средец")).toBe(
      "Кмет на община Средец",
    );
    // SFO_CITY is the capital itself, not one of its районa.
    expect(localOfficePhraseBg("mayor", "Столична община", "SFO_CITY")).toBe(
      "Кмет на Столична община",
    );
  });

  it("falls back to the office alone when the role has no place", () => {
    expect(localOfficePhraseBg("mayor", null)).toBe("Кмет на община");
    expect(localOfficePhraseBg("village_mayor", null)).toBe("Кмет на кметство");
    expect(localOfficePhraseBg("dogcatcher", null)).toBe("Местен вот");
    expect(localOfficePhraseBg("dogcatcher", "Опака")).toBe(
      "Местен вот в Опака",
    );
  });
});

describe("localOfficePhraseEn", () => {
  // Without a `placeEn` the phrase falls back to the Bulgarian name with its marker stripped.
  // That is the honest degradation for a caller with no dictionary — but NOT what the
  // prerender does; see the `placeEn` block below.
  it("drops the Bulgarian settlement abbreviation", () => {
    expect(localOfficePhraseEn("village_mayor", "с. Цветино")).toBe(
      "Village mayor of Цветино",
    );
    expect(localOfficePhraseEn("councillor", "Опака")).toBe(
      "Municipal councillor in Опака",
    );
  });

  it("uses 'of' for the jurisdiction offices and 'in' for the rest", () => {
    expect(localOfficePhraseEn("mayor", "Исперих")).toBe(
      "Municipal mayor of Исперих",
    );
    expect(localOfficePhraseEn("village_mayor", "Омуртаг")).toBe(
      "Village mayor in Омуртаг",
    );
    expect(localOfficePhraseEn("rayon_mayor", "Пловдив")).toBe(
      "District mayor in Пловдив",
    );
  });

  // The whole point of the 4th argument: an /en page must not print a Cyrillic proper noun
  // inside an English sentence ("Chief architect in Ивайловград").
  it("prints the English place name when one is supplied", () => {
    expect(
      localOfficePhraseEn(
        "chief_architect",
        "Ивайловград",
        "HKV11",
        "Ivaylovgrad",
      ),
    ).toBe("Chief architect in Ivaylovgrad");
    expect(localOfficePhraseEn("councillor", "Видин", "VID10", "Vidin")).toBe(
      "Municipal councillor in Vidin",
    );
    expect(
      localOfficePhraseEn("village_mayor", "с. Цветино", "78392", "Tsvetino"),
    ).toBe("Village mayor of Tsvetino");
    expect(localOfficePhraseEn("mayor", "Исперих", "RAZ04", "Isperih")).toBe(
      "Municipal mayor of Isperih",
    );
  });

  // The settlement/obshtina discrimination and the Sofia-район rule still read the BULGARIAN
  // label and the code — an English name carries neither the "с." marker nor the S2 shape, so
  // deriving the form from it would put a village mayor at the head of a municipality.
  it("keeps discriminating on the Bulgarian label and the code", () => {
    // resolve_persons falls back to the ОБЩИНА when a кметство name did not resolve; the
    // short "of" form would then name a different office held by a different person.
    expect(
      localOfficePhraseEn("village_mayor", "Омуртаг", "TGV22", "Omurtag"),
    ).toBe("Village mayor in Omurtag");
    expect(localOfficePhraseEn("mayor", "Средец", "S2401", "Sredets")).toBe(
      "District mayor of Sredets",
    );
    expect(
      localOfficePhraseEn("chief_architect", "Витоша", "S2317", "Vitosha"),
    ).toBe("Chief architect in Vitosha district");
  });
});

describe("isSettlementLabel", () => {
  it("accepts the three settlement markers", () => {
    expect(isSettlementLabel("с. Ореше")).toBe(true);
    expect(isSettlementLabel("гр. Българово")).toBe(true);
    expect(isSettlementLabel("ман. Рилски манастир")).toBe(true);
  });

  it("rejects a bare obshtina and the Sofia-district 'общ.' type", () => {
    expect(isSettlementLabel("Исперих")).toBe(false);
    // place_dim types the 21 Sofia district shards "общ."; a mayor "of общ. Витоша" would be
    // a claim about an office nobody holds.
    expect(isSettlementLabel("общ. Витоша")).toBe(false);
    expect(localOfficePhraseBg("mayor", "общ. Витоша")).toBe(
      "Кмет на общ. Витоша",
    );
  });
});

describe("stripSettlementMarker", () => {
  it("removes only the marker", () => {
    expect(stripSettlementMarker("с. Малка поляна")).toBe("Малка поляна");
    expect(stripSettlementMarker("Столична община")).toBe("Столична община");
  });
});
