// isServingDatabase() decides whether a process may overwrite a COMMITTED artifact minted
// from production — today data/person/prerender_slugs.json (emit_prerender_slugs.ts). A
// wrong `true` writes local data over the production manifest; a wrong `false` only skips a
// regeneration. So the predicate must fail CLOSED, and both ways it previously failed open
// are pinned below:
//
//   - it compared DATABASE_URL rather than the URL getPool() actually dials, so a process
//     that called pinLocalDatabase() read local while the guard said "serving";
//   - it was a denylist of one string literal, so the SAME local database reached by IP
//     instead of `localhost` — and any staging proxy — read as "serving".
//
// Hermetic: pg.ts builds its Pool lazily, so importing it opens no connection.

import { describe, test, expect, vi, afterEach } from "vitest";

/** Re-import pg.ts with a chosen DATABASE_URL. Module state (the captured DATABASE_URL) is
 *  read at import time, so each case needs a fresh module registry. */
const load = async (databaseUrl: string | undefined) => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", databaseUrl);
  return await import("./pg");
};

const CLOUD = "postgres://postgres@127.0.0.1:5434/electionsbg";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("isServingDatabase", () => {
  test("the Cloud SQL proxy is the serving database", async () => {
    const pg = await load(CLOUD);
    expect(pg.isServingDatabase()).toBe(true);
    expect(pg.connectionUrl()).toBe(CLOUD);
  });

  test("no DATABASE_URL falls back to local docker PG — not serving", async () => {
    const pg = await load(undefined);
    expect(pg.connectionUrl()).toBe(pg.LOCAL_DATABASE_URL);
    expect(pg.isServingDatabase()).toBe(false);
  });

  test("the local database reached by IP is still not serving", async () => {
    // Byte-different from LOCAL_DATABASE_URL (`localhost`), same server. A denylist on that
    // one literal called this serving and let the write through.
    const pg = await load(
      "postgres://postgres:postgres@127.0.0.1:5433/electionsbg",
    );
    expect(pg.isServingDatabase()).toBe(false);
  });

  test("some other host on the proxy port is not serving", async () => {
    // A staging proxy must never mint the production manifest.
    const pg = await load("postgres://postgres@10.1.2.3:5434/electionsbg");
    expect(pg.isServingDatabase()).toBe(false);
  });

  test("the proxy host on some other port is not serving", async () => {
    const pg = await load("postgres://postgres@127.0.0.1:5555/electionsbg");
    expect(pg.isServingDatabase()).toBe(false);
  });

  test("an unparseable DATABASE_URL is not serving", async () => {
    const pg = await load("not a url");
    expect(pg.isServingDatabase()).toBe(false);
  });

  test("pinLocalDatabase() wins over a cloud DATABASE_URL", async () => {
    // The regression that mattered: ai/tools/dbFetcherNode.ts and two data tests pin local
    // precisely because a cloud DATABASE_URL may be left in the shell. getPool() honours the
    // pin, so the guard must too — otherwise this process reads local and reports serving.
    const pg = await load(CLOUD);
    expect(pg.isServingDatabase()).toBe(true);
    pg.pinLocalDatabase();
    expect(pg.connectionUrl()).toBe(pg.LOCAL_DATABASE_URL);
    expect(pg.isServingDatabase()).toBe(false);
  });
});
