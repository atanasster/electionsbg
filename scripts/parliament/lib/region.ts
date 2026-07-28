// parliament.bg's МИР (multi-member constituency) field, parsed.
//
// Lives in its own module so it can be tested without importing scrape_mps.ts, whose
// top-level `run(cli, …)` would execute the CLI as an import side effect.

/** `"23-СОФИЯ"` / `"1-БЛАГОЕВГРАД"` → `{code, name}`. The code is zero-padded to two
 *  digits because that is how OBLAST_TO_MIR (src/data/parliament/nsFolders.ts) is keyed.
 *  An unparseable value yields an EMPTY code, which callers must treat as "no region". */
export const parseRegion = (vaName: string): { code: string; name: string } => {
  // Trimmed first: a stray leading space would otherwise fail the anchor and hand back
  // a code-less region.
  const m = vaName.trim().match(/^(\d{1,2})-(.+)$/);
  if (!m) return { code: "", name: vaName.trim() };
  return { code: m[1].padStart(2, "0"), name: m[2].trim() };
};

/**
 * The МИР an MP was SEATED from, off their own profile record (`A_ns_Va_name`).
 *
 * This is the field that takes `person_role.place_code` for `mp` from 11.3% to 100%:
 * the current-NS roster only knows the 240 sitting MPs, while parliament.bg carries a
 * seat on every profile it holds. Normalised to null rather than emitting a region with
 * no code — a half-filled region would flow downstream as an empty string and satisfy
 * the kind-iff-code CHECK while meaning nothing.
 *
 * CAVEAT: parliament.bg holds ONE value per person, so for a multi-term MP it cannot be
 * attributed to a particular parliament. It is a badge, not a history; the per-cycle,
 * sometimes multi-МИР record lives in person_election_stats.
 */
export const seatedRegionOf = (raw: {
  A_ns_Va_name?: string;
}): { code: string; name: string } | null => {
  const r = parseRegion(raw.A_ns_Va_name ?? "");
  return r.code && r.name ? r : null;
};
