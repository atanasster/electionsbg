// Regression gate for the MP-namesake filter.
//
// buildEikLinkageMap's `trNamesake` argument is optional, so a builder that
// forgets it still produces a linkage map — just an inflated one that keeps
// every name-only TR match against big state firms. That is exactly what
// happened on 2026-07-24: rebuild_from_cache.ts called buildEikLinkageMap with
// one argument and published 134 MPs / €2,964M in index.json's crossReference,
// where the filtered truth is 54 MPs / €1,958M. The figure only got repaired
// because rebuild_derived.ts ran afterwards.
//
// Two layers here:
//   1. behaviour — the shared helper both builders now call actually drops the
//      namesake matches, and the filtered/unfiltered counts really do differ, so
//      the assertion below isn't vacuous;
//   2. a source guard — no procurement builder reaches past the helper to
//      buildEikLinkageMap directly. The builders execute their `main()` at
//      import time (they are CLI scripts), so this is how we assert that
//      rebuild_from_cache and ingest agree without running the whole pipeline.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildEikLinkageMap,
  buildMpConnected,
  buildNamesakeFilteredLinkageMap,
} from "./cross_reference";
import type { ContractorRollup } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Two MPs, two supplier EIKs.
//  • Иван Петров — a common name held by 40 distinct TR companies. His link to
//    the big state supplier is a name-only mpRole: the namesake false positive.
//  • Мария Николова — name maps to exactly one TR company, so her mpRole is
//    trustworthy and survives. She also holds a declared stake in the second
//    supplier, which stands on its own regardless of the filter.
const NAMESAKE_MP = "Иван Петров";
const UNIQUE_MP = "Мария Николова";
const BIG_STATE_SUPPLIER = "831641791";
const SMALL_SUPPLIER = "202112233";

const companiesIndex = {
  generatedAt: "2026-07-24T00:00:00.000Z",
  total: 2,
  companies: [
    {
      slug: "big-state-supplier",
      displayName: "ГОЛЯМ ДОСТАВЧИК АД",
      tr: { uic: BIG_STATE_SUPPLIER },
      mpRoles: [
        {
          mpId: 1,
          mpName: NAMESAKE_MP,
          role: "manager" as const,
          isCurrent: true,
          confidence: "medium" as const,
        },
        {
          mpId: 2,
          mpName: UNIQUE_MP,
          role: "partner" as const,
          isCurrent: true,
          confidence: "high" as const,
        },
      ],
    },
    {
      slug: "small-supplier",
      displayName: "МАЛЪК ДОСТАВЧИК ЕООД",
      tr: { uic: SMALL_SUPPLIER },
      stakes: [
        {
          mpId: 2,
          declarantName: UNIQUE_MP,
          declarationYear: 2025,
          fiscalYear: 2024,
          institution: "НС",
          sourceUrl: "https://example.invalid/decl",
          stake: { shareSize: "50%", valueEur: 10_000 },
        },
      ],
    },
  ],
};

const rollup = (
  eik: string,
  name: string,
  totalEur: number,
): ContractorRollup =>
  ({
    eik,
    name,
    totalEur,
    totalOther: {},
    contractCount: 1,
    awardCount: 1,
    awarderCount: 1,
    byAwarder: [
      {
        eik: "000695089",
        name: "АПИ",
        totalEur,
        totalOther: {},
        contractCount: 1,
      },
    ],
    byYear: [{ year: "2025", totalEur, totalOther: {}, contractCount: 1 }],
  }) as ContractorRollup;

let tmp: string;
let companiesIndexPath: string;
let contractorsDir: string;
let trSqlitePath: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xref-namesake-"));
  companiesIndexPath = path.join(tmp, "companies-index.json");
  fs.writeFileSync(companiesIndexPath, JSON.stringify(companiesIndex));

  contractorsDir = path.join(tmp, "contractors");
  fs.mkdirSync(contractorsDir);
  fs.writeFileSync(
    path.join(contractorsDir, `${BIG_STATE_SUPPLIER}.json`),
    JSON.stringify(rollup(BIG_STATE_SUPPLIER, "ГОЛЯМ ДОСТАВЧИК АД", 1_000_000)),
  );
  fs.writeFileSync(
    path.join(contractorsDir, `${SMALL_SUPPLIER}.json`),
    JSON.stringify(rollup(SMALL_SUPPLIER, "МАЛЪК ДОСТАВЧИК ЕООД", 50_000)),
  );

  trSqlitePath = path.join(tmp, "state.sqlite");
  const db = new DatabaseSync(trSqlitePath);
  db.exec(
    `CREATE TABLE company_persons (uic TEXT, name TEXT, erased_at TEXT);`,
  );
  const ins = db.prepare(
    `INSERT INTO company_persons (uic, name, erased_at) VALUES (?, ?, NULL)`,
  );
  // The common name recurs across 40 unrelated companies → namesake collision.
  for (let i = 0; i < 40; i++) {
    ins.run(`9000000${String(i).padStart(2, "0")}`, NAMESAKE_MP);
  }
  ins.run(BIG_STATE_SUPPLIER, NAMESAKE_MP);
  // The rare name maps to exactly one company → the link is trustworthy.
  ins.run(BIG_STATE_SUPPLIER, UNIQUE_MP);
  db.close();
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const pairCount = (linkagePath: string, sqlitePath?: string): number =>
  buildMpConnected(
    contractorsDir,
    sqlitePath === undefined
      ? buildEikLinkageMap(linkagePath) // the buggy call shape
      : buildNamesakeFilteredLinkageMap(linkagePath, sqlitePath, () => {}),
  ).entries.length;

describe("MP namesake filter", () => {
  it("drops name-only matches whose name spans many TR companies", () => {
    const filtered = buildNamesakeFilteredLinkageMap(
      companiesIndexPath,
      trSqlitePath,
      () => {},
    );
    const mps = buildMpConnected(contractorsDir, filtered).entries.map(
      (e) => `${e.mpName}:${e.contractorEik}`,
    );
    expect(mps).not.toContain(`${NAMESAKE_MP}:${BIG_STATE_SUPPLIER}`);
    expect(mps).toEqual([
      `${UNIQUE_MP}:${BIG_STATE_SUPPLIER}`,
      `${UNIQUE_MP}:${SMALL_SUPPLIER}`,
    ]);
  });

  it("the unfiltered call shape really does inflate the pair count", () => {
    // Guards the assertion above from going vacuous: if these ever matched, the
    // fixture would no longer reproduce the 134-vs-54 failure mode.
    expect(pairCount(companiesIndexPath)).toBe(3);
    expect(pairCount(companiesIndexPath, trSqlitePath)).toBe(2);
  });

  it("degrades conservatively and warns when the TR mirror is absent", () => {
    const warnings: string[] = [];
    const map = buildNamesakeFilteredLinkageMap(
      companiesIndexPath,
      path.join(tmp, "does-not-exist.sqlite"),
      (m) => warnings.push(m),
    );
    expect(warnings.join("\n")).toMatch(/dropping ALL name-matched MP roles/);
    // Empty counts → no name reads as unique → every name-matched role goes and
    // only the declared stake stands. Under-links, never over-links.
    const entries = buildMpConnected(contractorsDir, map).entries;
    expect(entries.map((e) => `${e.mpName}:${e.contractorEik}`)).toEqual([
      `${UNIQUE_MP}:${SMALL_SUPPLIER}`,
    ]);
  });
});

describe("every procurement builder applies the filter", () => {
  // rebuild_from_cache is the one that regressed; ingest is the reference. The
  // rest share the same publish path into derived/mp_connected.json, so they
  // must agree too — identical fixtures in, identical pair count out.
  const BUILDERS = [
    "scripts/procurement/rebuild_from_cache.ts",
    "scripts/procurement/ingest.ts",
    "scripts/procurement/rebuild_derived.ts",
    "scripts/procurement/dedup_legacy_twins.ts",
    "scripts/procurement/dedup_contract_keys.ts",
    "scripts/db/gen_procurement/cross_reference.ts",
  ];

  it.each(BUILDERS)("%s goes through buildNamesakeFilteredLinkageMap", (f) => {
    const src = fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
    expect(src).toMatch(/buildNamesakeFilteredLinkageMap\(/);
    // A bare buildEikLinkageMap(...) call bypasses the filter.
    expect(src).not.toMatch(/[^a-zA-Z]buildEikLinkageMap\(/);
  });
});
