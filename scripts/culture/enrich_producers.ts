// Re-link data/culture/overview.json's topProducers to a company EIK, in place.
// The matching rule lives in scripts/culture/producer_eik.ts, shared with the
// ingest — see that file for why ambiguous names are left unlinked.
//
//   npx tsx scripts/culture/enrich_producers.ts
//
// Needs Postgres (tr_companies). NOT a required post-step of the film ingest any
// more: scripts/culture/ingest.ts links the producers itself before it writes
// overview.json, so the two cannot drift apart. This stays as the standalone
// re-run — after a TR reload, or to repair an overview.json written while
// Postgres was down (the ingest warns loudly and carries the previous EIKs
// forward in that case).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { end } from "../db/lib/pg";
import { linkProducerEiks } from "./producer_eik";
import type { CultureOverviewFile } from "../../src/data/culture/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OVERVIEW = path.resolve(__dirname, "../../data/culture/overview.json");

const main = async () => {
  const overview = JSON.parse(
    fs.readFileSync(OVERVIEW, "utf8"),
  ) as CultureOverviewFile;

  const { linked, total } = await linkProducerEiks(overview.topProducers);
  if (total === 0) {
    console.log("no producers to enrich");
    await end();
    return;
  }

  fs.writeFileSync(OVERVIEW, JSON.stringify(overview, null, 2) + "\n");
  console.log(
    `✓ ${linked}/${total} top producers linked to a unique EIK · → data/culture/overview.json`,
  );
  await end();
};

main().catch(async (e) => {
  console.error("producer enrichment failed:", e);
  await end();
  process.exit(1);
});
