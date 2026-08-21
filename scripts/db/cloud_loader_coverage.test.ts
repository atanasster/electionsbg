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
import {
  CLOUD_SKILL_EXEMPTIONS,
  ORCHESTRATOR_EXEMPTIONS,
} from "./cloud_loader_coverage";

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

// The ORCHESTRATOR itself — the skill whose Step 8 is the operator's consolidated
// publish checklist. "Named in some skill" (skillText) is a weaker bar than "named
// HERE": the C1 rollcall gap was named in update-rollcall yet absent from this file,
// so an orchestrated run never emitted it. Read separately for the orchestrator gate.
const orchestratorText = (): string => {
  const p = path.join(ROOT, ".claude/skills/process-watch-report/SKILL.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
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
              // The SHORTHAND form specifically: a `:cloud` used as a suffix
              // MODIFIER on a command named nearby — `# + :cloud`, `(+ \`:cloud\`)`,
              // `pg(:cloud)`, `` + `:cloud` ``. The marker is a `+` or `(`
              // immediately before it. Prose ABOUT the concept ("a `:cloud`
              // loader", "the `:cloud` command") is legitimate and must not trip
              // this, and neither must the documented `db:load:*:cloud` glob — so
              // a line that also names a real script is exempt.
              if (
                /[+(]\s*`?:cloud`?/.test(line) &&
                !/[\w*-]+:cloud\b/.test(line)
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

  it("the exemption list as a WHOLE cannot grow unnoticed", () => {
    // The `unreviewed` count alone does not close the loophole: a new unwired
    // loader silenced as `operator-tool` or `manual-trigger` passes every other
    // assertion here. Pinning the TOTAL means any addition — whatever kind it
    // claims — is a deliberate edit to this number, which is the moment someone
    // reads the reason and decides whether it is true.
    expect(
      Object.keys(CLOUD_SKILL_EXEMPTIONS).length,
      "an exemption was added or removed — if you EXEMPTED a loader, say why in " +
        "CLOUD_SKILL_EXEMPTIONS and raise this number deliberately; if you WIRED " +
        "one, lower it",
    ).toBe(8);
  });

  it("reports the unreviewed backlog so it stays visible", () => {
    const unreviewed = Object.entries(CLOUD_SKILL_EXEMPTIONS)
      .filter(([, v]) => v.kind === "unreviewed")
      .map(([k]) => k);
    // The backlog is now EMPTY: every one of the original 19 has been wired or
    // given a real kind. Keeping the assertion (at zero) rather than deleting it is
    // the point — it is what stops a future loader being parked as `unreviewed`
    // instead of decided.
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
    ).toBe(0);
  });

  // ── The orchestrator gate (cloud-deploy-speed-v1 §v2-b) ──────────────────────
  // The gap C1 exposed: a loader named in its OWN skill but absent from
  // process-watch-report's Step 8, so an orchestrated publish never emits it and
  // prod goes stale even though the coverage check above is green.
  const orchestrator = orchestratorText();

  // Match a script name as a whole TOKEN, not a bare substring: the name must be
  // followed by a non-name char (or end), so a future `:cloud` script that is a
  // prefix of a longer one cannot be masked by the longer one's presence. No such
  // pair exists today (verified across all 76 names), but the boundary makes the
  // invariant explicit rather than incidental.
  const emittedIn = (s: string): boolean =>
    new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w:-])").test(
      orchestrator,
    );

  it("no non-exempt :cloud loader is missing from the ORCHESTRATOR's Step 8", () => {
    expect(orchestrator.length).toBeGreaterThan(10_000); // non-vacuity
    const missing = scripts.filter(
      (s) =>
        !emittedIn(s) &&
        !CLOUD_SKILL_EXEMPTIONS[s] &&
        !ORCHESTRATOR_EXEMPTIONS[s],
    );
    expect(
      missing,
      `These are watcher-triggered PG loaders that an update-* skill runs but ` +
        `process-watch-report's Step 8 never emits, so an ORCHESTRATED publish ` +
        `leaves prod on the previous vintage at a 200 (the C1 rollcall class). ` +
        `Add the command to process-watch-report's Step 8 emit table, or — if its ` +
        `trigger is manual/calendar/build-time, not a daily watcher — add it to ` +
        `ORCHESTRATOR_EXEMPTIONS with a reason.`,
    ).toEqual([]);
  });

  it("no STALE orchestrator-exemption — each still exists and is still absent from the orchestrator", () => {
    const all = new Set(scripts);
    const gone = Object.keys(ORCHESTRATOR_EXEMPTIONS).filter(
      (s) => !all.has(s),
    );
    expect(
      gone,
      "orchestrator-exempted scripts that no longer exist in package.json",
    ).toEqual([]);
    const nowEmitted = Object.keys(ORCHESTRATOR_EXEMPTIONS).filter((s) =>
      emittedIn(s),
    );
    expect(
      nowEmitted,
      "these are now emitted by process-watch-report — remove them from " +
        "ORCHESTRATOR_EXEMPTIONS so the list keeps meaning something",
    ).toEqual([]);
  });

  it("the orchestrator-exemption list cannot grow unnoticed", () => {
    expect(
      Object.keys(ORCHESTRATOR_EXEMPTIONS).length,
      "an orchestrator-exemption was added or removed — if you EXEMPTED a loader, " +
        "say why in ORCHESTRATOR_EXEMPTIONS and raise this number deliberately; if " +
        "you WIRED one into process-watch-report's Step 8, lower it",
    ).toBe(5);
  });

  it("the two exemption maps are DISJOINT — a script is exempt for exactly one reason", () => {
    // A script in both maps has two competing reasons, and lowering one count
    // without the other would silently re-admit it. They answer different
    // questions (no owning skill at all vs. owning skill but not the orchestrator),
    // so no script legitimately belongs to both.
    const both = Object.keys(CLOUD_SKILL_EXEMPTIONS).filter(
      (s) => ORCHESTRATOR_EXEMPTIONS[s],
    );
    expect(
      both,
      "these are in BOTH exemption maps — pick one: CLOUD_SKILL_EXEMPTIONS if no " +
        "skill names it, ORCHESTRATOR_EXEMPTIONS if a skill does but the orchestrator " +
        "does not",
    ).toEqual([]);
  });
});
