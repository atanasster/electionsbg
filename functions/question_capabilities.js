// Explicit server contract for SQL question recipes whose schema was added
// after the original browser shipped. The UI consumes this declaration; it
// must never guess function/relation support from the schema explorer rows.
const { createHash } = require("node:crypto");

const CONTRACT_VERSION = 1;
const GUARDED_CAPABILITIES = [
  {
    id: "nationalResults",
    recipeVersion: 1,
    requiredSchemaVersion: 195,
    functionSignature: "election_national_results(text,text,integer)",
  },
  {
    id: "presidentialResults",
    recipeVersion: 1,
    requiredSchemaVersion: 195,
    functionSignature: "election_national_results(text,text,integer)",
  },
];

const REQUIRED_RELATIONS = {
  election_contest: [
    "contest_id",
    "contest_key",
    "election_type",
    "election_date",
    "round",
    "percentage_basis",
    "source_sha256",
    "granular_sha256",
    "granular_reconciled",
  ],
  election_national_result: [
    "contest_id",
    "choice_key",
    "choice_name",
    "votes",
    "pct",
    "seats",
  ],
};

const EXPECTED_FUNCTION_RESULT =
  "TABLE(election_id text, contest_key text, election_type text, result_grain text, election_date date, round smallint, registered_voters bigint, actual_voters bigint, pct_denominator_votes bigint, none_of_above_votes bigint, invalid_votes bigint, percentage_basis text, choice_key text, choice_kind text, choice_number integer, canonical_party_id text, president_name text, vice_president_name text, choice_name text, choice_short text, votes bigint, pct double precision, seats integer, passed_threshold boolean, source_path text, source_sha256 text, granular_source_path text, granular_sha256 text)";

async function readQuestionCapabilities(pool) {
  const rows = await pool
    .query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [Object.keys(REQUIRED_RELATIONS)],
    )
    .then((result) => result.rows);
  const columns = new Map();
  for (const row of rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
    columns.get(row.table_name).add(row.column_name);
  }
  const relationsReady = Object.entries(REQUIRED_RELATIONS).every(
    ([relation, required]) =>
      required.every((column) => columns.get(relation)?.has(column)),
  );
  const functionRows = relationsReady
    ? await pool
        .query(
          `SELECT to_regprocedure(signature) IS NOT NULL AS present,
                  pg_get_function_result(to_regprocedure(signature)) AS result,
                  has_function_privilege(
                    current_user,
                    to_regprocedure(signature),
                    'EXECUTE'
                  ) AS executable
           FROM unnest($1::text[]) AS signature`,
          [
            [
              ...new Set(
                GUARDED_CAPABILITIES.map((item) => item.functionSignature),
              ),
            ],
          ],
        )
        .then((result) => result.rows)
    : [];
  const functionsReady =
    functionRows.length > 0 &&
    functionRows.every(
      (row) =>
        row.present &&
        row.executable &&
        typeof row.result === "string" &&
        row.result.replace(/\s+/g, " ") === EXPECTED_FUNCTION_RESULT,
    );
  const dataRows =
    relationsReady && functionsReady
      ? await pool
          .query(
            `SELECT election_type,
                  string_agg(
                    concat_ws(':', contest_id, COALESCE(round::text, '-'), source_sha256, granular_sha256),
                    ',' ORDER BY contest_id, round NULLS FIRST
                  ) AS source_material,
                  MAX(election_date)::text AS latest_period,
                  COUNT(*)::integer AS contest_count
         FROM (
             SELECT DISTINCT c.contest_id, c.election_type, c.round,
                    c.source_sha256, c.granular_sha256, c.election_date
             FROM election_contest c
             WHERE c.granular_reconciled
               AND c.source_sha256 IS NOT NULL
               AND c.granular_sha256 IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM election_national_result r
                 WHERE r.contest_id = c.contest_id
               )
           ) AS eligible
           GROUP BY election_type`,
          )
          .then((result) => result.rows)
      : [];
  const dataByType = new Map(
    dataRows.map((row) => [
      row.election_type,
      {
        sourceVersion: createHash("sha256")
          .update(row.source_material)
          .digest("hex"),
        latestPeriod: row.latest_period,
        contestCount: Number(row.contest_count),
      },
    ]),
  );
  const capabilities = GUARDED_CAPABILITIES.map((item) => {
    const electionType =
      item.id === "presidentialResults" ? "presidential" : "parliamentary";
    const data = dataByType.get(electionType);
    return {
      id: item.id,
      recipeVersion: item.recipeVersion,
      requiredSchemaVersion: item.requiredSchemaVersion,
      ready: Boolean(
        data?.sourceVersion && data?.latestPeriod && data.contestCount,
      ),
      sourceVersion: data?.sourceVersion ?? null,
      latestPeriod: data?.latestPeriod ?? null,
    };
  });
  const allReady = capabilities.every((item) => item.ready);
  const sourceVersion = allReady
    ? createHash("sha256")
        .update(
          capabilities
            .map((item) => `${item.id}:${item.sourceVersion}`)
            .sort()
            .join(","),
        )
        .digest("hex")
    : null;
  const latestPeriod = allReady
    ? capabilities
        .map((item) => item.latestPeriod)
        .filter(Boolean)
        .sort()
        .at(-1)
    : null;

  return {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: relationsReady && functionsReady ? 195 : null,
    sourceVersion,
    latestPeriod,
    capabilities,
  };
}

module.exports = {
  CONTRACT_VERSION,
  GUARDED_CAPABILITIES,
  REQUIRED_RELATIONS,
  EXPECTED_FUNCTION_RESULT,
  readQuestionCapabilities,
};
