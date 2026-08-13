// Unit test for augmentCompaniesIndexWithMpRoles — the re-derivation of companies-index
// `mpRoles` (+ registry-only company entries). mpRoles going empty is a silent, build-green
// live-data regression (/mp/companies and the procurement crossReference read it), so this pins
// that the augmentation actually writes non-empty mpRoles and adds registry-only companies.
//
// The SOURCE is now Postgres, not the retired mp-management shards, so `allRows` is stubbed:
// the fixture rows below are the rows that query returns. No network, no database — and the
// two DEGRADE paths (unreachable, empty result) are asserted here too, because both must leave
// the previous vintage alone rather than retracting every link on the site.

import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rows = vi.hoisted(() => ({
  current: [] as Record<string, unknown>[],
  fail: false,
  ended: false,
}));
vi.mock("../db/lib/pg", () => ({
  allRows: async () => {
    if (rows.fail) throw new Error("connect ECONNREFUSED");
    return rows.current;
  },
  // The module closes the pool on both paths — a batch script must not hold the process open
  // for the pool's ~10 s idle tail. Stubbed rather than omitted so the test fails if that call
  // is ever dropped, not merely if it is added.
  end: async () => {
    rows.ended = true;
  },
}));

import { augmentCompaniesIndexWithMpRoles } from "./augment_mp_roles";

/** MP 1 holds ALPHA (uic A100, matches the declared entry) + ГАМА (C300, registry-only). */
const DEFAULT_ROWS = [
  {
    mp_id: 1,
    mp_name: "Иван Иванов",
    uic: "A100",
    company_name: "ALPHA OOD",
    legal_form: "OOD",
    seat: null,
    status: "active",
    role: "manager",
    erased_at: null,
    declared: true,
  },
  {
    mp_id: 1,
    mp_name: "Иван Иванов",
    uic: "C300",
    company_name: "ГАМА ЕООД",
    legal_form: "EOOD",
    seat: "София",
    status: "active",
    role: "sole_owner",
    erased_at: new Date("2024-01-01"),
    declared: false,
  },
];

const tmpDirs: string[] = [];
const mkFixture = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "augment-mp-roles-"));
  tmpDirs.push(root);
  const parliament = path.join(root, "parliament");
  fs.mkdirSync(parliament, { recursive: true });
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
  return root;
};

afterEach(() => {
  for (const d of tmpDirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
  rows.current = DEFAULT_ROWS;
  rows.fail = false;
  rows.ended = false;
});
rows.current = DEFAULT_ROWS;

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

  it("re-derives mpRoles from the person layer onto the matching declared company", async () => {
    const root = mkFixture();
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
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

  it("adds a registry-only company the MP holds but never declared", async () => {
    const root = mkFixture();
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
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

  it("keeps declared-stake-only companies and drops nothing MP-linked", async () => {
    const root = mkFixture();
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    // BETA has a stake but no TR role → kept with empty mpRoles.
    const beta = out.companies.find((c) => c.slug === "beta")!;
    expect(beta.mpRoles).toEqual([]);
    // 2 declared + 1 TR-only = 3, and the module writes an honest total.
    expect(out.total).toBe(3);
    expect(out.companies).toHaveLength(3);
  });

  it("is idempotent — a second run reproduces the first byte-for-byte (no re-appended TR-only)", async () => {
    const root = mkFixture();
    const p = path.join(root, "parliament", "companies-index.json");
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const first = fs.readFileSync(p, "utf-8");
    const gammaSlug = read(root).companies.find(
      (c) => c.tr?.uic === "C300",
    )!.slug;
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    expect(fs.readFileSync(p, "utf-8")).toBe(first);
    // The TR-only company keeps its base slug on re-run (byUic re-finds it — no `-2`).
    expect(read(root).companies.find((c) => c.tr?.uic === "C300")!.slug).toBe(
      gammaSlug,
    );
  });

  it("suffixes a registry-only company whose name collides with an existing base slug", async () => {
    const root = mkFixture();
    // An MP-managed TR-only company (uic Z900) whose name slugifies to the SAME base as the declared
    // "ALPHA OOD" (slug "alpha") must be appended under a disambiguated `-2` slug, not overwrite alpha.
    rows.current = [
      ...DEFAULT_ROWS,
      {
        mp_id: 2,
        mp_name: "Мара",
        uic: "Z900",
        company_name: "ALPHA OOD",
        legal_form: null,
        seat: null,
        status: null,
        role: "manager",
        erased_at: null,
        declared: false,
      },
    ];
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    const declaredAlpha = out.companies.find((c) => c.tr?.uic === "A100")!;
    const trOnlyAlpha = out.companies.find((c) => c.tr?.uic === "Z900")!;
    expect(declaredAlpha.slug).toBe("ALPHA-OOD"); // declared entry keeps the base slug
    expect(trOnlyAlpha.slug).toBe("ALPHA-OOD-2"); // TR-only collides → disambiguated
  });

  it("skips a registry-only role with an empty / '-' company name (no entry appended)", async () => {
    const root = mkFixture();
    rows.current = [
      ...DEFAULT_ROWS,
      {
        mp_id: 3,
        mp_name: "Георги",
        uic: "N000",
        company_name: "-",
        legal_form: null,
        seat: null,
        status: null,
        role: "manager",
        erased_at: null,
        declared: false,
      },
      {
        mp_id: 3,
        mp_name: "Георги",
        uic: "N001",
        company_name: "   ",
        legal_form: null,
        seat: null,
        status: null,
        role: "partner",
        erased_at: null,
        declared: false,
      },
    ];
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    expect(out.companies.find((c) => c.tr?.uic === "N000")).toBeUndefined();
    expect(out.companies.find((c) => c.tr?.uic === "N001")).toBeUndefined();
  });

  // ── The two degrade paths ────────────────────────────────────────────────────────────
  // Both must leave the PREVIOUS vintage alone. `mpRoles` drives a published cross-reference,
  // so clearing it on a build machine with no database would silently retract every MP↔company
  // link on the site — a build-green live-data regression, which is what this file exists for.

  it("leaves mpRoles untouched when Postgres is unreachable", async () => {
    const root = mkFixture();
    rows.fail = true;
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    expect(rows.ended).toBe(true); // the pool is closed on the failure path too
    const out = read(root);
    const alpha = out.companies.find((c) => c.tr?.uic === "A100")!;
    // The STALE role the fixture seeded is still there — proof nothing was rewritten.
    expect(alpha.mpRoles).toEqual([
      {
        mpId: 9,
        mpName: "STALE",
        role: "x",
        isCurrent: true,
        confidence: "medium",
      },
    ]);
  });

  it("leaves mpRoles untouched when the person layer returns nothing", async () => {
    const root = mkFixture();
    rows.current = [];
    await augmentCompaniesIndexWithMpRoles({ publicFolder: root, stringify });
    const out = read(root);
    expect(
      out.companies.find((c) => c.tr?.uic === "A100")!.mpRoles,
    ).toHaveLength(1);
  });
});
