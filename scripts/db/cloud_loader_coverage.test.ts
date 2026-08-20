// A `:cloud` script is how a corpus reaches PRODUCTION and nothing runs it
// automatically. If no skill names it, a watcher firing leads to a local
// re-ingest, a commit, and prod quietly serving the previous vintage at a 200.
//
// This gate fails when a NEW one lands unwired. It also fails on a STALE
// exemption — a script that has since been wired, or one that no longer exists —
// so the allowlist cannot rot into a blanket pass.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CLOUD_SKILL_EXEMPTIONS } from "./cloud_loader_coverage";

const ROOT = path.resolve(__dirname, "../..");

const cloudScripts = (): string[] => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  return Object.keys(pkg.scripts).filter((k) => k.endsWith(":cloud"));
};

const skillText = (): string => {
  const dir = path.join(ROOT, ".claude/skills");
  if (!fs.existsSync(dir)) return "";
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out.join("\n");
};

describe("every :cloud loader is reachable from a skill", () => {
  const scripts = cloudScripts();
  const skills = skillText();
  const named = new Set(scripts.filter((s) => skills.includes(s)));

  it("finds the scripts and the skills at all (non-vacuity)", () => {
    expect(scripts.length).toBeGreaterThan(50);
    expect(skills.length).toBeGreaterThan(10_000);
    expect(named.size).toBeGreaterThan(30);
  });

  it("no UNWIRED :cloud script outside the exemption list", () => {
    const unwired = scripts.filter(
      (s) => !named.has(s) && !CLOUD_SKILL_EXEMPTIONS[s],
    );
    expect(
      unwired,
      `These publish a corpus to production and no skill names them, so a watcher ` +
        `firing would leave prod on the previous vintage at a 200. Add the command ` +
        `to the owning update-* skill (and to the process-watch-report mapping row ` +
        `for its watcher), or add it to CLOUD_SKILL_EXEMPTIONS with a reason.`,
    ).toEqual([]);
  });

  it("no STALE exemption — every exempted script still exists and is still unwired", () => {
    const all = new Set(scripts);
    const gone = Object.keys(CLOUD_SKILL_EXEMPTIONS).filter((s) => !all.has(s));
    expect(
      gone,
      "exempted scripts that no longer exist in package.json",
    ).toEqual([]);
    const nowWired = Object.keys(CLOUD_SKILL_EXEMPTIONS).filter((s) =>
      named.has(s),
    );
    expect(
      nowWired,
      "these are now named in a skill — remove them from CLOUD_SKILL_EXEMPTIONS " +
        "so the list keeps meaning something",
    ).toEqual([]);
  });

  it("no skill refers to a :cloud command by SHORTHAND instead of naming it", () => {
    // The regression this tier fixed: `# + :cloud`, `(+ :cloud)`, `(+ \`:cloud\` to
    // publish)` all read fine to a human, leave the operator without a runnable
    // command, and are invisible to the literal match above — so the gate passed while
    // four publishes were unreachable. Catch the pattern itself, not just its effects.
    const dir = path.join(ROOT, ".claude/skills");
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.name.endsWith(".md")) {
          fs.readFileSync(fp, "utf8")
            .split("\n")
            .forEach((line, i) => {
              // a bare `:cloud` mention NOT preceded by a real script name on that line
              if (
                /[(#]\s*\+?\s*`?:cloud`?/.test(line) &&
                !/[\w-]+:cloud\b/.test(line)
              )
                offenders.push(
                  `${path.relative(ROOT, fp)}:${i + 1}  ${line.trim()}`,
                );
            });
        }
      }
    };
    if (fs.existsSync(dir)) walk(dir);
    expect(
      offenders,
      "write the command out in full — a shorthand leaves the operator without " +
        "something to run and does not register with the coverage check above",
    ).toEqual([]);
  });

  it("reports the unreviewed backlog so it stays visible", () => {
    const unreviewed = Object.entries(CLOUD_SKILL_EXEMPTIONS)
      .filter(([, v]) => v.kind === "unreviewed")
      .map(([k]) => k);
    // Not an assertion that it is empty — it is pre-existing debt. This prints it
    // so it cannot quietly become permanent, and fails only if it GROWS.
    console.warn(
      `cloud_loader_coverage: ${unreviewed.length} unreviewed :cloud loader(s) ` +
        `with no owning skill — pre-existing debt: ${unreviewed.join(", ")}`,
    );
    // EXACT, not `<=`. A ceiling ratchets in one direction only: wire three loaders
    // and the count silently drops to 12 with 3 slack, which the next unwired loader
    // then occupies for free. Equality forces the number down in the same commit that
    // earns it — the failure message says which way to move it.
    expect(
      unreviewed.length,
      "the unreviewed backlog changed — if you WIRED one, lower this number in the " +
        "same commit; if this grew, a new loader landed unwired",
    ).toBe(14);
  });
});
