// Reinstall the funding-query catalogs (installFundingQuery) without a corpus
// reload. LOCAL by default; `--cloud` targets $DATABASE_URL instead — the publish
// path when only the catalog moved (e.g. a sector roster change in
// PROCUREMENT_BUYER_SECTORS), which otherwise needed a whole funds or Interreg
// :cloud reload just to reach the call at its end.
//
//   npx tsx scripts/funds/install_query.ts           # local docker Postgres
//   npm run funds:install-query:cloud                # Cloud SQL via the proxy

import { installFundingQuery } from "../db/lib/installFundingQuery";
import { pinLocalDatabase, end } from "../db/lib/pg";

const cloud = process.argv.includes("--cloud");
if (!cloud) pinLocalDatabase();
else if (!process.env.DATABASE_URL)
  throw new Error(
    "--cloud needs DATABASE_URL (use npm run funds:install-query:cloud)",
  );
try {
  await installFundingQuery();
  console.log(
    `Funding query catalogs installed ${cloud ? "on DATABASE_URL" : "locally"}`,
  );
} finally {
  await end();
}
