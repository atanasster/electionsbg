// Regression gate for the MP↔company link set's TWO-STATE contract.
//
// It replaces `scripts/procurement/cross_reference.test.ts`, which gated the namesake filter
// that `buildEikLinkageMap` used to apply to `companies-index.json`'s name-matched mpRoles.
// That filter is gone with its input (Tier 5 of docs/plans/company-page-consolidation-v1.md):
// the source is now `company_politicians`, where migration 148's people-per-name fold has
// already refused a name the Commerce Registry says belongs to more than one human — a
// stronger guard than „this name maps to exactly one company", which 148's header calls wrong
// in both directions.
//
// What CAN still go wrong is the reason this file exists. Both builders publish an
// `mp_connected.json` that another surface then states things from — the budget dashboard's
// per-ministry MP-connected flag, and the funds MP-tied payload — so a link set that comes
// back EMPTY must be refused, not published. Empty and absent are different states:
//
//   absent (fresh clone, no Postgres)  → skip, and the raw corpus still lands
//   present but empty (broken load)    → throw
//
// Two layers, the same shape the deleted file had:
//   1. behaviour — readMpLinkRows really does refuse an empty result, and really does return
//      a non-empty one, so the assertion is not vacuous;
//   2. a source guard — no builder reconstructs the query or the probe locally, and none has
//      re-acquired a `companies-index.json` read.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stripComments } from "./strip_comments";

const rowsMock = vi.fn();
const reachableMock = vi.fn();
vi.mock("../db/lib/pg", () => ({
  allRows: (...a: unknown[]) => rowsMock(...a),
  dbReachable: () => reachableMock(),
}));

const { mpLinkageAvailable, readMpLinkRows } = await import("./mp_linkage");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

afterEach(() => {
  rowsMock.mockReset();
  reachableMock.mockReset();
});

const row = (over: Record<string, unknown> = {}) => ({
  eik: "831641791",
  ref: "/candidate/mp-1005",
  politician: "Мария Николова",
  relations: [],
  ...over,
});

describe("readMpLinkRows", () => {
  it("refuses an empty link set, naming what would otherwise be published", async () => {
    rowsMock.mockResolvedValue([]);
    await expect(
      readMpLinkRows("the funds payload would claim nobody is linked."),
    ).rejects.toThrow(/no usable mp rows.*nobody is linked.*db:load:tr:pg/s);
  });

  it("returns the rows when there are any", async () => {
    // Guards the assertion above from going vacuous: a readMpLinkRows that threw
    // unconditionally would satisfy it.
    rowsMock.mockResolvedValue([row()]);
    expect(await readMpLinkRows("…")).toEqual([
      { eik: "831641791", mpId: 1005, mpName: "Мария Николова", relations: [] },
    ]);
  });

  // ⚠️ THE ONE THAT COERCION PASSES. Number(null) is 0 and 0 is finite, so a
  // Number.isFinite guard over a nullable id accepts a ref-less row as MP id 0 — every entry
  // then collapses onto one id, and writeMpConnectedShards prunes the real per-MP shards
  // while writing a single 0.json, at exit 0.
  it.each([
    ["null", null],
    ["a person_id, not a URL", "4211"],
    ["an officials slug", "/officials/ivan-ivanov-ab12cd"],
    ["a trailing segment", "/candidate/mp-1005/extra"],
    ["a non-numeric id", "/candidate/mp-abc"],
  ])("drops a ref that is %s rather than coercing it", async (_label, ref) => {
    rowsMock.mockResolvedValue([row({ ref }), row({ eik: "2" })]);
    const rows = await readMpLinkRows("…");
    expect(rows.map((r) => r.eik)).toEqual(["2"]);
    expect(rows.every((r) => r.mpId === 1005)).toBe(true);
  });

  it("throws — not returns empty — when EVERY ref is unparseable", async () => {
    rowsMock.mockResolvedValue([row({ ref: null }), row({ ref: "4211" })]);
    await expect(readMpLinkRows("…")).rejects.toThrow(
      /2 read, 2 with an unparseable ref/,
    );
  });

  it("reads the served company_politicians for scope 'contractors'", async () => {
    rowsMock.mockResolvedValue([row()]);
    await readMpLinkRows("…", "contractors");
    const sql = String(rowsMock.mock.calls[0][0]);
    expect(sql).toMatch(/FROM company_politicians/);
    expect(sql).toMatch(/kind = 'mp'/);
  });

  // ⚠️ THE FINDING THIS FILE EXISTS FOR MOST. company_politicians is contract-restricted, so
  // reading it for the ИСУН funds join drops every MP-linked company that took EU money and
  // never won a public contract — measured 2026-08-20, it answers 43 of that payload's 303
  // pairs against 173 for this scope. The two scopes must stay distinguishable.
  it("re-derives the gate WITHOUT the money join for scope 'all'", async () => {
    rowsMock.mockResolvedValue([row()]);
    await readMpLinkRows("…", "all");
    const sql = String(rowsMock.mock.calls[0][0]);
    expect(sql).not.toMatch(/FROM company_politicians/);
    expect(sql).toMatch(/tr_name_fold_people/);
    expect(sql).toMatch(/LEFT JOIN money/);
  });
});

describe("mpLinkageAvailable", () => {
  it("is false when Postgres is unreachable — a fresh clone, not a broken load", async () => {
    reachableMock.mockResolvedValue(false);
    expect(await mpLinkageAvailable()).toBe(false);
    expect(rowsMock).not.toHaveBeenCalled();
  });

  it("is false when the relation does not exist", async () => {
    reachableMock.mockResolvedValue(true);
    rowsMock.mockResolvedValue([{ present: false }]);
    expect(await mpLinkageAvailable()).toBe(false);
  });

  it("is true when the relation exists — EMPTINESS is readMpLinkRows's job, not this one's", async () => {
    reachableMock.mockResolvedValue(true);
    rowsMock.mockResolvedValue([{ present: true }]);
    expect(await mpLinkageAvailable()).toBe(true);
  });
});

// BEHAVIOUR, not just wiring — the deleted namesake gate drove buildEikLinkageMap and
// buildMpConnected end to end over a fixture, and dropping that would have traded a
// behavioural test for a source scan. Both builders are driven here from mocked rows.
describe("the two builders fold rows into a linkage map", () => {
  const REL = [{ kind: "manager", isCurrent: true }];

  it("procurement: groups by EIK, one linkage per MP, relations carried", async () => {
    rowsMock.mockResolvedValue([
      row({ relations: REL }),
      row({ ref: "/candidate/mp-42", politician: "Иван Петров" }),
      row({ eik: "204219357" }),
    ]);
    const { buildEikLinkageMap } =
      await import("../procurement/cross_reference");
    const map = await buildEikLinkageMap();
    expect([...map.byEik.keys()].sort()).toEqual(["204219357", "831641791"]);
    expect(map.byEik.get("831641791")).toEqual([
      { mpId: 1005, mpName: "Мария Николова", relations: REL },
      { mpId: 42, mpName: "Иван Петров", relations: [] },
    ]);
  });

  it("procurement: emits one entry per (MP, contractor) and skips non-contractors", async () => {
    rowsMock.mockResolvedValue([
      row({ relations: REL }),
      row({ eik: "204219357" }),
    ]);
    const { buildEikLinkageMap, buildMpConnectedFrom } =
      await import("../procurement/cross_reference");
    const map = await buildEikLinkageMap();
    const out = buildMpConnectedFrom(
      (eik) =>
        eik === "831641791"
          ? ({
              eik,
              name: "АЛФА ЕООД",
              totalEur: 1000,
              totalOther: 0,
              contractCount: 2,
              awardCount: 2,
              byYear: [],
              byAwarder: [],
            } as never)
          : null,
      map,
    );
    // 204219357 has a linkage and no contractor rollup, so it must not appear — that is the
    // half of the join that keeps a beneficiary-only company out of a contractor payload.
    expect(out.entries.map((e) => [e.mpId, e.contractorEik])).toEqual([
      [1005, "831641791"],
    ]);
  });

  it("funds: same fold, and an unparseable ref never becomes MP 0", async () => {
    rowsMock.mockResolvedValue([
      row({ relations: REL }),
      row({ eik: "204219357", ref: null }),
    ]);
    const { buildEikLinkageMap } = await import("../funds/cross_reference");
    const map = await buildEikLinkageMap();
    expect([...map.byEik.keys()]).toEqual(["831641791"]);
    expect(map.byEik.get("831641791")).toEqual([
      { mpId: 1005, mpName: "Мария Николова", relations: REL },
    ]);
  });
});

describe("every builder goes through the shared reader", () => {
  // The two that BUILD a linkage map, and the five CLI entry points that publish one. They
  // execute their main() at import time (they are CLI scripts), so this is a source scan
  // rather than an invocation — the same technique the deleted namesake gate used.
  const LINKAGE_BUILDERS = [
    "scripts/procurement/cross_reference.ts",
    "scripts/funds/cross_reference.ts",
  ];
  const CALLERS = [
    "scripts/procurement/rebuild_from_cache.ts",
    "scripts/procurement/ingest.ts",
    "scripts/procurement/rebuild_derived.ts",
    "scripts/procurement/dedup_legacy_twins.ts",
    "scripts/procurement/dedup_contract_keys.ts",
    "scripts/db/gen_procurement/cross_reference.ts",
    "scripts/funds/ingest.ts",
  ];
  // ⚠️ COMMENTS OUT. Every one of these files now carries a header explaining what it
  // replaced, and those headers NAME companies-index.json — prose that mentions a pattern is
  // not an occurrence of it. Without the strip, the gate fails on its own documentation and
  // the only way to make it pass is to delete the explanation.
  const read = (f: string) =>
    stripComments(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));

  it.each(LINKAGE_BUILDERS)(
    "%s reads the link set through readMpLinkRows",
    (f) => {
      const src = read(f);
      expect(src).toMatch(/readMpLinkRows\(/);
      // A local SELECT is a second copy of the arm predicate, which is how the two builders
      // would come to disagree about which rows count.
      expect(src).not.toMatch(/FROM company_politicians/);
      // And a local Number() on the id is a second copy of the parse the module owns — the
      // one that must reject rather than coerce.
      expect(src).not.toMatch(/Number\(r\./);
    },
  );

  // Each builder's join POPULATION decides its scope, and getting it backwards is silent:
  // the payload is simply smaller. See the scope tests above for the measured cost.
  it.each([
    ["scripts/procurement/cross_reference.ts", "contractors"],
    ["scripts/funds/cross_reference.ts", "all"],
  ])("%s asks for scope %s", (f, scope) => {
    expect(read(f)).toMatch(
      new RegExp(`readMpLinkRows\\([\\s\\S]*?"${scope}",`),
    );
  });

  it.each([...LINKAGE_BUILDERS, ...CALLERS])(
    "%s no longer reads companies-index.json",
    (f) => {
      expect(read(f)).not.toMatch(/companies-index/);
    },
  );

  it.each(CALLERS)("%s gates on mpLinkageAvailable, not on a file", (f) => {
    const src = read(f);
    // gen_procurement/cross_reference.ts deliberately does not SKIP: a verifier reduced to
    // zero arms reports on a corpus it never compared. It probes only so the failure names
    // the fix, so what must hold there is that the else branch fails the run.
    if (f.includes("gen_procurement")) {
      expect(src).toMatch(/results\.push\(false\)/);
      expect(src).not.toMatch(/skipp?ed/i);
      return;
    }
    expect(src).toMatch(/await mpLinkageAvailable\(\)/);
  });
});
