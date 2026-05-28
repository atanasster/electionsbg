// Backfill EKATTE on кметство records emitted by the 2023_10_29_mi parser.
//
// The CIK source ships kmetstvoName but leaves `ekatte: ""` empty for every
// kметство. This script joins the name against data/settlements.json
// (filtered to the same obshtina) and emits a deterministic lookup file:
//
//   data/local_mayors/kmetstvo_to_ekatte.json
//
// Shape:
//   {
//     "<obshtinaCode>:<normalizedKmetstvoName>": "<ekatte>",
//     ...
//   }
//
// The SPA's MyAreaKmetstvoTile reads this map for an O(1) lookup instead
// of running the name-normalize compare on every render. When a future
// CIK cycle (mi2027 et seq.) lands, re-run this script to refresh.
//
// Run: `npx tsx scripts/parsers_local/backfill_kmetstvo_ekatte.ts`

import fs from "node:fs";
import path from "node:path";

type SettlementInfo = {
  ekatte: string;
  name: string;
  name_en?: string;
  obshtina: string;
};

type KmetstvoResult = {
  kmetstvoName: string;
  ekatte: string;
};

type LocalMunicipalityBundle = {
  obshtinaCode: string;
  kmetstva?: KmetstvoResult[];
};

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const SETTLEMENTS_FILE = path.join(PROJECT_ROOT, "data/settlements.json");
const CYCLE_DIR = path.join(PROJECT_ROOT, "data/2023_10_29_mi/municipalities");
const OUT_DIR = path.join(PROJECT_ROOT, "data/local_mayors");
const OUT_FILE = path.join(OUT_DIR, "kmetstvo_to_ekatte.json");

const normalize = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

const main = () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Build settlement index: obshtina → normalized name → ekatte. Some
  // settlement names repeat across municipalities (e.g. "Аврамово" in BLG
  // and KRZ), so we must scope by obshtina.
  const settlementsRaw = fs.readFileSync(SETTLEMENTS_FILE, "utf-8");
  const settlements = JSON.parse(settlementsRaw) as SettlementInfo[];
  const byObshtinaName = new Map<string, Map<string, string>>();
  for (const s of settlements) {
    if (!s.obshtina) continue;
    let inner = byObshtinaName.get(s.obshtina);
    if (!inner) {
      inner = new Map();
      byObshtinaName.set(s.obshtina, inner);
    }
    inner.set(normalize(s.name), s.ekatte);
  }

  // Walk each município bundle, match kметство names to EKATTE.
  const lookup: Record<string, string> = {};
  let totalKmetstva = 0;
  let matched = 0;
  let unmatched = 0;
  const unmatchedSamples: string[] = [];

  for (const f of fs.readdirSync(CYCLE_DIR)) {
    if (!f.endsWith(".json")) continue;
    const fullPath = path.join(CYCLE_DIR, f);
    const raw = fs.readFileSync(fullPath, "utf-8");
    let bundle: LocalMunicipalityBundle;
    try {
      bundle = JSON.parse(raw);
    } catch {
      continue;
    }
    const obshtina = bundle.obshtinaCode;
    if (!obshtina) continue;
    const innerIndex = byObshtinaName.get(obshtina);
    if (!innerIndex) continue;

    for (const k of bundle.kmetstva ?? []) {
      totalKmetstva++;
      const norm = normalize(k.kmetstvoName);
      const ekatte = innerIndex.get(norm);
      if (ekatte) {
        lookup[`${obshtina}:${norm}`] = ekatte;
        matched++;
      } else {
        unmatched++;
        if (unmatchedSamples.length < 10) {
          unmatchedSamples.push(`${obshtina} → ${k.kmetstvoName}`);
        }
      }
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(lookup, null, 2) + "\n");

  console.log(
    `Kметство EKATTE backfill: ${matched}/${totalKmetstva} matched (${unmatched} unmatched)`,
  );
  if (unmatchedSamples.length > 0) {
    console.log(`Sample unmatched entries:`);
    for (const s of unmatchedSamples) console.log(`  ${s}`);
  }
  console.log(`Wrote ${OUT_FILE}`);
};

main();
