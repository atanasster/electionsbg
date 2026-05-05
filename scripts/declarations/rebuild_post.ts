/**
 * One-shot: re-run the post-fetch build steps without touching the network.
 *   - buildConnectionsGraph (regenerates connections.json + rankings + per-MP)
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
import { buildConnectionsGraph } from "./build_connections_graph";
import { buildAssetsRankings } from "./build_assets_rankings";
import { buildCarMakes } from "./build_car_makes";
import { buildDataProvenance } from "./build_data_provenance";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "../..");
const PUBLIC = path.join(REPO, "public");
const RAW = path.join(REPO, "raw_data");

const stringify = (o: object): string => JSON.stringify(o, null, 0);

buildConnectionsGraph({ publicFolder: PUBLIC, rawFolder: RAW, stringify });
buildAssetsRankings({ publicFolder: PUBLIC, stringify });
buildCarMakes({ publicFolder: PUBLIC, stringify });
buildDataProvenance({ publicFolder: PUBLIC, stringify });
