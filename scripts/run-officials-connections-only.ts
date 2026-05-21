// Standalone runner: rebuilds only the officials ↔ MP / peer bridge
// (data/officials/derived/connections.json) from the existing
// company_links.json + data/parliament/companies-index.json. Run the
// officials cross-reference (run-officials-links-only.ts) first.
import { buildOfficialsConnections } from "./declarations/build_officials_connections";

buildOfficialsConnections({
  stringify: (o) => JSON.stringify(o, null, 2),
});
