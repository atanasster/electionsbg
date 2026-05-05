// Standalone runner: rebuilds only the connections graph using the existing
// public/parliament inputs. Saves a full pipeline run when iterating on the
// graph builder.
import { buildConnectionsGraph } from "./declarations/build_connections_graph";

buildConnectionsGraph({
  publicFolder: "./public",
  rawFolder: "./raw_data",
  stringify: (o) => JSON.stringify(o),
});
