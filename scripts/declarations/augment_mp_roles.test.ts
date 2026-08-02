// Unit test for augmentCompaniesIndexWithMpRoles — the graph-free re-derivation of companies-index
// `mpRoles` (+ TR-only company entries) that replaced the retired connections-graph tail step
// (connections-engine-v1 §P4.3). This is the gate the reviewer asked for: mpRoles going empty is a
// silent, build-green live-data regression (/mp/companies, CompaniesHqTile, procurement crossReference
// all read it), so pin that the augmentation actually writes non-empty mpRoles + adds TR-only companies.
// No network, no DB — runs the module against a throwaway fixture dir.

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { augmentCompaniesIndexWithMpRoles } from "./augment_mp_roles";

const tmpDirs: string[] = [];
const mkFixture = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "augment-mp-roles-"));
  tmpDirs.push(root);
  const parliament = path.join(root, "parliament");
  fs.mkdirSync(path.join(parliament, "mp-management"), { recursive: true });
  // A declared company (uic A100, MP already has a stake) + a plain declared company (B200, no TR role).
  fs.writeFileSync(
    path.join(parliament, "companies-index.json"),
    JSON.stringify({
      generatedAt: "2026-01-01",
      total: 2,
      companies: [
        {
          // slug matches slugifyCompanyName("ALPHA OOD") so a same-named TR-only role collides.
          slug: "ALPHA-OOD",
          displayName: "ALPHA OOD",
          registeredOffices: [],
          stakes: [{ mpId: 1, mpName: "Иван", sharePercent: 50 }],
          mpRoles: [
            {
              mpId: 9,
              mpName: "STALE",
              role: "x",
              isCurrent: true,
              confidence: "medium",
            },
          ],
          tr: {
            uic: "A100",
            legalForm: "OOD",
            status: "active",
            seat: null,
            lastUpdated: null,
            currentOfficers: [],
            currentOwners: [],
          },
        },
        {
          slug: "beta",
          displayName: "BETA EOOD",
          registeredOffices: [],
          stakes: [{ mpId: 2, mpName: "Петър", sharePercent: 100 }],
          mpRoles: [],
        },
      ],
    }),
  );
  // MP 1 manages ALPHA (uic A100, matches the declared entry) + GAMMA (uic C300, TR-only, not declared).
  fs.writeFileSync(
    path.join(parliament, "mp-management", "1.json"),
    JSON.stringify({
      mpId: 1,
      mpName: "Иван Иванов",
      roles: [
        {
          uic: "A100",
          companyName: "ALPHA OOD",
          role: "manager",
          erasedAt: null,
          confidence: "high",
        },
        {
          uic: "C300",
          companyName: "ГАМА ЕООД",
          legalForm: "EOOD",
          seat: "София",
          status: "active",
          role: "sole_owner",
          erasedAt: "2024-01-01",
          confidence: "low",
        },
      ],
    }),
  );
  return root;
};

afterEach(() => {
  for (const d of tmpDirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const read = (root: string) =>
  JSON.parse(
    fs.readFileSync(
      path.join(root, "parliament", "companies-index.json"),
      "utf-8",
    ),
  ) as {
    total: number;
    companies: {
      slug: string;
      stakes: unknown[];
      mpRoles?: {
        mpId: number;
        role: string;
        isCurrent: boolean;
        confidence: string;
      }[];
      tr?: { uic: string };
    }[];
  };

describe("augmentCompaniesIndexWithMpRoles", () => {
  const stringify = (o: object) => JSON.stringify(o, null, 0);

  it("re-derives mpRoles from mp-management onto the matching declared company", () => {
    const root = mkFixture();
    augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    const alpha = out.companies.find((c) => c.tr?.uic === "A100")!;
    // Stale mpRoles cleared + re-derived: MP 1 is a manager here (confidence low→medium coerced).
    expect(alpha.mpRoles).toEqual([
      {
        mpId: 1,
        mpName: "Иван Иванов",
        role: "manager",
        isCurrent: true,
        confidence: "high",
      },
    ]);
  });

  it("adds a TR-only company the MP manages but never declared", () => {
    const root = mkFixture();
    augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    const gamma = out.companies.find((c) => c.tr?.uic === "C300");
    expect(gamma, "TR-only company C300 should be appended").toBeTruthy();
    expect(gamma!.stakes).toEqual([]);
    expect(gamma!.mpRoles).toEqual([
      // erasedAt set → isCurrent false; confidence low→medium.
      {
        mpId: 1,
        mpName: "Иван Иванов",
        role: "sole_owner",
        isCurrent: false,
        confidence: "medium",
      },
    ]);
  });

  it("keeps declared-stake-only companies and drops nothing MP-linked", () => {
    const root = mkFixture();
    augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    // BETA has a stake but no TR role → kept with empty mpRoles.
    const beta = out.companies.find((c) => c.slug === "beta")!;
    expect(beta.mpRoles).toEqual([]);
    // 2 declared + 1 TR-only = 3, and the module writes an honest total.
    expect(out.total).toBe(3);
    expect(out.companies).toHaveLength(3);
  });

  it("is idempotent — a second run reproduces the first byte-for-byte (no re-appended TR-only)", () => {
    const root = mkFixture();
    const p = path.join(root, "parliament", "companies-index.json");
    augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const first = fs.readFileSync(p, "utf-8");
    const gammaSlug = read(root).companies.find(
      (c) => c.tr?.uic === "C300",
    )!.slug;
    augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    expect(fs.readFileSync(p, "utf-8")).toBe(first);
    // The TR-only company keeps its base slug on re-run (byUic re-finds it — no `-2`).
    expect(read(root).companies.find((c) => c.tr?.uic === "C300")!.slug).toBe(
      gammaSlug,
    );
  });

  it("suffixes a TR-only company whose name collides with an existing base slug", () => {
    const root = mkFixture();
    // An MP-managed TR-only company (uic Z900) whose name slugifies to the SAME base as the declared
    // "ALPHA OOD" (slug "alpha") must be appended under a disambiguated `-2` slug, not overwrite alpha.
    fs.writeFileSync(
      path.join(root, "parliament", "mp-management", "2.json"),
      JSON.stringify({
        mpId: 2,
        mpName: "Мара",
        roles: [
          {
            uic: "Z900",
            companyName: "ALPHA OOD",
            role: "manager",
            erasedAt: null,
            confidence: "medium",
          },
        ],
      }),
    );
    augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    const declaredAlpha = out.companies.find((c) => c.tr?.uic === "A100")!;
    const trOnlyAlpha = out.companies.find((c) => c.tr?.uic === "Z900")!;
    expect(declaredAlpha.slug).toBe("ALPHA-OOD"); // declared entry keeps the base slug
    expect(trOnlyAlpha.slug).toBe("ALPHA-OOD-2"); // TR-only collides → disambiguated
  });

  it("skips a TR-only role with an empty / '-' company name (no entry appended)", () => {
    const root = mkFixture();
    fs.writeFileSync(
      path.join(root, "parliament", "mp-management", "3.json"),
      JSON.stringify({
        mpId: 3,
        mpName: "Георги",
        roles: [
          { uic: "N000", companyName: "-", role: "manager", erasedAt: null },
          { uic: "N001", companyName: "   ", role: "partner", erasedAt: null },
        ],
      }),
    );
    augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    expect(out.companies.find((c) => c.tr?.uic === "N000")).toBeUndefined();
    expect(out.companies.find((c) => c.tr?.uic === "N001")).toBeUndefined();
  });
});
