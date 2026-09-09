import type { QuestionCatalog } from "../types";

export const SQL_CAPABILITY_CONTRACT_VERSION = 1;
export const GUARDED_SQL_REQUIREMENTS = {
  nationalResults: { recipeVersion: 1, requiredSchemaVersion: 195 },
  presidentialResults: { recipeVersion: 1, requiredSchemaVersion: 195 },
} as const;
export const GUARDED_SQL_CAPABILITIES = new Set(
  Object.keys(GUARDED_SQL_REQUIREMENTS),
);

export interface SqlServerCapability {
  id: keyof typeof GUARDED_SQL_REQUIREMENTS;
  recipeVersion: number;
  requiredSchemaVersion: number;
  ready: boolean;
  sourceVersion: string | null;
  latestPeriod: string | null;
}

export interface SqlServerCapabilities {
  contractVersion: number;
  schemaVersion: number | null;
  sourceVersion: string | null;
  latestPeriod: string | null;
  capabilities: SqlServerCapability[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Fail closed when a staggered or malformed server response is encountered. */
export const parseSqlServerCapabilities = (
  value: unknown,
): SqlServerCapabilities | null => {
  if (!isRecord(value)) return null;
  if (value.contractVersion !== SQL_CAPABILITY_CONTRACT_VERSION) return null;
  if (
    value.schemaVersion !== null &&
    (!Number.isSafeInteger(value.schemaVersion) ||
      (value.schemaVersion as number) < 0)
  )
    return null;
  if (value.sourceVersion !== null && !isSha256(value.sourceVersion))
    return null;
  if (value.latestPeriod !== null && !isIsoDate(value.latestPeriod))
    return null;
  if (!Array.isArray(value.capabilities)) return null;

  const capabilities: SqlServerCapability[] = [];
  const seen = new Set<string>();
  for (const item of value.capabilities) {
    if (!isRecord(item) || typeof item.id !== "string" || seen.has(item.id))
      return null;
    if (!(item.id in GUARDED_SQL_REQUIREMENTS)) return null;
    seen.add(item.id);
    const id = item.id as keyof typeof GUARDED_SQL_REQUIREMENTS;
    const expected = GUARDED_SQL_REQUIREMENTS[id];
    if (
      item.recipeVersion !== expected.recipeVersion ||
      item.requiredSchemaVersion !== expected.requiredSchemaVersion ||
      typeof item.ready !== "boolean" ||
      (item.sourceVersion !== null && !isSha256(item.sourceVersion)) ||
      (item.latestPeriod !== null && !isIsoDate(item.latestPeriod))
    )
      return null;
    if (
      item.ready &&
      (!isSha256(item.sourceVersion) || !isIsoDate(item.latestPeriod))
    )
      return null;
    capabilities.push({
      id,
      recipeVersion: item.recipeVersion,
      requiredSchemaVersion: item.requiredSchemaVersion,
      ready: item.ready,
      sourceVersion: item.sourceVersion as string | null,
      latestPeriod: item.latestPeriod as string | null,
    });
  }
  if (seen.size !== Object.keys(GUARDED_SQL_REQUIREMENTS).length) return null;

  return {
    contractVersion: SQL_CAPABILITY_CONTRACT_VERSION,
    schemaVersion: value.schemaVersion as number | null,
    sourceVersion: value.sourceVersion as string | null,
    latestPeriod: value.latestPeriod as string | null,
    capabilities,
  };
};

export const isSqlServerCapabilityReady = (
  id: string,
  recipeVersion: number,
  value: unknown,
): boolean => {
  if (!(id in GUARDED_SQL_REQUIREMENTS)) return true;
  const server = parseSqlServerCapabilities(value);
  if (!server || server.schemaVersion === null) return false;
  const expected =
    GUARDED_SQL_REQUIREMENTS[id as keyof typeof GUARDED_SQL_REQUIREMENTS];
  if (
    recipeVersion !== expected.recipeVersion ||
    server.schemaVersion < expected.requiredSchemaVersion
  )
    return false;
  return Boolean(
    server.capabilities.find(
      (item) =>
        item.id === id &&
        item.ready &&
        item.recipeVersion === expected.recipeVersion &&
        item.requiredSchemaVersion === expected.requiredSchemaVersion,
    ),
  );
};

export const isGuardedSqlExecutionBlocked = (
  rendered: { recipeId: string; version: number } | null | undefined,
  value: unknown,
): boolean =>
  Boolean(
    rendered &&
    GUARDED_SQL_CAPABILITIES.has(rendered.recipeId) &&
    !isSqlServerCapabilityReady(rendered.recipeId, rendered.version, value),
  );

export const catalogForServerCapabilities = (
  catalog: QuestionCatalog,
  server: unknown,
): QuestionCatalog => ({
  ...catalog,
  questions: catalog.questions.map((question) => {
    const capabilityId = question.sql.capabilityId;
    if (!capabilityId || !GUARDED_SQL_CAPABILITIES.has(capabilityId))
      return question;
    if (
      isSqlServerCapabilityReady(
        capabilityId,
        question.sql.version ?? 1,
        server,
      )
    )
      return question;
    return {
      ...question,
      sql: {
        ...question.sql,
        status: "review" as const,
        reason: {
          bg: "Сървърът още не е потвърдил нужната версия на данните.",
          en: "The server has not confirmed the required data version yet.",
        },
      },
    };
  }),
});
