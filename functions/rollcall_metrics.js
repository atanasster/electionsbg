// Adds aggregates over the compiler's complete cohort, never its visible page.
function compileMetrics(q, depth, { compileRollcallQuery, RollcallError }) {
  if (q.metric === "contested" && q.groupBy)
    throw new RollcallError("metric_grouping_unsupported", 422);
  if (q.operation === "compare") {
    const a = {
      ...q,
      operation: "summary",
      compareFrom: undefined,
      compareToExclusive: undefined,
    };
    const b = { ...a, from: q.compareFrom, toExclusive: q.compareToExclusive };
    const current = compileRollcallQuery(a, depth),
      previous = compileRollcallQuery(b, depth);
    const priorSql = previous.sql.replace(
      /\$(\d+)/g,
      (_, n) => "$" + (Number(n) + current.params.length),
    );
    const params = [...current.params, ...previous.params, JSON.stringify(q)];
    return {
      query: q,
      params,
      revisions: [...current.revisions, ...previous.revisions],
      sql: `WITH current_result AS MATERIALIZED(${current.sql}), previous_result AS MATERIALIZED(${priorSql}) SELECT (SELECT result FROM current_result)||jsonb_build_object('query',$${params.length}::jsonb,'comparisons',jsonb_build_array((SELECT result FROM current_result),(SELECT result FROM previous_result)),'dateQualityUnsupported',COALESCE((SELECT (result->>'dateQualityUnsupported')::boolean FROM current_result),FALSE) OR COALESCE((SELECT (result->>'dateQualityUnsupported')::boolean FROM previous_result),FALSE)) AS result`,
    };
  }
  if (["agreement", "alignment"].includes(q.metric) && q.groupBy)
    throw new RollcallError("metric_grouping_unsupported", 422);
  if (q.metric === "agreement") {
    for (const seats of [q.seatIds, q.comparatorSeatIds])
      if (new Set(seats.map((s) => s.split(":")[0])).size !== seats.length)
        throw new RollcallError("one_person_per_assembly_required", 422);
  }
  if (q.groupBy === "faction" && q.corpus !== "parliamentCasts")
    throw new RollcallError("historical_faction_unavailable", 422);
  const base = {
    ...q,
    metric: "records",
    groupBy: undefined,
    operation: "list",
    comparatorSeatIds: undefined,
  };
  const compiled = compileRollcallQuery(base, depth);
  const params = compiled.params;
  const bind = (v) => {
    params.push(v);
    return "$" + params.length;
  };
  let metric =
    "jsonb_build_object('metric','records','records',(SELECT count(*) FROM selected))";
  if (q.metric === "choiceShare") {
    const eligible =
      q.denominator === "participating"
        ? "choice IN ('for','against','abstain')"
        : "choice IS NOT NULL";
    metric = `(SELECT jsonb_build_object('metric','choiceShare','numerator',count(*) FILTER(WHERE choice=${bind(q.choice)} AND ${eligible}),'denominator',count(*) FILTER(WHERE ${eligible}),'recorded',count(*),'recordedAbsent',count(*) FILTER(WHERE choice='recordedAbsent'),'percentage',100.0*count(*) FILTER(WHERE choice=${bind(q.choice)} AND ${eligible})/NULLIF(count(*) FILTER(WHERE ${eligible}),0),'denominatorBasis',${bind(q.denominator)}::text) FROM cohort)`;
  }
  if (q.metric === "agreement") {
    const peers = bind(q.comparatorSeatIds);
    metric = `(SELECT jsonb_build_object('metric','agreement','numerator',count(*) FILTER(WHERE s.choice=CASE c.vote WHEN 'y' THEN 'for' WHEN 'n' THEN 'against' WHEN 'a' THEN 'abstain' END),'denominator',count(*),'percentage',CASE WHEN count(*)>=${bind(q.minOverlap)}::int THEN 100.0*count(*) FILTER(WHERE s.choice=CASE c.vote WHEN 'y' THEN 'for' WHEN 'n' THEN 'against' WHEN 'a' THEN 'abstain' END)/NULLIF(count(*),0) END,'minimumOverlap',${bind(q.minOverlap)}::int,'excludedRecordedAbsent',true,'definition','exact_choice_agreement') FROM selected s JOIN vote_cast c ON c.item_id=s.item_id AND c.ns::text||':'||c.mp_id::text=ANY(${peers}::text[]) WHERE s.choice IN ('for','against','abstain') AND c.vote IN ('y','n','a'))`;
  }
  if (q.metric === "alignment") {
    // Cast-time faction, matching the existing plurality priority: yes, no, abstain.
    metric = `(SELECT jsonb_build_object('metric','alignment','numerator',count(*) FILTER(WHERE choice=majority),'denominator',count(*),'percentage',CASE WHEN count(*)>=${bind(q.minOverlap)}::int THEN 100.0*count(*) FILTER(WHERE choice=majority)/NULLIF(count(*),0) END,'minimumOverlap',${bind(q.minOverlap)}::int,'tiePolicy','for_then_against_then_abstain','excludedRecordedAbsent',true) FROM (SELECT s.choice,m.majority FROM selected s CROSS JOIN LATERAL(SELECT CASE c.vote WHEN 'y' THEN 'for' WHEN 'n' THEN 'against' WHEN 'a' THEN 'abstain' END AS majority FROM vote_cast c JOIN party_dim pd ON pd.party_id=c.party_id WHERE c.item_id=s.item_id AND pd.short=s.faction AND c.vote IN ('y','n','a') GROUP BY c.vote ORDER BY count(*) DESC,CASE c.vote WHEN 'y' THEN 1 WHEN 'n' THEN 2 ELSE 3 END LIMIT 1) m WHERE s.choice IN ('for','against','abstain') AND s.faction IS NOT NULL) evaluated)`;
  }
  let groups = "'[]'::jsonb",
    groupCount = "0";
  if (q.groupBy) {
    const expression = {
      month: "to_char(date,'YYYY-MM')",
      year: "to_char(date,'YYYY')",
      person: "person_key",
      faction: "faction",
      choice: "choice",
      body: "body",
    }[q.groupBy];
    const eligible =
      q.denominator === "participating"
        ? "choice IN ('for','against','abstain')"
        : "choice IS NOT NULL";
    const extra =
      q.metric === "choiceShare"
        ? `,count(*) FILTER(WHERE ${eligible}) AS denominator,count(*) FILTER(WHERE ${eligible} AND choice=${bind(q.choice)}) AS numerator,100.0*count(*) FILTER(WHERE ${eligible} AND choice=${bind(q.choice)})/NULLIF(count(*) FILTER(WHERE ${eligible}),0) AS percentage`
        : "";
    const aggregated = `SELECT ${expression} AS key,count(*) AS records${extra} FROM ${q.metric === "choiceShare" ? "cohort" : "selected"} GROUP BY ${expression}`;
    const sort =
      q.operation === "rank"
        ? `${q.metric === "choiceShare" ? "percentage" : "records"} ${q.order.toUpperCase()} NULLS LAST,key`
        : `key ${q.order.toUpperCase()} NULLS LAST`;
    groups = `(SELECT COALESCE(jsonb_agg(g ORDER BY ${sort
      .split(",")
      .map((x) => "g." + x)
      .join(
        ",",
      )}),'[]'::jsonb) FROM (SELECT * FROM (${aggregated}) all_groups ORDER BY ${sort} LIMIT ${bind(q.limit)} OFFSET ${bind(q.offset)}) g)`;
    groupCount = `(SELECT count(*) FROM (${aggregated}) all_groups)`;
  }
  const marker = compiled.sql.lastIndexOf("'totals',");
  const sql =
    compiled.sql.slice(0, marker) +
    compiled.sql
      .slice(marker)
      .replace(
        "'totals',",
        `'metrics',${metric},'groups',${groups},'groupCount',${groupCount},'totals',`,
      );
  // The public query is the requested metric scope, not the internal records adapter.

  const original = JSON.stringify(compiled.query);
  const i = params.indexOf(original);
  if (i < 0) throw Error("Missing canonical query parameter");
  params[i] = JSON.stringify(q);
  return { ...compiled, query: q, sql, params };
}
module.exports = { compileMetrics };
