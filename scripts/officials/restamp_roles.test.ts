// The restamp's guards. Every one of them exists because its failure is SILENT — an empty or
// stale join reports `0 role change(s)`, which reads as "nothing to fix" rather than "nothing
// was checked". The row source is injected so all of this runs without Postgres.
// Plan: docs/plans/officials-roster-missing-mayor-v1.md (T2).

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { restampRoles, type FiledSource } from "./restamp_roles";
import type { MunicipalIndexFile } from "../../src/data/dataTypes";

const tmp: string[] = [];
afterEach(() => {
  while (tmp.length) fs.rmSync(tmp.pop()!, { force: true });
});

const writeIndex = (entries: unknown[]): string => {
  const f = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "restamp-")),
    "index.json",
  );
  tmp.push(f);
  fs.writeFileSync(
    f,
    JSON.stringify({
      generatedAt: "2026-01-01T00:00:00.000Z",
      years: [2026],
      total: entries.length,
      byRole: {},
      current: { year: 2026, total: entries.length, byRole: {} },
      entries,
    }),
  );
  return f;
};

const row = (over: Record<string, unknown> = {}) => ({
  slug: "a-1",
  name: "Иван Иванов",
  normalizedName: "ИВАН ИВАНОВ",
  role: "deputy_mayor",
  roleRaw: "Заместник кмет",
  municipality: "Мъглиж",
  latestDeclarationYear: 2026,
  descriptorYear: 2026,
  ...over,
});

const source =
  (
    rows: Parameters<FiledSource>[0] extends never ? never : unknown[],
  ): FiledSource =>
  async () =>
    rows as never;

const read = (f: string): MunicipalIndexFile =>
  JSON.parse(fs.readFileSync(f, "utf8"));

describe("restampRoles", () => {
  it("promotes a mislabelled mayor and recomputes both tallies", async () => {
    const f = writeIndex([
      row(),
      row({ slug: "b-2", role: "councillor", roleRaw: "Общински съветник" }),
    ]);
    const n = await restampRoles(true, false, {
      indexPath: f,
      source: source([
        {
          subject_ref: "a-1",
          filed_position: "Кмет на Община Мъглиж",
          filed_institution: "Община Мъглиж",
        },
        {
          subject_ref: "b-2",
          filed_position: "Общински съветник",
          filed_institution: "Община Мъглиж",
        },
      ]),
    });
    expect(n).toBe(1);
    const out = read(f);
    expect(out.entries[0]!.role).toBe("mayor");
    expect(out.entries[1]!.role).toBe("councillor");
    // Seeded, so a zero bucket survives and the key order is canonical.
    expect(out.byRole.other).toBe(0);
    expect(out.byRole.mayor).toBe(1);
    expect(out.current!.byRole.mayor).toBe(1);
    // The content moved, so the stamp must have too.
    expect(out.generatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("a dry run reports the flip and leaves the file byte-identical", async () => {
    const f = writeIndex([row()]);
    const before = fs.readFileSync(f, "utf8");
    const n = await restampRoles(false, false, {
      indexPath: f,
      source: source([
        {
          subject_ref: "a-1",
          filed_position: "Кмет",
          filed_institution: "Община Мъглиж",
        },
      ]),
    });
    expect(n).toBe(1);
    expect(fs.readFileSync(f, "utf8")).toBe(before);
  });

  // ⚠️ The guard the file argues for at length: an empty join is a database that has not
  // loaded the declarations, which is indistinguishable from "nothing to correct" in the
  // output but is the opposite state.
  it("refuses an empty join instead of reporting a clean run", async () => {
    const f = writeIndex([row()]);
    await expect(
      restampRoles(true, false, { indexPath: f, source: source([]) }),
    ).rejects.toThrow(/no muni-tier declarations/);
  });

  // The same reasoning, one step along: a join that is merely POOR means the shard tree and
  // Postgres are different vintages, and the rows that did not join were never checked.
  it("refuses when fewer than 95% of rows join a filing", async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      row({ slug: `s-${i}` }),
    );
    const f = writeIndex(entries);
    await expect(
      restampRoles(true, false, {
        indexPath: f,
        source: source([
          {
            subject_ref: "s-0",
            filed_position: "Кмет",
            filed_institution: "Община Мъглиж",
          },
        ]),
      }),
    ).rejects.toThrow(/different vintages/);
  });

  it("--allow-partial accepts the gap deliberately", async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      row({ slug: `s-${i}` }),
    );
    const f = writeIndex(entries);
    const n = await restampRoles(true, true, {
      indexPath: f,
      source: source([
        {
          subject_ref: "s-0",
          filed_position: "Кмет",
          filed_institution: "Община Мъглиж",
        },
      ]),
    });
    expect(n).toBe(1);
  });

  // ⚠️ CONVERGENCE, NOT LATCHING. The second run must re-derive the listing role from
  // `roleRaw` and reach the same answer — not skip because the stored role already says
  // mayor. The difference only shows when the rule is later narrowed, which is exactly when
  // nobody is watching.
  it("is idempotent by re-deriving, so a narrowed rule would un-promote", async () => {
    const f = writeIndex([row()]);
    const filings = source([
      {
        subject_ref: "a-1",
        filed_position: "Кмет",
        filed_institution: "Община Мъглиж",
      },
    ]);
    expect(
      await restampRoles(true, false, { indexPath: f, source: filings }),
    ).toBe(1);
    expect(
      await restampRoles(true, false, { indexPath: f, source: filings }),
    ).toBe(0);

    // Now withdraw the corroboration — a re-run must put the row back, which a latching
    // implementation cannot do because it would read the stored `mayor` and short-circuit.
    const withdrawn = source([
      {
        subject_ref: "a-1",
        filed_position: "Кмет",
        filed_institution: "Кметство Габра",
      },
    ]);
    expect(
      await restampRoles(true, false, { indexPath: f, source: withdrawn }),
    ).toBe(1);
    expect(read(f).entries[0]!.role).toBe("deputy_mayor");
  });
});
