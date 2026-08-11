// Unit tests for the pure helpers in bootstrap_roles.ts — no database.
//
// These are reachable only because that module guards its entrypoint (`import.meta.url ===
// argv[1]`): without the guard, importing it here would CREATE A ROLE against whatever
// DATABASE_URL is ambient as an import side effect.
//
// The interesting cases are all "a rename or a comment makes the parser answer confidently
// and wrongly", because the consequence is not a crash — it is granting a role CONNECT on a
// database nobody looked at.

import { describe, it, expect } from "vitest";
import {
  grantedDatabase,
  stripSqlComments,
  databaseOf,
  isLocalCompose,
  resolveTarget,
  waitForPostgres,
} from "./bootstrap_roles";
import { LOCAL_DATABASE_URL } from "./lib/pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(HERE, "schema/pg/roles_readonly.sql");

describe("the applier does not use exec()", () => {
  // The regression this file exists to prevent, and the one the cold-bootstrap data test
  // structurally CANNOT catch: that test applies the SQL with its own client, so swapping
  // run()'s raw query back to exec() leaves every assertion there green.
  //
  // exec() preflights `SELECT similarity('', '')` to force-load pg_trgm, and pg_trgm is
  // created by 000_search_fns.sql — applied by db:load:pg, FOUR STEPS AFTER this one in
  // db:refresh. On the virgin cluster this whole step exists for, that preflight raises
  // 42883 before the role file is ever sent. Measured: the first draft failed on the only
  // case it was written for, and passed on every developer machine.
  const src = readFileSync(path.join(HERE, "bootstrap_roles.ts"), "utf8");

  it("calls neither exec() nor execEach()", () => {
    expect(src).not.toMatch(/\bawait\s+exec(Each)?\s*\(/);
  });

  it("still applies the schema through a raw client query", () => {
    // Non-vacuity for the assertion above: without this, deleting the apply entirely would
    // also pass.
    expect(src).toMatch(/withClient\([\s\S]*?c\.query\(sql\)/);
  });
});

describe("grantedDatabase", () => {
  it("reads the committed roles_readonly.sql", () => {
    // The one that matters: if this stops being `electionsbg`, every local bootstrap
    // refuses until someone updates the URL, which is the intended loud failure.
    expect(grantedDatabase(readFileSync(SCHEMA, "utf8"))).toBe("electionsbg");
  });

  it("ignores a commented-out grant", () => {
    expect(
      grantedDatabase(
        `-- GRANT CONNECT ON DATABASE old_name TO app_readonly;\n` +
          `GRANT CONNECT ON DATABASE realdb TO app_readonly;`,
      ),
    ).toBe("realdb");
  });

  it("ignores a grant merely discussed in prose", () => {
    // The serious one. roles_readonly.sql opens with a 16-line prose header about what it
    // grants, so a sentence naming a database there is the LIKELY shape, not an exotic one.
    // First-match-wins would return `electionsbg` and validate against a file that grants
    // CONNECT somewhere else entirely.
    expect(
      grantedDatabase(
        `-- Run GRANT CONNECT ON DATABASE electionsbg by hand before this.\n` +
          `GRANT CONNECT ON DATABASE realdb TO app_readonly;`,
      ),
    ).toBe("realdb");
  });

  it("ignores a grant inside a block comment", () => {
    expect(
      grantedDatabase(
        `/* GRANT CONNECT ON DATABASE old_name TO app_readonly; */\n` +
          `GRANT CONNECT ON DATABASE realdb TO app_readonly;`,
      ),
    ).toBe("realdb");
  });

  it("folds an unquoted identifier to lower case, the way Postgres does", () => {
    expect(
      grantedDatabase(`GRANT CONNECT ON DATABASE ElectionsBG TO app_readonly;`),
    ).toBe("electionsbg");
  });

  it("keeps a quoted identifier verbatim, including a hyphen", () => {
    expect(
      grantedDatabase(
        `GRANT CONNECT ON DATABASE "elections-bg" TO app_readonly;`,
      ),
    ).toBe("elections-bg");
  });

  it("accepts $ in an identifier rather than truncating at it", () => {
    expect(
      grantedDatabase(
        `GRANT CONNECT ON DATABASE elections$bg TO app_readonly;`,
      ),
    ).toBe("elections$bg");
  });

  it("REFUSES an ambiguous file rather than preferring the first grant", () => {
    // Two live grants mean the file targets two databases; this step can only verify one,
    // so the only honest answer is to refuse.
    expect(
      grantedDatabase(
        `GRANT CONNECT ON DATABASE a TO app_readonly;\n` +
          `GRANT CONNECT ON DATABASE b TO app_readonly;`,
      ),
    ).toBeNull();
  });

  it("treats a repeated identical grant as unambiguous", () => {
    expect(
      grantedDatabase(
        `GRANT CONNECT ON DATABASE a TO app_readonly;\n` +
          `GRANT CONNECT ON DATABASE a TO someone_else;`,
      ),
    ).toBe("a");
  });

  it("returns null when there is no grant at all", () => {
    expect(
      grantedDatabase(`GRANT USAGE ON SCHEMA public TO app_readonly;`),
    ).toBeNull();
  });
});

describe("stripSqlComments", () => {
  it("removes line and block comments without joining adjacent tokens", () => {
    expect(stripSqlComments(`a -- x\nb`).split(/\s+/).filter(Boolean)).toEqual([
      "a",
      "b",
    ]);
    expect(stripSqlComments(`a/* x */b`).split(/\s+/).filter(Boolean)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("databaseOf", () => {
  it("extracts the database name", () => {
    expect(databaseOf(LOCAL_DATABASE_URL)).toBe("electionsbg");
  });
  it("decodes a percent-escaped name", () => {
    expect(databaseOf("postgres://u@h:1/elections%2Dbg")).toBe("elections-bg");
  });
  it("returns null for a URL naming no database", () => {
    expect(databaseOf("postgres://u@h:1/")).toBeNull();
  });
  it("returns null for an unparseable URL", () => {
    expect(databaseOf("not a url")).toBeNull();
  });
});

describe("isLocalCompose", () => {
  it("accepts the docker-compose Postgres", () => {
    expect(isLocalCompose(LOCAL_DATABASE_URL)).toBe(true);
  });
  it("rejects a staging clone that shares the database NAME", () => {
    // The case a name-only check cannot see, and the reason this function exists: every
    // database in this repo is `electionsbg`, so the name proves nothing about the server.
    expect(
      isLocalCompose("postgres://postgres@127.0.0.1:5435/electionsbg"),
    ).toBe(false);
  });
  it("rejects the Cloud SQL proxy", () => {
    expect(
      isLocalCompose("postgres://postgres@127.0.0.1:5434/electionsbg"),
    ).toBe(false);
  });
  it("rejects a remote host on the same port", () => {
    expect(
      isLocalCompose("postgres://postgres@db.example.com:5433/electionsbg"),
    ).toBe(false);
  });
  it("rejects an unparseable URL", () => {
    expect(isLocalCompose("not a url")).toBe(false);
  });
});

describe("resolveTarget", () => {
  const sql = `GRANT CONNECT ON DATABASE electionsbg TO app_readonly;`;

  it("accepts the local docker Postgres", () => {
    expect(resolveTarget(sql, []).database).toBe("electionsbg");
  });

  it("refuses a non-local target without the opt-in flag", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://postgres@127.0.0.1:5434/electionsbg";
    try {
      // DATABASE_URL is read at module load, so this asserts on the helper directly rather
      // than pretending the env change reaches resolveTarget's connectionUrl().
      expect(isLocalCompose(process.env.DATABASE_URL)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it("refuses a file whose grant names a different database", () => {
    expect(() =>
      resolveTarget(
        `GRANT CONNECT ON DATABASE somewhere_else TO app_readonly;`,
        [],
      ),
    ).toThrow(/grants CONNECT on "somewhere_else"/);
  });

  it("refuses a file with no single grant rather than guessing", () => {
    expect(() =>
      resolveTarget(`GRANT USAGE ON SCHEMA public TO app_readonly;`, []),
    ).toThrow(/no single `GRANT CONNECT ON DATABASE/);
  });
});

describe("waitForPostgres", () => {
  it("returns as soon as a probe succeeds", async () => {
    let calls = 0;
    await waitForPostgres(3, 1, async () => {
      calls++;
    });
    expect(calls).toBe(1);
  });

  it("retries a connection-refused error", async () => {
    let calls = 0;
    await waitForPostgres(5, 1, async () => {
      if (++calls < 3)
        throw Object.assign(new Error("nope"), { code: "ECONNREFUSED" });
    });
    expect(calls).toBe(3);
  });

  it("FAILS FAST on a non-retryable error instead of spinning out the budget", async () => {
    // The defect this replaced: dbReachable() collapses every failure to `false`, so a wrong
    // password spun all 30 attempts and then told the operator to check the container — the
    // one thing that was not broken. The SQLSTATE must reach the message.
    let calls = 0;
    await expect(
      waitForPostgres(30, 1, async () => {
        calls++;
        throw Object.assign(new Error("password authentication failed"), {
          code: "28P01",
        });
      }),
    ).rejects.toThrow(/28P01/);
    expect(calls).toBe(1);
  });

  it("reports the last error when the attempts run out", async () => {
    await expect(
      waitForPostgres(2, 1, async () => {
        throw Object.assign(new Error("still starting"), { code: "57P03" });
      }),
    ).rejects.toThrow(/still starting/);
  });
});
