// A portable one-hop semijoin over the full parent cohort, never its result page.
const contract = require("./generated/procurement_query");
const compile = q => q.corpus === "contracts"
  ? require("./procurement_query").compileContractQuery(q)
  : require("./procurement_query_corpora").compileOtherQuery(q);
function withParentQuery(child) {
  const decoded = contract.decodeProcurementQuery(child.query.parentQuery);
  if (!decoded.ok) throw Error("Invalid parent query");
  const q = decoded.query, parent = compile(q), params = [];
  const extract = (compiled, projection) => {
    const end = compiled.sql.search(/,\s*totals AS/);
    if (end < 0) throw Error("Parent cohort compiler shape changed");
    const indices = new Map();
    return (compiled.sql.slice(0,end) + " SELECT " + projection + " FROM scoped WHERE period='primary'")
      .replace(/\$(\d+)/g, (_,n) => {
        if (!indices.has(n)) {params.push(compiled.params[Number(n)-1]);indices.set(n,params.length);}
        return "$" + indices.get(n);
      });
  };
  const population = extract(parent,"unp,matched");
  let coverage = "SELECT count(*) AS records,count(*) FILTER(WHERE matched IS NOT NULL) AS evaluable FROM procurement_parent_population";
  if (parent.requiresRisk) {
    // Conservative candidate coverage BEFORE risk membership can remove rows.
    // All requested risk observations must exist, even when Boolean short-circuit
    // could establish some memberships. Never call unknown membership empty.
    const riskIds = [...(q.basePredicates||[]),...(q.numeratorPredicates||[])].map(p=>p.replace(/^!/,"")).filter(p=>p.startsWith("risk:"));
    const mask = riskIds.reduce((n,id)=>n | (1 << contract.PROCUREMENT_RISKS[q.corpus].indexOf(id.slice(5))),0);
    const raw = {...q,operation:"count",metric:"riskCount",basePredicates:undefined,numeratorPredicates:undefined,minRiskCount:undefined,maxRiskCount:undefined};
    const valid=contract.validateProcurementQuery(raw);if(!valid.ok)throw Error("Invalid parent coverage");
    const coverageQuery=compile(valid.query);
    coverage=extract(coverageQuery,`count(*) AS records,count(*) FILTER(WHERE ${mask?`(available_mask & ${mask})=${mask}`:"available>0"}) AS evaluable`);
  }
  const shift=params.length;
  let sql=child.sql.replace(/\$(\d+)/g,(_,n)=>"$"+(Number(n)+shift));
  sql=sql.replace(/^WITH /,`WITH procurement_parent_population AS (${population}), procurement_parent_keys AS (SELECT DISTINCT unp FROM procurement_parent_population WHERE matched IS TRUE AND unp IS NOT NULL), procurement_parent_coverage AS (${coverage}), `);
  sql=sql.replace(/\) AS result\s*$/,`, 'parentRecords',(SELECT records FROM procurement_parent_coverage),'parentEvaluable',(SELECT evaluable FROM procurement_parent_coverage),'parentRiskCatalog',${parent.riskCatalogSql}) AS result`);
  return {...child,sql,params:[...params,...child.params],parentRequiresRisk:parent.requiresRisk};
}
module.exports={withParentQuery};
