// Tests for the chain-aware deploy resolver (cloud-deploy-speed-v1 §v2-d). Pure
// function over the v2-c registry — no Postgres, runs in test:unit.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveDeploySet, BASE_LOADERS } from "./deployResolver";
import type { DerivedObject } from "./derivedRegistry";

const ROOT = path.resolve(__dirname, "../../..");
const npmScripts = (): Set<string> => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  return new Set(Object.keys(pkg.scripts));
};
const before = (loaders: string[], a: string, b: string): boolean =>
  loaders.indexOf(a) !== -1 &&
  loaders.indexOf(b) !== -1 &&
  loaders.indexOf(a) < loaders.indexOf(b);

describe("resolveDeploySet", () => {
  it("an empty change set produces an empty plan", () => {
    expect(resolveDeploySet([])).toEqual({
      objects: [],
      loaders: [],
      unmappedChanges: [],
      cyclic: false,
    });
  });

  it("a change with no downstream and no base loader produces nothing but an unmapped note", () => {
    // prices lives outside the money graph — nothing in the registry reads it.
    const plan = resolveDeploySet(["price_last_seen"]);
    expect(plan.objects).toEqual([]);
    expect(plan.loaders).toEqual([]);
    expect(plan.unmappedChanges).toEqual(["price_last_seen"]);
  });

  it("every base loader it can emit is a real npm script (base name, no :cloud)", () => {
    const scripts = npmScripts();
    const missing = [...new Set(Object.values(BASE_LOADERS))].filter(
      (l) => !scripts.has(l),
    );
    expect(missing).toEqual([]);
    expect(Object.values(BASE_LOADERS).some((l) => l.endsWith(":cloud"))).toBe(
      false,
    );
  });

  it("a contracts change runs the money tail — once each, in dependency order", () => {
    const plan = resolveDeploySet(["contracts"]);

    // it fans out to the derived money + person + procurement objects
    expect(plan.objects).toEqual(
      expect.arrayContaining([
        "company_public_money",
        "tr_company_place",
        "person_browse_table",
        "person_search",
        "procurement_payloads",
        "agri_hub_stats_cache",
      ]),
    );

    // the loaders are the ones whose OUTPUTS went stale — and NOT the corpora that
    // did not change (tr / agri full reloads must not be dragged in)
    expect(plan.loaders).toEqual(
      expect.arrayContaining([
        "db:load:pg",
        "db:load:graph:pg",
        "db:load:tr-company-place:pg",
        "db:load:persons-browse:pg",
        "db:load:person-search:pg",
        "db:load:agri-hub-stats:pg",
      ]),
    );
    expect(plan.loaders).not.toContain("db:load:tr:pg");
    expect(plan.loaders).not.toContain("db:load:agri:pg");

    // each loader appears at most once
    expect(new Set(plan.loaders).size).toBe(plan.loaders.length);

    // dependency order: the corpus load before the money basis, the basis before
    // what denormalizes it, the browse table before the search index that reads it
    expect(before(plan.loaders, "db:load:pg", "db:load:graph:pg")).toBe(true);
    expect(
      before(plan.loaders, "db:load:graph:pg", "db:load:tr-company-place:pg"),
    ).toBe(true);
    expect(
      before(
        plan.loaders,
        "db:load:persons-browse:pg",
        "db:load:person-search:pg",
      ),
    ).toBe(true);
    expect(plan.cyclic).toBe(false);
  });

  it("a TR change runs the graph + person tail but not the contracts loader", () => {
    const plan = resolveDeploySet(["tr_companies", "company_politicians"]);
    expect(plan.loaders).toEqual(
      expect.arrayContaining([
        "db:load:tr:pg",
        "db:load:graph:pg",
        "db:load:tr-company-place:pg",
        "db:load:persons-browse:pg",
        "db:load:person-search:pg",
      ]),
    );
    expect(plan.loaders).not.toContain("db:load:pg");
    expect(before(plan.loaders, "db:load:tr:pg", "db:load:graph:pg")).toBe(
      true,
    );
    expect(
      before(plan.loaders, "db:load:tr:pg", "db:load:tr-company-place:pg"),
    ).toBe(true);
    expect(new Set(plan.loaders).size).toBe(plan.loaders.length);
  });

  it("a narrow change does NOT pick a heavy unrelated base loader as a cover", () => {
    // kzk_appeals has no automated loader; its only downstream is
    // awarder_risk_grade_scoped, whose rebuilders are [db:load:pg, db:load:tr:pg,
    // kzk:rejoin]. The right cover is kzk:rejoin — NOT db:load:pg (an 8-min
    // contracts reload nobody asked for).
    const plan = resolveDeploySet(["kzk_appeals"]);
    // kzk_appeals feeds awarder_risk_grade_scoped AND the hub_stats.json artifact
    // (which lists kzk_appeals among its inputs) — both must rebuild, via their own
    // light rebuilders, NOT via a contracts/TR reload.
    expect(plan.objects).toEqual(
      expect.arrayContaining(["awarder_risk_grade_scoped", "hub_stats.json"]),
    );
    expect(plan.loaders).toEqual(
      expect.arrayContaining(["kzk:rejoin", "db:gen-hub-stats"]),
    );
    expect(plan.loaders).not.toContain("db:load:pg");
    expect(plan.loaders).not.toContain("db:load:tr:pg");
    expect(plan.unmappedChanges).toEqual(["kzk_appeals"]);
  });

  it("is deterministic — the same input yields the same plan", () => {
    expect(resolveDeploySet(["contracts"])).toEqual(
      resolveDeploySet(["contracts"]),
    );
    expect(resolveDeploySet(["tr_companies", "company_politicians"])).toEqual(
      resolveDeploySet(["company_politicians", "tr_companies"]),
    );
  });

  it("never emits a duplicate loader for any single-corpus change", () => {
    for (const t of Object.keys(BASE_LOADERS)) {
      const { loaders } = resolveDeploySet([t]);
      expect(new Set(loaders).size, `duplicate loader for ${t}`).toBe(
        loaders.length,
      );
    }
  });

  it("expands co-loaded siblings — a fund_beneficiaries change fires fund_projects-derived objects", () => {
    // db:load:funds:pg reloads fund_beneficiaries AND fund_projects AND fund_payloads
    // together, so naming just one must still fire funds_hub_stats_cache/fund_fit
    // (which read fund_projects) and the money basis (reads fund_beneficiaries).
    const plan = resolveDeploySet(["fund_beneficiaries"]);
    expect(plan.objects).toEqual(
      expect.arrayContaining([
        "funds_hub_stats_cache",
        "fund_fit",
        "company_public_money",
      ]),
    );
    expect(plan.loaders).toEqual(
      expect.arrayContaining([
        "db:load:funds:pg",
        "db:load:funds-fit:pg",
        "db:load:graph:pg",
      ]),
    );
    expect(plan.loaders).not.toContain("db:load:pg"); // contracts untouched
    expect(plan.loaders).not.toContain("db:load:tr:pg");
  });

  it("expands co-loaded siblings — tr_companies ALONE still fires the person browse table", () => {
    // db:load:tr:pg co-loads company_politicians / tr_officers, which person_browse_table
    // reads — so tr_companies alone must not drop db:load:persons-browse:pg.
    const plan = resolveDeploySet(["tr_companies"]);
    expect(plan.loaders).toEqual(
      expect.arrayContaining([
        "db:load:tr:pg",
        "db:load:persons-browse:pg",
        "db:load:person-search:pg",
      ]),
    );
  });

  it("covers contract_risk_cache after a company_nkid change with kzk:rejoin, not a contracts reload", () => {
    // company_nkid feeds contract_risk_cache (rebuilders [db:load:pg, kzk:rejoin]).
    // db:load:pg is an unrelated heavy reload here; kzk:rejoin is the only non-heavy
    // rebuilder that actually rebuilds it, and must run AFTER the nkid load.
    const plan = resolveDeploySet(["company_nkid"]);
    expect(plan.objects).toEqual(["contract_risk_cache"]);
    expect(new Set(plan.loaders)).toEqual(
      new Set(["db:load:cr-nkid:pg", "kzk:rejoin"]),
    );
    expect(plan.loaders).not.toContain("db:load:pg");
    expect(before(plan.loaders, "db:load:cr-nkid:pg", "kzk:rejoin")).toBe(true);
  });

  it("is permutation-invariant for two genuinely distinct loaders", () => {
    expect(resolveDeploySet(["contracts", "tenders"])).toEqual(
      resolveDeploySet(["tenders", "contracts"]),
    );
    // duplicates in the input do not change the plan either
    expect(resolveDeploySet(["contracts", "contracts"])).toEqual(
      resolveDeploySet(["contracts"]),
    );
  });

  it("flags a cyclic object graph without looping, and still emits every loader once", () => {
    // Synthetic fixture: A ← x and A ← B, B ← A. `x` dirties A, A dirties B, B
    // dirties A — a la↔lb cycle the topo-sort cannot fully order.
    const cyclicFixture: DerivedObject[] = [
      { name: "A", migration: "t", inputs: ["x", "B"], rebuiltBy: ["la"] },
      { name: "B", migration: "t", inputs: ["A"], rebuiltBy: ["lb"] },
    ];
    const plan = resolveDeploySet(["x"], cyclicFixture);
    expect(plan.cyclic).toBe(true);
    expect(new Set(plan.loaders)).toEqual(new Set(["la", "lb"]));
    expect(plan.loaders.length).toBe(2); // each once, none dropped
  });
});
