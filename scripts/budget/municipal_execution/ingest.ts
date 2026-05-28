// Ingest municipal cash-execution (касово изпълнение) from data.egov.bg.
//
// Generic across municipalities: the MINFIN B3 template is uniform, so the
// only per-muni knowledge is the registry below (org id + obshtina code +
// which resource family carries the consolidated single-file B3). Each
// covered муни publishes one portal-hosted resource per fiscal year.
//
// Usage:
//   tsx scripts/budget/municipal_execution/ingest.ts --muni ruse --year 2024
//   tsx scripts/budget/municipal_execution/ingest.ts --muni ruse --all
//   tsx scripts/budget/municipal_execution/ingest.ts --all          (every muni, every year)
//
// Writes data/budget/municipal_execution/{slug}/{year}.json + rebuilds
// index.json from what's on disk.

import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listDatasets, getResourceData } from "../lib/egov_api";
import { parseB3 } from "./parse";
import type {
  MunicipalExecutionIndexEntry,
  MunicipalExecutionIndexFile,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_ROOT = resolve(__dirname, "../../../data/budget/municipal_execution");

interface MuniConfig {
  slug: string;
  orgId: number;
  obshtina: string;
  nameBg: string;
  nameEn: string;
  publisher: string;
  // The consolidated single-file B3 family to prefer when a muni publishes
  // both a one-file recap and a multi-file periodic set for the same year.
  resourcePref: RegExp;
}

const REGISTRY: MuniConfig[] = [
  {
    slug: "ruse",
    orgId: 157,
    obshtina: "RSE27",
    nameBg: "Русе",
    nameEn: "Ruse",
    publisher: "Община Русе",
    resourcePref: /Данни за бюджет\s+20\d{2}/i,
  },
  {
    slug: "nikolaevo",
    orgId: 281,
    obshtina: "SZR38",
    nameBg: "Николаево",
    nameEn: "Nikolaevo",
    publisher: "Община Николаево",
    resourcePref: /Отчет за касово изпълнение/i,
  },
];

const EXEC_RE = /касово изпълнение|разходването му|изпълнението на бюджета/i;

interface YearResource {
  uri: string;
  datasetUri: string;
  name: string;
  updated: string;
  preferred: boolean;
}

// Resolve year → best portal-hosted execution resource for a municipality.
const resolveYearResources = async (
  muni: MuniConfig,
): Promise<Map<number, YearResource>> => {
  const datasets = await listDatasets(muni.orgId);
  const map = new Map<number, YearResource>();
  for (const ds of datasets) {
    for (const r of ds.resources) {
      if (r.resource_url != null) continue; // link-out resources carry no data
      const hay = `${r.name} ${ds.name}`;
      const preferred = muni.resourcePref.test(hay);
      if (!preferred && !EXEC_RE.test(hay)) continue;
      const ym = r.name.match(/20\d{2}/) ?? ds.name.match(/20\d{2}/);
      if (!ym) continue;
      const year = Number(ym[0]);
      const cur = map.get(year);
      const better =
        !cur ||
        (preferred && !cur.preferred) ||
        (preferred === cur.preferred && r.updated_at > cur.updated);
      if (better) {
        map.set(year, {
          uri: r.uri,
          datasetUri: ds.uri,
          name: r.name,
          updated: r.updated_at,
          preferred,
        });
      }
    }
  }
  return map;
};

const ingestOne = async (
  muni: MuniConfig,
  year: number,
  res: YearResource,
): Promise<void> => {
  const rows = await getResourceData(res.uri);
  const parsed = parseB3({
    rows,
    fiscalYear: year,
    obshtina: muni.obshtina,
    muniSlug: muni.slug,
    muniNameBg: muni.nameBg,
    muniNameEn: muni.nameEn,
    source: {
      publisher: muni.publisher,
      datasetUrl: `https://data.egov.bg/data/view/${res.datasetUri}`,
      resourceUri: res.uri,
    },
  });
  const outPath = resolve(OUT_ROOT, muni.slug, `${year}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  const r = parsed.revenue;
  const e = parsed.expense;
  const mEur = (m: { amountEur: number }) =>
    (m.amountEur / 1_000_000).toFixed(1);
  console.log(
    `[muni-exec] ${muni.slug} ${year} (${parsed.period.labelBg}) — ` +
      `приходи план €${mEur(r.plan)}M / отчет €${mEur(r.actual)}M (${r.executionPct}%), ` +
      `разходи план €${mEur(e.plan)}M / отчет €${mEur(e.actual)}M (${e.executionPct}%) ` +
      `→ ${outPath}`,
  );
};

const rebuildIndex = (): void => {
  const municipalities: MunicipalExecutionIndexEntry[] = [];
  for (const muni of REGISTRY) {
    const dir = resolve(OUT_ROOT, muni.slug);
    if (!existsSync(dir)) continue;
    const years = readdirSync(dir)
      .map((f) => f.match(/^(\d{4})\.json$/)?.[1])
      .filter((y): y is string => !!y)
      .map(Number)
      .sort((a, b) => a - b);
    if (years.length === 0) continue;
    // Latest full-fiscal-year file, so the tile defaults to a complete year.
    let latestFullYear: number | null = null;
    for (const y of years) {
      const f = JSON.parse(readFileSync(resolve(dir, `${y}.json`), "utf8")) as {
        period?: { isFullYear?: boolean };
      };
      if (f.period?.isFullYear) latestFullYear = y;
    }
    municipalities.push({
      muniSlug: muni.slug,
      obshtina: muni.obshtina,
      muniNameBg: muni.nameBg,
      muniNameEn: muni.nameEn,
      years,
      latestFullYear,
    });
  }
  const index: MunicipalExecutionIndexFile = {
    generatedAt: new Date().toISOString(),
    municipalities,
  };
  mkdirSync(OUT_ROOT, { recursive: true });
  writeFileSync(
    resolve(OUT_ROOT, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
    "utf8",
  );
  console.log(
    `[muni-exec] index: ${municipalities.length} muni(s) — ${municipalities
      .map((m) => `${m.muniSlug}(${m.years.length}y)`)
      .join(", ")}`,
  );
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const muniArg = args.includes("--muni")
    ? args[args.indexOf("--muni") + 1]
    : undefined;
  const yearArg = args.includes("--year")
    ? Number(args[args.indexOf("--year") + 1])
    : undefined;
  const all = args.includes("--all");

  const targets = muniArg
    ? REGISTRY.filter((m) => m.slug === muniArg)
    : REGISTRY;
  if (targets.length === 0) {
    throw new Error(
      `unknown --muni ${muniArg}. Known: ${REGISTRY.map((m) => m.slug).join(", ")}`,
    );
  }

  for (const muni of targets) {
    const resources = await resolveYearResources(muni);
    if (resources.size === 0) {
      console.warn(
        `[muni-exec] ${muni.slug}: no portal-hosted execution resources found`,
      );
      continue;
    }
    const years =
      yearArg !== undefined
        ? [yearArg]
        : all || !muniArg
          ? [...resources.keys()].sort((a, b) => a - b)
          : [Math.max(...resources.keys())]; // default: latest year
    for (const year of years) {
      const res = resources.get(year);
      if (!res) {
        console.warn(`[muni-exec] ${muni.slug} ${year}: no resource`);
        continue;
      }
      try {
        await ingestOne(muni, year, res);
      } catch (e) {
        console.error(
          `[muni-exec] ${muni.slug} ${year} FAILED: ${(e as Error).message}`,
        );
      }
    }
  }

  rebuildIndex();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
