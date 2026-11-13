// The exit code is the contract a publish gates on: 1 = "found an
// unpublished artifact" (reported), 2 = "could not check" (holds the
// manifest). Before the split a crash exited 1 and read as a finding.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHECK_CRASHED,
  CHECK_FOUND,
  exitCodeFor,
} from "./check_generated_artifacts";
import { CHECK_CRASHED as CLOUD_CRASHED } from "./check_cloud_migrations";

describe("check_generated_artifacts exit code", () => {
  it("is 0 when everything matches or is unbuilt", () => {
    expect(exitCodeFor([{ verdict: "ok" }, { verdict: "unbuilt" }])).toBe(0);
  });
  it("is FOUND for a stale or missing artifact, even beside an unreachable one", () => {
    expect(exitCodeFor([{ verdict: "stale" }])).toBe(CHECK_FOUND);
    expect(
      exitCodeFor([{ verdict: "missing" }, { verdict: "unreachable" }]),
    ).toBe(CHECK_FOUND);
  });
  it("is CRASHED when the bucket could not be reached and nothing was found", () => {
    expect(exitCodeFor([{ verdict: "ok" }, { verdict: "unreachable" }])).toBe(
      CHECK_CRASHED,
    );
    expect(CHECK_CRASHED).not.toBe(CHECK_FOUND);
  });
});

describe("check_cloud_migrations on a crash", () => {
  it("exits CHECK_CRASHED, not 1, when it cannot connect", () => {
    // Port 1 is closed: both pools fail to connect, which is the proxy-down
    // shape. Nothing is read from any real database.
    const r = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "check_cloud_migrations.ts",
        ),
      ],
      {
        env: {
          ...process.env,
          CLOUD_DATABASE_URL: "postgres://x:y@127.0.0.1:1/none",
          DATABASE_URL: "postgres://x:y@127.0.0.1:1/none",
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(r.status).toBe(CLOUD_CRASHED);
  }, 90_000);
});
