// The law-HTML cache key, isolated.
//
// `fetchLawHtml` used to key its gzip cache on the fiscal YEAR, which does not
// identify a law: FY2026 alone has the ЗДБРБ (pending), the ЗБДОО (244982), the
// ЗБНЗОК (244981) and a bridging law with its own ЗИД. Re-keying to idMat fixed
// that but introduced two faults of its own, both caught in review:
//
//   1. the legacy-year cache was adopted for ANY idMat, so asking for the ЗБДОО
//      would hand back the ЗДБРБ and then persist it under the ЗБДОО's key;
//   2. the read path skipped the size sanity the fetch path has — and
//      raw_data/budget really does hold a 4 KB `law-202168.html.gz` stub, which
//      is FY2024's idMat, so it would have shadowed the good 176 KB cache and
//      failed inside the parser with a message blaming ДВ's page structure.
//
// The policy is pure and worth testing directly; exercising `fetchLawHtml`
// itself would need the filesystem and the network.
import { describe, expect, it } from "vitest";
import { LAW_DV_MATERIALS } from "./fetch_sources";

/** Mirrors fetchLawHtml's cache-selection policy. */
const cacheFiles = (
  fiscalYear: number,
  idMat: string,
): { primary: string; legacy: string | null } => ({
  primary: `law-${idMat}.html.gz`,
  legacy:
    LAW_DV_MATERIALS[fiscalYear] === idMat ? `law-${fiscalYear}.html.gz` : null,
});

const MIN_LAW_HTML = 10000;
const usable = (html: string): boolean => html.length >= MIN_LAW_HTML;

describe("law cache key", () => {
  it("keys on idMat, not on the fiscal year", () => {
    // The two 2026 fund laws must never share a file.
    const doo = cacheFiles(2026, "244982");
    const nzok = cacheFiles(2026, "244981");
    expect(doo.primary).not.toBe(nzok.primary);
    expect(doo.primary).toBe("law-244982.html.gz");
  });

  it("adopts the legacy year cache ONLY for that year's ЗДБРБ", () => {
    // FY2024's State Budget Law is idMat 202168 — the legacy law-2024 blob is
    // genuinely that law, so adopting it is correct.
    expect(cacheFiles(2024, LAW_DV_MATERIALS[2024]).legacy).toBe(
      "law-2024.html.gz",
    );
  });

  it("never adopts the legacy year cache for a DIFFERENT law", () => {
    // The critical one. law-2026.html.gz, if it existed, would be the ЗДБРБ —
    // handing it back for the ЗБДОО would parse the wrong statute and then make
    // the mistake permanent under the ЗБДОО's own key.
    expect(cacheFiles(2026, "244982").legacy).toBeNull();
    expect(cacheFiles(2026, "244981").legacy).toBeNull();
    expect(cacheFiles(2024, "244982").legacy).toBeNull();
  });

  it("has no legacy path for a year with no catalogued ЗДБРБ", () => {
    // 2026 is deliberately absent from LAW_DV_MATERIALS — no ЗДБРБ yet.
    expect(LAW_DV_MATERIALS[2026]).toBeUndefined();
    expect(cacheFiles(2026, "whatever").legacy).toBeNull();
  });

  it("applies the same size floor to cached blobs as to fetched ones", () => {
    // The 4 KB law-202168 stub is exactly this case.
    expect(usable("x".repeat(4315))).toBe(false);
    expect(usable("x".repeat(MIN_LAW_HTML))).toBe(true);
    expect(usable("x".repeat(175957))).toBe(true);
  });

  it("would reject the known-bad stub for the year it shadows", () => {
    // Regression pin: FY2024's idMat IS 202168, so the stub sits on the primary
    // path. It must be discarded, not served.
    expect(LAW_DV_MATERIALS[2024]).toBe("202168");
    expect(cacheFiles(2024, "202168").primary).toBe("law-202168.html.gz");
    expect(usable("x".repeat(4315))).toBe(false);
  });
});
