import { writeFileSync } from "node:fs";
import { pinLocalDatabase, withClient, end } from "../db/lib/pg";
pinLocalDatabase();
try {
  const audit = await withClient(async (c) => {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      await c.query("SET LOCAL ROLE app_readonly");
      const read = async (sql: string) => (await c.query(sql)).rows;
      return {
        checkedAt: new Date().toISOString(),
        role: "app_readonly",
        isolation: "repeatable read",
        environment: "local",
        columns: await read(
          "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('fund_projects','agri_subsidies','interreg_operations','interreg_partners') ORDER BY table_name,ordinal_position",
        ),
        identities: await read(
          `SELECT 'isun' AS corpus,count(*) AS records,count(*)-count(DISTINCT contract_number) AS duplicate_or_null_key FROM fund_projects UNION ALL SELECT 'interregOperations',count(*),count(*)-count(DISTINCT keep_id) FROM interreg_operations UNION ALL SELECT 'interregPartners',count(*),count(*)-count(DISTINCT keep_partnership_id) FROM interreg_partners UNION ALL SELECT 'agri',count(*),count(*)-count(DISTINCT id) FROM agri_subsidies`,
        ),
        partnerIdentity: await read(
          `SELECT count(*) FILTER(WHERE keep_partnership_id IS NULL) AS missing_partnership_id,count(*) FILTER(WHERE keep_partner_id IS NULL) AS missing_organisation_id,count(DISTINCT keep_partner_id) AS organisations,count(*) AS partnerships FROM interreg_partners`,
        ),
        keyConstraints: await read(
          `SELECT c.relname AS relation,p.conname,pg_get_constraintdef(p.oid) AS definition FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('fund_projects','agri_subsidies','interreg_operations','interreg_partners') AND p.contype IN ('p','u') ORDER BY c.relname,p.conname`,
        ),
        isun: await read(
          "SELECT count(*) AS records,count(DISTINCT beneficiary_eik) AS eiks,count(*) FILTER(WHERE beneficiary_eik IS NULL) AS missing_eik,count(*) FILTER(WHERE total_eur IS NULL) AS missing_total,count(*) FILTER(WHERE paid_eur IS NULL) AS missing_paid,count(DISTINCT program_code) AS programmes FROM fund_projects",
        ),
        agri: await read(
          "SELECT year,count(*) AS records,count(DISTINCT eik) AS eiks,count(*) FILTER(WHERE eik IS NULL) AS person_records,count(*) FILTER(WHERE eik='121100421') AS payer_records,count(*) FILTER(WHERE total_eur<0) AS negative_records FROM agri_subsidies GROUP BY year ORDER BY year",
        ),
        interreg: await read(
          "SELECT period,count(*) AS operations,count(*) FILTER(WHERE start_date IS NULL) AS missing_start,count(*) FILTER(WHERE end_date IS NULL) AS missing_end,count(*) FILTER(WHERE start_date>end_date) AS reversed_dates FROM interreg_operations GROUP BY period ORDER BY period",
        ),
        partners: await read(
          "SELECT budget_basis,count(*) AS records,count(*) FILTER(WHERE eik IS NULL) AS missing_eik,count(*) FILTER(WHERE obshtina IS NULL) AS missing_place FROM interreg_partners WHERE country='Bulgaria' OR country_department='Bulgaria' GROUP BY budget_basis ORDER BY budget_basis",
        ),
      };
    } finally {
      await c.query("ROLLBACK");
    }
  });
  writeFileSync(
    "docs/plans/ai-funding-chat-source-audit.json",
    JSON.stringify(audit, null, 2) + "\n",
  );
  console.log(JSON.stringify({ ...audit, columns: audit.columns.length }));
} finally {
  await end();
}
