// The structured scope three sources store as meta.scope — what the
// pipeline's scoped steps (`--local-ingest <cycle>`, `--pvr <slug>`,
// run_naredba <codes>) are given instead of parsing a describe-line.

import { describe, expect, it } from "vitest";
import type { Fingerprint, WatchState } from "../types";
import { cikPresidential } from "./cik_presidential";
import { cikResults } from "./cik_results";
import { municipalNaredba } from "./municipal_naredba";

const state = (meta: Record<string, unknown>): WatchState => ({
  fingerprint: "p",
  detail: "",
  lastChecked: "t",
  meta,
});
const fp = (meta: Record<string, unknown>): Fingerprint => ({
  value: "c",
  detail: "",
  meta,
});

describe("cik_results scope", () => {
  const regular = (cycle: string, lastModified: string) => ({
    cycle,
    kind: "regular",
    status: 200,
    lastModified,
    contentLength: 1,
    runoffStage: 0,
  });

  it("names new and re-uploaded cycles, and nothing that did not move", () => {
    const prev = state({
      cycles: [regular("mi2023", "a"), regular("mi2019", "a")],
    });
    const curr = fp({
      cycles: [
        regular("mi2023", "b"),
        regular("mi2019", "a"),
        regular("mi2027", "a"),
      ],
    });
    expect(cikResults.scope?.(prev, curr)).toEqual({
      cycles: ["mi2023", "mi2027"],
    });
    // describe reads the SAME comparison.
    expect(cikResults.describe?.(prev, curr)).toMatch(
      /2 cycle\(s\) changed: mi2023 re-uploaded, new cycle: mi2027/,
    );
  });

  it("returns null when nothing scoped moved", () => {
    const s = state({ cycles: [regular("mi2023", "a")] });
    expect(
      cikResults.scope?.(s, fp({ cycles: [regular("mi2023", "a")] })),
    ).toBeNull();
  });
});

describe("municipal_naredba scope", () => {
  it("names the municípios whose source changed", () => {
    const prev = state({
      perObshtina: {
        SOF00: [{ url: "u", status: 200, length: "1" }],
        VAR06: [{ url: "v", status: 200 }],
      },
    });
    const curr = fp({
      perObshtina: {
        SOF00: [{ url: "u", status: 200, length: "2" }],
        VAR06: [{ url: "v", status: 200 }],
      },
    });
    expect(municipalNaredba.scope?.(prev, curr)).toEqual({
      obshtini: ["SOF00"],
    });
  });

  it("is null on a first run (nothing to diff against)", () => {
    expect(
      municipalNaredba.scope?.(null, fp({ perObshtina: { SOF00: [] } })),
    ).toBeNull();
  });
});

describe("cik_presidential scope", () => {
  const cycle = (slug: string, known: boolean, status: number) => ({
    slug,
    year: "2031",
    known,
    rounds: [
      {
        round: 1,
        url: "u",
        guessedUrl: false,
        status,
        lastModified: null,
        contentLength: null,
      },
    ],
  });

  it("scopes a new cycle and a published round — never a merely re-listed or vanished one", () => {
    const prev = state({
      cycles: [cycle("pvr2026", true, 404), cycle("gone", true, 200)],
    });
    const curr = fp({
      cycles: [
        cycle("pvr2026", true, 200),
        cycle("pvr2031", false, 404),
        cycle("listed", true, 200),
      ],
    });
    expect(cikPresidential.scope?.(prev, curr)).toEqual({
      cycles: ["pvr2026", "pvr2031"],
    });
  });
});
