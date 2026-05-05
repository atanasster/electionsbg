/**
 * One-off migration: title-case the *display* MP names across the generated
 * public/parliament/ JSON outputs so the site stops mixing all-uppercase
 * (parliament.bg style) with mixed-case (election results style).
 *
 * Run with `tsx scripts/parliament/normalize_mp_name_casing.ts`.
 *
 * Files touched:
 *   - public/parliament/index.json                        — mps[].name
 *   - public/parliament/profiles/{id}.json                — A_ns_MPL_Name1/2/3
 *   - public/parliament/connections.json                  — nodes[].label (type=mp)
 *   - public/parliament/connections-rankings.json         — topMps[].label
 *   - public/parliament/mp-connections/{id}.json          — nodes[].label (type=mp)
 *   - public/parliament/mp-management/{id}.json           — mpName
 *
 * `normalizedName` (the canonical matching key) stays uppercase.
 */
import fs from "fs";
import path from "path";
import { titleCaseBgName } from "./name_case";

const PUBLIC_PARLIAMENT = path.join(process.cwd(), "public", "parliament");

const readJson = <T>(p: string): T =>
  JSON.parse(fs.readFileSync(p, "utf-8")) as T;
const writeJson = (p: string, data: unknown) =>
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");

let filesTouched = 0;

const updateIndex = () => {
  const p = path.join(PUBLIC_PARLIAMENT, "index.json");
  if (!fs.existsSync(p)) return;
  const data = readJson<{ mps: { name: string }[] }>(p);
  let changed = false;
  for (const mp of data.mps ?? []) {
    const nx = titleCaseBgName(mp.name);
    if (nx !== mp.name) {
      mp.name = nx;
      changed = true;
    }
  }
  if (changed) {
    writeJson(p, data);
    filesTouched++;
    console.log("  updated index.json");
  }
};

const updateProfiles = () => {
  const dir = path.join(PUBLIC_PARLIAMENT, "profiles");
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const p = path.join(dir, f);
    const raw = readJson<Record<string, unknown>>(p);
    let changed = false;
    for (const k of ["A_ns_MPL_Name1", "A_ns_MPL_Name2", "A_ns_MPL_Name3"]) {
      const v = raw[k];
      if (typeof v === "string") {
        const nx = titleCaseBgName(v);
        if (nx !== v) {
          raw[k] = nx;
          changed = true;
        }
      }
    }
    if (changed) {
      writeJson(p, raw);
      filesTouched++;
    }
  }
  console.log(`  scanned ${files.length} profile files`);
};

type Node = { type?: string; label?: string };
type Connections = { nodes: Node[] };

const updateConnectionsGraph = () => {
  const p = path.join(PUBLIC_PARLIAMENT, "connections.json");
  if (!fs.existsSync(p)) return;
  const data = readJson<Connections>(p);
  let changed = 0;
  for (const n of data.nodes ?? []) {
    if (n.type === "mp" && typeof n.label === "string") {
      const nx = titleCaseBgName(n.label);
      if (nx !== n.label) {
        n.label = nx;
        changed++;
      }
    }
  }
  if (changed) {
    writeJson(p, data);
    filesTouched++;
    console.log(`  updated connections.json (${changed} mp nodes)`);
  }
};

const updateRankings = () => {
  const p = path.join(PUBLIC_PARLIAMENT, "connections-rankings.json");
  if (!fs.existsSync(p)) return;
  const data = readJson<{ topMps?: { label: string }[] }>(p);
  let changed = 0;
  for (const r of data.topMps ?? []) {
    const nx = titleCaseBgName(r.label);
    if (nx !== r.label) {
      r.label = nx;
      changed++;
    }
  }
  if (changed) {
    writeJson(p, data);
    filesTouched++;
    console.log(`  updated connections-rankings.json (${changed} mps)`);
  }
};

const updateMpConnections = () => {
  const dir = path.join(PUBLIC_PARLIAMENT, "mp-connections");
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  let changedFiles = 0;
  for (const f of files) {
    const p = path.join(dir, f);
    const data = readJson<Connections>(p);
    let changed = false;
    for (const n of data.nodes ?? []) {
      if (n.type === "mp" && typeof n.label === "string") {
        const nx = titleCaseBgName(n.label);
        if (nx !== n.label) {
          n.label = nx;
          changed = true;
        }
      }
    }
    if (changed) {
      writeJson(p, data);
      changedFiles++;
    }
  }
  filesTouched += changedFiles;
  console.log(
    `  scanned ${files.length} mp-connections files (${changedFiles} changed)`,
  );
};

const updateMpManagement = () => {
  const dir = path.join(PUBLIC_PARLIAMENT, "mp-management");
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  let changedFiles = 0;
  for (const f of files) {
    const p = path.join(dir, f);
    const data = readJson<{ mpName?: string }>(p);
    if (typeof data.mpName === "string") {
      const nx = titleCaseBgName(data.mpName);
      if (nx !== data.mpName) {
        data.mpName = nx;
        writeJson(p, data);
        changedFiles++;
      }
    }
  }
  filesTouched += changedFiles;
  console.log(
    `  scanned ${files.length} mp-management files (${changedFiles} changed)`,
  );
};

const main = () => {
  console.log("[normalize-mp-name-casing] starting…");
  updateIndex();
  updateProfiles();
  updateConnectionsGraph();
  updateRankings();
  updateMpConnections();
  updateMpManagement();
  console.log(
    `[normalize-mp-name-casing] done. files touched: ${filesTouched}`,
  );
};

main();
