// Gates for the report renderer's manual-downloads section.
//
// The section exists because "an upstream moved" and "a human must fetch
// something before anything can run" are different facts, and the report could
// previously only express the first. The tests below pin the three properties
// that make it useful rather than noise: it appears only when something is
// outstanding, it appears ABOVE Changed, and it is independent of status.

import { describe, it, expect } from "vitest";
import { renderReport } from "./report";
import type { ManualRequest, ReportEntry, WatchSource } from "./types";

const src = (id: string, label: string): WatchSource => ({
  id,
  label,
  url: `https://example.test/${id}`,
  cadence: "daily",
  fingerprint: async () => ({ value: "v", detail: "d" }),
});

const entry = (
  id: string,
  status: ReportEntry["status"],
  manual?: ManualRequest,
): ReportEntry => ({
  source: src(id, `Source ${id}`),
  status,
  line: `${status} line`,
  manual,
});

const RUN_AT = "2026-08-13T06:00:00.000Z";

describe("renderReport — manual downloads", () => {
  it("omits the section entirely when nothing is outstanding", () => {
    const out = renderReport(
      [entry("a", "unchanged"), entry("b", "changed")],
      RUN_AT,
    );
    expect(out).not.toContain("Manual downloads needed");
  });

  it("renders the instruction, url, drop dir and each filename", () => {
    const out = renderReport(
      [
        entry("mf", "unchanged", {
          instruction: "Q3-2025 is due (we hold Q2-2025).",
          url: "https://www.minfin.bg/bg/810",
          dropDir: "data/_cache/minfin_municipal_fiscal",
          files: ["a.xlsx", "b.pdf"],
        }),
      ],
      RUN_AT,
    );
    expect(out).toContain("## Manual downloads needed");
    expect(out).toContain("Q3-2025 is due (we hold Q2-2025).");
    expect(out).toContain("https://www.minfin.bg/bg/810");
    expect(out).toContain("`data/_cache/minfin_municipal_fiscal`");
    expect(out).toContain("`a.xlsx`");
    expect(out).toContain("`b.pdf`");
  });

  it("places the section ABOVE Changed", () => {
    // A missing input blocks the ingest even when the upstream moved, so the
    // operator must meet it before the list of things they could run.
    const out = renderReport(
      [
        entry("x", "changed"),
        entry("mf", "unchanged", {
          instruction: "fetch it",
          url: "https://example.test",
        }),
      ],
      RUN_AT,
    );
    expect(out.indexOf("## Manual downloads needed")).toBeLessThan(
      out.indexOf("## Changed"),
    );
  });

  it("is independent of status — an UNCHANGED source can still be blocking", () => {
    // The load-bearing case: a file that is still missing does not move a
    // fingerprint, so the source reports `unchanged` while the request stands.
    // If the section keyed on `changed` it would go quiet exactly while the
    // pipeline was blocked.
    const out = renderReport(
      [entry("mf", "unchanged", { instruction: "still missing", url: "u" })],
      RUN_AT,
    );
    expect(out).toContain("still missing");
    expect(out).toContain("- Source mf: unchanged line"); // still listed as unchanged
  });

  it("renders a request that names no files or drop dir", () => {
    const out = renderReport(
      [entry("cpi", "changed", { instruction: "paste the new CPI", url: "u" })],
      RUN_AT,
    );
    expect(out).toContain("paste the new CPI");
    expect(out).not.toContain("Save from");
  });

  it("lists every outstanding source, not just the first", () => {
    const out = renderReport(
      [
        entry("a", "unchanged", { instruction: "fetch A", url: "ua" }),
        entry("b", "error", { instruction: "fetch B", url: "ub" }),
      ],
      RUN_AT,
    );
    expect(out).toContain("fetch A");
    expect(out).toContain("fetch B");
  });

  it("keeps the whole request nested under its bullet", () => {
    // Every other assertion here is a `toContain` on a fragment, which survives
    // the indentation being stripped — and unindented, the url and filenames
    // stop being part of the bullet and become siblings of it. Asserted as
    // exact lines so the nesting itself is pinned.
    const out = renderReport(
      [
        entry("mf", "unchanged", {
          instruction: "Q3-2025 is due.",
          url: "https://example.test/810",
          dropDir: "data/_cache/x",
          files: ["a.xlsx"],
        }),
      ],
      RUN_AT,
    );
    const lines = out.split("\n");
    const i = lines.indexOf("## Manual downloads needed");
    expect(i).toBeGreaterThan(-1);
    expect(lines.slice(i + 1, i + 4)).toEqual([
      "- **Source mf**: Q3-2025 is due.",
      "  Save from [https://example.test/810](https://example.test/810) into `data/_cache/x`:",
      "  - `a.xlsx`",
    ]);
  });

  it("cannot be made to forge a heading or break a code span", () => {
    // `files` is upstream-derived, so this is the design path rather than an
    // exotic one: a newline in `instruction` would otherwise emit a literal
    // „## Changed" ABOVE the real section, with a fabricated bullet under it.
    const out = renderReport(
      [
        entry("evil", "unchanged", {
          instruction: "line one\n\n## Changed\n- forged entry",
          url: "https://example.test",
          dropDir: "dir`with`ticks",
          files: ["file`name.xlsx"],
        }),
      ],
      RUN_AT,
    );
    // Exactly one Changed heading, and it is the real one.
    expect(out.split("\n").filter((l) => l === "## Changed")).toHaveLength(1);
    // The forged bullet must not be a LINE of its own — flattened, it survives
    // as text inside the real bullet, which is the intended outcome.
    expect(out.split("\n")).not.toContain("- forged entry");
    expect(out).toContain("line one ## Changed - forged entry");
    expect(out).toContain("`dir'with'ticks`");
    expect(out).toContain("`file'name.xlsx`");
  });
});
