import { describe, it, expect } from "vitest";
import { obshtinaLabels } from "./places";
import { canonicalObshtina } from "../../src/lib/obshtinaPlace";

// obshtinaLabels() reads data/municipalities.json, which is committed, so these are
// hermetic in the sense that matters: no network, no database, no fixture drift.
describe("obshtinaLabels", () => {
  const labels = obshtinaLabels();

  it("labels a real obshtina in both languages", () => {
    const gotseDelchev = labels.get("BLG11");
    expect(gotseDelchev?.bg).toBeTruthy();
    expect(gotseDelchev?.en).toBeTruthy();
  });

  it("supplies the synthetic SFO_CITY label the JSON cannot carry", () => {
    // Applied AFTER the JSON load, so it also wins over any same-code row. That
    // precedence is load-bearing — it is what gives SFO_CITY a label at all.
    expect(labels.get("SFO_CITY")?.bg).toBe("Столична община");
  });

  it("covers every obshtina in the municipalities file", () => {
    // Guards the 'every place_code resolves to both labels' DB invariant hermetically:
    // a row in the file with a blank name would otherwise surface only with Postgres up.
    expect(labels.size).toBeGreaterThan(280);
    for (const [code, label] of labels) {
      expect(label.bg, `${code} has no BG label`).toBeTruthy();
      expect(label.en, `${code} has no EN label`).toBeTruthy();
    }
  });

  it("keys every entry on a canonical code", () => {
    // A label filed under a non-canonical code would never be found: the resolver
    // canonicalises the raw code before the lookup.
    for (const code of labels.keys())
      expect(canonicalObshtina(code), `${code} is not canonical`).toBe(code);
  });

  it("labels Sofia's районa separately from the city bundle", () => {
    // The районa are real municipalities in the file and must not inherit the city label.
    expect(labels.get("S2309")?.bg).toBeTruthy();
    expect(labels.get("S2309")?.bg).not.toBe(labels.get("SFO_CITY")?.bg);
  });
});
