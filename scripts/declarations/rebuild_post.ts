/**
 * One-shot: re-run the post-fetch build steps without touching the network.
 *   - augmentCompaniesIndexWithMpRoles (re-derives companies-index `mpRoles` + TR-only companies)
 *   - buildAssetsRankings   (regenerates assets-rankings + mp-assets/*)
 *   - buildCarMakes         (regenerates car-makes.json)
 *   - buildDataProvenance   (regenerates data-provenance.json)
 *
 * Use after editing any of those builders (e.g. to re-shape the rankings
 * file) so we don't have to re-fetch every cacbg declaration.
 *
 *   npx tsx scripts/declarations/rebuild_post.ts
 */

import path from "path";
import { fileURLToPath } from "url";
import { augmentCompaniesIndexWithMpRoles } from "./augment_mp_roles";
import { buildAssetsRankings } from "./build_assets_rankings";
import { buildCarMakes } from "./build_car_makes";
import { buildDataProvenance } from "./build_data_provenance";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "../..");
const DATA = path.join(REPO, "data");

const stringify = (o: object): string => JSON.stringify(o, null, 0);

// Sequenced rather than fired-and-forgotten: the augment reads Postgres and is async, so a
// bare call would let the three builders below run against a companies-index it has not
// finished rewriting, and would swallow its rejection at exit 0.
const main = async (): Promise<void> => {
  await augmentCompaniesIndexWithMpRoles({ publicFolder: DATA, stringify });
  buildAssetsRankings({ publicFolder: DATA, stringify });
  buildCarMakes({ publicFolder: DATA, stringify });
  buildDataProvenance({ publicFolder: DATA, stringify });
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
