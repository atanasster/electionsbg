// The /persons CSV export.
//
// Two things are worth locking. First the QUOTING: these rows are Bulgarian institution
// names, which routinely contain commas and quotes ("Български пощи" ЕАД, Окръжен съд -
// Кърджали), and an unquoted comma silently shifts every later column of that row. Second
// the TRUNCATION SIGNAL: an export that stops at the cap must say so, or the file reads as
// the complete answer to the reader's query.

import { describe, test, expect, vi, afterEach } from "vitest";
import { rowsToCsv, fetchPersonsCsv, EXPORT_MAX } from "./exportPersonsCsv";
import type { PersonBrowseRow } from "./personBrowseTypes";

const row = (over: Partial<PersonBrowseRow> = {}): PersonBrowseRow =>
  ({
    slug: "ivan-ivanov",
    name: "Иван Иванов",
    primaryRole: "mp",
    primaryFacet: "politician",
    rolesN: 3,
    partyPrimary: "gerb",
    partiesN: 1,
    placeLabel: "Варна",
    oblastCode: "VAR",
    obshtinaCode: null,
    institution: null,
    latestDeclarationYear: 2025,
    hasDeclaration: true,
    companiesN: null,
    ...over,
  }) as PersonBrowseRow;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rowsToCsv", () => {
  test("emits a header and one line per row", () => {
    const csv = rowsToCsv([row(), row({ slug: "b", name: "Петър Петров" })]);
    const lines = csv.split("\n");
    expect(lines[0]).toMatch(/^slug,name,primary_role/);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Иван Иванов");
  });

  test("quotes a value containing a comma", () => {
    const csv = rowsToCsv([row({ institution: "Окръжен съд, Варна" })]);
    expect(csv).toContain('"Окръжен съд, Варна"');
  });

  test("doubles embedded quotes", () => {
    const csv = rowsToCsv([row({ institution: '"Български пощи" ЕАД' })]);
    expect(csv).toContain('"""Български пощи"" ЕАД"');
  });

  test("renders null as empty, not as the string null", () => {
    const csv = rowsToCsv([row({ institution: null, companiesN: null })]);
    expect(csv).not.toContain("null");
  });
});

describe("fetchPersonsCsv", () => {
  const mockPages = (total: number, pageSize = 50) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const q = JSON.parse(
          decodeURIComponent(new URL(url, "http://x").searchParams.get("q")!),
        );
        const start = q.page * pageSize;
        const rows = Array.from(
          { length: Math.max(0, Math.min(pageSize, total - start)) },
          (_, i) => row({ slug: `p${start + i}` }),
        );
        return { ok: true, json: async () => ({ rows, total }) } as Response;
      }),
    );
  };

  test("re-issues the caller's own request, overriding only paging", async () => {
    mockPages(10);
    const request = {
      resource: "persons",
      filters: { global: "иван", columns: [{ id: "is_mp", value: true }] },
      sort: [{ id: "prominence", desc: true }],
      page: 0,
      pageSize: 25,
    };
    await fetchPersonsCsv(request);
    const sent = JSON.parse(
      decodeURIComponent(
        new URL(
          (
            globalThis.fetch as unknown as { mock: { calls: string[][] } }
          ).mock.calls[0][0],
          "http://x",
        ).searchParams.get("q")!,
      ),
    );
    // The reader's filters and search term must survive into the export — dropping them
    // silently exports a different, larger result set than the one on screen.
    expect(sent.filters).toEqual(request.filters);
    expect(sent.sort).toEqual(request.sort);
    expect(sent.pageSize).toBe(50);
  });

  test("pages until the result set is exhausted", async () => {
    mockPages(120);
    const { rows, truncated } = await fetchPersonsCsv({ resource: "persons" });
    expect(rows).toBe(120);
    expect(truncated).toBe(false);
  });

  test("stops at the cap and REPORTS that it did", async () => {
    mockPages(EXPORT_MAX + 500);
    const { rows, truncated } = await fetchPersonsCsv({ resource: "persons" });
    expect(rows).toBe(EXPORT_MAX);
    expect(truncated).toBe(true);
  });

  test("throws on a failed request rather than writing a partial file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as Response),
    );
    await expect(fetchPersonsCsv({ resource: "persons" })).rejects.toThrow(
      /export failed: 500/,
    );
  });
});
