const contract = require("./generated/procurement_query");
const { ProcurementQueryError } = require("./procurement_query");
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");
/** One row per procedure, complaint or act. Related predicates use EXISTS. */
function compileOtherQuery(q) {
  const params = [];
  const bind = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const tender = q.corpus === "tenders",
    appeal = q.corpus === "appeals",
    decision = q.corpus === "decisions";
  if (!tender && !appeal && !decision)
    throw new ProcurementQueryError("Unsupported corpus", 422);
  const risks =
    [...(q.basePredicates || []), ...(q.numeratorPredicates || [])].some((p) =>
      p.includes("risk:"),
    ) ||
    ["risk", "riskCount"].includes(q.metric) ||
    q.minRiskCount !== undefined ||
    q.maxRiskCount !== undefined;
  const terms = [];
  if(q.actKind)terms.push(q.actKind==="unknown"?"c.kind IS NULL":`c.kind=${bind(q.actKind)}`);
  if(q.parentQuery) terms.push(q.corpus==="decisions" ? "EXISTS(SELECT 1 FROM kzk_appeals pa JOIN procurement_parent_keys pk ON pk.unp=pa.unp WHERE pa.decision_act_no=c.act_no)" : "EXISTS(SELECT 1 FROM procurement_parent_keys pk WHERE pk.unp=c.unp)");
  const key = tender ? "c.unp" : appeal ? "c.complaint_no" : "c.act_no";
  const dateField = tender
    ? q.dateBasis === "deadline"
      ? "c.submission_deadline"
      : "c.publication_date"
    : appeal
      ? q.dateBasis === "decision"
        ? "c.decision_date"
        : "c.complaint_date"
      : "c.decision_date";
  const date = `procurement_query_instant(${dateField})`;
  // A conservative indexed prefilter; exact timezone-aware bounds remain below.
  // Two-day padding cannot drop an ISO instant crossing the Sofia date boundary.
  if (q.operation !== "compare") {
    const shift = (value, days) => {
      const d = new Date(value + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    if (q.from) terms.push(`${dateField} >= ${bind(shift(q.from, -2))}`);
    if (q.toExclusive)
      terms.push(`${dateField} < ${bind(shift(q.toExclusive, 2))}`);
  }
  const buyer =
    tender || appeal
      ? "c.buyer_eik"
      : "(SELECT CASE WHEN count(DISTINCT a.buyer_eik)=1 THEN min(a.buyer_eik) END FROM kzk_appeals a WHERE a.decision_act_no=c.act_no)";
  if (decision && q.groupBy === "cpv")
    throw new ProcurementQueryError(
      "Decision CPV grouping is ambiguous across linked procedures",
      422,
    );
  const subject = tender
    ? "c.subject"
    : appeal
      ? "c.subject"
      : "c.pronouncement";
  const cpv = tender ? "c.cpv" : "t.cpv";
  const unp = tender ? "c.unp" : appeal ? "c.unp" : null;
  const outcome = appeal
    ? "kzk_effective_outcome(c.outcome,c.status)"
    : decision
      ? `(SELECT CASE WHEN count(DISTINCT a.outcome)=1 THEN min(a.outcome) ELSE NULL END FROM kzk_appeals a WHERE a.decision_act_no=c.act_no AND a.outcome IN ('уважена','отхвърлена'))`
      : null;
  const suspension = appeal
    ? "kzk_effective_suspension(c.suspension,c.status)"
    : decision
      ? `(SELECT bool_or(kzk_effective_suspension(a.suspension,a.status)) FROM kzk_appeals a WHERE a.decision_act_no=c.act_no)`
      : null;
  const filterBuyer = (ids) => {
    if (!ids?.length) return;
    const p = bind(ids);
    terms.push(
      !decision
        ? `${buyer}=ANY(${p}::text[])`
        : `EXISTS(SELECT 1 FROM kzk_appeals a WHERE a.decision_act_no=c.act_no AND a.buyer_eik=ANY(${p}::text[]))`,
    );
  };
  filterBuyer(q.buyerIds);
  if (q.buyerSectors?.length)
    filterBuyer([
      ...new Set(
        q.buyerSectors.flatMap(
          (id) => contract.PROCUREMENT_BUYER_SECTORS[id].eiks,
        ),
      ),
    ]);
  const cpvPredicate = (prefixes) =>
    prefixes.map((p) => `${cpv} LIKE ${bind(p + "%")}`).join(" OR ");
  const subjectCondition = (expression) =>
    decision
      ? `EXISTS(SELECT 1 FROM kzk_appeals a JOIN tenders t ON t.unp=a.unp WHERE a.decision_act_no=c.act_no AND (${expression}))`
      : `(${expression})`;
  if (q.cpvPrefixes?.length)
    terms.push(subjectCondition(cpvPredicate(q.cpvPrefixes)));
  if (q.subjectSectors?.length)
    terms.push(
      subjectCondition(
        cpvPredicate([
          ...new Set(
            q.subjectSectors.flatMap(
              (id) => contract.PROCUREMENT_SUBJECTS[id].prefixes,
            ),
          ),
        ]),
      ),
    );
  if (q.topic) {
    const topic = contract.PROCUREMENT_TOPICS.find((t) => t.id === q.topic);
    terms.push(
      subjectCondition(
        `(${cpvPredicate(topic.cpvPrefixes)}) OR ${tender ? "c.subject" : "t.subject"} ~* ${bind(topic.pattern)}`,
      ),
    );
  }
  if (q.keyword)
    terms.push(`${subject} ILIKE ${bind("%" + escapeLike(q.keyword) + "%")}`);
  if (q.key) terms.push(`${key}=${bind(q.key)}`);
  if (tender) {
    if (q.procedure) terms.push(`c.procedure_type=${bind(q.procedure)}`);
    for (const [name, column, yes] of [
      ["funding", "is_eu_funded", "eu"],
      ["framework", "is_framework_agreement", "yes"],
    ])
      if (q[name])
        terms.push(
          q[name] === "unknown"
            ? `c.${column} IS NULL`
            : `c.${column}=${bind(q[name] === yes)}`,
        );
    if (q.status === "cancelled") terms.push("c.is_cancelled IS TRUE");
    if (q.status === "notCancelled") terms.push("c.is_cancelled IS FALSE");
    if (["open", "closed"].includes(q.status))
      terms.push(
        `c.is_cancelled IS FALSE AND procurement_query_instant(c.submission_deadline) ${q.status === "open" ? ">" : "<="} ${bind(q.asOf)}::timestamptz`,
      );
    for (const [name, column, op] of [
      [
        "amountMin",
        "c.estimated_value_eur",
        q.amountMinRelation === "gt" ? ">" : ">=",
      ],
      [
        "amountMax",
        "c.estimated_value_eur",
        q.amountMaxRelation === "lt" ? "<" : "<=",
      ],
      ["minRiskCount", "r.fired", ">="],
      ["maxRiskCount", "r.fired", "<="],
    ])
      if (q[name] !== undefined)
        terms.push(
          `${column}${op}${bind(name.startsWith("amount") && q.currency === "BGN" ? q[name] / 1.95583 : q[name])}`,
        );
  }
  if (tender && ["open", "closed"].includes(q.status))
    terms.push(
      `procurement_query_instant(c.publication_date) <= ${bind(q.asOf)}::timestamptz`,
    );
  if (q.outcome)
    terms.push(
      q.outcome === "unknown"
        ? `(${outcome}) IS NULL`
        : `(${outcome})=${bind(q.outcome)}`,
    );
  const related = (kind) => {
    const rel = [`a.unp=${unp}`, "a.unp IS NOT NULL"];
    if (kind === "upheld") rel.push("a.outcome='уважена'");
    if (kind === "suspended")
      rel.push("kzk_effective_suspension(a.suspension,a.status) IS TRUE");
    const decisions = q.relatedCorpus === "decisions";
    const field = decisions ? "d.decision_date" : "a.complaint_date";
    if (q.relatedFrom)
      rel.push(
        `procurement_query_instant(${field}) >= ${bind(q.relatedFrom)}::date::timestamp AT TIME ZONE 'Europe/Sofia'`,
      );
    if (q.relatedToExclusive)
      rel.push(
        `procurement_query_instant(${field}) < ${bind(q.relatedToExclusive)}::date::timestamp AT TIME ZONE 'Europe/Sofia'`,
      );
    return `EXISTS(SELECT 1 FROM kzk_appeals a ${decisions ? "JOIN kzk_decisions d ON d.act_no=a.decision_act_no" : ""} WHERE ${rel.join(" AND ")})`;
  };
  if (q.relatedCorpus) {
    const decisionRelation = q.relatedCorpus === "decisions";
    const field = decisionRelation ? "d.decision_date" : "a.complaint_date";
    const link = appeal ? "a.complaint_no=c.complaint_no" : `a.unp=${unp}`;
    const periods = [
      q.relatedFrom
        ? `procurement_query_instant(${field})>=${bind(q.relatedFrom)}::date::timestamp AT TIME ZONE 'Europe/Sofia'`
        : "TRUE",
      q.relatedToExclusive
        ? `procurement_query_instant(${field})<${bind(q.relatedToExclusive)}::date::timestamp AT TIME ZONE 'Europe/Sofia'`
        : "TRUE",
    ];
    terms.push(
      `EXISTS(SELECT 1 FROM kzk_appeals a ${decisionRelation ? "JOIN kzk_decisions d ON d.act_no=a.decision_act_no" : ""} WHERE ${link} AND ${periods.join(" AND ")})`,
    );
  }
  function predicate(raw) {
    const negated = raw.startsWith("!"),
      id = negated ? raw.slice(1) : raw;
    let sql;
    if (id.startsWith("risk:")) {
      const bit = contract.PROCUREMENT_RISKS.tenders.indexOf(id.slice(5));
      if (!tender || bit < 0)
        throw new ProcurementQueryError("Unsupported risk");
      sql = `CASE WHEN (r.available_mask & ${1 << bit})<>0 THEN (r.fired_mask & ${1 << bit})<>0 END`;
    } else if (tender) sql = `CASE WHEN c.unp<>'' THEN ${related(id)} END`;
    else if (id === "unlinked")
      sql = appeal
        ? "t.unp IS NULL"
        : "NOT EXISTS(SELECT 1 FROM kzk_appeals a WHERE a.decision_act_no=c.act_no)";
    else if (id === "interimRequested" && appeal) sql = "c.vm_requested";
    else if (id === "appealed") sql = "TRUE";
    else if (id === "upheld")
      sql = `CASE WHEN (${outcome}) IN ('уважена','отхвърлена') ${decision ? "AND c.kind='решения'" : ""} THEN (${outcome})='уважена' END`;
    else if (id === "suspended") sql = suspension;
    else throw new ProcurementQueryError("Unsupported predicate");
    return negated ? `NOT(${sql})` : `(${sql})`;
  }
  const combine = (ids, mode) =>
    ids?.length
      ? ids.map(predicate).join(mode === "any" ? " OR " : " AND ")
      : "TRUE";
  if (q.basePredicates?.length)
    terms.push(`(${combine(q.basePredicates, q.baseMode)}) IS TRUE`);
  const numIds = q.numeratorPredicates?.length
    ? q.numeratorPredicates
    : ["appealed", "upheld", "suspended"].includes(q.metric)
      ? [q.metric]
      : [];
  const matched = combine(numIds, q.numeratorMode);
  const merits = tender
    ? "FALSE"
    : `(${outcome}) IN ('уважена','отхвърлена')${decision ? " AND c.kind='решения'" : ""}`;
  const numerator =
    q.denominator === "merits"
      ? `CASE WHEN ${merits} THEN (${matched}) END`
      : matched;
  const period = (from, to) =>
    [
      from
        ? `${date}>=${bind(from)}::date::timestamp AT TIME ZONE 'Europe/Sofia'`
        : "TRUE",
      to
        ? `${date}<${bind(to)}::date::timestamp AT TIME ZONE 'Europe/Sofia'`
        : "TRUE",
    ].join(" AND ");
  const primary = period(q.from, q.toExclusive),
    comparison =
      q.operation === "compare"
        ? period(q.compareFrom, q.compareToExclusive)
        : "FALSE";
  const groupField = {
    buyer: "buyer_id",
    month: "substring(date,1,7)",
    year: "substring(date,1,4)",
    cpv: "substring(cpv,1,2)",
    outcome: "outcome",
  }[q.groupBy || (q.operation === "trend" ? "month" : "")];
  if (q.groupBy && !groupField)
    throw new ProcurementQueryError("Unsupported grouping");
  const aggregate = `count(*)::int AS records,count(*) FILTER(WHERE matched IS TRUE)::int AS numerator,count(*) FILTER(WHERE ${q.metric === "riskCount" ? "available>0" : "matched IS NOT NULL"})::int AS evaluable,count(*) FILTER(WHERE merits IS TRUE)::int AS merits,
 sum(amount::numeric)::text AS value_eur,count(*) FILTER(WHERE amount IS NULL)::int AS missing_value,
 ${decision ? "(SELECT count(DISTINCT x.value)::int FROM jsonb_array_elements(jsonb_agg(linked_unps)) n, LATERAL jsonb_array_elements_text(n.value) x)" : "count(DISTINCT unp)::int"} AS linked_procedures,count(*) FILTER(WHERE linked IS NOT TRUE)::int AS unlinked,
 count(*) FILTER(WHERE requested IS TRUE)::int AS interim_requested,
 count(*) FILTER(WHERE outcome='уважена')::int AS upheld,count(*) FILTER(WHERE outcome='отхвърлена')::int AS rejected,count(*) FILTER(WHERE outcome='отказана')::int AS refused,count(*) FILTER(WHERE outcome='прекратена')::int AS terminated,count(*) FILTER(WHERE outcome IS NULL)::int AS unknown_outcome,
 avg(fired) FILTER(WHERE available>0)::text AS mean_risk_count,min(date) AS first_date,max(date) AS last_date`;
  const denom =
    q.denominator === "merits"
      ? "merits"
      : q.denominator === "evaluable"
        ? "evaluable"
        : "records";
  const sort =
    q.metric === "value"
      ? "value_eur::numeric"
      : q.metric === "riskCount"
        ? "mean_risk_count::numeric"
        : numIds.length
          ? `numerator::numeric/NULLIF(${denom},0)`
          : "records";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const grouped = groupField
    ? `, groups AS(SELECT ${groupField} AS group_key,${aggregate} FROM scoped WHERE period='primary' GROUP BY ${groupField}), ranked_groups AS(SELECT * FROM groups WHERE ${q.minGroupCountBasis === "evaluable" ? "evaluable" : "records"}>=${bind(q.minGroupCount || 0)} ORDER BY ${q.operation === "trend" ? "group_key ASC" : `${sort} ${order} NULLS LAST,group_key`} LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)})`
    : "";
  const compiled = {
    query: q,
    requiresRisk: risks,
    riskCatalogSql:risks ? "(SELECT CASE WHEN revision=(SELECT COALESCE(jsonb_object_agg(resource,generation::text),'{}'::jsonb) FROM procurement_query_revisions WHERE resource IN ('contracts','tenders')) THEN catalog_version END FROM procurement_tender_risk_meta WHERE only_row)" : "NULL::text",
    params,
    sql: `WITH base AS(SELECT ${key} AS key,${subject} AS title,(${date} AT TIME ZONE 'Europe/Sofia')::date::text AS date,${buyer || "NULL::text"} AS buyer_id,${tender ? "c.buyer_name" : appeal ? "c.respondent" : "c.respondent"} AS buyer,${tender ? "c.cpv" : appeal ? "t.cpv" : "NULL::text"} AS cpv,${unp || "NULL::text"} AS unp,
 ${tender ? "c.estimated_value_eur" : "NULL::numeric"} AS amount,${outcome || "NULL::text"} AS outcome,${merits} AS merits,${appeal ? "c.vm_requested" : "NULL::boolean"} AS requested,
 ${tender ? "TRUE" : appeal ? "t.unp IS NOT NULL" : `EXISTS(SELECT 1 FROM kzk_appeals a WHERE a.decision_act_no=c.act_no)`} AS linked,
 ${decision ? "(SELECT COALESCE(jsonb_agg(DISTINCT a.unp) FILTER(WHERE a.unp IS NOT NULL),'[]'::jsonb) FROM kzk_appeals a WHERE a.decision_act_no=c.act_no)" : "'[]'::jsonb"} AS linked_unps,
 ${tender && risks ? "r.fired,r.available,r.cri,r.fired_mask,r.available_mask" : "NULL::int AS fired,NULL::int AS available,NULL::numeric AS cri,NULL::int AS fired_mask,NULL::int AS available_mask"},
 (${numerator}) AS matched,(${primary}) AS in_primary,(${comparison}) AS in_comparison,
 ${appeal ? `CASE WHEN c.decision_act_no IS NOT NULL THEN 'act-derived-coarse' WHEN c.outcome IS NOT NULL OR c.decision_date IS NOT NULL THEN 'protected-manual' ELSE 'status-derived' END` : decision ? "'linked-complaint-consensus'" : "NULL::text"} AS outcome_basis,
 ${tender ? "NULL::text" : "c.source_url"} AS source_url,${decision ? "c.kind" : "NULL::text"} AS act_kind
 FROM ${tender ? "tenders" : appeal ? "kzk_appeals" : "kzk_decisions"} c ${tender && risks ? "LEFT JOIN procurement_tender_risk_cache r ON r.unp=c.unp" : ""} ${appeal ? "LEFT JOIN tenders t ON t.unp=c.unp" : ""} WHERE ${terms.length ? terms.join(" AND ") : "TRUE"}),
 scoped AS(SELECT base.*,'primary'::text AS period FROM base WHERE in_primary UNION ALL SELECT base.*,'comparison'::text AS period FROM base WHERE in_comparison),
 totals AS(SELECT ${aggregate} FROM scoped WHERE period='primary'),comparison AS(SELECT ${aggregate} FROM scoped WHERE period='comparison'),
 page AS(SELECT key,title,date,buyer_id,buyer,cpv,unp,amount::numeric::text AS amount_eur,outcome,outcome_basis,act_kind,source_url,fired,available,cri,fired_mask,available_mask FROM scoped WHERE period='primary' ${numIds.length ? "AND matched IS TRUE" : ""} ORDER BY ${q.metric === "value" ? `amount ${order} NULLS LAST` : q.metric === "riskCount" ? `fired ${order} NULLS LAST` : "date DESC NULLS LAST"},key LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)}) ${grouped}
 SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),'comparison',(SELECT to_jsonb(c) FROM comparison c),'rows',COALESCE((SELECT jsonb_agg(p) FROM page p),'[]'::jsonb),'groups',${groupField ? "COALESCE((SELECT jsonb_agg(g) FROM ranked_groups g),'[]'::jsonb)" : "'[]'::jsonb"},'revision',(SELECT COALESCE(jsonb_object_agg(resource,generation::text),'{}'::jsonb) FROM procurement_query_revisions),'riskCatalog',${risks ? "(SELECT CASE WHEN revision=(SELECT COALESCE(jsonb_object_agg(resource,generation::text),'{}'::jsonb) FROM procurement_query_revisions WHERE resource IN ('contracts','tenders')) THEN catalog_version END FROM procurement_tender_risk_meta WHERE only_row)" : "NULL::text"}) AS result`,
  };
  return q.parentQuery ? require("./procurement_query_parent").withParentQuery(compiled) : compiled;
}
module.exports = { compileOtherQuery };
