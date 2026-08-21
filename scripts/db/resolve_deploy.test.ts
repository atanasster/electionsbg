// Tests for the resolver-driven deploy emission CLI (cloud-deploy-speed-v1 §v2-e).
// Pure — injects the npm-script set, no Postgres, runs in test:unit.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deployCommands, cloudScripts, parseChanged } from "./resolve_deploy";

const ROOT = path.resolve(__dirname, "../..");
const realScripts = new Set(
  Object.keys(
    (
      JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts,
  ),
);

describe("deployCommands", () => {
  it("emits ordered :cloud commands for the loaders the resolver selected", () => {
    const { commands } = deployCommands(["contracts"], realScripts);
    expect(commands).toEqual(
      expect.arrayContaining([
        "npm run db:load:pg:cloud",
        "npm run db:load:graph:pg:cloud",
        "npm run db:load:persons-browse:pg:cloud",
        "npm run db:load:person-search:pg:cloud",
      ]),
    );
    // dependency order carries through from the resolver
    const i = (s: string): number => commands.indexOf(s);
    expect(i("npm run db:load:pg:cloud")).toBeLessThan(
      i("npm run db:load:graph:pg:cloud"),
    );
    expect(i("npm run db:load:persons-browse:pg:cloud")).toBeLessThan(
      i("npm run db:load:person-search:pg:cloud"),
    );
    // every command names a real :cloud npm script (ignoring any `-- --flag` suffix)
    for (const c of commands) {
      const script = c.replace(/^npm run /, "").split(" ")[0];
      expect(realScripts.has(script), `${script} is a real npm script`).toBe(
        true,
      );
    }
  });

  it("routes the committed-artifact generators to a bucket:sync note, not a :cloud command", () => {
    // contracts also stales hub_stats.json / sector_stats.json, whose generators
    // (db:gen-hub-stats / db:gen-sector-stats) have NO :cloud publish.
    const { commands, notes } = deployCommands(["contracts"], realScripts);
    expect(commands).not.toContain("npm run db:gen-hub-stats:cloud");
    expect(commands.some((c) => c.includes("db:gen"))).toBe(false);
    expect(notes.some((n) => n.includes("db:gen-hub-stats"))).toBe(true);
    expect(notes.some((n) => n.includes("bucket:sync"))).toBe(true);
  });

  it("bakes in a mandatory flag so an emitted command is not a silent no-op", () => {
    // kzk:rejoin:cloud is a dry-run without `-- --apply`; a bare emission would
    // publish nothing. The downstream of a kzk_appeals change must carry the flag.
    const { commands, notes } = deployCommands(["kzk_appeals"], realScripts);
    expect(commands).toContain("npm run kzk:rejoin:cloud -- --apply");
    expect(commands).not.toContain("npm run kzk:rejoin:cloud");
    expect(notes.some((n) => n.includes("kzk_appeals"))).toBe(true);
  });

  it("emits the funds scope flag and its verify-scope advisory", () => {
    // db:load:funds:pg:cloud EXITS 1 without a scope flag (F53/F34).
    const { commands, notes } = deployCommands(
      ["fund_beneficiaries"],
      realScripts,
    );
    expect(commands).toContain("npm run db:load:funds:pg:cloud -- --full");
    expect(notes.some((n) => n.includes("--payloads-only"))).toBe(true);
  });

  it("emits no publish command for a change no served object depends on", () => {
    const { commands, notes } = deployCommands(
      ["price_last_seen"],
      realScripts,
    );
    // price_last_seen has no derived downstream and no base loader in the registry,
    // so there is nothing to publish — but an advisory names it (published by its
    // own skill), which the "emits nothing" phrasing must not deny.
    expect(commands).toEqual([]);
    expect(notes.some((n) => n.includes("price_last_seen"))).toBe(true);
  });

  it("parseChanged drops -flags and keeps table names", () => {
    expect(parseChanged(["contracts", "--dry", "tenders", "-x"])).toEqual([
      "contracts",
      "tenders",
    ]);
    expect(parseChanged([])).toEqual([]);
    expect(parseChanged(["--only-flags"])).toEqual([]);
  });

  it("never emits a duplicate command", () => {
    const { commands } = deployCommands(
      ["contracts", "tr_companies"],
      realScripts,
    );
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("cloudScripts() reads the real package.json and finds the known loaders", () => {
    const s = cloudScripts();
    expect(s.has("db:load:pg:cloud")).toBe(true);
    expect(s.size).toBeGreaterThan(50);
  });
});
