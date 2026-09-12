const contract = require("./generated/rollcall_query");
const escaped = (s) => s.replace(/[\\%_]/g, "\\$&");
const sessionKey =
  "r.obshtina_code||':'||r.decided_on::text||':'||COALESCE(r.session,'unknown:'||r.id)";
function compileCouncilQuery(
  q,
  depth,
  { RollcallError, revisionSql, compileRollcallQuery },
) {
  if (q.metric !== "records" || q.groupBy || q.operation === "compare")
    throw new RollcallError("metric_not_ready", 422);
  const parent = q.parentQuery
    ? compileRollcallQuery(
        JSON.parse(decodeURIComponent(q.parentQuery)),
        depth + 1,
      )
    : null;
  const params = parent ? [...parent.params] : [];
  const bind = (v) => {
    params.push(v);
    return "$" + params.length;
  };
  const sessions = q.corpus === "councilSessions",
    casts = q.corpus === "councilCasts";
  const body = [];
  if (q.councilIds)
    body.push(`r.obshtina_code=ANY(${bind(q.councilIds)}::text[])`);
  const date = [];
  if (q.from)
    date.push(
      `r.decided_on>=${bind(q.from)}::date AND r.decided_on<${bind(q.toExclusive)}::date`,
    );
  const basic = [...body, ...date];
  const filters = [];
  const evidenceKeys = [];
  if (q.key) {
    filters.push(`s.key=${bind(q.key)}`);
    evidenceKeys.push(`s.vote_key=${bind(q.key.split("::")[0])}`);
  }
  const identityFilterCount = filters.length;
  if (q.sessionKey) filters.push(`s.session_key=${bind(q.sessionKey)}`);
  if (q.councilCastKeys)
    filters.push(
      casts
        ? `s.key=ANY(${bind(q.councilCastKeys)}::text[])`
        : `EXISTS(SELECT 1 FROM council_vote v WHERE v.resolution_id=s.vote_key AND v.resolution_id||'::'||v.norm_key=ANY(${bind(q.councilCastKeys)}::text[]))`,
    );
  if (sessions && (q.outcome || q.tallyMethod))
    throw new RollcallError("session_resolution_predicate_required", 422);
  if (q.outcome) filters.push(`s.outcome=${bind(q.outcome)}`);
  if (q.named)
    filters.push(`s.has_named_votes=${q.named === "yes" ? "TRUE" : "FALSE"}`);
  if (q.tallyMethod) filters.push(`s.tally_method=${bind(q.tallyMethod)}`);
  if (parent)
    filters.push(
      `s.${q.relationship === "sessionVotes" ? "session_key" : "vote_key"} IN (SELECT jsonb_array_elements_text(result->'${q.relationship === "sessionVotes" ? "keys" : "voteKeys"}') FROM parent_result)`,
    );
  const subjects = [];
  if (q.keyword)
    subjects.push(
      `lower(COALESCE(s.title,'')) LIKE lower(${bind("%" + escaped(q.keyword) + "%")})`,
    );
  for (const id of q.topicIds || [])
    subjects.push(
      "(" +
        contract.ROLLCALL_TOPICS[id].stems
          .map(
            (stem) =>
              `lower(COALESCE(s.title,'')) LIKE ${bind("%" + escaped(stem) + "%")}`,
          )
          .join(" OR ") +
        ")",
    );
  const topic =
    subjects.join(q.topicMode === "any" ? " OR " : " AND ") || "TRUE";
  const subject =
    sessions && subjects.length
      ? `EXISTS(SELECT 1 FROM council_resolution r WHERE ${sessionKey}=s.session_key AND (${topic.replaceAll("s.title", "r.title")}))`
      : topic;
  const unknownDate =
    "r.obshtina_code IN (SELECT jsonb_array_elements_text(value->'yearOnlyCouncils') FROM rollcall_query_meta WHERE key='catalog')";
  const source = sessions
    ? `SELECT ${sessionKey} AS key,${sessionKey} AS session_key,NULL::text AS vote_key,r.obshtina_code AS body,r.decided_on AS date,0 AS ordinal,NULL::text AS title,NULL::text AS name,NULL::text AS person_key,NULL::text AS choice,NULL::text AS faction,NULL::text AS outcome,NULL::text AS tally_method,bool_or(r.has_named_votes) AS has_named_votes,min(r.source_url) AS source_url,max(r.last_seen_at) AS scraped_at,count(*)::int AS item_count,NULL::int AS yes,NULL::int AS no,NULL::int AS abstain,NULL::int AS absent,bool_or(${unknownDate}) AS year_only FROM council_resolution r WHERE ${basic.join(" AND ") || "TRUE"} GROUP BY r.obshtina_code,r.decided_on,r.session,${sessionKey}`
    : `SELECT ${casts ? "r.id||'::'||v.norm_key" : "r.id"} AS key,${sessionKey} AS session_key,r.id AS vote_key,r.obshtina_code AS body,r.decided_on AS date,0 AS ordinal,r.title,${casts ? "v.councillor" : "NULL::text"} AS name,${casts ? "r.id||'::'||v.norm_key" : "NULL::text"} AS person_key,${casts ? "v.vote" : "NULL::text"} AS choice,NULL::text AS faction,r.result AS outcome,r.tally_method,r.has_named_votes,r.source_url,r.last_seen_at AS scraped_at,NULL::int AS item_count,r.tally_for AS yes,r.tally_against AS no,r.tally_abstain AS abstain,NULL::int AS absent,${unknownDate} AS year_only FROM council_resolution r ${casts ? "JOIN council_vote v ON v.resolution_id=r.id" : ""} WHERE ${basic.join(" AND ") || "TRUE"}`;
  const evidenceFilters = filters
    .slice(identityFilterCount)
    .filter((f) => !f.startsWith("s.key=ANY"));
  if (q.councilCastKeys)
    evidenceFilters.push(
      `s.vote_key=ANY(${bind([...new Set(q.councilCastKeys.map((k) => k.split("::")[0]))])}::text[])`,
    );
  evidenceFilters.push(...evidenceKeys);
  const evidenceSource = casts
    ? source
        .replaceAll("r.id||'::'||v.norm_key", "r.id")
        .replace("v.councillor", "NULL::text")
        .replace("v.vote", "NULL::text")
        .replace("JOIN council_vote v ON v.resolution_id=r.id", "")
    : source;
  const sql = `WITH ${parent ? `parent_result AS MATERIALIZED(${parent.sql}),` : ""}source AS NOT MATERIALIZED(${source}),
 evidence_source AS NOT MATERIALIZED(${evidenceSource}),
 resolution_coverage AS MATERIALIZED(SELECT DISTINCT s.vote_key FROM evidence_source s WHERE ${evidenceFilters.join(" AND ") || "TRUE"} AND (${subject})),
 roll_coverage AS MATERIALIZED(SELECT rc.vote_key,EXISTS(SELECT 1 FROM council_vote v WHERE v.resolution_id=rc.vote_key) AS published FROM resolution_coverage rc),
 body_coverage AS MATERIALIZED(SELECT r.* FROM council_resolution r WHERE ${basic.join(" AND ") || "TRUE"}),
 candidates AS MATERIALIZED(SELECT * FROM source s WHERE ${filters.join(" AND ") || "TRUE"}),
 matches AS MATERIALIZED(SELECT * FROM candidates s WHERE ${subject}),
 cohort AS MATERIALIZED(SELECT * FROM matches ORDER BY date DESC,key ${q.latestN ? "LIMIT " + bind(q.latestN) : ""}),
 selected AS MATERIALIZED(SELECT * FROM cohort WHERE ${q.choice ? "choice=" + bind(q.choice) : "TRUE"}),
 page AS (SELECT * FROM selected ORDER BY date ${q.order.toUpperCase()},key LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)}),
 tally AS (SELECT v.resolution_id AS vote_key,count(*) FILTER(WHERE vote='for') AS named_for,count(*) FILTER(WHERE vote='against') AS named_against,count(*) FILTER(WHERE vote='abstain') AS named_abstain FROM council_vote v WHERE resolution_id IN (SELECT vote_key FROM page) GROUP BY resolution_id)
 SELECT jsonb_build_object('query',${bind(JSON.stringify(q))}::jsonb,'revision',${revisionSql},
 'rows',COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('named_for',t.named_for,'named_against',t.named_against,'named_abstain',t.named_abstain,'tally_mismatch',CASE WHEN t.vote_key IS NULL THEN NULL ELSE (p.yes,p.no,p.abstain) IS DISTINCT FROM (t.named_for,t.named_against,t.named_abstain) END) ORDER BY p.date ${q.order.toUpperCase()},p.key) FROM page p LEFT JOIN tally t USING(vote_key)),'[]'::jsonb),
 'totals',jsonb_build_object('records',(SELECT count(*) FROM selected),'cohortRecords',(SELECT count(*) FROM cohort)),
 'coverage',jsonb_build_object('indexedDays',(SELECT count(DISTINCT decided_on) FROM body_coverage),'namedResolutions',(SELECT count(*) FROM roll_coverage WHERE published),'resolutionRecords',(SELECT count(*) FROM roll_coverage),'missingRolls',(SELECT count(*) FROM roll_coverage WHERE NOT published),'publishedCasts',(SELECT count(*) FROM cohort),'candidates',(SELECT count(*) FROM candidates),'untitled',(SELECT count(*) FROM body_coverage WHERE title IS NULL OR title='' OR title='(no title parsed)'),'latestIndexed',(SELECT max(date) FROM candidates),'sourceMissing',(SELECT count(*) FROM selected WHERE source_url IS NULL),'bodies',(SELECT jsonb_agg(DISTINCT body) FROM candidates),'yearOnly',(SELECT count(*) FROM body_coverage r WHERE ${unknownDate})),
 'dateQualityUnsupported',${parent ? "COALESCE((SELECT (result->>'dateQualityUnsupported')::boolean FROM parent_result),FALSE) OR " : ""}${sessions || (q.from && (!q.from.endsWith("-01-01") || !q.toExclusive.endsWith("-01-01"))) ? `EXISTS(SELECT 1 FROM council_resolution r WHERE ${body.join(" AND ") || "TRUE"} AND ${unknownDate}${q.from ? ` AND r.decided_on>=date_trunc('year',${bind(q.from)}::date) AND r.decided_on<${bind(q.toExclusive)}::date` : ""})` : "FALSE"},
 'keys',${depth ? "(SELECT COALESCE(jsonb_agg(key),'[]'::jsonb) FROM selected)" : "'[]'::jsonb"},'voteKeys',${depth ? "(SELECT COALESCE(jsonb_agg(DISTINCT vote_key),'[]'::jsonb) FROM selected)" : "'[]'::jsonb"}) AS result`;
  return {
    query: q,
    sql,
    params,
    revisions: [
      ...(q.expectedRevision ? [q.expectedRevision] : []),
      ...(parent?.revisions || []),
    ],
  };
}
async function councilEntities(db, args, revisionSql) {
  const code = String(args.council || "");
  const name = String(args.name || "").trim();
  if (!/^[A-Z0-9]{3,10}$/.test(code) || name.length < 2 || name.length > 150)
    return { status: 400, body: { error: "council_and_name_required" } };
  if (args.namespace && !["source", "frontend"].includes(args.namespace))
    return { status: 400, body: { error: "invalid_council_namespace" } };
  const tokens = name.split(/\s+/).map(escaped),
    params = [code, ...tokens.map((t) => "%" + t + "%")];
  const terms = tokens.map(
    (_, i) =>
      `translit_bg_latin(v.councillor) LIKE translit_bg_latin($${i + 2})`,
  );
  if (args.from || args.toExclusive) {
    if (
      !contract.validateRollcallQuery({
        corpus: "councilResolutions",
        from: args.from,
        toExclusive: args.toExclusive,
      }).ok
    )
      return { status: 400, body: { error: "invalid_dates" } };
    params.push(args.from, args.toExclusive);
    terms.push(
      `r.decided_on>=$${params.length - 1}::date AND r.decided_on<$${params.length}::date`,
    );
  }
  const snap = (
    await db(
      `WITH council AS (${args.namespace === "frontend" ? "SELECT obshtina_code FROM council_muni_code WHERE frontend_code=$1" : "SELECT obshtina_code FROM council_muni WHERE obshtina_code=$1"}),matches AS (SELECT r.obshtina_code AS council,r.id||'::'||v.norm_key AS key,v.councillor AS name,r.decided_on::text AS date,r.source_url FROM council_vote v JOIN council_resolution r ON r.id=v.resolution_id WHERE r.obshtina_code IN (SELECT obshtina_code FROM council) AND ${terms.join(" AND ")} ORDER BY r.decided_on DESC,r.id,v.norm_key LIMIT 101) SELECT COALESCE((SELECT jsonb_agg(matches) FROM matches),'[]'::jsonb) AS rows,${revisionSql} AS revision`,
      params,
    )
  )[0];
  return {
    body: {
      status: snap.rows.length ? "clarify" : "empty",
      reason:
        snap.rows.length > 100
          ? "narrow_source_scope"
          : "source_name_not_verified_identity",
      sourceRows: snap.rows.slice(0, 100),
      revision: snap.revision,
    },
  };
}
module.exports = { compileCouncilQuery, councilEntities };
