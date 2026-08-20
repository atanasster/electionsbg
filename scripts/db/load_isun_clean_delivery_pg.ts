// Load data/funds/clean_delivery.json into the 175 tables.
//
//   npm run db:load:clean-delivery:pg
//   npm run db:load:clean-delivery:pg:cloud
//
// Pure-load: the source JSON is committed, so this works on a fresh clone with no
// network. `npm run funds:clean-delivery` rebuilds it from the operator-downloaded
// XLSX drops in data/_cache/isun_clean_delivery/ (gitignored — the F5 WAF in front
// of 2020.eufunds.bg refuses automated exports intermittently).
//
// ⚠️ See 175's header before using the data: it is an ACHIEVEMENT register, and
// absence from it is NOT a financial correction.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(__dirname, "schema/pg/175_isun_clean_delivery.sql");
const SRC = path.resolve(__dirname, "../../data/funds/clean_delivery.json");

interface Contract {
  regNo: string;
  contractNumber: string;
  programme: string;
  procedure: string;
  title: string;
  beneficiaryEik: string | null;
  beneficiaryName: string;
  orgType: string;
  orgKind: string;
  enterpriseCategory: string;
  durationMonths: number | null;
  signedOn: string | null;
  originalEndOn: string | null;
  closedOn: string | null;
  status: string;
}
interface Beneficiary {
  eik: string | null;
  name: string;
  orgType: string;
  orgKind: string;
  seat: string;
  onTimeContracts: number;
}

const main = async (): Promise<void> => {
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  if (!fs.existsSync(SRC)) {
    console.warn(
      `→ schema applied; no ${path.relative(process.cwd(), SRC)} — run ` +
        `\`npm run funds:clean-delivery\` first.`,
    );
    await end();
    return;
  }

  const p = JSON.parse(fs.readFileSync(SRC, "utf8")) as {
    coverage: Record<string, never>;
    contracts: Contract[];
    beneficiaries: Beneficiary[];
  };
  if (!p.contracts?.length || !p.beneficiaries?.length)
    throw new Error(
      "clean_delivery.json has no rows — refusing to publish an empty register " +
        "over a populated one",
    );
  // The caveat is the point of the dataset, and 175 makes the column NOT NULL. Fail
  // here with a readable message rather than on a constraint violation deep in COPY.
  if (!p.coverage?.absenceMeaning)
    throw new Error(
      "coverage.absenceMeaning is missing. It is the sentence that stops this " +
        "register being read as an accusation dataset; it is not optional.",
    );

  await withTx(async (c) => {
    await c.query("TRUNCATE isun_clean_contract, isun_clean_beneficiary");
    await copyRows(
      c,
      "isun_clean_contract",
      [
        "reg_no",
        "contract_number",
        "programme",
        "procedure",
        "title",
        "beneficiary_eik",
        "beneficiary_name",
        "org_type",
        "org_kind",
        "enterprise_category",
        "duration_months",
        "signed_on",
        "original_end_on",
        "closed_on",
        "status",
      ],
      p.contracts.map((r) => [
        r.regNo,
        r.contractNumber,
        r.programme,
        r.procedure,
        r.title,
        r.beneficiaryEik,
        r.beneficiaryName,
        r.orgType,
        r.orgKind,
        r.enterpriseCategory,
        r.durationMonths,
        r.signedOn,
        r.originalEndOn,
        r.closedOn,
        r.status,
      ]),
    );
    await copyRows(
      c,
      "isun_clean_beneficiary",
      ["eik", "name", "org_type", "org_kind", "seat", "on_time_contracts"],
      p.beneficiaries.map((b) => [
        b.eik,
        b.name,
        b.orgType,
        b.orgKind,
        b.seat,
        b.onTimeContracts,
      ]),
    );
    const cv = p.coverage;
    await c.query(
      `INSERT INTO isun_clean_delivery_coverage
         (id, built_at, contract_criterion, beneficiary_criterion, absence_meaning,
          contracts, beneficiaries, natural_persons_excluded,
          on_time_contracts_declared, programmes)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         built_at=EXCLUDED.built_at, contract_criterion=EXCLUDED.contract_criterion,
         beneficiary_criterion=EXCLUDED.beneficiary_criterion,
         absence_meaning=EXCLUDED.absence_meaning, contracts=EXCLUDED.contracts,
         beneficiaries=EXCLUDED.beneficiaries,
         natural_persons_excluded=EXCLUDED.natural_persons_excluded,
         on_time_contracts_declared=EXCLUDED.on_time_contracts_declared,
         programmes=EXCLUDED.programmes`,
      [
        cv.builtAt,
        cv.contractCriterion,
        cv.beneficiaryCriterion,
        cv.absenceMeaning,
        cv.contracts,
        cv.beneficiaries,
        cv.naturalPersonsExcluded,
        cv.onTimeContractsDeclared,
        JSON.stringify(cv.programmes ?? []),
      ],
    );
  });

  await vacuumAfterReload("isun_clean_contract", "isun_clean_beneficiary");

  const [j] = await allRows<{ joined: string; total: string }>(
    `SELECT count(*) FILTER (WHERE f.contract_number IS NOT NULL)::text joined,
            count(*)::text total
       FROM isun_clean_contract c
       LEFT JOIN fund_projects f ON f.contract_number = c.contract_number`,
  );
  console.log(
    `✓ isun_clean_contract=${p.contracts.length.toLocaleString()} · ` +
      `isun_clean_beneficiary=${p.beneficiaries.length.toLocaleString()}`,
  );
  console.log(
    `  join to fund_projects: ${Number(j.joined).toLocaleString()}/${Number(j.total).toLocaleString()}` +
      ` on contract_number (the -C## suffix stripped)`,
  );
  console.log(
    "  ⚠️ absence from this register is NOT a financial correction — see 175",
  );
  await end();
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
