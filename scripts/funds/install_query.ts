// Reinstall the funding-query catalogs (installFundingQuery) without a corpus
// reload. LOCAL by default; `--cloud` targets $DATABASE_URL instead — the publish
// path when only the catalog moved (e.g. a sector roster change in
// PROCUREMENT_BUYER_SECTORS), which otherwise needed a whole funds or Interreg
// :cloud reload just to reach the call at its end.
//
//   npx tsx scripts/funds/install_query.ts           # local docker Postgres
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
//     npx tsx scripts/funds/install_query.ts --cloud # Cloud SQL via the proxy
//
// Deliberately NOT an npm `:cloud` script: those are corpus publishes, gated by
// cloud_loader_coverage.test.ts to be emitted by a skill. This reloads no corpus.

import { installFundingQuery } from "../db/lib/installFundingQuery";
import { pinLocalDatabase, end } from "../db/lib/pg";

const cloud = process.argv.includes("--cloud");
if (!cloud) pinLocalDatabase();
else if (!process.env.DATABASE_URL)
  throw new Error("--cloud needs DATABASE_URL (the Cloud SQL proxy URL)");
try {
  await installFundingQuery();
  console.log(
    `Funding query catalogs installed ${cloud ? "on DATABASE_URL" : "locally"}`,
  );
} finally {
  await end();
}
