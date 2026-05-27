// One-shot enrichment of data/procurement/awarders/<eik>.json with the
// `address` + `geo` blocks defined in types.ts.
//
// Why this exists: in the steady state, scripts/procurement/rollups.ts
// applies the resolver + tier classifier whenever it rebuilds rollups. But
// the rollups are only enriched if the underlying Contract rows carry
// `awarderLocality` + `awarderPostal` — which they only do after the
// extended normalizer (this commit) has run. For the ~3,400 existing
// awarder files we'd otherwise have to re-ingest the entire 5-year
// corpus from raw_data/procurement/legacy/*.csv.gz, which is hours of
// work and bandwidth.
//
// This script takes the cheap path: scan the cached fortnight bundles
// (raw_data/procurement/*.json.gz — already on disk from prior runs) to
// build an EIK → address lookup, then walk awarders/*.json and stamp
// `address` + `geo` onto each file. Awarders that never appeared in a
// cached bundle (i.e. inactive since 2026) get no enrichment — they'll
// stay outside the settlement map until they procure again.
//
// Usage:
//   npx tsx scripts/procurement/enrich_awarders_geo.ts
//
// After this runs you can build by_settlement.ts shards via:
//   npx tsx -e "import('./scripts/procurement/by_settlement').then(m =>
//     m.buildBySettlement().then(r => console.log(r)))"

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";
import { getResolver, type OcdsAddress } from "./resolve_ekatte";
import { classifyAwarder, LOCAL_TIERS } from "./awarder_tier";
import { canonicalJson } from "./validate";
import type { AwarderRollup, AwarderAddress, AwarderGeo } from "./types";
import { canonicalEik } from "./eik";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../raw_data/procurement");
const AWARDERS_DIR = path.resolve(__dirname, "../../data/procurement/awarders");
const UNCLASSIFIED_OUT = path.resolve(
  __dirname,
  "../../data/procurement/awarder_tier_unclassified.json",
);

interface BuyerInfo {
  name: string;
  address: OcdsAddress;
}

const collectBuyerAddresses = (): Map<string, BuyerInfo> => {
  const map = new Map<string, BuyerInfo>();
  if (!fs.existsSync(RAW_DIR)) return map;
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith(".json.gz"));
  for (const f of files) {
    const buf = fs.readFileSync(path.join(RAW_DIR, f));
    const text = zlib.gunzipSync(buf).toString("utf8");
    const data = JSON.parse(text) as {
      releases?: Array<{
        parties?: Array<{
          roles?: string[];
          identifier?: { id?: string };
          name?: string;
          address?: OcdsAddress;
        }>;
      }>;
    };
    for (const r of data.releases ?? []) {
      for (const p of r.parties ?? []) {
        if (!(p.roles ?? []).includes("buyer")) continue;
        const eik = canonicalEik(p.identifier?.id);
        if (!eik) continue;
        if (!map.has(eik) && p.address) {
          map.set(eik, {
            name: p.name ?? "",
            address: p.address,
          });
        }
      }
    }
  }
  return map;
};

export const enrichAwarders = (): {
  awardersTotal: number;
  enriched: number;
  unresolved: number;
  noAddress: number;
  unclassifiedTier: Array<{ eik: string; name: string }>;
} => {
  const buyerInfo = collectBuyerAddresses();
  const resolver = getResolver();

  const files = fs.readdirSync(AWARDERS_DIR).filter((f) => f.endsWith(".json"));

  let enriched = 0;
  let unresolved = 0;
  let noAddress = 0;
  const unclassifiedTier: Array<{ eik: string; name: string }> = [];

  for (const f of files) {
    const filePath = path.join(AWARDERS_DIR, f);
    const aw = JSON.parse(fs.readFileSync(filePath, "utf8")) as AwarderRollup;
    const info = buyerInfo.get(aw.eik);
    if (!info?.address) {
      noAddress++;
      // Still classify by tier — useful when we know the entity is central
      // even if we never saw its address.
      const tier = classifyAwarder(aw.eik, aw.name);
      if (tier === "other") {
        unclassifiedTier.push({ eik: aw.eik, name: aw.name });
      }
      continue;
    }

    const address: AwarderAddress = {
      locality: info.address.locality,
      postal: info.address.postalCode,
      street: info.address.streetAddress,
    };
    const res = resolver.resolve(info.address);
    const tier = classifyAwarder(aw.eik, aw.name);
    if (tier === "other") {
      unclassifiedTier.push({ eik: aw.eik, name: aw.name });
    }

    let geo: AwarderGeo | undefined;
    if (res.ekatte && res.confidence !== "unresolved") {
      geo = {
        ekatte: res.ekatte,
        confidence: res.confidence,
        tier,
        isLocalHQ: LOCAL_TIERS.has(tier),
      };
      enriched++;
    } else {
      unresolved++;
    }

    aw.address = address;
    if (geo) aw.geo = geo;
    if (info.address.region) aw.region = info.address.region;

    fs.writeFileSync(filePath, canonicalJson(aw));
  }

  fs.writeFileSync(
    UNCLASSIFIED_OUT,
    canonicalJson({
      generatedAt: new Date().toISOString(),
      note: "Awarders that fell into the 'other' tier — review and add an OVERRIDE entry to scripts/procurement/awarder_tier.ts where appropriate.",
      total: unclassifiedTier.length,
      entries: unclassifiedTier.sort((a, b) => a.eik.localeCompare(b.eik)),
    }),
  );

  return {
    awardersTotal: files.length,
    enriched,
    unresolved,
    noAddress,
    unclassifiedTier,
  };
};

// CLI entry — exported above for unit tests / other scripts.
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = enrichAwarders();
  console.log("Awarders total      :", r.awardersTotal);
  console.log("  enriched (resolved):", r.enriched);
  console.log("  unresolved          :", r.unresolved);
  console.log("  no cached address   :", r.noAddress);
  console.log("  unclassified tier   :", r.unclassifiedTier.length);
  console.log(
    "  → unclassified list written to data/procurement/awarder_tier_unclassified.json",
  );
}
