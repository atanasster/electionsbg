// Rebuild company_politicians — and every precompute derived from it — WITHOUT a TR load.
//
// company_politicians stores person_id, a positional ordinal that db:resolve:persons
// reassigns. Its only builder used to be db:load:tr:pg, which reads the gitignored TR
// SQLite and is a REFRESH_EXCLUSIONS member, so a resolve in db:refresh (or the cloud person
// chain) left the table naming the wrong humans until the next TR load. This runs the same
// rebuild from Postgres alone; run it after `db:load:declarations:pg -- --resolve` (it reads
// declaration_stake_company) and before persons-browse / graph.
//
//   npm run db:load:company-politicians:pg         # local
//   npm run db:load:company-politicians:pg:cloud   # Cloud SQL

import { pathToFileURL } from "node:url";
import { allRows, end } from "./lib/pg";
import { rebuildCompanyPoliticians } from "./load_tr_pg";

const main = async (): Promise<void> => {
  const [t] = await allRows<{ cp: string | null; tr: string | null }>(
    `SELECT to_regclass('public.company_politicians')::text AS cp,
            to_regclass('public.tr_person_roles')::text AS tr`,
  );
  if (!t.cp || !t.tr) {
    console.warn(
      "company_politicians: no TR corpus on this database (run db:load:tr:pg once) — skipped.",
    );
    return;
  }
  const t0 = Date.now();
  const links = await rebuildCompanyPoliticians();
  console.log(
    `company_politicians: rebuilt ${links} link(s) + dependents in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then(() => end())
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
