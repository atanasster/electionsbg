// Standalone runner: rebuilds only the connections graph using the existing
// data/parliament inputs. Saves a full pipeline run when iterating on the
// graph builder. `publicFolder` is the pipeline's historical name for the
// data root (see scripts/main.ts) — it resolves to ./data.
import { buildConnectionsGraph } from "./declarations/build_connections_graph";

buildConnectionsGraph({
  publicFolder: "./data",
  rawFolder: "./raw_data",
  stringify: (o) => JSON.stringify(o),
});
