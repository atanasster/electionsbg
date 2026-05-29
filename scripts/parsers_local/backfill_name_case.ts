// One-off backfill: re-apply titleCasePersonName() to every candidate-name
// field already on disk under data/. The parsers now normalise at ingest
// (parse_rezultati_html.ts, parse_local_candidates.ts), but the existing
// bundles still carry the ALL-CAPS variants CIK serves. This script walks
// every local-election cycle and rewrites the affected fields in place:
//
//   data/<cycle>/municipalities/*.json
//     mayor.round1[].candidateName
//     mayor.round2?[].candidateName
//     mayor.elected?.candidateName
//     council[].candidates[].name
//     kmetstva[].candidates[].candidateName
//     districts[].candidates[].candidateName
//   data/<cycle>/officials_diff.json + officials_diff/*.json
//     municipalities[].mayor.cikName
//     municipalities[].council.onlyInCik[].name
//   data/local_chmi_history.json
//     byObshtina[*][].candidateName
//     allEvents[].candidateName
//
// Idempotent — running twice is a no-op (helper short-circuits on strings
// that already mix case). Run once: `npx tsx scripts/parsers_local/backfill_name_case.ts`.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { titleCasePersonName } from "./text";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_ROOT = path.resolve(__dirname, "../../data");

let totalFieldsRewritten = 0;

const rewrite = (obj: Record<string, unknown>, key: string): void => {
  const v = obj[key];
  if (typeof v !== "string") return;
  const next = titleCasePersonName(v);
  if (next !== v) {
    obj[key] = next;
    totalFieldsRewritten++;
  }
};

const stringify = (o: unknown): string => JSON.stringify(o, null, 2);

const fixMunicipalityBundle = (file: string): boolean => {
  const raw = fs.readFileSync(file, "utf-8");
  const before = totalFieldsRewritten;
  const bundle = JSON.parse(raw) as {
    mayor: {
      round1: Array<Record<string, unknown>>;
      round2?: Array<Record<string, unknown>>;
      elected: Record<string, unknown> | null;
    };
    council: Array<{
      candidates: Array<Record<string, unknown>>;
    }>;
    kmetstva: Array<{
      candidates: Array<Record<string, unknown>>;
    }>;
    districts: Array<{
      candidates: Array<Record<string, unknown>>;
    }>;
  };
  for (const m of bundle.mayor.round1) rewrite(m, "candidateName");
  if (bundle.mayor.round2)
    for (const m of bundle.mayor.round2) rewrite(m, "candidateName");
  if (bundle.mayor.elected) rewrite(bundle.mayor.elected, "candidateName");
  for (const p of bundle.council)
    for (const c of p.candidates) rewrite(c, "name");
  for (const k of bundle.kmetstva)
    for (const c of k.candidates) rewrite(c, "candidateName");
  for (const d of bundle.districts)
    for (const c of d.candidates) rewrite(c, "candidateName");
  const changed = totalFieldsRewritten > before;
  if (changed) fs.writeFileSync(file, stringify(bundle), "utf-8");
  return changed;
};

const fixOfficialsDiff = (file: string): boolean => {
  const raw = fs.readFileSync(file, "utf-8");
  const before = totalFieldsRewritten;
  const parsed = JSON.parse(raw);
  const munis: unknown[] = Array.isArray(parsed)
    ? parsed
    : ((parsed as { municipalities?: unknown[] }).municipalities ?? []);
  for (const mu of munis) {
    const m = mu as {
      mayor?: Record<string, unknown> | null;
      council?: {
        onlyInCik?: Array<Record<string, unknown>>;
      };
    };
    if (m.mayor) rewrite(m.mayor, "cikName");
    if (m.council?.onlyInCik)
      for (const r of m.council.onlyInCik) rewrite(r, "name");
  }
  const changed = totalFieldsRewritten > before;
  if (changed) fs.writeFileSync(file, stringify(parsed), "utf-8");
  return changed;
};

const fixChmiHistory = (file: string): boolean => {
  if (!fs.existsSync(file)) return false;
  const raw = fs.readFileSync(file, "utf-8");
  const before = totalFieldsRewritten;
  const hist = JSON.parse(raw) as {
    byObshtina: Record<string, Array<Record<string, unknown>>>;
    allEvents: Array<Record<string, unknown>>;
  };
  for (const events of Object.values(hist.byObshtina))
    for (const e of events) rewrite(e, "candidateName");
  for (const e of hist.allEvents) rewrite(e, "candidateName");
  const changed = totalFieldsRewritten > before;
  if (changed) fs.writeFileSync(file, stringify(hist), "utf-8");
  return changed;
};

const isCycleFolder = (name: string): boolean =>
  /_mi$/.test(name) || /_chmi(?:_nov)?$/.test(name);

const main = (): void => {
  const cycles = fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isCycleFolder(d.name))
    .map((d) => d.name)
    .sort();

  let bundlesTouched = 0;
  let diffsTouched = 0;

  for (const cycle of cycles) {
    const muniDir = path.join(DATA_ROOT, cycle, "municipalities");
    if (fs.existsSync(muniDir)) {
      const files = fs
        .readdirSync(muniDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(muniDir, f));
      for (const f of files) if (fixMunicipalityBundle(f)) bundlesTouched++;
    }
    const odMain = path.join(DATA_ROOT, cycle, "officials_diff.json");
    if (fs.existsSync(odMain) && fixOfficialsDiff(odMain)) diffsTouched++;
    const odDir = path.join(DATA_ROOT, cycle, "officials_diff");
    if (fs.existsSync(odDir)) {
      const files = fs
        .readdirSync(odDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(odDir, f));
      for (const f of files) if (fixOfficialsDiff(f)) diffsTouched++;
    }
    console.log(`[backfill] ${cycle}: scanned`);
  }

  const histPath = path.join(DATA_ROOT, "local_chmi_history.json");
  const histChanged = fixChmiHistory(histPath);

  console.log(
    `[backfill] done — fields rewritten: ${totalFieldsRewritten}, ` +
      `bundles touched: ${bundlesTouched}, officials_diff files touched: ${diffsTouched}, ` +
      `chmi history touched: ${histChanged}`,
  );
};

main();
