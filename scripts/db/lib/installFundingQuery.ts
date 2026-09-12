import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { withClient } from "./pg";
import { PROCUREMENT_BUYER_SECTORS } from "../../../src/lib/procurementBuyerSectors";
import { FUNDING_CATALOG_VERSION } from "../../../src/lib/fundingCatalog";
import {
  fundingProgrammeClass,
  FUNDING_EXTRA_THEMES,
} from "../../funds/query_catalog";
const root = new URL("../../../", import.meta.url);
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, root), "utf8"));
export type MoneyObservation = {
  contract_number: string;
  total_eur: number | null;
  grant_eur: number | null;
  own_cofinance_eur: number | null;
  paid_eur: number | null;
  observed_mask: number;
  source_hash: string;
};
/** Preserve the raw observation mask; blank cells are never source-published zeros. */
export function fundingMoneyObservations(buffer: Buffer): MoneyObservation[] {
  const book = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(
    book.Sheets[book.SheetNames[0]],
    { header: 1, raw: true },
  );
  const header = rows.findIndex(
    (r) =>
      r[0] === "Програма" &&
      r[7] === "Номер на проектно предложение" &&
      r[9] === "Обща стойност" &&
      r[10] === "БФП" &&
      r[11] === "Собствено съфинансиране от бенефициента" &&
      r[12] === "Реално изплатени суми",
  );
  if (header < 0) throw Error("Funding observation export schema mismatch");
  const hash = createHash("sha256").update(buffer).digest("hex"),
    seen = new Set<string>();
  return rows
    .slice(header + 1)
    .filter((r) => r[7])
    .map((r) => {
      const key = String(r[7]).trim();
      if (seen.has(key)) throw Error("Duplicate funding observation key");
      seen.add(key);
      let mask = 0;
      const values = [9, 10, 11, 12].map((col, bit) => {
        if (
          r[col] === null ||
          r[col] === undefined ||
          String(r[col]).trim() === ""
        )
          return null;
        const n =
          typeof r[col] === "number"
            ? (r[col] as number)
            : Number(String(r[col]).replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n))
          throw Error("Invalid funding observation amount");
        mask |= 1 << bit;
        return n;
      });
      return {
        contract_number: key,
        total_eur: values[0],
        grant_eur: values[1],
        own_cofinance_eur: values[2],
        paid_eur: values[3],
        observed_mask: mask,
        source_hash: hash,
      };
    });
}
export async function installFundingQuery(): Promise<void> {
  const taxFile = new URL("data/funds/taxonomy.json", root),
    themeFile = new URL("data/funds/themes.json", root);
  if (!existsSync(taxFile) || !existsSync(themeFile))
    throw Error("Funding catalogs missing; refusing partial publication");
  const tax = readJson("data/funds/taxonomy.json") as {
    programmes: {
      programCode: string;
      programName: string;
      fundType: string;
    }[];
  };
  const themes = readJson("data/funds/themes.json") as {
    themes: {
      slug: string;
      labelBg: string;
      labelEn: string;
      titleKeywords?: string[];
      programCodes?: string[];
    }[];
  };
  const programmes = tax.programmes
    .map((p) => ({
      corpus: "isunProjects",
      code: p.programCode,
      label_bg: p.programName,
      label_en: null,
      ...fundingProgrammeClass(p.programCode, p.fundType),
    }))
    .map(({ fundType, ...p }) => ({ ...p, fund_type: fundType }));
  const themeRows = [
    ...themes.themes.map((t) => ({
      id: t.slug,
      label_bg: t.labelBg,
      label_en: t.labelEn,
      keywords: t.titleKeywords ?? [],
      programme_ids: t.programCodes ?? [],
    })),
    ...FUNDING_EXTRA_THEMES,
  ];
  const sectors = Object.values(PROCUREMENT_BUYER_SECTORS).map((s) => ({
    id: s.id,
    label_bg: s.label.bg,
    label_en: s.label.en,
    eiks: s.eiks,
  }));
  const snapshot = new URL("data/_cache/funds/projects.xlsx", root);
  const observations = existsSync(snapshot)
    ? fundingMoneyObservations(readFileSync(snapshot))
    : null;
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('funding-query-catalog-v1'))",
      );
      await c.query(
        readFileSync(
          new URL(
            "../schema/pg/198_funding_query_catalogs.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await c.query("DELETE FROM funding_programmes");
      await c.query(
        `INSERT INTO funding_programmes(corpus,code,label_bg,label_en,period,mechanism,fund_type) SELECT corpus,code,label_bg,label_en,period,mechanism,fund_type FROM jsonb_to_recordset($1::jsonb) AS x(corpus text,code text,label_bg text,label_en text,period text,mechanism text,fund_type text)`,
        [JSON.stringify(programmes)],
      );
      const tables = (
        await c.query(
          "SELECT to_regclass('interreg_programmes') IS NOT NULL AS interreg,to_regclass('fund_projects') IS NOT NULL AS isun",
        )
      ).rows[0];
      if (tables.interreg)
        await c.query(
          "INSERT INTO funding_programmes SELECT 'interregOperations',code,name_bg,name_en,period,'EU','Interreg',eligible_nuts FROM interreg_programmes",
        );
      await c.query("DELETE FROM funding_themes");
      await c.query(
        `INSERT INTO funding_themes SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text,label_bg text,label_en text,keywords text[],programme_ids text[])`,
        [JSON.stringify(themeRows)],
      );
      await c.query("DELETE FROM funding_sectors");
      await c.query(
        `INSERT INTO funding_sectors SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text,label_bg text,label_en text,eiks text[])`,
        [JSON.stringify(sectors)],
      );
      // Publish evidence only for keys AND exact current values; a stale local cache cannot certify changed rows.
      if (observations && tables.isun) {
        await c.query("DELETE FROM funding_isun_observations");
        await c.query(
          `INSERT INTO funding_isun_observations SELECT o.* FROM jsonb_to_recordset($1::jsonb) AS o(contract_number text,total_eur double precision,grant_eur double precision,own_cofinance_eur double precision,paid_eur double precision,observed_mask int,source_hash text) JOIN fund_projects f ON f.contract_number=o.contract_number WHERE f.total_eur IS NOT DISTINCT FROM COALESCE(o.total_eur,0) AND f.grant_eur IS NOT DISTINCT FROM COALESCE(o.grant_eur,0) AND f.own_cofinance_eur IS NOT DISTINCT FROM COALESCE(o.own_cofinance_eur,0) AND f.paid_eur IS NOT DISTINCT FROM COALESCE(o.paid_eur,0)`,
          [JSON.stringify(observations)],
        );
      }
      const evidence = (
        await c.query(
          "SELECT count(*)::int AS records,count(*) FILTER(WHERE observed_mask=15)::int AS complete FROM funding_isun_observations",
        )
      ).rows[0];
      await c.query(
        "INSERT INTO funding_query_meta VALUES('catalog',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [
          JSON.stringify({
            version: FUNDING_CATALOG_VERSION,
            observationEvidence: evidence,
            sourceHash: observations?.[0]?.source_hash ?? null,
          }),
        ],
      );
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    }
  });
}
