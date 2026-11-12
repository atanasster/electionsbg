import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Plan, PlanEntry } from "./planner";
import { ingest } from "./registry/build";
import type { Handler } from "./registry/types";
import {
  compare,
  labelsOf,
  parseCatFileBatch,
  readSessions,
  renderShadow,
  sessionIdTime,
  sessionStart,
  type PerfRow,
} from "./shadow";

const H = (over: Partial<Handler> & { id: string }): Handler => ({
  runner: "script",
  sources: [],
  steps: [ingest("a", "pnpm run a")],
  changelog: "none",
  ...over,
});

const entry = (
  handler: string,
  status: PlanEntry["status"],
  why?: string,
): PlanEntry => ({ handler, status, why }) as PlanEntry;

const planOf = (...entries: PlanEntry[]): Plan => ({
  schema: 1,
  generatedAt: "2026-11-01T00:00:00Z",
  bootstrap: "run",
  entries,
  followUps: [],
  cloud: [],
  unrouted: [],
  warnings: [],
});

const row = (step: string, status = "ok", phase = "ingest"): PerfRow => ({
  session: "s",
  step,
  phase,
  status,
  startedAt: "2026-11-01T00:00:00Z",
});

describe("compare", () => {
  const handlers = [
    H({ id: "update-macro", skill: "update-macro" }),
    H({ id: "kzk_appeals", skill: "update-kzk-appeals" }),
    H({ id: "kzk_decisions", skill: "update-kzk-appeals" }),
    H({ id: "update-agri", skill: "update-agri" }),
    H({ id: "update-defense", skill: "update-defense" }),
    H({ id: "eurostat_rail" }),
  ];

  it("splits agreement, planned-only and run-only at runbook granularity", () => {
    const p = planOf(
      entry("update-macro", "run"),
      entry("kzk_appeals", "run"),
      entry("kzk_decisions", "run"),
      entry("update-agri", "run"),
    );
    const rows = [
      row("update-macro"),
      row("update-kzk-appeals"),
      row("eurostat_rail"),
      row("pnpm run db:refresh", "ok", "derive"),
    ];
    const r = compare("s", "t", "sha", p, rows, handlers);
    expect(r.planned).toEqual([
      "update-macro",
      "update-kzk-appeals",
      "update-agri",
    ]);
    expect(r.agree).toEqual(["update-macro", "update-kzk-appeals"]);
    expect(r.plannedOnly).toEqual(["update-agri"]);
    expect(r.ranOnly).toEqual(["eurostat_rail"]);
  });

  it("does not count a planned runbook the LLM only skipped as agreement", () => {
    const r = compare(
      "s",
      "t",
      "sha",
      planOf(entry("update-macro", "run"), entry("update-agri", "run")),
      [row("update-macro", "skipped"), row("update-agri", "error")],
      handlers,
    );
    // An error is still an attempt: the LLM queued it, as the planner did.
    expect(r.agree).toEqual(["update-agri"]);
    expect(r.plannedOnly).toEqual(["update-macro"]);
  });

  it("reports held-back entries separately from disagreement", () => {
    const p = planOf(entry("update-defense", "needs-operator", "read the PDF"));
    const r = compare(
      "s",
      "t",
      "sha",
      p,
      [row("update-defense", "skipped")],
      handlers,
    );
    expect(r.planned).toEqual([]);
    expect(r.heldBack).toEqual([
      {
        label: "update-defense",
        status: "needs-operator",
        why: "read the PDF",
      },
    ]);
    // Held by the planner and only `skipped` by the LLM: agreement, not a diff.
    expect(r.ranOnly).toEqual([]);
    expect(r.bothHeld).toEqual(["update-defense"]);
    expect(renderShadow(r)).toMatch(
      /held back: update-defense \[needs-operator\] — read the PDF/,
    );
  });

  it("credits a row by command only to the single handler owning that ingest", () => {
    const hs = [
      H({
        id: "eurostat_tourism",
        steps: [ingest("t", "pnpm exec tsx scripts/t.ts")],
      }),
      H({ id: "a", steps: [ingest("x", "pnpm run shared")] }),
      H({ id: "b", steps: [ingest("x", "pnpm run shared")] }),
    ];
    const r = compare(
      "s",
      "t",
      "sha",
      planOf(entry("eurostat_tourism", "run")),
      [
        {
          ...row("eurostat_tourism fetch", "ok", "derive"),
          command: "pnpm exec tsx scripts/t.ts --x",
        },
        { ...row("shared", "ok", "derive"), command: "pnpm run shared" },
        {
          ...row("other", "ok", "derive"),
          command: "pnpm exec tsx scripts/t.tsv",
        },
      ],
      hs,
    );
    expect(r.ran).toEqual([{ label: "eurostat_tourism", status: "ok" }]);
    expect(r.agree).toEqual(["eurostat_tourism"]);
  });

  it("ignores rows that are not a known handler's ingest", () => {
    const r = compare(
      "s",
      "t",
      "sha",
      planOf(),
      [row("myarea:alerts", "ok", "derive"), row("something-else")],
      handlers,
    );
    expect(r.ran).toEqual([]);
  });

  it("labels a handler by runbook, id and marker", () => {
    expect(
      labelsOf(
        H({
          id: "update-local-elections",
          marker: "cik_local",
          skill: "update-local-elections",
        }),
      ),
    ).toEqual(["update-local-elections", "cik_local"]);
  });
});

describe("parseCatFileBatch", () => {
  it("walks by bytes, so Cyrillic content does not shift later objects", () => {
    const a = '{"detail":"Народно събрание"}';
    const b = '{"x":1}';
    const raw = Buffer.concat([
      Buffer.from(`oid1 blob ${Buffer.byteLength(a)}\n`),
      Buffer.from(a),
      Buffer.from("\n"),
      Buffer.from("x:missing.json missing\n"),
      Buffer.from(`oid2 blob ${Buffer.byteLength(b)}\n`),
      Buffer.from(b),
      Buffer.from("\n"),
    ]);
    expect(
      parseCatFileBatch(raw, ["a.json", "missing.json", "b.json"]),
    ).toEqual([
      ["a.json", a],
      ["b.json", b],
    ]);
  });
});

describe("readSessions", () => {
  it("groups rows by session in file order", () => {
    const f = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "shadow-")),
      "p.jsonl",
    );
    fs.writeFileSync(
      f,
      [
        { session: "a", step: "x", status: "ok", startedAt: "t" },
        { session: "b", step: "y", status: "ok", startedAt: "t" },
        { session: "a", step: "z", status: "ok", startedAt: "t" },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    const s = readSessions(f);
    expect([...s.keys()]).toEqual(["a", "b"]);
    expect(s.get("a")?.map((r) => r.step)).toEqual(["x", "z"]);
  });
});

describe("sessionStart", () => {
  it("parses the session id's mint time", () => {
    expect(sessionIdTime("20261108T225046Z-471d")).toBe("2026-11-08T22:50:46Z");
    expect(sessionIdTime("unknown")).toBeNull();
  });

  it("takes the earlier of the id time and the first row", () => {
    const later = { ...row("x"), startedAt: "2026-11-08T22:51:28.006Z" };
    expect(sessionStart("20261108T225046Z-471d", [later])).toBe(
      "2026-11-08T22:50:46Z",
    );
    const earlier = { ...row("x"), startedAt: "2026-11-08T00:01:22.000Z" };
    expect(sessionStart("20261108T000126Z-6855", [earlier])).toBe(
      "2026-11-08T00:01:22.000Z",
    );
    expect(sessionStart("nodate", [])).toBeUndefined();
  });
});
