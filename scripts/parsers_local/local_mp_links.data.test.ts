// Every `mpId` stamped on a local-election candidate row names an MP whose full name
// is IDENTICAL to the candidate's, has at least two tokens, and belongs to that MP alone.
//
// The decorator used to fall back to first+last, which drops the patronymic: 11,991 of
// 17,374 stamped rows (69%) showed a different person's parliament.bg portrait. This
// gate re-checks the stamped artifacts rather than the matcher, so a stale bundle
// written by the old rule fails here too. See docs/plans/local-mp-photo-links-v1.md.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { reportSkip } from "../lib/report_skip";
import { normaliseMpName, PARLIAMENT_INDEX } from "./mpNameMatch";

const DATA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data",
);

const bundleDirs = (): string[] =>
  fs.existsSync(DATA)
    ? fs
        .readdirSync(DATA, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /_(mi|chmi|chmi_nov)$/.test(d.name))
        .map((d) => path.join(DATA, d.name, "municipalities"))
        .filter((dir) => fs.existsSync(dir))
    : [];

type Row = { mpId?: unknown; candidateName?: string; name?: string };

// Walks every object in a bundle: mayor rounds, council slates, kmetstva and districts
// all carry candidate rows, and a rule keyed on today's slot list would miss a new one.
const stampedRows = (node: unknown, out: Row[]): void => {
  if (Array.isArray(node)) {
    for (const v of node) stampedRows(v, out);
  } else if (node && typeof node === "object") {
    const row = node as Row;
    if (row.mpId !== undefined) out.push(row);
    for (const v of Object.values(node)) stampedRows(v, out);
  }
};

const dirs = bundleDirs();
const skip = !fs.existsSync(PARLIAMENT_INDEX)
  ? "data/parliament/index.json absent (fresh clone)"
  : dirs.length === 0
    ? "no data/<cycle>/municipalities bundles (fresh clone)"
    : false;
reportSkip(import.meta.url, skip);

describe("local-election MP links", () => {
  it.skipIf(skip)(
    "every stamped mpId is an exact, unique full-name match",
    () => {
      const mps = (
        JSON.parse(fs.readFileSync(PARLIAMENT_INDEX, "utf8")) as {
          mps: Array<{ id: number; normalizedName?: string }>;
        }
      ).mps;
      const nameById = new Map<number, string>();
      const holders = new Map<string, Set<number>>();
      for (const m of mps) {
        if (!m.normalizedName) continue;
        const key = normaliseMpName(m.normalizedName);
        nameById.set(m.id, key);
        holders.set(key, (holders.get(key) ?? new Set<number>()).add(m.id));
      }

      let stamped = 0;
      const bad: string[] = [];
      for (const dir of dirs) {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".json")) continue;
          const rows: Row[] = [];
          stampedRows(
            JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")),
            rows,
          );
          for (const r of rows) {
            stamped++;
            const cand = normaliseMpName(r.candidateName ?? r.name ?? "");
            const mpKey =
              typeof r.mpId === "number" ? nameById.get(r.mpId) : undefined;
            if (cand.split(" ").length < 2) {
              bad.push(
                `${path.basename(path.dirname(dir))}/${f}: ${cand || "(empty)"} has fewer than two name tokens`,
              );
            } else if (mpKey !== cand) {
              bad.push(
                `${path.basename(path.dirname(dir))}/${f}: ${cand} → #${String(r.mpId)} ${mpKey ?? "(no such MP)"}`,
              );
            } else if ((holders.get(mpKey)?.size ?? 0) !== 1) {
              bad.push(
                `${path.basename(path.dirname(dir))}/${f}: ${cand} is shared by several MPs`,
              );
            }
          }
        }
      }
      // Non-vacuity: a decorator that stamped nothing would pass the loop trivially.
      expect(stamped).toBeGreaterThan(0);
      expect(
        bad.slice(0, 20),
        `${bad.length} wrong MP link(s) — re-run npx tsx scripts/parsers_local/decorate_local_mp_links.ts`,
      ).toEqual([]);
    },
  );
});
