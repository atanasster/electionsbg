// Parameterized analytics. Population, numerator, totals and page share ONE SQL
// statement/snapshot. Never derive a national total from a limited result page.
const contract = require("./generated/procurement_query.js");

class ProcurementQueryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");
const hasRisk = (q) =>
  ["risk", "riskCount", "cri"].includes(q.metric) ||
  q.minRiskCount !== undefined ||
  q.maxRiskCount !== undefined ||
  [...(q.basePredicates || []), ...(q.numeratorPredicates || [])].some((p) =>
    p.includes("risk:"),
  );

function compileContractQuery(query) {
  const parsed = contract.validateProcurementQuery(query);
  if (!parsed.ok)
    throw new ProcurementQueryError(JSON.stringify(parsed.errors));
  const q = parsed.query;
  if (!["contracts", "amendments"].includes(q.corpus))
    throw new ProcurementQueryError(
      "Corpus not available in this service",
      422,
    );
  const params = [];
  const bind = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const risk = hasRisk(q);
  const where = [
    `c.tag = ${bind(q.corpus === "contracts" ? "contract" : "contractAmendment")}`,
    "c.consortium_role IS DISTINCT FROM 'member'",
  ];
  const dates =
    q.dateBasis === "signed" ? "NULLIF(c.date_signed, c.date)" : "c.date";
  const date = `CASE WHEN (${dates}) ~ '^\\d{4}-\\d{2}-\\d{2}$' AND pg_input_is_valid((${dates}), 'date') THEN (${dates}) ELSE NULL END`;
  const money =
    q.valueBasis === "signing"
      ? "COALESCE(c.signing_amount_eur, c.amount_eur)"
      : "c.amount_eur";
  const inList = (column, values) => {
    if (values?.length) where.push(`${column} = ANY(${bind(values)}::text[])`);
  };
  inList("c.awarder_eik", q.buyerIds);
  inList("c.contractor_eik", q.supplierIds);
  if (q.buyerSectors?.length)
    inList("c.awarder_eik", [
      ...new Set(
        q.buyerSectors.flatMap(
          (id) => contract.PROCUREMENT_BUYER_SECTORS[id].eiks,
        ),
      ),
    ]);
  const prefixes = (values) =>
    values.map((v) => `c.cpv LIKE ${bind(v + "%")}`).join(" OR ");
  if (q.cpvPrefixes?.length) where.push(`(${prefixes(q.cpvPrefixes)})`);
  if (q.subjectSectors?.length)
    where.push(
      `(${prefixes([...new Set(q.subjectSectors.flatMap((id) => contract.PROCUREMENT_SUBJECTS[id].prefixes))])})`,
    );
  if (q.topic) {
    const topic = contract.PROCUREMENT_TOPICS.find((t) => t.id === q.topic);
    where.push(
      `((${prefixes(topic.cpvPrefixes)}) OR c.title ~* ${bind(topic.pattern)})`,
    );
  }
  if (q.keyword)
    where.push(`c.title ILIKE ${bind("%" + escapeLike(q.keyword) + "%")}`);
  if (q.procedure) where.push(`c.procurement_method = ${bind(q.procedure)}`);
  if (q.funding)
    where.push(
      q.funding === "unknown"
        ? "c.eu_funded IS NULL"
        : `c.eu_funded = ${bind(q.funding === "eu" ? 1 : 0)}`,
    );
  if (q.framework === "unknown")
    throw new ProcurementQueryError(
      "Framework unknown status is not recorded for contracts",
      422,
    );
  if (q.framework)
    where.push(
      q.framework === "unknown"
        ? "c.joint_kind IS NULL"
        : `c.joint_kind ${q.framework === "yes" ? "=" : "IS DISTINCT FROM"} 'framework'`,
    );
  for (const [key, expression, comparator] of [
    ["bidderMin", "c.number_of_tenderers", ">="],
    ["bidderMax", "c.number_of_tenderers", "<="],
    ["amountMin", money, q.amountMinRelation === "gt" ? ">" : ">="],
    ["amountMax", money, q.amountMaxRelation === "lt" ? "<" : "<="],
    ["minRiskCount", "r.fired", ">="],
    ["maxRiskCount", "r.fired", "<="],
  ]) {
    if (q[key] !== undefined)
      where.push(
        `(${expression}) ${comparator} ${bind(key.startsWith("amount") && q.currency === "BGN" ? q[key] / 1.95583 : q[key])}`,
      );
  }
  if (q.key) where.push(`c.key = ${bind(q.key)}`);
  const period = (from, to) =>
    [
      from ? `(${date}) >= ${bind(from)}` : "TRUE",
      to ? `(${date}) < ${bind(to)}` : "TRUE",
    ].join(" AND ");
  const primaryPeriod = period(q.from, q.toExclusive);
  const comparisonPeriod =
    q.operation === "compare"
      ? period(q.compareFrom, q.compareToExclusive)
      : "FALSE";
  // Keep the indexed source-date predicate alongside validity checking.
  if (q.from && q.operation !== "compare")
    where.push(`(${dates}) >= ${bind(q.from)}`);
  if (q.toExclusive && q.operation !== "compare")
    where.push(`(${dates}) < ${bind(q.toExclusive)}`);
  const appealWhere = (kind, related = false) => {
    const terms = ["a.unp = c.unp", "a.unp IS NOT NULL"];
    if (kind === "upheld") terms.push("a.outcome = 'уважена'");
    if (kind === "suspended")
      terms.push("kzk_effective_suspension(a.suspension, a.status) IS TRUE");
    if (related && q.relatedCorpus === "decisions")
      terms.push("a.decision_act_no = d.act_no");
    const field =
      q.relatedCorpus === "decisions" ? "d.decision_date" : "a.complaint_date";
    if (related && q.relatedFrom)
      terms.push(`${field} >= ${bind(q.relatedFrom)}`);
    if (related && q.relatedToExclusive)
      terms.push(`${field} < ${bind(q.relatedToExclusive)}`);
    return `EXISTS (SELECT 1 FROM kzk_appeals a ${related && q.relatedCorpus === "decisions" ? "JOIN kzk_decisions d ON d.act_no = a.decision_act_no" : ""} WHERE ${terms.join(" AND ")})`;
  };
  if (q.relatedCorpus) where.push(appealWhere("appealed", true));
  function predicate(raw) {
    const negated = raw.startsWith("!");
    const id = negated ? raw.slice(1) : raw;
    let expression;
    if (id === "oneBid")
      expression =
        "CASE WHEN c.number_of_tenderers > 0 THEN c.number_of_tenderers = 1 ELSE NULL END";
    else if (id.startsWith("risk:")) {
      const bit = contract.PROCUREMENT_RISKS[q.corpus].indexOf(id.slice(5));
      if (bit < 0) throw new ProcurementQueryError("Unknown risk");
      expression = `CASE WHEN (r.available_mask & ${1 << bit}) <> 0 THEN (r.fired_mask & ${1 << bit}) <> 0 ELSE NULL END`;
    } else if (["appealed", "upheld", "suspended"].includes(id))
      expression = `CASE WHEN c.unp IS NOT NULL AND c.unp <> '' THEN ${appealWhere(id, Boolean(q.relatedCorpus))} ELSE NULL END`;
    else throw new ProcurementQueryError("Unsupported predicate");
    return negated ? `NOT (${expression})` : `(${expression})`;
  }
  const combine = (items, mode) =>
    items?.length
      ? items.map(predicate).join(mode === "any" ? " OR " : " AND ")
      : "TRUE";
  if (q.basePredicates?.length)
    where.push(`(${combine(q.basePredicates, q.baseMode)}) IS TRUE`);
  const numeratorIds = q.numeratorPredicates?.length
    ? q.numeratorPredicates
    : ["oneBid", "appealed", "upheld", "suspended"].includes(q.metric)
      ? [q.metric]
      : [];
  const rawNumerator = combine(numeratorIds, q.numeratorMode);
  const numerator =
    q.denominator === "positiveKnown"
      ? `CASE WHEN c.number_of_tenderers > 0 THEN (${rawNumerator}) ELSE NULL END`
      : rawNumerator;
  const evaluable =
    q.metric === "cri"
      ? "cri IS NOT NULL AND available > 0"
      : q.metric === "riskCount"
        ? "fired IS NOT NULL AND available > 0"
        : "matched IS NOT NULL";
  const revision =
    "(SELECT COALESCE(jsonb_object_agg(resource, generation::text), '{}'::jsonb) FROM procurement_query_revisions)";
  const meta = risk
    ? "(SELECT CASE WHEN EXISTS (SELECT 1 FROM procurement_query_revisions v WHERE resource IN ('contracts','kzk_appeals') AND generation > 0 AND changed_at > m.rebuilt_at) THEN NULL ELSE catalog_version END FROM contract_risk_meta m WHERE only_row)"
    : "NULL::text";
  const riskFields = risk
    ? "r.fired, r.available, r.cri, r.fired_mask, r.available_mask"
    : "NULL::int AS fired, NULL::int AS available, NULL::int AS cri, NULL::int AS fired_mask, NULL::int AS available_mask";
  const aggregate = `count(*)::int AS records, count(*) FILTER (WHERE matched IS TRUE)::int AS numerator,
    count(*) FILTER (WHERE ${evaluable})::int AS evaluable,
    count(*) FILTER (WHERE bids > 0)::int AS positive_known,
    count(*) FILTER (WHERE bids = 1)::int AS one_bid,
    count(*) FILTER (WHERE bids = 0)::int AS zero_bids,
    count(*) FILTER (WHERE bids < 0)::int AS invalid_bids,
    count(*) FILTER (WHERE bids IS NULL)::int AS missing_bids,
    count(*) FILTER (WHERE amount IS NULL)::int AS missing_value,
    sum(amount::numeric)::text AS value_eur,
    sum(amount::numeric) FILTER (WHERE matched IS TRUE)::text AS numerator_value_eur,
    avg(fired) FILTER (WHERE available > 0)::numeric::text AS mean_risk_count, avg(cri) FILTER (WHERE available > 0)::numeric::text AS mean_cri,
    count(*) FILTER (WHERE available IS NULL)::int AS missing_risk,
    min(date) AS first_date, max(date) AS last_date`;
  const denominator =
    q.denominator === "positiveKnown"
      ? "positive_known"
      : q.denominator === "evaluable"
        ? "evaluable"
        : "records";
  const grouped = q.groupBy || (q.operation === "trend" ? "month" : null);
  const groupField = {
    buyer: "buyer_id",
    supplier: "supplier_id",
    month: "substring(date,1,7)",
    year: "substring(date,1,4)",
    cpv: "substring(cpv,1,2)",
  }[grouped];
  if (grouped && !groupField)
    throw new ProcurementQueryError("Unsupported grouping");
  const orderMetric =
    q.metric === "riskCount"
      ? "mean_risk_count::numeric"
      : q.metric === "cri"
        ? "mean_cri::numeric"
        : q.metric === "value"
          ? "value_eur::numeric"
          : q.operation === "share" ||
              ["oneBid", "risk", "upheld", "appealed", "suspended"].includes(
                q.metric,
              )
            ? `numerator::numeric / NULLIF(${denominator},0)`
            : "records";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const groupSql = groupField
    ? `, groups AS (SELECT ${groupField} AS group_key, ${aggregate} FROM scoped WHERE period = 'primary' GROUP BY ${groupField}), ranked_groups AS (SELECT * FROM groups WHERE ${q.minGroupCountBasis === "evaluable" ? "evaluable" : "records"} >= ${bind(q.minGroupCount ?? 0)} ORDER BY ${q.operation === "trend" ? "group_key ASC" : `${orderMetric} ${order} NULLS LAST, group_key`} LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)})`
    : "";
  const pageOrder =
    q.metric === "riskCount" || q.metric === "risk"
      ? `fired ${order} NULLS LAST, cri DESC NULLS LAST`
      : q.metric === "cri"
        ? `cri ${order} NULLS LAST`
        : q.metric === "value"
          ? `amount ${order} NULLS LAST`
          : "date DESC NULLS LAST";
  return {
    query: q,
    requiresRisk: risk,
    params,
    sql: `WITH base AS (
    SELECT c.key, c.title, ${date} AS date, c.awarder_eik AS buyer_id, c.awarder_name AS buyer,
      c.contractor_eik AS supplier_id, c.contractor_name AS supplier, c.cpv, c.unp,
      c.number_of_tenderers AS bids, (${money}) AS amount, c.joint_kind,
      (${numerator}) AS matched, (${primaryPeriod}) AS in_primary, (${comparisonPeriod}) AS in_comparison, ${riskFields}
    FROM contracts c ${risk ? "LEFT JOIN contract_risk_cache r ON r.key = c.key" : ""} WHERE ${where.join(" AND ")}
  ), scoped AS (
    SELECT base.*, 'primary'::text AS period FROM base WHERE in_primary
    UNION ALL SELECT base.*, 'comparison'::text AS period FROM base WHERE in_comparison
  ), totals AS (SELECT ${aggregate} FROM scoped WHERE period = 'primary'),
  comparison AS (SELECT ${aggregate} FROM scoped WHERE period = 'comparison'),
  page AS (SELECT key,title,date,buyer_id,buyer,supplier_id,supplier,cpv,unp,bids,amount::numeric::text AS amount_eur,joint_kind,fired,available,cri,fired_mask,available_mask
    FROM scoped WHERE period = 'primary' ${numeratorIds.length ? "AND matched IS TRUE" : ""}
    ORDER BY ${pageOrder}, key LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)}) ${groupSql}
  SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),'comparison',(SELECT to_jsonb(t) FROM comparison t),
    'rows',COALESCE((SELECT jsonb_agg(p) FROM page p),'[]'::jsonb),
    'groups',${groupField ? "COALESCE((SELECT jsonb_agg(g) FROM ranked_groups g),'[]'::jsonb)" : "'[]'::jsonb"},
    'revision',${revision},'riskCatalog',${meta}) AS result`,
  };
}

async function runProcurementQuery(dbRows, raw) {
  if (process.env.PROCUREMENT_QUERY_DISABLED === "1") return {body:{status:"unavailable",reason:"capability_disabled"}};
  let compiled;
  try {
    const parsed = contract.validateProcurementQuery(raw);
    if (!parsed.ok)
      throw new ProcurementQueryError(JSON.stringify(parsed.errors));
    compiled = ["contracts", "amendments"].includes(parsed.query.corpus)
      ? compileContractQuery(parsed.query)
      : require("./procurement_query_corpora").compileOtherQuery(parsed.query);
  } catch (error) {
    if (error instanceof ProcurementQueryError)
      return {
        status: error.status,
        body: { status: "unsupported", reason: error.message },
      };
    throw error;
  }
  try {
    const [row] = await dbRows(compiled.sql, compiled.params);
    const result = row?.result;
    if (!result) throw new Error("Missing analytics result");
    if (
      compiled.requiresRisk &&
      result.riskCatalog !== contract.PROCUREMENT_CAPABILITY.catalogVersion
    )
      return {
        body: {
          status: "unavailable",
          reason: "risk_catalog_unavailable",
          query: compiled.query,
        },
      };
    return {
      body: {
        ...result,
        query: compiled.query,
        populationVersion: contract.PROCUREMENT_QUERY_VERSION,
        warnings:
          compiled.query.status &&
          ["open", "closed"].includes(compiled.query.status)
            ? ["current_cancellation_state"]
            : [],
        status: !result.totals.records
          ? "empty"
          : compiled.requiresRisk && result.totals.evaluable === 0
            ? "partial"
            : "success",
      },
    };
  } catch (error) {
    if (
      ["42P01", "42703", "42883", "55000", "42501", "57014", "55P03"].includes(
        error.code,
      )
    )
      return {
        body: {
          status: "unavailable",
          reason:
            error.code === "57014"
              ? "query_timeout"
              : "data_capability_unavailable",
          query: compiled.query,
        },
      };
    throw error;
  }
}
module.exports = {
  compileContractQuery,
  runProcurementQuery,
  ProcurementQueryError,
};
