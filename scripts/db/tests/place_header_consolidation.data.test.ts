// place-header-consolidation-v1, Phase 5 gates. Pins the two PG serving functions the
// consolidation added/extended, and the cross-page oblast-wording PARITY that is the whole
// point (the procurement settlement page and the parliamentary settlement page must name the
// same place identically).
//
//   procurement_settlement_detail(ekatte)  → the shared hero identity (030, extended)
//   awarder_seat_place(eik)                 → the composed seat line (021)
//
// Auto-skips when Postgres is down / the dimension has never been loaded — like the other
// *.data.test.ts gates. Needs place_dim (117) + the extended functions applied + the
// contracts corpus (for awarder_seats). Run: npm run test:data
//
// PARITY. The procurement page resolves oblast via place_dim.oblast_code (the STATISTICAL
// fold), the parliamentary PlaceHeader via regions.json keyed on the settlement's raw
// (МИР-namespace) oblast field. They must render the same "област X" for the same place. For
// the град-МИР cities this is non-obvious — гр. Пловдив's raw oblast is PDV-00 — but the
// regions.json PDV-00 entry is named "Пловдив", identical to OBLAST_NAME["PDV"], so they
// coincide. This gate reproduces the parliamentary resolution from the JSON and asserts it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
type SettlementJson = { ekatte: string; oblast?: string };
type RegionJson = {
  oblast?: string;
  name?: string;
  long_name?: string;
};
const settlements: SettlementJson[] = JSON.parse(
  readFileSync(path.join(ROOT, "data/settlements.json"), "utf8"),
);
const regions: RegionJson[] = JSON.parse(
  readFileSync(path.join(ROOT, "src/data/json/regions.json"), "utf8"),
);

// The tautological " област"/" region" suffix strip BOTH pages apply before rendering
// (PlaceHeader.tsx and settlementHero.tsx). The parity assertion compares RENDERED values, so
// it must strip the procurement side the same way — otherwise it would enforce
// raw==stripped, latent for any oblast carrying the suffix (e.g. "Софийска област").
const stripOblast = (s: unknown): unknown =>
  typeof s === "string" ? s.replace(/\s+област$/u, "").trim() : s;

// The parliamentary PlaceHeader's oblast label for a settlement: findRegion(settlement.oblast)
// → long_name || name, then the same strip.
const parliamentaryOblastName = (ekatte: string): string | null => {
  const s = settlements.find((r) => r.ekatte === ekatte);
  if (!s?.oblast) return null;
  const r = regions.find((x) => x.oblast === s.oblast);
  const raw = r?.long_name || r?.name;
  return raw ? (stripOblast(raw) as string) : null;
};

const reachable = async (): Promise<boolean> => {
  try {
    // These gates need BOTH the place dimension (117) AND the contracts corpus (awarder_seats
    // / procurement_settlement_detail). db:refresh loads them in separate steps, so probe both
    // — a place_dim-loaded-but-corpus-absent state must SKIP, not fail red.
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM place_dim WHERE kind='oblast'",
    );
    const [s] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM awarder_seats WHERE source='geo'",
    );
    return Number(c.n) > 0 && Number(s.n) > 0;
  } catch {
    return false;
  }
};
const ok = await reachable();
const skip = ok
  ? false
  : "Postgres unreachable / place_dim (117) or awarder_seats corpus not loaded";

afterAll(async () => {
  await end();
});

const detail = async (
  ekatte: string,
): Promise<Record<string, unknown> | null> => {
  const [r] = await allRows<{ r: Record<string, unknown> | null }>(
    "SELECT procurement_settlement_detail($1) AS r",
    [ekatte],
  );
  return r?.r ?? null;
};

test.skipIf(skip)(
  "procurement_settlement_detail resolves the place identity from place_dim",
  async () => {
    const varna = await detail("10135");
    assert.ok(varna, "Варна (10135) has no procurement detail");
    assert.equal(varna.name, "Варна");
    assert.equal(varna.nameEn, "Varna"); // the EN-localization fix
    assert.equal(varna.settlementType, "гр.");
    assert.equal(varna.obshtinaCode, "VAR06");
    assert.equal(varna.obshtinaName, "Варна");
    assert.equal(varna.oblastCode, "VAR");
    assert.equal(varna.oblastName, "Варна");
    assert.ok(varna.loc, "Варна has no centroid for the hero thumbnail");
  },
);

test.skipIf(skip)(
  "procurement_settlement_detail is null-safe for an unknown settlement",
  async () => {
    assert.equal(await detail("99999"), null);
  },
);

test.skipIf(skip)(
  "oblast wording matches the parliamentary page (no consolidation divergence)",
  async () => {
    // гр. Варна (clean) and гр. Пловдив (the град-МИР edge, raw oblast PDV-00, non-tautological
    // parity since regions.json PDV-00="Пловдив" vs PDV="обл. Пловдив"). Each must read
    // identically on the procurement hero and the parliamentary settlement page. Compare the
    // RENDERED (stripped) procurement value.
    let checked = 0;
    for (const ekatte of ["10135", "56784"]) {
      const d = await detail(ekatte);
      if (!d) continue; // no procurement for this settlement in this corpus
      checked++;
      const parliamentary = parliamentaryOblastName(ekatte);
      assert.equal(
        stripOblast(d.oblastName),
        parliamentary,
        `oblast wording diverges for ${ekatte}: procurement="${d.oblastName}" vs parliamentary="${parliamentary}"`,
      );
    }
    assert.ok(
      checked > 0,
      "parity asserted nothing — no procurement for either fixture settlement",
    );
  },
);

test.skipIf(skip)(
  "KNOWN divergence: Sofia PROVINCE is named differently by the two dictionaries",
  async () => {
    // A pre-existing cross-dictionary mismatch the parity gate surfaced, NOT introduced by the
    // consolidation: OBLAST_NAME["SFO"] (place_dim / procurement) = "Софийска област" → the
    // hero renders "област Софийска", while regions.json["SFO"] (parliamentary) = "София
    // област" → "област София". Both name Sofia PROVINCE (not the capital). Pinned so a future
    // reconciliation of the two dictionaries (a data-owner decision on the canonical name)
    // trips here and updates both sides together. Алдомировци (00223) is a Софийска-област
    // village; skip if it has no procurement in this corpus.
    const d = await detail("00223");
    if (!d) return;
    assert.equal(d.oblastName, "Софийска област");
    assert.equal(stripOblast(d.oblastName), "Софийска");
    assert.equal(parliamentaryOblastName("00223"), "София");
  },
);

test.skipIf(skip)(
  "awarder_seat_place composes a localizable seat with governance-vocabulary codes",
  async () => {
    // A Варна awarder (any geo-resolved seat at ekatte 10135).
    const [varna] = await allRows<{ r: Record<string, unknown> | null }>(
      `SELECT awarder_seat_place(eik) AS r
         FROM awarder_seats WHERE ekatte='10135' AND source='geo' LIMIT 1`,
    );
    assert.ok(varna?.r, "no Варна awarder seat resolved");
    assert.equal(varna.r.settlement, "Варна");
    assert.equal(varna.r.settlementEn, "Varna");
    assert.equal(varna.r.obshtinaCode, "VAR06");
    assert.equal(varna.r.oblastCode, "VAR");

    // A Sofia awarder (ekatte 68134): the codes must be the GOVERNANCE vocabulary the seat
    // links resolve against — obshtina SOF00 (not SFO_CITY), oblast NULL (SOFIA_CITY has no
    // /governance/region page), so the segment renders as unlinked text.
    const [sofia] = await allRows<{ r: Record<string, unknown> | null }>(
      `SELECT awarder_seat_place(eik) AS r
         FROM awarder_seats WHERE ekatte='68134' AND source='geo' LIMIT 1`,
    );
    if (sofia?.r) {
      assert.equal(sofia.r.obshtinaCode, "SOF00");
      assert.equal(sofia.r.oblastCode, null);
      assert.equal(sofia.r.obshtina, "Столична община");
    }
  },
);

test.skipIf(skip)(
  "awarder_seat_place returns NULL for a non-awarder (no awarder_seats row)",
  async () => {
    const [r] = await allRows<{ r: unknown }>(
      "SELECT awarder_seat_place($1) AS r",
      ["ZZZ_NOT_AN_AWARDER"],
    );
    assert.equal(r?.r ?? null, null);
  },
);
