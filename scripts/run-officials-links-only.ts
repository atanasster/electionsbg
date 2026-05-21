// Standalone runner: rebuilds only the officials → company cross-reference
// (data/officials/derived/company_links.json) from the existing
// data/officials/ ingest output + raw_data/tr/state.sqlite. Saves a full
// pipeline run when iterating on the cross-reference.
import { buildOfficialsCompanyLinks } from "./declarations/build_officials_company_links";

buildOfficialsCompanyLinks({
  stringify: (o) => JSON.stringify(o, null, 2),
});
