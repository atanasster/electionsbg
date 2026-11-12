// The handler index: the registry rendered as one markdown page
// (docs/pipeline-handlers.md), so a skill can point at "the registry entry"
// instead of restating its commands. Generated, never hand-edited —
// handler_index.test.ts fails when the committed page drifts.
// Plan: docs/plans/watch-pipeline-scripts-v1.md, Tier 6.

import { orderCloud } from "./cloud_order";
import type { PostStep } from "./post_steps";
import { markerOf, type Handler } from "./types";

export const INDEX_PATH = "docs/pipeline-handlers.md";

const cell = (v: string): string =>
  v.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const code = (v: string): string => "`" + cell(v).replace(/`/g, "'") + "`";
const list = (xs: readonly string[]): string =>
  xs.length ? xs.map(code).join(", ") : "—";
const anchorOf = (id: string): string =>
  id.toLowerCase().replace(/[^a-z0-9_-]/g, "");

/** A cloud command built at run time: name the script it runs, from the
 *  function's own source, and mark the arguments as derived. */
const derivedCommand = (fn: (...a: never[]) => string): string => {
  const m = String(fn).match(/pnpm run ([\w:.-]+)/);
  return m
    ? `pnpm run ${m[1]} (args derived from the run)`
    : "(derived from the run)";
};

const RUNNER_NOTE: Record<Handler["runner"], string> = {
  script: "runs unattended under `pipeline:ingest`",
  skill: "delegated — `pipeline:ingest` lists it under **Needs agent**",
  operator: "human-only — nothing runs until an operator acts and acks",
};

const renderHandler = (h: Handler): string => {
  const out: string[] = [];
  out.push(`### \`${h.id}\``);
  out.push("");
  out.push(`- **Runner:** ${h.runner} — ${RUNNER_NOTE[h.runner]}`);
  if (h.skill)
    out.push(`- **Runbook:** \`.claude/skills/${h.skill}/SKILL.md\``);
  out.push(`- **Marker:** \`state/ingest/${markerOf(h)}.json\``);
  out.push(`- **Sources:** ${list(h.sources)}`);
  if (h.needs?.length) out.push(`- **Needs:** ${list(h.needs)}`);
  if (h.after?.length) out.push(`- **After:** ${list(h.after)}`);
  out.push(`- **Changelog:** ${h.changelog}`);
  if (h.followUps?.length)
    out.push(
      `- **Follow-ups:** ${h.followUps.map((f) => `[${code(f)}](#post-${anchorOf(f)})`).join(", ")}`,
    );
  if (h.gates?.length)
    out.push(`- **Gates:** ${list(h.gates.map((g) => g.id))}`);
  if (h.steps.length) {
    out.push("");
    out.push("| step | phase | command | only on |");
    out.push("| --- | --- | --- | --- |");
    for (const s of h.steps)
      out.push(
        `| ${code(s.id)} | ${s.phase} | ${code(s.run)}${s.args ? " _+ scoped args_" : ""} | ${s.on?.length ? list(s.on) : "—"} |`,
      );
  }
  if (h.operator?.length) {
    out.push("");
    out.push("**Operator steps:**");
    for (const o of h.operator)
      out.push(
        `- ${code(o.id)} (blocks ${o.blocks}${o.done ? ", file done-check" : ""}${o.on?.length ? `, only on ${list(o.on)}` : ""}): ${cell(o.instruction)}` +
          (o.url ? ` URL: ${code(o.url)}.` : "") +
          (o.dropDir ? ` Drop into ${code(o.dropDir)}.` : ""),
      );
  }
  if (h.agent?.length) {
    out.push("");
    out.push("**Agent steps:**");
    for (const a of h.agent)
      out.push(`- ${code(a.id)}: ${cell(a.instruction)} (see ${code(a.doc)})`);
  }
  const p = h.publish;
  if (p && (p.paths?.length || p.cloud?.length)) {
    out.push("");
    out.push("**Publish:**");
    if (p.paths?.length) out.push(`- bucket: ${list(p.paths)}`);
    // Unconditional commands in the global order; conditional ones after,
    // each with the sources that require it.
    const always = (p.cloud ?? []).flatMap((c) =>
      typeof c === "string"
        ? [c]
        : c.on?.length
          ? []
          : [typeof c.run === "string" ? c.run : derivedCommand(c.run)],
    );
    if (always.length)
      out.push(`- cloud (global order applies): ${list(orderCloud(always))}`);
    for (const c of p.cloud ?? [])
      if (typeof c !== "string" && c.on?.length)
        out.push(
          `- cloud, only on ${list(c.on)}: ${code(typeof c.run === "string" ? c.run : derivedCommand(c.run))}`,
        );
  }
  if (h.never?.length) {
    out.push("");
    out.push("**Never:**");
    for (const n of h.never) out.push(`- ${cell(n)}`);
  }
  if (h.knownFailures?.length) {
    out.push("");
    out.push("**Known failures:**");
    for (const k of h.knownFailures)
      out.push(`- ${code(String(k.match))}: ${cell(k.advice)}`);
  }
  return out.join("\n");
};

const renderPostStep = (p: PostStep): string => {
  const out = [`### <a id="post-${anchorOf(p.id)}"></a>\`${p.id}\``, ""];
  out.push(
    `- **When:** ${p.when === "always" ? "every ingest run that ran a handler" : "when a handler lists it as a follow-up"}`,
  );
  if (p.skipWhen?.length)
    out.push(`- **Skipped when moved:** ${list(p.skipWhen)}`);
  if (p.needs?.length) out.push(`- **Needs:** ${list(p.needs)}`);
  for (const s of p.steps) out.push(`- step ${code(s.id)}: ${code(s.run)}`);
  if (p.publish?.paths?.length) out.push(`- bucket: ${list(p.publish.paths)}`);
  if (p.publish?.cloud?.length)
    out.push(`- cloud: ${list(orderCloud(p.publish.cloud))}`);
  return out.join("\n");
};

export const renderHandlerIndex = (
  handlers: readonly Handler[],
  unrouted: Readonly<Record<string, string>>,
  postSteps: readonly PostStep[] = [],
): string => {
  const sorted = [...handlers].sort((a, b) => a.id.localeCompare(b.id));
  const count = (r: Handler["runner"]) =>
    sorted.filter((h) => h.runner === r).length;
  const out: string[] = [
    "# Pipeline handlers",
    "",
    "<!-- GENERATED by `pnpm run pipeline:index` from scripts/pipeline/registry/ — do not edit. -->",
    "",
    "Every watcher source and what runs when it moves. The registry is the source of",
    "truth; a skill's runbook covers only what a script cannot do (operator and agent",
    "steps, troubleshooting). Run it all with `pnpm run pipeline:nightly`; see",
    "`docs/plans/watch-pipeline-scripts-v1.md` for how.",
    "",
    `${sorted.length} handlers: ${count("script")} script, ${count("skill")} delegated to an agent, ${count("operator")} operator-only.`,
    "",
    "| handler | runner | sources |",
    "| --- | --- | --- |",
    ...sorted.map(
      (h) =>
        `| [\`${h.id}\`](#${anchorOf(h.id)}) | ${h.runner} | ${list(h.sources)} |`,
    ),
    "",
  ];
  const un = Object.entries(unrouted).sort(([a], [b]) => a.localeCompare(b));
  if (un.length) {
    out.push("## Unrouted sources", "");
    for (const [id, why] of un) out.push(`- ${code(id)}: ${cell(why)}`);
    out.push("");
  }
  out.push("## Handlers", "");
  for (const h of sorted) out.push(renderHandler(h), "");
  if (postSteps.length) {
    out.push(
      "## Post-steps",
      "",
      "Run after the handlers, in this order (scripts/pipeline/registry/post_steps.ts).",
      "",
    );
    for (const p of postSteps) out.push(renderPostStep(p), "");
  }
  return out.join("\n").replace(/\n+$/, "\n");
};

// ── Skill pointers ──────────────────────────────────────────────────────────
// Each runbook a handler names carries a short generated block saying which
// handler runs it and whether it is unattended or still delegated, so a reader
// of the skill lands on the registry entry instead of re-deriving it.

export const POINTER_START =
  "<!-- pipeline-pointer:start (generated from the registry; edit scripts/pipeline/registry) -->";
export const POINTER_END = "<!-- pipeline-pointer:end -->";

/** The block for one skill, or null when no handler names it. */
export const renderSkillPointer = (
  handlers: readonly Handler[],
  skill: string,
): string | null => {
  const hs = handlers.filter((h) => h.skill === skill);
  if (!hs.length) return null;
  const lines = hs.map((h) => {
    const link = `[\`${h.id}\`](../../../${INDEX_PATH}#${anchorOf(h.id)})`;
    if (h.runner === "script")
      return (
        `> **Pipeline:** handler ${link} runs this unattended — \`pnpm run pipeline:ingest --only ${h.id}\`. ` +
        "The registry holds its commands, gates and publish set; this runbook covers what a script " +
        "cannot do (operator steps, judgement calls, troubleshooting). When a step fails, start from " +
        "the repair packet the run writes, not from the procedure below."
      );
    if (h.runner === "operator")
      return (
        `> **Pipeline:** handler ${link} is **human-only** — \`pipeline:ingest\` lists its items under ` +
        "*Needs operator*; after acting, run `pnpm run pipeline:ack`."
      );
    return (
      `> **Pipeline:** handler ${link} is still **delegated** — \`pipeline:ingest\` lists it under ` +
      "*Needs agent*; why is a comment on its entry in `scripts/pipeline/registry/handlers/`. " +
      "Follow this runbook to run it."
    );
  });
  return `${POINTER_START}\n${lines.join("\n>\n")}\n${POINTER_END}`;
};

/** `text` with its pointer block replaced, or inserted under the first
 *  heading after the frontmatter. */
export const applySkillPointer = (text: string, block: string): string => {
  const i = text.indexOf(POINTER_START);
  if (i >= 0) {
    const j = text.indexOf(POINTER_END, i);
    if (j < 0) throw new Error("pipeline-pointer:start without an end marker");
    return text.slice(0, i) + block + text.slice(j + POINTER_END.length);
  }
  const fm = /^---\n[\s\S]*?\n---\n/.exec(text);
  const at = fm ? fm[0].length : 0;
  const rest = text.slice(at);
  const h1 = /^# .*\n/m.exec(rest);
  const cut = h1 && h1.index < 400 ? at + h1.index + h1[0].length : at;
  return `${text.slice(0, cut)}\n${block}\n${text.slice(cut)}`;
};

/** `text` with its pointer block (and the blank line before it) removed —
 *  for a runbook no handler names any more. */
export const removeSkillPointer = (text: string): string => {
  const i = text.indexOf(POINTER_START);
  if (i < 0) return text;
  const j = text.indexOf(POINTER_END, i);
  if (j < 0) throw new Error("pipeline-pointer:start without an end marker");
  const before = text.slice(0, i).replace(/\n$/, "");
  const after = text.slice(j + POINTER_END.length).replace(/^\n/, "");
  return `${before}${after.startsWith("\n") ? "" : "\n"}${after}`;
};
