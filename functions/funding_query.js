// All aggregates, evidence checks and pages use a single PostgreSQL snapshot.
const contract = require("./generated/funding_query");
class FundingQueryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const like = (s) => s.replace(/[\\%_]/g, "\\$&");
function compileFundingQuery(raw) {
  const parsed = contract.validateFundingQuery(raw);
  if (!parsed.ok) throw new FundingQueryError(JSON.stringify(parsed.errors));
  const q = parsed.query,
    params = [];
  const bind = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const agri = q.corpus === "agriPayments";
  if (!["isunProjects", "agriPayments"].includes(q.corpus))
    throw new FundingQueryError("corpus_not_ready", 422);
  if (q.parentQuery) throw new FundingQueryError("relationship_not_ready", 422);
  if (q.placeBasis && q.placeBasis !== (agri ? "recipient" : "implementation"))
    throw new FundingQueryError("geography_basis_unavailable", 422);
  if (!agri && q.entityClass === "individual")
    throw new FundingQueryError("individual_identity_not_recorded", 422);
  const predicates = [
    ...(q.basePredicates || []),
    ...(q.numeratorPredicates || []),
  ].map((x) => x.replace(/^!/, ""));
  const has = (id) => predicates.includes(id);
  const money = {
    grant: ["grant_eur", 2],
    projectCost: ["total_eur", 1],
    ownCofinance: ["own_cofinance_eur", 4],
    paid: ["paid_eur", 8],
  }[q.amountBasis] || ["paid_eur", 8];
  // Evidence with missing cells compares to the legacy normalized zero, but the mask
  // remains authoritative: missing values are never exposed as published zeros.
  const evidenceJoin = [
    "total_eur",
    "grant_eur",
    "own_cofinance_eur",
    "paid_eur",
  ]
    .map((k) => `c.${k} IS NOT DISTINCT FROM COALESCE(o.${k},0)`)
    .join(" AND ");
  const known = (col, bit) =>
    `CASE WHEN (${evidenceJoin}) AND (o.observed_mask & ${bit})<>0 THEN c.${col}::numeric ELSE NULL END`;
  const signals = {
    unidentified: "NULLIF(c.beneficiary_eik,'') IS NULL",
    zeroPaid: `(${known("paid_eur", 8)})=0`,
  };
  if (has("political"))
    signals.political =
      "CASE WHEN NULLIF(c.beneficiary_eik,'') IS NOT NULL THEN EXISTS(SELECT 1 FROM funding_political_eiks pe WHERE pe.eik=c.beneficiary_eik) END";
  if (has("debarredName"))
    signals.debarredName =
      "CASE WHEN NULLIF(c.beneficiary_name,'') IS NOT NULL THEN EXISTS(SELECT 1 FROM debarred d WHERE d.name_norm=debar_norm(c.beneficiary_name)) END";
  if (has("serialWinner"))
    signals.serialWinner =
      "CASE WHEN NULLIF(c.beneficiary_eik,'') IS NOT NULL THEN (SELECT count(DISTINCT p.program_code)>1 FROM fund_projects p WHERE p.beneficiary_eik=c.beneficiary_eik) END";
  if (has("otherFunding"))
    signals.otherFunding =
      "CASE WHEN NULLIF(c.beneficiary_eik,'') IS NOT NULL THEN EXISTS(SELECT 1 FROM agri_subsidies a WHERE a.eik=c.beneficiary_eik) OR EXISTS(SELECT 1 FROM interreg_partners p WHERE p.eik=c.beneficiary_eik) END";
  const signalSql = Object.entries(signals)
    .flatMap(([k, v]) => [`'${k}'`, `(${v})`])
    .join(",");
  const date =
    q.dateBasis === "observed"
      ? "(SELECT (min(f.first_seen_at) AT TIME ZONE 'Europe/Sofia')::date FROM ingest_first_seen f WHERE f.source='fund_project' AND f.key=c.contract_number)"
      : "NULL::date";
  const source = agri
    ? require("./funding_query_agri").agriSource(q, has, bind)
    : `SELECT c.contract_number AS key,NULLIF(c.beneficiary_eik,'') AS entity,c.beneficiary_name AS name,c.title,c.program_code AS programme,
 ${known(money[0], money[1])} AS amount,${known("paid_eur", 8)} AS paid,${date} AS date,
 CASE WHEN c.status LIKE 'Приключен%' THEN 'completed' WHEN c.status LIKE 'В изпълнение%' THEN 'in-progress' WHEN c.status='Сключен' THEN 'signed' WHEN c.status LIKE 'Прекратен%' THEN 'terminated' WHEN NULLIF(c.status,'') IS NULL THEN 'unknown' ELSE 'other' END AS status,
 c.location_json AS location,c.ekatte,c.oblast,jsonb_build_object(${signalSql}) AS signals,
 ${q.themeIds?.length || q.groupBy === "theme" ? `ARRAY(SELECT t.id FROM funding_themes t WHERE c.program_code=ANY(t.programme_ids) OR EXISTS(SELECT 1 FROM unnest(t.keywords) kw WHERE c.title ILIKE '%'||replace(replace(replace(kw,'\\','\\\\'),'%','\\%'),'_','\\_')||'%'))` : "ARRAY[]::text[]"} AS themes
 FROM fund_projects c LEFT JOIN funding_isun_observations o ON o.contract_number=c.contract_number`;
  const where = [],
    checks = [];
  const inList = (col, values) => {
    if (values?.length) where.push(`${col}=ANY(${bind(values)}::text[])`);
  };
  inList("s.entity", q.entityIds);
  if (agri) {
    inList("s.programme", q.schemeIds);
    if (q.entityClass === "individual") where.push("s.entity IS NULL");
    if (q.schemeIds?.length)
      checks.push(
        `NOT EXISTS(SELECT 1 FROM unnest(${bind(q.schemeIds)}::text[]) x WHERE NOT EXISTS(SELECT 1 FROM agri_subsidies WHERE scheme=x))`,
      );
  }
  if (agri && q.placeIds?.some((id) => !contract.FUNDING_RECIPIENT_PLACES[id]))
    throw new FundingQueryError("DFZ_geography_requires_oblast", 422);
  if (agri && q.operation === "detail" && !q.expectedRevision)
    throw new FundingQueryError("annual_record_requires_revision", 422);
  inList("s.programme", q.programmeIds);
  inList("s.status", q.statusIds);
  if (q.entityClass === "legal") where.push("s.entity IS NOT NULL");
  if (q.key) where.push(`s.key=${bind(q.key)}`);
  if (q.keyword)
    where.push(`s.title ILIKE ${bind("%" + like(q.keyword) + "%")}`);
  for (const [field, col] of [
    ["programmingPeriods", "period"],
    ["fundingMechanisms", "mechanism"],
    ["fundTypes", "fund_type"],
  ])
    if (q[field]?.length)
      where.push(
        `EXISTS(SELECT 1 FROM funding_programmes fp WHERE fp.corpus='isunProjects' AND fp.code=s.programme AND fp.${col}=ANY(${bind(q[field])}::text[]))`,
      );
  if (q.themeIds?.length) where.push(`s.themes && ${bind(q.themeIds)}::text[]`);
  if (q.beneficiarySectors?.length)
    where.push(
      `EXISTS(SELECT 1 FROM funding_sectors fs WHERE fs.id=ANY(${bind(q.beneficiarySectors)}::text[]) AND s.entity=ANY(fs.eiks))`,
    );
  for (const [field, table, col, extra] of [
    ["programmeIds", "funding_programmes", "code", "AND corpus='isunProjects'"],
    [
      "fundTypes",
      "funding_programmes",
      "fund_type",
      "AND corpus='isunProjects'",
    ],
    ["themeIds", "funding_themes", "id", ""],
    ["beneficiarySectors", "funding_sectors", "id", ""],
  ])
    if (q[field]?.length)
      checks.push(
        `NOT EXISTS(SELECT 1 FROM unnest(${bind(q[field])}::text[]) x WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE ${col}=x ${extra}))`,
      );
  if (q.placeIds?.length) {
    const ids = q.placeIds.map((x) => (!agri && x === "SFO_CITY" ? "S22" : x));
    where.push(
      `(s.ekatte=ANY(${bind(ids)}::text[]) OR s.oblast=ANY(${bind(ids)}::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.location->'munis','[]')) p WHERE p=ANY(${bind(ids)}::text[])) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.location->'oblasts','[]')) p WHERE p=ANY(${bind(ids)}::text[])) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.location->'nutsCodes','[]')) p WHERE p=ANY(${bind(ids)}::text[])))`,
    );
  }
  const amountConditions = [];
  for (const [field, op] of [
    ["amountMin", q.amountMinRelation === "gt" ? ">" : ">="],
    ["amountMax", q.amountMaxRelation === "lt" ? "<" : "<="],
  ])
    if (q[field] !== undefined)
      amountConditions.push(`s.amount ${op} ${bind(q[field])}::numeric`);
  const period = (from, to) =>
    [
      from ? `s.date>=${bind(from)}::date` : "TRUE",
      to ? `s.date<${bind(to)}::date` : "TRUE",
    ].join(" AND ");
  const financialPeriod = (years) =>
    years?.length
      ? `to_char(s.date,'YYYY')=ANY(${bind(years)}::text[])`
      : "TRUE";
  const current = agri
      ? q.operation === "compare"
        ? financialPeriod(q.financialYears)
        : "TRUE"
      : period(q.from, q.toExclusive),
    comparison =
      q.operation === "compare"
        ? agri
          ? financialPeriod(q.compareFinancialYears)
          : period(q.compareFrom, q.compareToExclusive)
        : "FALSE";
  const predicate = (raw) =>
    `${raw.startsWith("!") ? "NOT " : ""}((s.signals->>'${raw.replace(/^!/, "")}')::boolean)`;
  const combine = (ids, mode) =>
    ids?.length
      ? ids.map(predicate).join(mode === "any" ? " OR " : " AND ")
      : "TRUE";
  const base = combine(q.basePredicates, q.baseMode),
    numerator = combine(q.numeratorPredicates, q.numeratorMode);
  const group =
    q.groupBy === "theme"
      ? "unnest(themes)"
      : {
          entity: "COALESCE(entity,'unknown:'||key)",
          programme: "COALESCE(programme,'unknown')",
          scheme: "COALESCE(programme,'unknown')",
          financialYear: "to_char(date,'YYYY')",
          place: "COALESCE(oblast,'unknown')",
          month: "to_char(date,'YYYY-MM')",
          year: "to_char(date,'YYYY')",
        }[q.groupBy] || "'all'::text";
  const metric =
    q.metric === "amount"
      ? "amount"
      : q.metric === "beneficiaries"
        ? "beneficiaries"
        : q.metric === "paidRatio"
          ? "paid_ratio"
          : q.metric === "hhi"
            ? "hhi"
            : q.metric === "topShare"
              ? "top_share"
              : "records";
  const selectMatches =
    q.numeratorPredicates?.length &&
    !["share", "summary", "methodology"].includes(q.operation);
  const stats = `count(key)::int AS records,count(DISTINCT entity)::int AS beneficiaries,count(amount)::int AS known_amount,count(paid)::int AS known_paid,count(key) FILTER(WHERE entity IS NULL)::int AS unidentified,sum(amount) AS amount,sum(paid) AS paid,count(key) FILTER(WHERE matched IS NOT NULL)::int AS evaluable,count(key) FILTER(WHERE matched)::int AS numerator_records,CASE WHEN count(key) FILTER(WHERE matched)>0 THEN sum(amount) FILTER(WHERE matched) WHEN count(key) FILTER(WHERE matched IS NOT NULL)>0 THEN 0::numeric END AS numerator_amount,100*sum(paid) FILTER(WHERE amount IS NOT NULL)/NULLIF(sum(amount) FILTER(WHERE paid IS NOT NULL),0) AS paid_ratio`;
  const shareExpr =
    q.denominator === "amount"
      ? "100*numerator_amount/NULLIF(amount,0)"
      : `CASE WHEN evaluable>0 THEN 100.0*numerator_records/NULLIF(${q.denominator === "evaluable" ? "evaluable" : "records"},0) END`;
  const selectedMetric =
    q.operation === "share" && !["paidRatio", "topShare"].includes(q.metric)
      ? "share"
      : metric;
  const sql = `WITH source AS NOT MATERIALIZED (${source}), candidates AS MATERIALIZED(SELECT s.*,(${current}) AS current,(${comparison}) AS comparison,(${base}) AS base,(${numerator}) AS matched,(${amountConditions.join(" AND ") || "TRUE"}) AS amount_match FROM source s WHERE ${where.join(" AND ") || "TRUE"}),
 scoped AS MATERIALIZED(SELECT * FROM candidates WHERE amount_match IS TRUE),
 base_cohorts AS MATERIALIZED(SELECT s.*,w.cohort_window FROM scoped s CROSS JOIN LATERAL (SELECT 'current'::text AS cohort_window WHERE s.current UNION ALL SELECT 'comparison' WHERE s.comparison) w WHERE s.base IS TRUE),
 cohorts AS MATERIALIZED(SELECT * FROM base_cohorts ${selectMatches ? "WHERE matched IS TRUE" : ""}),
 grouped AS (${q.groupBy ? `SELECT *,${group} AS group_key FROM cohorts UNION ALL ` : ""}SELECT *,'__total'::text AS group_key FROM cohorts),
 entity_money AS (SELECT cohort_window,group_key,entity,sum(amount) AS amount FROM grouped WHERE ${["hhi", "topShare"].includes(q.metric) ? "TRUE" : "FALSE"} AND entity IS NOT NULL AND amount IS NOT NULL GROUP BY cohort_window,group_key,entity),
 concentration AS (SELECT cohort_window,group_key,CASE WHEN count(*)>=${bind(q.minGroupCount || 2)} AND min(amount)>=0 AND sum(amount)>0 THEN 10000*sum(amount*amount)/power(sum(amount),2) END AS hhi,CASE WHEN count(*)>=${bind(q.minGroupCount || 2)} AND min(amount)>=0 AND sum(amount)>0 THEN 100*sum(amount) FILTER(WHERE rn<=${bind(q.topN || 10)})/sum(amount) END AS top_share FROM (SELECT *,row_number() OVER(PARTITION BY cohort_window,group_key ORDER BY amount DESC NULLS LAST,entity) rn FROM entity_money) e GROUP BY cohort_window,group_key),
 summaries AS (SELECT cohort_window,group_key,${stats} FROM grouped GROUP BY cohort_window,group_key),
 empty_stats AS (SELECT ${stats} FROM cohorts WHERE FALSE),
 windows AS (SELECT 'current'::text AS cohort_window UNION ALL SELECT 'comparison' WHERE ${q.operation === "compare" ? "TRUE" : "FALSE"}),
 complete_summaries AS (SELECT * FROM summaries UNION ALL SELECT w.cohort_window,'__total',e.* FROM windows w CROSS JOIN empty_stats e WHERE NOT EXISTS(SELECT 1 FROM summaries s WHERE s.cohort_window=w.cohort_window AND s.group_key='__total')),
 measured AS (SELECT t.*,c.hhi,c.top_share,${shareExpr} AS share FROM complete_summaries t LEFT JOIN concentration c USING(cohort_window,group_key)),
 groups AS (SELECT * FROM measured WHERE group_key<>'__total' AND records>=${bind(q.minGroupCount || 1)}),
 page AS (SELECT key,entity,name,title,programme,amount,paid,date,status,signals FROM cohorts WHERE cohort_window='current' ${q.numeratorPredicates?.length ? "AND matched IS TRUE" : ""} ORDER BY amount ${q.order.toUpperCase()} NULLS LAST,key LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)}),
 group_page AS (SELECT * FROM groups ORDER BY ${selectedMetric} ${q.order.toUpperCase()} NULLS LAST,cohort_window,group_key LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)})
 SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM measured t WHERE group_key='__total' AND cohort_window='current'),'rows',COALESCE((SELECT jsonb_agg(page) FROM page),'[]'::jsonb),'groups',COALESCE((SELECT jsonb_agg(group_page) FROM group_page),'[]'::jsonb),
 'comparisons',COALESCE((SELECT jsonb_agg(t ORDER BY cohort_window) FROM measured t WHERE group_key='__total'),'[]'::jsonb),
 'groupCount',(SELECT count(*) FROM groups),'catalogValid',${checks.join(" AND ") || "TRUE"},'catalogVersion',(SELECT value->>'version' FROM funding_query_meta WHERE key='catalog'),
 'yearsAvailable',${agri ? `(WITH RECURSIVE years(y) AS (SELECT min(year) FROM agri_subsidies UNION ALL SELECT (SELECT min(year) FROM agri_subsidies WHERE year>years.y) FROM years WHERE y IS NOT NULL) SELECT jsonb_agg(y::text ORDER BY y) FROM years WHERE y IS NOT NULL)` : "null::jsonb"},
 'candidateRecords',(SELECT count(*) FROM candidates),
 'dateUnknown',(SELECT count(*) FROM candidates WHERE ${q.dateBasis !== "none" ? "date IS NULL" : "FALSE"}),
 'amountUnknown',(SELECT count(*) FROM candidates WHERE ${amountConditions.length ? "amount IS NULL" : "FALSE"}),
 'scopeRecords',(SELECT count(*) FROM scoped WHERE current OR comparison),'baseEvaluable',(SELECT count(*) FROM scoped WHERE (current OR comparison) AND base IS NOT NULL),
 'numeratorScope',(SELECT count(*) FROM base_cohorts),'numeratorEvaluable',(SELECT count(*) FROM base_cohorts WHERE matched IS NOT NULL),
 'revision',(SELECT md5(COALESCE(string_agg(resource||':'||generation::text,',' ORDER BY resource),'')) FROM funding_query_revisions)) AS result`;
  return { query: q, sql, params };
}
async function runFundingQuery(dbRows, raw) {
  if (process.env.FUNDING_QUERY_DISABLED === "1")
    return { body: { status: "unavailable", reason: "capability_disabled" } };
  let c;
  try {
    c = compileFundingQuery(raw);
  } catch (e) {
    if (e instanceof FundingQueryError)
      return {
        status: e.status,
        body: { status: "unsupported", reason: e.message },
      };
    throw e;
  }
  try {
    const [row] = await dbRows(c.sql, c.params),
      r = row?.result;
    if (!r) throw Error("Missing funding analytics result");
    if (!r.catalogValid)
      return {
        status: 422,
        body: {
          status: "unsupported",
          reason: "unknown_catalog_id",
          query: c.query,
        },
      };
    if (r.catalogVersion !== contract.FUNDING_CATALOG_VERSION)
      return {
        body: {
          status: "unavailable",
          reason: "catalog_unavailable",
          query: c.query,
        },
      };
    if (c.query.expectedRevision && c.query.expectedRevision !== r.revision)
      return {
        status: 409,
        body: {
          status: "unavailable",
          reason: "revision_changed",
          query: c.query,
          revision: r.revision,
        },
      };
    if (
      c.query.corpus === "agriPayments" &&
      [
        ...(c.query.financialYears || []),
        ...(c.query.compareFinancialYears || []),
      ].some((y) => !r.yearsAvailable?.includes(y))
    )
      return {
        body: {
          status: "unavailable",
          reason: "financial_year_unavailable",
          query: c.query,
          yearsAvailable: r.yearsAvailable,
        },
      };
    const t = r.totals;
    const periods = c.query.operation === "compare" ? r.comparisons : [t];
    const missing =
      r.dateUnknown > 0 ||
      r.amountUnknown > 0 ||
      r.baseEvaluable < r.scopeRecords ||
      (c.query.numeratorPredicates?.length &&
        r.numeratorEvaluable < r.numeratorScope) ||
      periods.some(
        (x) =>
          x.known_amount < x.records ||
          (c.query.metric === "paidRatio" && x.known_paid < x.records),
      );
    const unavailable =
      (r.candidateRecords > 0 &&
        (r.dateUnknown === r.candidateRecords ||
          r.amountUnknown === r.candidateRecords)) ||
      (c.query.numeratorPredicates?.length &&
        r.numeratorScope > 0 &&
        r.numeratorEvaluable === 0) ||
      (c.query.metric === "paidRatio" &&
        periods.some((x) => x.records > 0 && x.paid_ratio === null));
    return {
      body: {
        ...r,
        query: c.query,
        status: unavailable
          ? "unavailable"
          : missing
            ? "partial"
            : !periods.some((x) => x.records)
              ? "empty"
              : "success",
        warnings:
          c.query.corpus === "agriPayments"
            ? [
                "financial_year_not_calendar_year",
                "annual_records_not_transactions",
                "source_person_groupings_not_verified_people",
                "net_published_amounts",
                "current_identity_evidence",
                c.query.population === "attributable"
                  ? "payer_121100421_excluded"
                  : "gross_source_population",
              ]
            : [
                "current_source_snapshot",
                "cumulative_paid_not_period_cash",
                "whole_project_geographic_inclusion",
                "source_double_precision",
                "current_identity_evidence",
              ],
        populationVersion: contract.FUNDING_VERSION,
      },
    };
  } catch (e) {
    if (
      ["42P01", "42703", "42883", "55000", "42501", "57014", "55P03"].includes(
        e.code,
      )
    )
      return {
        body: {
          status: "unavailable",
          reason:
            e.code === "57014"
              ? "query_timeout"
              : "data_capability_unavailable",
          query: c.query,
        },
      };
    throw e;
  }
}
async function fundingCapabilities(dbRows) {
  const base = await runFundingQuery(dbRows, {
    corpus: "isunProjects",
    limit: 1,
  });
  const ready = ["success", "partial", "empty"].includes(base.body.status);
  const descriptor = {
    ...contract.FUNDING_CAPABILITIES.isunProjects,
    ready,
    dates: ["none"],
    predicates: [],
    amounts: base.body.totals?.known_amount > 0 ? ["grant"] : [],
    coverage: base.body.totals || null,
  };
  const probe = async (sql) => {
    try {
      const [r] = await dbRows(sql, []);
      return Boolean(r?.ready);
    } catch (e) {
      if (
        ["42P01", "42703", "42883", "42501", "57014", "55000"].includes(e.code)
      )
        return false;
      throw e;
    }
  };
  if (ready) {
    descriptor.predicates.push("unidentified");
    if (base.body.totals?.known_paid > 0) {
      descriptor.predicates.push("zeroPaid");
      descriptor.amounts.push("paid");
    }
    if (
      await probe(
        "SELECT EXISTS(SELECT 1 FROM ingest_first_seen f JOIN fund_projects p ON p.contract_number=f.key WHERE f.source='fund_project') AS ready",
      )
    )
      descriptor.dates.push("observed");
    if (base.body.totals?.beneficiaries > 0) {
      descriptor.predicates.push("serialWinner");
      if (
        await probe("SELECT count(*)>=0 AS ready FROM funding_political_eiks")
      )
        descriptor.predicates.push("political");
      if (
        await probe(
          "SELECT EXISTS(SELECT 1 FROM agri_subsidies) AND EXISTS(SELECT 1 FROM interreg_partners) AS ready",
        )
      )
        descriptor.predicates.push("otherFunding");
    }
    if (
      await probe(
        "SELECT EXISTS(SELECT 1 FROM debarred WHERE name_norm IS NOT NULL) AND debar_norm('test') IS NOT NULL AS ready",
      )
    )
      descriptor.predicates.push("debarredName");
    for (const [amount, bit] of [
      ["projectCost", 1],
      ["ownCofinance", 4],
    ])
      if (
        await probe(
          `SELECT EXISTS(SELECT 1 FROM funding_isun_observations o JOIN fund_projects c USING(contract_number) WHERE (o.observed_mask & ${bit})<>0 AND ${["total_eur", "grant_eur", "own_cofinance_eur", "paid_eur"].map((k) => `c.${k} IS NOT DISTINCT FROM COALESCE(o.${k},0)`).join(" AND ")}) AS ready`,
        )
      )
        descriptor.amounts.push(amount);
  }
  const agriProbe = await runFundingQuery(dbRows, {
    corpus: "agriPayments",
    entityIds: ["000000000"],
    limit: 1,
  });
  const agriReady = ["success", "partial", "empty"].includes(
    agriProbe.body.status,
  );
  const agriDescriptor = {
    ...contract.FUNDING_CAPABILITIES.agriPayments,
    ready: agriReady,
    dates: agriReady ? ["financialYear"] : [],
    amounts: [],
    predicates: agriReady ? ["unidentified"] : [],
    financialYears: agriProbe.body.yearsAvailable || [],
    latestAvailableFinancialYear: agriProbe.body.yearsAvailable?.at(-1) || null,
    geography: ["recipientOblast"],
  };
  if (agriReady) {
    for (const [basis, col] of [
      ["paid", "total_eur"],
      ["direct", "dp_eur"],
      ["market", "market_eur"],
      ["rural", "rural_eur"],
    ])
      if (
        await probe(
          `SELECT EXISTS(SELECT 1 FROM agri_subsidies WHERE ${col} IS NOT NULL) AS ready`,
        )
      )
        agriDescriptor.amounts.push(basis);
    if (await probe("SELECT count(*)>=0 AS ready FROM funding_political_eiks"))
      agriDescriptor.predicates.push("political");
    if (
      await probe(
        "SELECT EXISTS(SELECT 1 FROM fund_projects) AND EXISTS(SELECT 1 FROM interreg_partners) AS ready",
      )
    )
      agriDescriptor.predicates.push("otherFunding");
  }
  return {
    body: {
      version: contract.FUNDING_VERSION,
      catalogVersion: contract.FUNDING_CATALOG_VERSION,
      corpora: { isunProjects: descriptor, agriPayments: agriDescriptor },
      revision: base.body.revision,
    },
  };
}

module.exports = {
  compileFundingQuery,
  runFundingQuery,
  FundingQueryError,
  fundingCapabilities,
};
