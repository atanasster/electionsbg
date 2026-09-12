import { installFundingQuery } from "../db/lib/installFundingQuery";
import { pinLocalDatabase, end } from "../db/lib/pg";
pinLocalDatabase();
try {
  await installFundingQuery();
  console.log("Funding query catalogs installed locally");
} finally {
  await end();
}
