import { describe, expect, it } from "vitest";
import { SQL_QUESTION_CATALOG } from "./catalog";
import {
  catalogForServerCapabilities,
  isGuardedSqlExecutionBlocked,
  isSqlServerCapabilityReady,
  parseSqlServerCapabilities,
  SQL_CAPABILITY_CONTRACT_VERSION,
} from "./capabilities";

const HASH = "a".repeat(64);
const manifest = {
  contractVersion: SQL_CAPABILITY_CONTRACT_VERSION,
  schemaVersion: 195,
  sourceVersion: "b".repeat(64),
  latestPeriod: "2026-04-19",
  capabilities: [
    {
      id: "nationalResults",
      recipeVersion: 1,
      requiredSchemaVersion: 195,
      ready: true,
      sourceVersion: HASH,
      latestPeriod: "2026-04-19",
    },
    {
      id: "presidentialResults",
      recipeVersion: 1,
      requiredSchemaVersion: 195,
      ready: true,
      sourceVersion: HASH,
      latestPeriod: "2021-11-21",
    },
  ],
};

const statuses = (server: unknown) =>
  Object.fromEntries(
    catalogForServerCapabilities(SQL_QUESTION_CATALOG, server)
      .questions.filter((question) =>
        ["nationalResults", "presidentialResults"].includes(question.id),
      )
      .map((question) => [question.id, question.sql.status]),
  );

describe("server-gated SQL question availability", () => {
  it("keeps new recipes in review when the deployed server has no contract", () => {
    expect(statuses(undefined)).toEqual({
      nationalResults: "review",
      presidentialResults: "review",
    });
  });

  it("promotes exact, populated recipe and schema versions", () => {
    expect(statuses(manifest)).toEqual({
      nationalResults: "ready",
      presidentialResults: "ready",
    });
    expect(isSqlServerCapabilityReady("nationalResults", 1, manifest)).toBe(
      true,
    );
    expect(
      isGuardedSqlExecutionBlocked(
        { recipeId: "nationalResults", version: 1 },
        manifest,
      ),
    ).toBe(false);
  });

  it.each([
    { ...manifest, contractVersion: 2 },
    { ...manifest, capabilities: manifest.capabilities.slice(0, 1) },
    {
      ...manifest,
      capabilities: [manifest.capabilities[0], manifest.capabilities[0]],
    },
    {
      ...manifest,
      capabilities: manifest.capabilities.map((item, index) =>
        index === 0 ? { ...item, sourceVersion: "fixture" } : item,
      ),
    },
    {
      ...manifest,
      capabilities: manifest.capabilities.map((item, index) =>
        index === 0 ? { ...item, recipeVersion: 2 } : item,
      ),
    },
  ])("fails closed for malformed or incompatible manifests", (candidate) => {
    expect(parseSqlServerCapabilities(candidate)).toBeNull();
    expect(statuses(candidate)).toEqual({
      nationalResults: "review",
      presidentialResults: "review",
    });
  });

  it("keeps recipes guarded when a valid manifest reports an older schema", () => {
    const older = { ...manifest, schemaVersion: 194 };
    expect(parseSqlServerCapabilities(older)).not.toBeNull();
    expect(statuses(older)).toEqual({
      nationalResults: "review",
      presidentialResults: "review",
    });
    expect(
      isGuardedSqlExecutionBlocked(
        { recipeId: "nationalResults", version: 1 },
        older,
      ),
    ).toBe(true);
    expect(
      isGuardedSqlExecutionBlocked(
        { recipeId: "top-contractors", version: 1 },
        null,
      ),
    ).toBe(false);
  });
});
