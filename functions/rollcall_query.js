const contract = require("./generated/rollcall_query");
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");
class RollcallError extends Error {
  constructor(reason, status = 400) {
    super(reason);
    this.status = status;
  }
}
const revisionSql =
  "(SELECT md5(COALESCE(string_agg(resource||':'||generation::text,',' ORDER BY resource),'')) FROM rollcall_query_revisions)";
function compileRollcallQuery(raw, depth = 0) {
  const p = contract.validateRollcallQuery(raw, depth);
  if (!p.ok) throw new RollcallError(p.errors.join(","));
  const q = p.query,
    params = [];
  const bind = (v) => {
    params.push(v);
    return "$" + params.length;
  };
  if (!q.corpus.startsWith("parliament"))
    return require("./rollcall_council").compileCouncilQuery(q, depth, {
      RollcallError,
      revisionSql,
      compileRollcallQuery,
    });
  if (
    !["records", "contested"].includes(q.metric) ||
    q.operation === "compare" ||
    q.groupBy
  )
    throw new RollcallError("metric_not_ready", 422);
  let parent = null;
  if (q.parentQuery) {
    parent = compileRollcallQuery(
      JSON.parse(decodeURIComponent(q.parentQuery)),
      depth + 1,
    );
    params.push(...parent.params);
  }
  const sessions = q.corpus === "parliamentSessions",
    casts = q.corpus === "parliamentCasts";
  const where = [];
  const defaultAssembly =
    !q.assemblyIds &&
    !q.from &&
    !q.seatIds &&
    !q.key &&
    !q.sessionKey &&
    !parent;
  const latestAssembly = sessions
    ? "SELECT ns::text FROM vote_day ORDER BY date DESC,ns DESC LIMIT 1"
    : `SELECT i.ns::text FROM vote_item i ${casts ? "WHERE EXISTS(SELECT 1 FROM vote_cast c WHERE c.item_id=i.item_id AND c.ns=i.ns)" : ""} ORDER BY i.date DESC,i.ns DESC LIMIT 1`;
  if (q.assemblyIds) where.push(`s.body=ANY(${bind(q.assemblyIds)}::text[])`);
  else if (defaultAssembly) where.push(`s.body=(${latestAssembly})`);
  if (q.from)
    where.push(
      `s.date>=${bind(q.from)}::date AND s.date<${bind(q.toExclusive)}::date`,
    );
  const bodyDateWhere = [...where];
  if (q.seatIds)
    where.push(
      casts
        ? `s.person_key=ANY(${bind(q.seatIds)}::text[])`
        : `EXISTS(SELECT 1 FROM vote_cast vc WHERE vc.item_id=s.item_id AND vc.ns::text||':'||vc.mp_id::text=ANY(${bind(q.seatIds)}::text[]))`,
    );
  if (q.factionIds)
    where.push(
      casts
        ? `s.faction=ANY(${bind(q.factionIds)}::text[])`
        : `EXISTS(SELECT 1 FROM vote_cast vc JOIN party_dim pd ON pd.party_id=vc.party_id WHERE vc.item_id=s.item_id AND pd.short=ANY(${bind(q.factionIds)}::text[]))`,
    );
  if (q.key) where.push(`s.key=${bind(q.key)}`);
  if (q.sessionKey) where.push(`s.session_key=${bind(q.sessionKey)}`);
  if (q.basis === "standing" && !sessions) where.push("s.standing");
  if (parent)
    where.push(
      `s.${q.relationship === "sessionVotes" ? "session_key" : "vote_key"} IN (SELECT jsonb_array_elements_text(result->'${q.relationship === "sessionVotes" ? "keys" : "voteKeys"}') FROM parent_result)`,
    );
  const itemKey = "i.ns::text||':'||i.date::text||':'||i.item_no::text";
  const castPushdown =
    casts && q.seatIds
      ? " WHERE " +
        q.seatIds
          .map((id) => {
            const [ns, mp] = id.split(":").map(Number);
            return `(c.ns=${bind(ns)}::int AND c.mp_id=${bind(mp)}::int)`;
          })
          .join(" OR ")
      : "";
  const source = sessions
    ? `SELECT d.ns::text||':'||d.date::text AS key,d.ns::text||':'||d.date::text AS session_key,NULL::text AS vote_key,NULL::int AS item_id,d.ns::text AS body,d.date,0 AS ordinal,NULL::text AS title,NULL::text AS person_key,NULL::text AS name,NULL::text AS faction,NULL::text AS choice,TRUE AS standing,d.pdf_url AS source_url,d.scraped_at AS scraped_at,(SELECT count(*)::int FROM vote_item v WHERE v.ns=d.ns AND v.date=d.date ${q.basis === "standing" ? "AND v.superseded_by IS NULL" : ""}) AS item_count,NULL::int AS yes,NULL::int AS no,NULL::int AS abstain,NULL::int AS absent,NULL::text AS superseded_by,NULL::numeric AS contested FROM vote_day d`
    : `SELECT ${itemKey}${casts ? "||'::'||c.mp_id::text" : ""} AS key,i.ns::text||':'||i.date::text AS session_key,${itemKey} AS vote_key,i.item_id,i.ns::text AS body,i.date,i.item_no AS ordinal,i.title,${casts ? "c.ns::text||':'||c.mp_id::text" : "NULL::text"} AS person_key,${casts ? "m.name" : "NULL::text"} AS name,${casts ? "pd.short" : "NULL::text"} AS faction,${casts ? "CASE c.vote WHEN 'y' THEN 'for' WHEN 'n' THEN 'against' WHEN 'a' THEN 'abstain' WHEN 'x' THEN 'recordedAbsent' END" : "NULL::text"} AS choice,i.superseded_by IS NULL AS standing,d.pdf_url AS source_url,d.scraped_at,NULL::int AS item_count,i.yes::int,i.no::int,i.abstain::int,i.absent::int,(SELECT v.ns::text||':'||v.date::text||':'||v.item_no::text FROM vote_item v WHERE v.item_id=i.superseded_by) AS superseded_by,CASE WHEN i.yes+i.no+i.abstain>0 THEN 100.0*LEAST(i.yes,i.no+i.abstain)/(i.yes+i.no+i.abstain) WHEN i.yes+i.no+i.abstain=0 THEN 0::numeric END AS contested FROM vote_item i LEFT JOIN vote_day d ON d.ns=i.ns AND d.date=i.date ${casts ? "JOIN vote_cast c ON c.item_id=i.item_id AND c.ns=i.ns JOIN mp_seat m ON m.ns=c.ns AND m.mp_id=c.mp_id LEFT JOIN party_dim pd ON pd.party_id=c.party_id" : ""}${castPushdown}`;
  const topics = [];
  if (q.keyword)
    topics.push(
      `lower(COALESCE(s.title,'')) LIKE lower(${bind("%" + escapeLike(q.keyword) + "%")})`,
    );
  for (const id of q.topicIds || [])
    topics.push(
      "(" +
        contract.ROLLCALL_TOPICS[id].stems
          .map(
            (stem) =>
              `lower(COALESCE(s.title,'')) LIKE ${bind("%" + escapeLike(stem) + "%")}`,
          )
          .join(" OR ") +
        ")",
    );
  const titleSubject = topics.length
    ? topics.join(q.topicMode === "any" ? " OR " : " AND ")
    : "TRUE";
  const subject =
    sessions && topics.length
      ? `EXISTS(SELECT 1 FROM vote_item v WHERE v.ns::text=s.body AND v.date=s.date ${q.basis === "standing" ? "AND v.superseded_by IS NULL" : ""} AND (${titleSubject.replaceAll("s.title", "v.title")}))`
      : titleSubject;
  const choice = q.choice ? `choice=${bind(q.choice)}` : "TRUE";
  const sort = q.metric === "contested" ? "contested DESC NULLS LAST," : "";
  const parentCte = parent
    ? `parent_result AS MATERIALIZED(${parent.sql}),`
    : "";
  const sql = `WITH ${parentCte}source AS NOT MATERIALIZED(${source}),body_coverage AS (SELECT s.* FROM (SELECT ns::text AS body,date FROM vote_day) s WHERE ${bodyDateWhere.join(" AND ") || "TRUE"}),candidates AS MATERIALIZED(SELECT s.* FROM source s WHERE ${where.join(" AND ") || "TRUE"}),
 matches AS MATERIALIZED(SELECT * FROM candidates s WHERE ${subject}),
 cohort AS MATERIALIZED(SELECT * FROM matches ORDER BY date DESC,ordinal DESC,key ${q.latestN ? "LIMIT " + bind(q.latestN) : ""}),
 selected AS MATERIALIZED(SELECT * FROM cohort WHERE ${choice}),
 page AS (SELECT * FROM selected ORDER BY ${sort}date ${q.order.toUpperCase()},ordinal ${q.order.toUpperCase()},key LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)}),
 tally AS (SELECT c.item_id,count(*) FILTER(WHERE c.vote='y') AS named_for,count(*) FILTER(WHERE c.vote='n') AS named_against,count(*) FILTER(WHERE c.vote='a') AS named_abstain,count(*) FILTER(WHERE c.vote='x') AS named_absent FROM vote_cast c WHERE c.item_id IN (SELECT item_id FROM page) GROUP BY c.item_id)
 SELECT jsonb_build_object('query',${bind(JSON.stringify(q))}::jsonb,'revision',${revisionSql},'rows',COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('named_for',t.named_for,'named_against',t.named_against,'named_abstain',t.named_abstain,'named_absent',t.named_absent,'tally_mismatch',CASE WHEN p.item_id IS NULL THEN NULL ELSE (p.yes,p.no,p.abstain,p.absent) IS DISTINCT FROM (t.named_for,t.named_against,t.named_abstain,t.named_absent) END) ORDER BY ${q.metric === "contested" ? "p.contested DESC NULLS LAST," : ""}p.date ${q.order.toUpperCase()},p.ordinal ${q.order.toUpperCase()},p.key) FROM page p LEFT JOIN tally t USING(item_id)),'[]'::jsonb),
 'totals',jsonb_build_object('records',(SELECT count(*) FROM selected),'cohortRecords',(SELECT count(*) FROM cohort)),
 'coverage',jsonb_build_object('indexedDays',(SELECT count(*) FROM body_coverage),'candidates',(SELECT count(*) FROM candidates),'untitled',(SELECT count(*) FROM candidates s WHERE ${sessions ? "EXISTS(SELECT 1 FROM vote_item v WHERE v.ns::text=s.body AND v.date=s.date AND (v.title IS NULL OR v.title=''))" : "title IS NULL OR title=''"}),'latestIndexed',(SELECT max(date) FROM candidates),'sourceMissing',(SELECT count(*) FROM selected WHERE source_url IS NULL),'bodies',(SELECT jsonb_agg(DISTINCT body) FROM candidates)),
 'keys',${depth ? "(SELECT COALESCE(jsonb_agg(key),'[]'::jsonb) FROM selected)" : "'[]'::jsonb"},'voteKeys',${depth ? "(SELECT COALESCE(jsonb_agg(DISTINCT vote_key),'[]'::jsonb) FROM selected)" : "'[]'::jsonb"}) AS result`;
  return {
    query: q,
    sql,
    params,
    defaultAssembly,
    revisions: [
      ...(q.expectedRevision ? [q.expectedRevision] : []),
      ...(parent?.revisions || []),
    ],
  };
}
async function runRollcallQuery(db, raw) {
  if (process.env.ROLLCALL_QUERY_DISABLED === "1")
    return { body: { status: "unavailable", reason: "capability_disabled" } };
  let c;
  try {
    c = compileRollcallQuery(raw);
  } catch (e) {
    if (e instanceof RollcallError)
      return {
        status: e.status,
        body: { status: "unsupported", reason: e.message },
      };
    throw e;
  }
  try {
    const r = (await db(c.sql, c.params))[0]?.result;
    if (!r) throw new Error("Missing roll-call result");
    if (c.revisions.some((rev) => rev !== r.revision))
      return {
        status: 409,
        body: {
          status: "stale",
          reason: "revision_changed",
          query: c.query,
          revision: r.revision,
        },
      };
    if (c.defaultAssembly && r.coverage.bodies?.length)
      r.query.assemblyIds = r.coverage.bodies;
    if (r.dateQualityUnsupported)
      return {
        body: {
          status: "unsupported",
          reason: "source_year_only",
          query: c.query,
          coverage: r.coverage,
          revision: r.revision,
        },
      };
    if (
      c.query.corpus === "councilCasts" &&
      !r.coverage.namedResolutions &&
      r.coverage.resolutionRecords
    )
      return {
        body: {
          status: "unavailable",
          reason: "named_roll_not_published",
          query: c.query,
          coverage: r.coverage,
          revision: r.revision,
        },
      };
    const partial =
      r.coverage.sourceMissing > 0 ||
      (c.query.corpus === "councilCasts" && r.coverage.missingRolls > 0) ||
      r.coverage.yearOnly > 0 ||
      r.rows.some((row) => row.tally_mismatch) ||
      ((c.query.topicIds || c.query.keyword) && r.coverage.untitled > 0);
    delete r.keys;
    delete r.voteKeys;
    return {
      body: {
        ...r,
        status: r.totals.records
          ? partial
            ? "partial"
            : "success"
          : r.coverage.indexedDays
            ? "empty"
            : "unavailable",
        reason:
          !r.totals.records && !r.coverage.indexedDays
            ? "scope_not_indexed"
            : !r.totals.records && c.query.key
              ? "record_not_found"
              : undefined,
      },
    };
  } catch (e) {
    if (["42P01", "42883", "42501", "57014"].includes(e.code))
      return {
        body: {
          status: "unavailable",
          reason: e.code === "57014" ? "query_timeout" : "source_unavailable",
          query: c.query,
        },
      };
    throw e;
  }
}
async function rollcallEntities(db, args) {
  const name = String(args.name || "").trim();
  if (name.length < 2 || name.length > 150)
    return { status: 400, body: { error: "name_required" } };
  if (args.corpus && !String(args.corpus).startsWith("parliament"))
    return require("./rollcall_council").councilEntities(db, args, revisionSql);
  const tokens = name.split(/\s+/).map(escapeLike);
  const params = tokens.map((t) => "%" + t + "%");
  const conditions = tokens.map(
    (_, i) => `translit_bg_latin(s.name) LIKE translit_bg_latin($${i + 1})`,
  );
  if (args.ns) {
    if (!/^\d{1,2}$/.test(String(args.ns)))
      return { status: 400, body: { error: "invalid_assembly" } };
    params.push(String(args.ns));
    conditions.push(`s.ns::text=$${params.length}`);
  }
  const snapshot = (
    await db(
      `WITH candidates AS (SELECT s.ns,s.mp_id,s.name,s.ns::text||':'||s.mp_id::text AS seat_key, CASE WHEN count(DISTINCT p.person_id)=1 THEN min(p.person_id)::text END AS verified_person FROM mp_seat s LEFT JOIN person_role r ON r.source='mp' AND r.ref=s.mp_id::text||':'||s.ns::text AND r.confidence IN ('exact_id','manual','high') LEFT JOIN person p ON p.person_id=r.person_id AND p.status='active' AND translit_bg_latin(p.display_name)=translit_bg_latin(s.name) WHERE ${conditions.join(" AND ")} GROUP BY s.ns,s.mp_id,s.name ORDER BY s.ns DESC,s.name,s.mp_id LIMIT 101) SELECT COALESCE((SELECT jsonb_agg(candidates) FROM candidates),'[]'::jsonb) AS rows,${revisionSql} AS revision`,
      params,
    )
  )[0];
  const rows = snapshot.rows;
  if (rows.length > 100)
    return {
      body: { status: "clarify", reason: "too_many_people", candidates: [] },
    };
  const groups = new Map();
  for (const row of rows) {
    const key = row.verified_person
      ? "person:" + row.verified_person
      : row.seat_key;
    if (!groups.has(key))
      groups.set(key, {
        label: row.name,
        seatIds: [],
        assemblies: [],
        verified: !!row.verified_person,
      });
    const g = groups.get(key);
    g.seatIds.push(row.seat_key);
    g.assemblies.push(row.ns);
  }
  return {
    body: { candidates: [...groups.values()], revision: snapshot.revision },
  };
}
async function rollcallCapabilities(db) {
  if (process.env.ROLLCALL_QUERY_DISABLED === "1")
    return { body: { version: contract.ROLLCALL_VERSION, corpora: {} } };
  const parliamentSql = `WITH assemblies AS (SELECT ns::text AS id,min(date)::text AS first,max(date)::text AS latest,count(*)::int AS sessions FROM vote_day GROUP BY ns ORDER BY ns) SELECT COALESCE((SELECT jsonb_agg(assemblies) FROM assemblies),'[]'::jsonb) AS rows,EXISTS(SELECT 1 FROM vote_item) AS has_votes,EXISTS(SELECT 1 FROM vote_cast) AS has_casts,${revisionSql} AS revision`;
  const councilSql = `SELECT COALESCE((SELECT jsonb_agg(x) FROM (SELECT m.obshtina_code AS id,m.name,min(r.decided_on)::text AS first,max(r.decided_on)::text AS latest,count(r.id)::int AS resolutions,count(r.id) FILTER(WHERE r.has_named_votes)::int AS named, m.obshtina_code IN (SELECT jsonb_array_elements_text(value->'yearOnlyCouncils') FROM rollcall_query_meta WHERE key='catalog') AS year_only,(SELECT jsonb_agg(frontend_code) FROM council_muni_code b WHERE b.obshtina_code=m.obshtina_code) AS frontend_ids FROM council_muni m LEFT JOIN council_resolution r USING(obshtina_code) GROUP BY m.obshtina_code,m.name ORDER BY m.name) x),'[]'::jsonb) AS councils,${revisionSql} AS revision`;
  const combinedSql = `WITH assemblies AS (SELECT ns::text AS id,min(date)::text AS first,max(date)::text AS latest,count(*)::int AS sessions FROM vote_day GROUP BY ns ORDER BY ns) SELECT COALESCE((SELECT jsonb_agg(assemblies) FROM assemblies),'[]'::jsonb) AS rows,EXISTS(SELECT 1 FROM vote_item) AS has_votes,EXISTS(SELECT 1 FROM vote_cast) AS has_casts,COALESCE((SELECT jsonb_agg(x) FROM (SELECT m.obshtina_code AS id,m.name,min(r.decided_on)::text AS first,max(r.decided_on)::text AS latest,count(r.id)::int AS resolutions,count(r.id) FILTER(WHERE r.has_named_votes)::int AS named, m.obshtina_code IN (SELECT jsonb_array_elements_text(value->'yearOnlyCouncils') FROM rollcall_query_meta WHERE key='catalog') AS year_only,(SELECT jsonb_agg(frontend_code) FROM council_muni_code b WHERE b.obshtina_code=m.obshtina_code) AS frontend_ids FROM council_muni m LEFT JOIN council_resolution r USING(obshtina_code) GROUP BY m.obshtina_code,m.name ORDER BY m.name) x),'[]'::jsonb) AS councils,${revisionSql} AS revision`;
  let snapshot;
  try {
    snapshot = (await db(combinedSql, []))[0];
  } catch (e) {
    if (!["42P01", "42883", "42501", "57014"].includes(e.code)) throw e;
    const probe = async (sql) => {
      try {
        return (await db(sql, []))[0];
      } catch (error) {
        if (!["42P01", "42883", "42501", "57014"].includes(error.code))
          throw error;
        return null;
      }
    };
    const [p, c] = await Promise.all([probe(parliamentSql), probe(councilSql)]);
    snapshot = {
      ...p,
      ...c,
      parliamentRevision: p?.revision,
      councilRevision: c?.revision,
    };
  }
  const rows = snapshot.rows || [],
    councils = snapshot.councils || [];
  return {
    body: {
      version: contract.ROLLCALL_VERSION,
      revision: snapshot.revision,
      assemblies: rows,
      councils,
      corpora: Object.fromEntries(
        contract.ROLLCALL_CORPORA.map((c) => [
          c,
          {
            ready: c.startsWith("council")
              ? councils.some((b) =>
                  c === "councilCasts"
                    ? b.named > 0
                    : c === "councilSessions"
                      ? b.resolutions > 0 && !b.year_only
                      : b.resolutions > 0,
                )
              : c === "parliamentSessions"
                ? rows.length > 0
                : c === "parliamentVotes"
                  ? !!snapshot.has_votes
                  : !!snapshot.has_casts,
            revision: c.startsWith("council")
              ? snapshot.councilRevision || snapshot.revision
              : snapshot.parliamentRevision || snapshot.revision,
            operations: ["list", "detail", "count", "summary", "methodology"],
            metrics: ["records"],
            dateBasis: c.startsWith("council") ? "decision" : "sitting",
            basis: c.startsWith("council")
              ? ["attempts"]
              : ["attempts", "standing"],
          },
        ]),
      ),
    },
  };
}
module.exports = {
  compileRollcallQuery,
  runRollcallQuery,
  rollcallEntities,
  rollcallCapabilities,
};

async function rollcallCatalog(db) {
  const result = await rollcallCapabilities(db);
  return {
    body: {
      ...result.body,
      topics: contract.ROLLCALL_TOPICS,
      choices: {
        parliament: ["for", "against", "abstain", "recordedAbsent"],
        council: ["for", "against", "abstain"],
      },
    },
  };
}
module.exports.rollcallCatalog = rollcallCatalog;
