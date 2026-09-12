function interregSource(q, has) {
  const partners = q.corpus === "interregPartners";
  const money = partners
    ? q.amountBasis === "partnerEu"
      ? "p.eu_funding_eur"
      : "p.budget_eur"
    : q.amountBasis === "operationEu"
      ? "c.eu_funding_eur"
      : "c.total_budget_eur";
  const signals = partners
    ? {
        unpublishedBudget: "p.budget_eur IS NULL",
        publishedZero: "COALESCE(p.budget_eur=0,false)",
        unidentified: "NULLIF(p.eik,'') IS NULL",
        unplaced:
          "p.ekatte IS NULL AND p.obshtina IS NULL AND p.oblast IS NULL",
        lead: "p.is_lead",
        bulgarian:
          "p.country='Bulgaria' OR COALESCE(p.country_department='Bulgaria',false)",
      }
    : {
        unpublishedBudget: "c.total_budget_eur IS NULL",
        reversedDates: "c.start_date>c.end_date",
      };
  if (partners && has("political"))
    signals.political =
      "CASE WHEN NULLIF(p.eik,'') IS NOT NULL THEN EXISTS(SELECT 1 FROM funding_political_eiks e WHERE e.eik=p.eik) END";
  if (partners && has("otherFunding"))
    signals.otherFunding =
      "CASE WHEN NULLIF(p.eik,'') IS NOT NULL THEN EXISTS(SELECT 1 FROM fund_projects f WHERE f.beneficiary_eik=p.eik) OR EXISTS(SELECT 1 FROM agri_subsidies a WHERE a.eik=p.eik) END";
  const date =
    q.dateBasis === "end"
      ? "c.end_date"
      : q.dateBasis === "none"
        ? "NULL::date"
        : "c.start_date";
  return `SELECT ${partners ? "p.keep_partnership_id::text" : "c.keep_id::text"} AS key,${partners ? "NULLIF(p.eik,'')" : "NULL::text"} AS entity,${partners ? "p.partner_name" : "NULL::text"} AS name,COALESCE(c.title_bg,c.title_en) AS title,c.programme_code AS programme,${money}::numeric AS amount,NULL::numeric AS paid,${date} AS date,c.end_date AS end_date,c.keep_id::text AS operation_key,${partners ? "p.keep_partner_id::text" : "NULL::text"} AS organisation,CASE WHEN c.status IN ('closed','ongoing') THEN c.status WHEN NULLIF(c.status,'') IS NULL THEN 'unknown' ELSE 'other' END AS status,${partners ? "jsonb_build_object('munis',jsonb_build_array(p.obshtina))" : "NULL::jsonb"} AS location,${partners ? "p.ekatte" : "NULL::text"} AS ekatte,${partners ? "p.oblast" : "NULL::text"} AS oblast,jsonb_build_object(${Object.entries(
    signals,
  )
    .flatMap(([k, v]) => [`'${k}'`, `(${v})`])
    .join(
      ",",
    )}) AS signals,ARRAY[]::text[] AS themes FROM interreg_operations c ${partners ? "JOIN interreg_partners p ON p.keep_id=c.keep_id" : ""}`;
}
module.exports = { interregSource };
