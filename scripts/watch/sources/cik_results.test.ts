import { describe, expect, it } from "vitest";
import {
  carryFailedHead,
  carryPartials,
  changedCycles,
  type CycleFingerprint,
} from "./cik_results";
import type { WatchState } from "../types";

const reg = (over: Partial<CycleFingerprint> = {}): CycleFingerprint => ({
  cycle: "mi2023",
  kind: "regular",
  bundleUrl: "https://results.cik.bg/mi2023/tur1/opendata/export.zip",
  lastModified: "Mon, 06 Nov 2023 10:00:00 GMT",
  contentLength: "123",
  status: 200,
  runoffTracked: false,
  runoffStage: 0,
  ...over,
});
const failed = reg({ status: 0, lastModified: null, contentLength: null });
const prevState = (cycles: CycleFingerprint[]): WatchState => ({
  fingerprint: "x",
  detail: "d",
  meta: { cycles } as unknown as Record<string, unknown>,
  lastChecked: "t",
  lastChanged: "t",
});
const fpOf = (cycles: CycleFingerprint[]) => ({
  value: "y",
  detail: "d",
  meta: { cycles } as unknown as Record<string, unknown>,
});

describe("cik_results — a failed HEAD is not a change", () => {
  it("carries the previous observation forward on status 0", () => {
    expect(carryFailedHead(failed, reg())).toEqual(reg());
    // No previous observation: the 0 stays (and is never a "new cycle").
    expect(carryFailedHead(failed, undefined).status).toBe(0);
    // A real answer is never overwritten.
    const moved = reg({ contentLength: "999" });
    expect(carryFailedHead(moved, reg())).toEqual(moved);
  });

  it("never reports a status-0 cycle as re-uploaded", () => {
    expect(changedCycles(prevState([reg()]), fpOf([failed]))).toEqual([]);
    expect(changedCycles(prevState([failed]), fpOf([reg()]))).toEqual([]);
    expect(
      changedCycles(prevState([reg()]), fpOf([reg({ contentLength: "9" })])),
    ).toEqual([{ cycle: "mi2023", label: "mi2023 re-uploaded" }]);
  });
});

describe("cik_results — failed partial discovery", () => {
  const prev = ["chmi2024-2026/2024-10-20_chastichen"];
  it("carries the previous partials when discovery returns nothing", () => {
    expect(carryPartials([], prev)).toEqual({ cycles: prev, carried: true });
  });
  it("uses a non-empty discovery as is, and an empty one with no history", () => {
    const now = [...prev, "chmi2024-2026/2025-10-12_nov"];
    expect(carryPartials(now, prev)).toEqual({ cycles: now, carried: false });
    expect(carryPartials([], [])).toEqual({ cycles: [], carried: false });
  });
});
