const { FUNDING_RECIPIENT_PLACES } = require("./generated/funding_query");
function agriSource(q, has, bind) {
  const money = {
    paid: "total_eur",
    direct: "dp_eur",
    market: "market_eur",
    rural: "rural_eur",
  }[q.amountBasis];
  const signals = { unidentified: "NULLIF(c.eik,'') IS NULL" };
  if (has("political"))
    signals.political =
      "CASE WHEN NULLIF(c.eik,'') IS NOT NULL THEN EXISTS(SELECT 1 FROM funding_political_eiks p WHERE p.eik=c.eik) END";
  if (has("otherFunding"))
    signals.otherFunding =
      "CASE WHEN NULLIF(c.eik,'') IS NOT NULL THEN EXISTS(SELECT 1 FROM fund_projects f WHERE f.beneficiary_eik=c.eik) OR EXISTS(SELECT 1 FROM interreg_partners p WHERE p.eik=c.eik) END";
  const oblast =
    q.placeIds?.length || q.groupBy === "place"
      ? `CASE c.oblast ${Object.entries(FUNDING_RECIPIENT_PLACES)
          .map(([id, name]) => `WHEN ${bind(name)} THEN ${bind(id)}`)
          .join(" ")} ELSE NULL END`
      : "NULL::text";
  const filters =
    q.population === "attributable"
      ? ["c.eik IS DISTINCT FROM '121100421'"]
      : [];
  const years = [
    ...new Set([
      ...(q.financialYears || []),
      ...(q.compareFinancialYears || []),
    ]),
  ];
  if (years.length)
    filters.push(`c.year=ANY(${bind(years.map(Number))}::int[])`);
  return `SELECT c.id::text AS key,NULLIF(c.eik,'') AS entity,c.name,COALESCE(c.scheme_desc,c.scheme,'') AS title,c.scheme AS programme,c.${money}::numeric AS amount,c.total_eur::numeric AS paid,make_date(c.year,1,1) AS date,'unknown'::text AS status,NULL::jsonb AS location,NULL::text AS ekatte,${oblast} AS oblast,jsonb_build_object(${Object.entries(
    signals,
  )
    .flatMap(([k, v]) => [`'${k}'`, `(${v})`])
    .join(
      ",",
    )}) AS signals,ARRAY[]::text[] AS themes FROM agri_subsidies c ${filters.length ? "WHERE " + filters.join(" AND ") : ""}`;
}
module.exports = { agriSource };
