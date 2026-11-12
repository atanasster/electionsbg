import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HANDLERS, UNROUTED } from "./index";
import { POST_STEPS } from "./post_steps";
import {
  applySkillPointer,
  INDEX_PATH,
  POINTER_END,
  POINTER_START,
  removeSkillPointer,
  renderHandlerIndex,
  renderSkillPointer,
} from "./handler_index";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("docs/pipeline-handlers.md", () => {
  it("is the registry as rendered now — regenerate with pnpm run pipeline:index", () => {
    const have = fs.readFileSync(path.join(REPO, INDEX_PATH), "utf8");
    expect(have).toBe(renderHandlerIndex(HANDLERS, UNROUTED, POST_STEPS));
  });

  it("names every handler, source, follow-up and post-step", () => {
    const md = renderHandlerIndex(HANDLERS, UNROUTED, POST_STEPS);
    for (const p of POST_STEPS) expect(md).toContain(`\`${p.id}\``);
    for (const h of HANDLERS)
      for (const f of h.followUps ?? []) expect(md).toContain(`#post-${f}`);
    for (const h of HANDLERS) {
      expect(md).toContain(`### \`${h.id}\``);
      for (const s of h.sources) expect(md).toContain(`\`${s}\``);
    }
  });

  it("escapes a pipe so a command cannot break the table", () => {
    const md = renderHandlerIndex(
      [
        {
          id: "x",
          runner: "script",
          sources: ["s"],
          changelog: "none",
          steps: [{ id: "a", phase: "ingest", run: "a | b" }],
        },
      ],
      {},
    );
    expect(md).toContain("`a \\| b`");
  });
});

describe("runbook pointers", () => {
  it("every runbook a handler names carries its current pointer block", () => {
    const skills = [...new Set(HANDLERS.flatMap((h) => h.skill ?? []))];
    expect(skills.length).toBeGreaterThan(20);
    const stale = skills.filter((skill) => {
      const text = fs.readFileSync(
        path.join(REPO, ".claude/skills", skill, "SKILL.md"),
        "utf8",
      );
      return (
        applySkillPointer(text, renderSkillPointer(HANDLERS, skill)!) !== text
      );
    });
    expect(stale, "run: pnpm run pipeline:index").toEqual([]);
  });

  it("inserts under the first heading, then replaces in place", () => {
    const text = "---\nname: x\n---\n\n# Title\n\nBody\n";
    const once = applySkillPointer(text, `${POINTER_START}\nA\n${POINTER_END}`);
    expect(once).toBe(
      `---\nname: x\n---\n\n# Title\n\n${POINTER_START}\nA\n${POINTER_END}\n\nBody\n`,
    );
    const twice = applySkillPointer(
      once,
      `${POINTER_START}\nB\n${POINTER_END}`,
    );
    expect(twice).toBe(once.replace("\nA\n", "\nB\n"));
    expect(removeSkillPointer(twice)).toBe(text);
  });

  it("no runbook outside the registry carries a pointer block", () => {
    const named = new Set(HANDLERS.flatMap((h) => h.skill ?? []));
    const dir = path.join(REPO, ".claude/skills");
    const orphans = fs.readdirSync(dir).filter((skill) => {
      if (named.has(skill)) return false;
      try {
        return fs
          .readFileSync(path.join(dir, skill, "SKILL.md"), "utf8")
          .includes(POINTER_START);
      } catch {
        return false;
      }
    });
    expect(orphans, "run: pnpm run pipeline:index").toEqual([]);
  });

  it("marks a conditional cloud command with its sources", () => {
    const md = renderHandlerIndex(
      [
        {
          id: "x",
          runner: "script",
          sources: ["a", "b"],
          changelog: "none",
          steps: [],
          publish: {
            cloud: [
              "pnpm run db:load:x:pg:cloud",
              { run: "pnpm run db:load:y:pg:cloud", on: ["b"] },
            ],
          },
        },
      ],
      {},
    );
    expect(md).toContain(
      "- cloud (global order applies): `pnpm run db:load:x:pg:cloud`",
    );
    expect(md).toContain("- cloud, only on `b`: `pnpm run db:load:y:pg:cloud`");
  });

  it("says delegated for a skill-runner handler", () => {
    const b = renderSkillPointer(
      [
        {
          id: "h",
          skill: "s",
          runner: "skill",
          sources: [],
          steps: [],
          changelog: "none",
        },
      ],
      "s",
    );
    expect(b).toMatch(/still \*\*delegated\*\*/);
    expect(
      renderSkillPointer(
        [
          {
            id: "h",
            skill: "s",
            runner: "operator",
            sources: [],
            steps: [],
            changelog: "none",
          },
        ],
        "s",
      ),
    ).toMatch(/human-only/);
    expect(renderSkillPointer([], "s")).toBeNull();
  });
});
