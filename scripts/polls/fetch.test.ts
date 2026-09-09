// Integration-flavored tests for `polls:fetch`'s CLI orchestration. The pure
// decision logic (versioning, target resolution, attachment discovery) is
// tested exhaustively in scripts/polls/lib/capture.test.ts; this file checks
// that fetch.ts wires it correctly to real fs writes (redirected to a
// scratch directory via __setCaptureRootForTests) and to fetchText/fetch.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../watch/fingerprint", async (orig) => ({
  ...(await orig<typeof import("../watch/fingerprint")>()),
  fetchText: vi.fn(),
}));
vi.mock("../watch/state", () => ({ readState: vi.fn() }));

import { fetchText } from "../watch/fingerprint";
import { readState } from "../watch/state";
import { __setCaptureRootForTests, main, parseArgv } from "./fetch";

const mockedFetchText = vi.mocked(fetchText);
const mockedReadState = vi.mocked(readState);

describe("parseArgv", () => {
  it("reads every value flag and the boolean --force", () => {
    expect(
      parseArgv([
        "--since",
        "2026-01-01",
        "--agency",
        "TR",
        "--pub",
        "12",
        "--url",
        "https://x/",
        "--archive",
        "https://web.archive.org/y",
        "--force",
      ]),
    ).toEqual({
      since: "2026-01-01",
      agency: "TR",
      pub: "12",
      url: "https://x/",
      archive: "https://web.archive.org/y",
      force: true,
    });
  });

  it("defaults every value flag to undefined and force to false", () => {
    expect(parseArgv([])).toEqual({
      since: undefined,
      agency: undefined,
      pub: undefined,
      url: undefined,
      archive: undefined,
      force: false,
    });
  });
});

describe("main — argv validation (no fs/network touched)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });
  afterEach(() => {
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("refuses an unknown --agency", async () => {
    await main(["--agency", "ZZ"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown --agency"),
    );
  });

  it("refuses --url with no --agency", async () => {
    await main(["--url", "https://x/"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--url needs --agency"),
    );
  });

  it("refuses --archive with no --agency", async () => {
    await main(["--archive", "https://web.archive.org/x"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--archive needs --agency"),
    );
  });
});

describe("main — capture flow (real fs, redirected to a scratch dir)", () => {
  let scratchRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedFetchText.mockReset();
    mockedReadState.mockReset();
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polls-fetch-test-"));
    __setCaptureRootForTests(scratchRoot);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
        }) as unknown as Response,
    );
  });
  afterEach(() => {
    __setCaptureRootForTests(); // restore the real repo root — never leave a later test pointed at a deleted scratch dir
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    logSpy.mockRestore();
    fetchSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("captures a fresh site-item target: page.html, one PDF, and SOURCE.json", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: "2026-07-01",
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue(
      `<html><body><a href="/files/report.pdf">Report</a></body></html>`,
    );

    await main(["--agency", "TR"]);

    const dir = path.join(scratchRoot, "raw_data/polls/trend/10");
    expect(fs.existsSync(path.join(dir, "page.html"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "report.pdf"))).toBe(true);
    const stamp = JSON.parse(
      fs.readFileSync(path.join(dir, "SOURCE.json"), "utf8"),
    );
    expect(stamp.url).toBe("https://rctrend.bg/p/10");
    expect(stamp.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stamp.bytes).toBeGreaterThan(0);
    expect(stamp.archiveUrl).toBeUndefined();
  });

  it("skips an already-captured pubId without --force, without fetching", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    const dir = path.join(scratchRoot, "raw_data/polls/trend/10");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SOURCE.json"),
      JSON.stringify({ url: "x", fetchedAt: "y", sha256: "z", bytes: 1 }),
    );

    await main(["--agency", "TR"]);

    expect(mockedFetchText).not.toHaveBeenCalled();
  });

  it("versions a changed re-fetch as .v2 when --force is given", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    const dir = path.join(scratchRoot, "raw_data/polls/trend/10");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SOURCE.json"),
      JSON.stringify({
        url: "x",
        fetchedAt: "y",
        sha256: "not-the-real-hash",
        bytes: 1,
      }),
    );
    mockedFetchText.mockResolvedValue("<html>new content</html>");

    await main(["--agency", "TR", "--force"]);

    expect(
      fs.existsSync(
        path.join(scratchRoot, "raw_data/polls/trend/10.v2", "page.html"),
      ),
    ).toBe(true);
    // The original capture is untouched.
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "SOURCE.json"), "utf8")).sha256,
    ).toBe("not-the-real-hash");
  });

  it("captures a third-party press URL under the given --agency", async () => {
    mockedFetchText.mockResolvedValue("<html>press article</html>");

    await main(["--url", "https://btvnovinite.bg/x", "--agency", "MD"]);

    const entries = fs.readdirSync(path.join(scratchRoot, "raw_data/polls/md"));
    expect(entries).toHaveLength(1);
    const stamp = JSON.parse(
      fs.readFileSync(
        path.join(scratchRoot, "raw_data/polls/md", entries[0], "SOURCE.json"),
        "utf8",
      ),
    );
    expect(stamp.url).toBe("https://btvnovinite.bg/x");
  });

  it("captures a Wayback snapshot and records BOTH urls (decision 17)", async () => {
    mockedFetchText.mockResolvedValue("<html>archived page</html>");

    await main([
      "--archive",
      "https://web.archive.org/web/20160101000000/https://alpharesearch.bg/post/1-x.html",
      "--agency",
      "AR",
    ]);

    const entries = fs.readdirSync(
      path.join(scratchRoot, "raw_data/polls/alpha_research"),
    );
    expect(entries).toHaveLength(1);
    const stamp = JSON.parse(
      fs.readFileSync(
        path.join(
          scratchRoot,
          "raw_data/polls/alpha_research",
          entries[0],
          "SOURCE.json",
        ),
        "utf8",
      ),
    );
    expect(stamp.url).toBe("https://alpharesearch.bg/post/1-x.html");
    expect(stamp.archiveUrl).toBe(
      "https://web.archive.org/web/20160101000000/https://alpharesearch.bg/post/1-x.html",
    );
  });

  it("combines --archive with an explicit --url: fetches the SNAPSHOT, records the canonical url", async () => {
    mockedFetchText.mockResolvedValue("<html>archived page</html>");
    const waybackUrl =
      "https://web.archive.org/web/20160101000000/https://alpharesearch.bg/post/1-x.html";
    const canonicalUrl = "https://alpharesearch.bg/post/1-canonical.html";

    await main([
      "--archive",
      waybackUrl,
      "--url",
      canonicalUrl,
      "--agency",
      "AR",
    ]);

    // Fetched the WAYBACK address, never the live one.
    expect(mockedFetchText).toHaveBeenCalledWith(waybackUrl, expect.anything());
    const entries = fs.readdirSync(
      path.join(scratchRoot, "raw_data/polls/alpha_research"),
    );
    expect(entries).toHaveLength(1);
    const stamp = JSON.parse(
      fs.readFileSync(
        path.join(
          scratchRoot,
          "raw_data/polls/alpha_research",
          entries[0],
          "SOURCE.json",
        ),
        "utf8",
      ),
    );
    expect(stamp.url).toBe(canonicalUrl);
    expect(stamp.archiveUrl).toBe(waybackUrl);
  });

  it("does NOT create a new version under --force when the re-fetched hash is unchanged", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    const stableHtml = "<html>stable content</html>";
    mockedFetchText.mockResolvedValue(stableHtml);

    // First run: fresh capture, establishes the real stored hash.
    await main(["--agency", "TR"]);
    const dir = path.join(scratchRoot, "raw_data/polls/trend/10");
    const firstStamp = JSON.parse(
      fs.readFileSync(path.join(dir, "SOURCE.json"), "utf8"),
    );

    // Second run, --force, same content: must NOT mint a .v2.
    await main(["--agency", "TR", "--force"]);

    expect(
      fs.existsSync(path.join(scratchRoot, "raw_data/polls/trend/10.v2")),
    ).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "SOURCE.json"), "utf8")).sha256,
    ).toBe(firstStamp.sha256);
  });

  it("--pub narrows a multi-item pending list to the matching target only", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "11",
            detail: "d",
            meta: {
              newestId: 11,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "A",
                  publishedAt: null,
                },
                {
                  id: 11,
                  url: "https://rctrend.bg/p/11",
                  title: "B",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue("<html>x</html>");

    await main(["--agency", "TR", "--pub", "11"]);

    expect(
      fs.existsSync(path.join(scratchRoot, "raw_data/polls/trend/10")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(scratchRoot, "raw_data/polls/trend/11", "page.html"),
      ),
    ).toBe(true);
  });

  it("two PDF links sharing a basename do not clobber each other on disk", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue(
      `<html><body>
        <a href="/2025/report.pdf">2025</a>
        <a href="/2026/report.pdf">2026</a>
      </body></html>`,
    );
    let call = 0;
    fetchSpy.mockImplementation(async () => {
      call++;
      return new Response(new Uint8Array([call]), {
        status: 200,
      }) as unknown as Response;
    });

    await main(["--agency", "TR"]);

    const dir = path.join(scratchRoot, "raw_data/polls/trend/10");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf"));
    expect(files).toHaveLength(2);
    const contents = files.map((f) => fs.readFileSync(path.join(dir, f)));
    // Both distinct attachments survive with distinct, non-empty content.
    expect(contents[0].equals(contents[1])).toBe(false);
  });

  it("saves the page and every attachment that DID succeed when one attachment 403s (Market Links, live)", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue(
      `<html><body>
        <a href="/blocked.pdf">blocked</a>
        <a href="/ok.pdf">ok</a>
      </body></html>`,
    );
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/blocked.pdf"))
        return new Response(null, { status: 403 }) as unknown as Response;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
      }) as unknown as Response;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await main(["--agency", "TR"]);

    const dir = path.join(scratchRoot, "raw_data/polls/trend/10");
    // The page and the ok.pdf attachment both survive.
    expect(fs.existsSync(path.join(dir, "page.html"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "ok.pdf"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "blocked.pdf"))).toBe(false);
    // The stamp records WHICH attachment failed rather than silently
    // looking like a complete capture.
    const stamp = JSON.parse(
      fs.readFileSync(path.join(dir, "SOURCE.json"), "utf8"),
    );
    expect(stamp.attachmentFailures).toEqual([
      "https://rctrend.bg/blocked.pdf",
    ]);
    // A failed attachment inside a bulk capture is logged, not thrown —
    // the run itself still succeeds for this target.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("attachment FAILED"),
    );

    errorSpy.mockRestore();
  });

  it("still captures the page when EVERY discovered attachment fails", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue(
      `<html><body><a href="/a.pdf">a</a><a href="/b.pdf">b</a></body></html>`,
    );
    fetchSpy.mockImplementation(
      async () => new Response(null, { status: 403 }) as unknown as Response,
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await main(["--agency", "TR"]);

    const dir = path.join(scratchRoot, "raw_data/polls/trend/10");
    expect(fs.existsSync(path.join(dir, "page.html"))).toBe(true);
    const stamp = JSON.parse(
      fs.readFileSync(path.join(dir, "SOURCE.json"), "utf8"),
    );
    // bytes reflect ONLY the page — no attachment made it to disk.
    expect(stamp.bytes).toBe(
      Buffer.byteLength(
        fs.readFileSync(path.join(dir, "page.html"), "utf8"),
        "utf8",
      ),
    );
    expect(stamp.attachmentFailures).toEqual([
      "https://rctrend.bg/a.pdf",
      "https://rctrend.bg/b.pdf",
    ]);

    errorSpy.mockRestore();
  });

  it("does not retry a definite 403 (only a transient 5xx gets a second attempt)", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue(
      `<html><body><a href="/blocked.pdf">blocked</a></body></html>`,
    );
    let calls = 0;
    fetchSpy.mockImplementation(async () => {
      calls++;
      return new Response(null, { status: 403 }) as unknown as Response;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await main(["--agency", "TR"]);

    expect(calls).toBe(1); // a 403 is permanent — never worth a second attempt
  });

  it("retries once on a transient 5xx, then succeeds", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue(
      `<html><body><a href="/flaky.pdf">flaky</a></body></html>`,
    );
    let calls = 0;
    fetchSpy.mockImplementation(async () => {
      calls++;
      if (calls === 1)
        return new Response(null, { status: 503 }) as unknown as Response;
      return new Response(new Uint8Array([1]), {
        status: 200,
      }) as unknown as Response;
    });

    await main(["--agency", "TR"]);

    expect(calls).toBe(2);
    expect(
      fs.existsSync(
        path.join(scratchRoot, "raw_data/polls/trend/10", "flaky.pdf"),
      ),
    ).toBe(true);
  });

  it("stays unchanged across --force when the SAME attachment keeps 403ing", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue(
      `<html><body>
        <a href="/blocked.pdf">blocked</a>
        <a href="/ok.pdf">ok</a>
      </body></html>`,
    );
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/blocked.pdf"))
        return new Response(null, { status: 403 }) as unknown as Response;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
      }) as unknown as Response;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await main(["--agency", "TR"]); // first run: mints the base capture
    await main(["--agency", "TR", "--force"]); // re-check: same failure, same success

    expect(
      fs.existsSync(path.join(scratchRoot, "raw_data/polls/trend/10.v2")),
    ).toBe(false);
  });

  it("carries no attachmentFailures key at all when every attachment succeeds", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_trend"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://rctrend.bg/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue("<html>no attachments</html>");

    await main(["--agency", "TR"]);

    const stamp = JSON.parse(
      fs.readFileSync(
        path.join(scratchRoot, "raw_data/polls/trend/10", "SOURCE.json"),
        "utf8",
      ),
    );
    expect("attachmentFailures" in stamp).toBe(false);
  });

  it("continues walking other agencies' --since backlogs when one agency's listing throws", async () => {
    const { trend } = await import("./agencies/trend");
    const { alphaResearch } = await import("./agencies/alpha_research");
    const { marketLinks } = await import("./agencies/market_links");
    const { sovaHarris } = await import("./agencies/sova_harris");
    const { myara } = await import("./agencies/myara");
    const { globalMetrics } = await import("./agencies/global_metrics");
    const { gallup } = await import("./agencies/gallup");
    const spies = [
      vi
        .spyOn(trend, "listPublications")
        .mockRejectedValue(new Error("TR site down")),
      vi.spyOn(alphaResearch, "listPublications").mockResolvedValue([
        {
          id: 5,
          url: "https://alpharesearch.bg/post/5-x.html",
          title: "electoral post",
          publishedAt: "2026-07-01",
          kind: "html" as const,
          attachments: [],
        },
      ]),
      vi.spyOn(alphaResearch, "isElectoral").mockReturnValue(true),
      // Every other fetchable agency: an empty backlog — kept quiet on
      // purpose, so this test isolates the ONE thing it means to prove
      // (TR failing does not stop AR) rather than also exercising five
      // unrelated listers' real parsing against a generic mock body.
      vi.spyOn(marketLinks, "listPublications").mockResolvedValue([]),
      vi.spyOn(sovaHarris, "listPublications").mockResolvedValue([]),
      vi.spyOn(myara, "listPublications").mockResolvedValue([]),
      vi.spyOn(globalMetrics, "listPublications").mockResolvedValue([]),
      vi.spyOn(gallup, "listPublications").mockResolvedValue([]),
    ];
    mockedFetchText.mockResolvedValue("<html>AR page</html>");

    await main(["--since", "2026-01-01", "--agency", "TR"]);
    // TR alone fails — logs, does not throw, sets a failing exit code.
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    await main(["--since", "2026-01-01"]); // every fetchable agency — TR fails, AR must still be captured
    expect(
      fs.existsSync(path.join(scratchRoot, "raw_data/polls/alpha_research/5")),
    ).toBe(true);

    spies.forEach((s) => s.mockRestore());
  });

  it("isolates a failed Sova Harris bulletin image the same way as a PDF", async () => {
    mockedReadState.mockImplementation((id: string) =>
      id === "polls_sova_harris"
        ? {
            fingerprint: "10",
            detail: "d",
            meta: {
              newestId: 10,
              items: [
                {
                  id: 10,
                  url: "https://sovaharris.com/p/10",
                  title: "T",
                  publishedAt: null,
                },
              ],
            },
            lastChecked: "2026-09-01T00:00:00.000Z",
          }
        : null,
    );
    mockedFetchText.mockResolvedValue(
      `<html><body>
        <img src="https://sovaharris.com/wp-content/Buletin_x_page-0001.jpg">
        <img src="https://sovaharris.com/wp-content/Buletin_x_page-0002.jpg">
      </body></html>`,
    );
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("page-0001.jpg"))
        return new Response(null, { status: 403 }) as unknown as Response;
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
      }) as unknown as Response;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await main(["--agency", "SH"]);

    const dir = path.join(scratchRoot, "raw_data/polls/sova_harris/10");
    expect(fs.existsSync(path.join(dir, "page.html"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "Buletin_x_page-0002.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "Buletin_x_page-0001.jpg"))).toBe(
      false,
    );
    const stamp = JSON.parse(
      fs.readFileSync(path.join(dir, "SOURCE.json"), "utf8"),
    );
    expect(stamp.attachmentFailures).toEqual([
      "https://sovaharris.com/wp-content/Buletin_x_page-0001.jpg",
    ]);
  });

  it("lists pending press notices without attempting to fetch them", async () => {
    mockedReadState.mockImplementation((id: string) => {
      if (id === "polls_press")
        return {
          fingerprint: "x",
          detail: "d",
          meta: {
            agencies: {
              MD: {
                latestMs: 1,
                latestGuid: "g1",
                items: [
                  {
                    title: "Медиана press item",
                    link: "https://news.google.com/rss/articles/tok",
                    guid: "g1",
                    pubDate: "2026-07-01T00:00:00.000Z",
                    sourceUrl: null,
                    sourceName: "БТВ",
                  },
                ],
              },
            },
          },
          lastChecked: "2026-09-01T00:00:00.000Z",
        };
      return null;
    });

    await main([]);

    const logged = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(logged).toContain("press item(s) need a manual --url capture");
    expect(logged).toContain("Медиана press item");
    // Never tried to fetch the Google News redirect token.
    expect(mockedFetchText).not.toHaveBeenCalled();
  });
});
