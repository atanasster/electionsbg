/**
 * Build the company → people-in-power connection files (PRD "Stage 2").
 *
 * Reads the reconstructed TR state (raw_data/tr/state.sqlite) plus the curated
 * power-people sources, and for every company computes its links to MPs /
 * officials at two depths:
 *
 *   company → officer                          → politician   (direct)
 *   company → officer → other company → officer → politician   (one-hop bridge)
 *
 * One small JSON per connected company is written to
 * data/parliament/company-connections/{eik}.json. The directory is a
 * regenerable build artifact — gitignored, served in dev via the data/ overlay
 * and in prod from the GCS bucket. A 404 on the /company/:eik page simply
 * means the company has no political connection on record.
 *
 * Run:  npx tsx scripts/declarations/tr/build_company_connections.ts
 *   or:  npm run tr:build-company-connections
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const SQLITE_PATH = path.join(repoRoot, "raw_data/tr/state.sqlite");
const CONNECTIONS_SEARCH = path.join(
  repoRoot,
  "data/parliament/connections-search.json",
);
const OFFICIALS_INDEX = path.join(repoRoot, "data/officials/index.json");
const MUNICIPAL_INDEX = path.join(
  repoRoot,
  "data/officials/municipal/index.json",
);
const OUT_DIR = path.join(repoRoot, "data/parliament/company-connections");
const STATS_PATH = path.join(
  repoRoot,
  "data/parliament/company-connections-stats.json",
);

/** Don't bridge through a name that appears in more than this many companies —
 *  a common Bulgarian name explodes the traversal into namesake noise. */
const NAMESAKE_CAP = 25;
/** Max bridged links written per company file. */
const BRIDGE_CAP = 200;

// One shared name normalizer for BOTH the TR officer side and the power-people
// side — uppercase, collapse whitespace, and collapse spaces around hyphens
// (hyphenated double-surnames are common for women officials). Applying the
// same function to every name is what makes the name-only join sound; see the
// PRD "Gate B" note. Names are re-normalized from the raw `name` column rather
// than trusting any pre-computed *_norm field from another pipeline.
const normalizeName = (s: string): string =>
  s
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

type Tier = "national" | "executive" | "municipal";

type PowerRef = {
  kind: "mp" | "official";
  refId: string; // mpId (string) or official slug — deep-link target
  name: string;
  party: string | null;
  tier: Tier;
  roleLabel: string | null; // short human label (institution / role · municipality)
};

type Confidence = "medium" | "low";

const powerKey = (p: PowerRef): string => `${p.kind}:${p.refId}`;

// ---------------------------------------------------------------------------
// 1. Power people — MPs + every executive and municipal official.
// ---------------------------------------------------------------------------

const readJson = <T>(p: string): T =>
  JSON.parse(fs.readFileSync(p, "utf-8")) as T;

const buildPowerPeople = (): {
  byName: Map<string, PowerRef[]>;
  counts: { mp: number; executive: number; municipal: number };
} => {
  const byName = new Map<string, PowerRef[]>();
  const seen = new Set<string>(); // dedupe key — `${kind}:${refId}`
  const counts = { mp: 0, executive: 0, municipal: 0 };

  const add = (nameRaw: string, ref: PowerRef): void => {
    const k = powerKey(ref);
    if (seen.has(k)) return;
    seen.add(k);
    const norm = normalizeName(nameRaw);
    if (!norm) return;
    const list = byName.get(norm);
    if (list) list.push(ref);
    else byName.set(norm, [ref]);
    counts[ref.tier === "national" ? "mp" : ref.tier]++;
  };

  // MPs — from the connections search index.
  const search = readJson<{
    entries: Array<{
      type: string;
      mpId?: number;
      label?: string;
      partyGroupShort?: string;
    }>;
  }>(CONNECTIONS_SEARCH);
  for (const e of search.entries) {
    if (e.type !== "mp" || e.mpId == null || !e.label) continue;
    add(e.label, {
      kind: "mp",
      refId: String(e.mpId),
      name: e.label,
      party: e.partyGroupShort ?? null,
      tier: "national",
      roleLabel: null,
    });
  }

  // Executive officials — cabinet, deputy ministers, agency heads, governors.
  const execIdx = readJson<{
    entries: Array<{
      slug: string;
      name: string;
      categoryRaw?: string | null;
      institution?: string | null;
    }>;
  }>(OFFICIALS_INDEX);
  for (const o of execIdx.entries) {
    if (!o.slug || !o.name) continue;
    add(o.name, {
      kind: "official",
      refId: o.slug,
      name: o.name,
      party: null,
      tier: "executive",
      roleLabel: o.institution || o.categoryRaw || null,
    });
  }

  // Municipal officials — mayors, deputy mayors, council chairs, councillors,
  // chief architects.
  const muniIdx = readJson<{
    entries: Array<{
      slug: string;
      name: string;
      roleRaw?: string | null;
      municipality?: string | null;
    }>;
  }>(MUNICIPAL_INDEX);
  for (const o of muniIdx.entries) {
    if (!o.slug || !o.name) continue;
    const role = o.roleRaw || "";
    const roleLabel =
      role && o.municipality
        ? `${role}, ${o.municipality}`
        : role || o.municipality || null;
    add(o.name, {
      kind: "official",
      refId: o.slug,
      name: o.name,
      party: null,
      tier: "municipal",
      roleLabel,
    });
  }

  return { byName, counts };
};

// ---------------------------------------------------------------------------
// 2. TR officers — load state.sqlite into in-memory maps.
// ---------------------------------------------------------------------------

type Officer = {
  name: string;
  nameNorm: string;
  role: string;
  isCurrent: boolean;
};

const loadTr = (): {
  companyOfficers: Map<string, Officer[]>;
  personCompanies: Map<string, Set<string>>;
  companyName: Map<string, string | null>;
} => {
  if (!fs.existsSync(SQLITE_PATH)) {
    throw new Error(
      `[company-connections] ${SQLITE_PATH} not found — run the TR reconstruct first.`,
    );
  }
  const db = new DatabaseSync(SQLITE_PATH, { readOnly: true });

  const companyName = new Map<string, string | null>();
  for (const r of db.prepare("SELECT uic, name FROM companies").all() as Array<{
    uic: string;
    name: string | null;
  }>) {
    companyName.set(r.uic, r.name);
  }

  const personRows = db
    .prepare("SELECT uic, role, name, erased_at FROM company_persons")
    .all() as Array<{
    uic: string;
    role: string;
    name: string;
    erased_at: string | null;
  }>;
  db.close();

  // uic → (`${nameNorm}|${role}` → Officer), deduped.
  const officerMap = new Map<string, Map<string, Officer>>();
  const personCompanies = new Map<string, Set<string>>();

  for (const r of personRows) {
    if (!r.name) continue;
    const nameNorm = normalizeName(r.name);
    if (!nameNorm) continue;
    const isCurrent = r.erased_at == null;

    let offs = officerMap.get(r.uic);
    if (!offs) {
      offs = new Map();
      officerMap.set(r.uic, offs);
    }
    const key = `${nameNorm}|${r.role}`;
    const existing = offs.get(key);
    if (existing) {
      if (isCurrent) existing.isCurrent = true;
    } else {
      offs.set(key, { name: r.name, nameNorm, role: r.role, isCurrent });
    }

    let cs = personCompanies.get(nameNorm);
    if (!cs) {
      cs = new Set();
      personCompanies.set(nameNorm, cs);
    }
    cs.add(r.uic);
  }

  const companyOfficers = new Map<string, Officer[]>();
  for (const [uic, offs] of officerMap) {
    companyOfficers.set(uic, [...offs.values()]);
  }
  return { companyOfficers, personCompanies, companyName };
};

// ---------------------------------------------------------------------------
// 3. Compute per-company connections.
// ---------------------------------------------------------------------------

type DirectLink = {
  officerName: string;
  officerRole: string;
  isCurrent: boolean;
  confidence: Confidence;
  power: PowerRef;
};

type BridgedLink = {
  bridgeName: string;
  bridgeRole: string;
  bridgeIsCurrent: boolean;
  viaEik: string;
  viaCompany: string | null;
  powerRole: string;
  confidence: Confidence;
  power: PowerRef;
};

type CompanyFile = {
  eik: string;
  name: string | null;
  generatedAt: string;
  officers: Array<{ name: string; role: string; isCurrent: boolean }>;
  directLinks: DirectLink[];
  bridgedLinks: BridgedLink[];
  truncated: boolean;
};

export const buildCompanyConnections = (): void => {
  // Graceful degradation when the TR SQLite hasn't been reconstructed yet —
  // matches the same behaviour `integrateTr` and `buildConnectionsGraph` have.
  // Keeps `npm run data -- --declarations` working on a fresh clone.
  if (!fs.existsSync(SQLITE_PATH)) {
    console.warn(
      `[company-connections] ${SQLITE_PATH} not found — skipping (run the TR reconstruct first).`,
    );
    return;
  }
  console.log("[company-connections] loading power people…");
  const { byName: powerByName, counts: powerCounts } = buildPowerPeople();
  console.log(
    `[company-connections]   MPs ${powerCounts.mp}, executive ${powerCounts.executive}, municipal ${powerCounts.municipal}`,
  );

  console.log(`[company-connections] loading ${SQLITE_PATH}…`);
  const { companyOfficers, personCompanies, companyName } = loadTr();
  console.log(
    `[company-connections]   ${companyOfficers.size.toLocaleString()} companies with officers, ` +
      `${personCompanies.size.toLocaleString()} distinct names`,
  );

  const generatedAt = new Date().toISOString();
  const directConfidence = (nameNorm: string): Confidence => {
    const parts = nameNorm.split(" ").length;
    const companyCount = personCompanies.get(nameNorm)?.size ?? 0;
    return parts >= 3 && companyCount <= NAMESAKE_CAP ? "medium" : "low";
  };

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let connectedCount = 0;
  let directOnly = 0;
  let withBridges = 0;
  let totalDirect = 0;
  let totalBridged = 0;

  for (const [uic, officers] of companyOfficers) {
    // --- direct links: an officer of this company is a politician ---
    const directLinks: DirectLink[] = [];
    const directSeen = new Set<string>(); // `${officerNameNorm}|${powerKey}`
    const directPowerKeys = new Set<string>();
    for (const off of officers) {
      const matches = powerByName.get(off.nameNorm);
      if (!matches) continue;
      for (const power of matches) {
        const dk = `${off.nameNorm}|${powerKey(power)}`;
        if (directSeen.has(dk)) continue;
        directSeen.add(dk);
        directPowerKeys.add(powerKey(power));
        directLinks.push({
          officerName: off.name,
          officerRole: off.role,
          isCurrent: off.isCurrent,
          confidence: directConfidence(off.nameNorm),
          power,
        });
      }
    }

    // --- one-hop bridges: officer → other company → politician there ---
    const bridgedLinks: BridgedLink[] = [];
    const bridgeSeen = new Set<string>(); // `${bridgeNameNorm}|${viaUic}|${powerKey}`
    for (const bridge of officers) {
      const others = personCompanies.get(bridge.nameNorm);
      if (!others || others.size > NAMESAKE_CAP) continue; // namesake guard
      for (const viaUic of others) {
        if (viaUic === uic) continue;
        const viaOfficers = companyOfficers.get(viaUic);
        if (!viaOfficers) continue;
        for (const viaOff of viaOfficers) {
          if (viaOff.nameNorm === bridge.nameNorm) continue; // the bridge itself
          const matches = powerByName.get(viaOff.nameNorm);
          if (!matches) continue;
          for (const power of matches) {
            if (directPowerKeys.has(powerKey(power))) continue; // already direct
            const bk = `${bridge.nameNorm}|${viaUic}|${powerKey(power)}`;
            if (bridgeSeen.has(bk)) continue;
            bridgeSeen.add(bk);
            bridgedLinks.push({
              bridgeName: bridge.name,
              bridgeRole: bridge.role,
              bridgeIsCurrent: bridge.isCurrent,
              viaEik: viaUic,
              viaCompany: companyName.get(viaUic) ?? null,
              powerRole: viaOff.role,
              confidence: "low", // two name hops — never better than low
              power,
            });
          }
        }
      }
    }

    if (directLinks.length === 0 && bridgedLinks.length === 0) continue;

    const truncated = bridgedLinks.length > BRIDGE_CAP;
    const file: CompanyFile = {
      eik: uic,
      name: companyName.get(uic) ?? null,
      generatedAt,
      officers: officers.map((o) => ({
        name: o.name,
        role: o.role,
        isCurrent: o.isCurrent,
      })),
      directLinks,
      bridgedLinks: truncated
        ? bridgedLinks.slice(0, BRIDGE_CAP)
        : bridgedLinks,
      truncated,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${uic}.json`), JSON.stringify(file));

    connectedCount++;
    totalDirect += directLinks.length;
    totalBridged += file.bridgedLinks.length;
    if (bridgedLinks.length > 0) withBridges++;
    else directOnly++;
  }

  const stats = {
    generatedAt,
    namesakeCap: NAMESAKE_CAP,
    bridgeCap: BRIDGE_CAP,
    powerPeople: powerCounts,
    companiesWithOfficers: companyOfficers.size,
    connectedCompanies: connectedCount,
    directOnly,
    withBridges,
    totalDirectLinks: totalDirect,
    totalBridgedLinks: totalBridged,
  };
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));

  console.log(
    `[company-connections] wrote ${connectedCount.toLocaleString()} per-EIK file(s) → ${OUT_DIR}`,
  );
  console.log(
    `[company-connections]   direct-only ${directOnly.toLocaleString()}, ` +
      `with bridges ${withBridges.toLocaleString()}, ` +
      `${totalDirect.toLocaleString()} direct + ${totalBridged.toLocaleString()} bridged links`,
  );
};

// CLI entry point — also exported for the `--declarations` chain in
// scripts/declarations/index.ts (Phase 7), where this is called after
// buildConnectionsGraph has refreshed connections-search.json.
if (import.meta.url === `file://${process.argv[1]}`) {
  buildCompanyConnections();
}
