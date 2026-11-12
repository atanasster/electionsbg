// The two file-drop done-checks, evaluated against what is on disk today.
// Each is checked both ways: a due period whose file exists, and one whose
// file cannot exist — so a check that always says "done" fails here.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reportSkip } from "../../lib/report_skip";
import { REPO } from "../state";
import { handlerById, type RunCtx } from "./index";

// Both inputs are gitignored operator drops: a fresh clone has neither, and
// that must read as "not provable here", never as a pass.
const FTS = "raw_data/ngo_funding/fts/2025_FTS_dataset_en.xlsx";
const MF =
  "data/_cache/minfin_municipal_fiscal/quarterly-reports-Q22025-Q42025-Q22026-website.xlsx";
const skipFts = fs.existsSync(path.join(REPO, FTS))
  ? false
  : `${FTS} is absent — the FTS done-check cannot be exercised on this machine`;
const skipMf = fs.existsSync(path.join(REPO, MF))
  ? false
  : `${MF} is absent — the municipal-fiscal done-check cannot be exercised on this machine`;
reportSkip(import.meta.url, skipFts);
reportSkip(import.meta.url, skipMf);

const ctxWith = (source: string, meta: Record<string, unknown>): RunCtx => ({
  flipped: new Set([source]),
  meta: (id) => (id === source ? meta : undefined),
  detail: () => undefined,
  now: new Date(),
});

const doneOf = (handler: string, op: string) => {
  const o = handlerById(handler)?.operator?.find((x) => x.id === op);
  if (!o?.done) throw new Error(`${handler} › ${op} has no done-check`);
  return o.done;
};

describe("file-drop done-checks", () => {
  it.skipIf(skipFts)(
    "FTS: done exactly when the watcher's latest year's XLSX is present",
    () => {
      const done = doneOf("db-load-ngo-funding", "fts-xlsx-download");
      expect(done(ctxWith("ec_fts", { latestYear: 2025 }))).toBe(true);
      expect(done(ctxWith("ec_fts", { latestYear: 2099 }))).toBe(false);
      expect(done(ctxWith("ec_fts", {}))).toBe(false);
    },
  );

  it.skipIf(skipMf)(
    "МФ municipal fiscal: done exactly when the due quarter's workbook is present",
    () => {
      const done = doneOf(
        "update-budget-municipal-fiscal",
        "minfin-fiscal-workbooks",
      );
      expect(done(ctxWith("municipal_fiscal_due", { due: "2026-Q2" }))).toBe(
        true,
      );
      expect(done(ctxWith("municipal_fiscal_due", { due: "2099-Q1" }))).toBe(
        false,
      );
      expect(done(ctxWith("municipal_fiscal_due", { due: "garbage" }))).toBe(
        false,
      );
    },
  );
});
