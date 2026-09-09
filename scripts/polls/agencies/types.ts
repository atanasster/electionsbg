// The lister contract every agency module implements — the shape shared by
// the watcher (fingerprints off it) and the ingest (fetches off it). See
// docs/plans/polls-agency-watchers-v1.md §6.1: "Two copies of what counts as
// an electoral publication is how the watcher would flip on a post the
// ingest then ignores."

export interface Publication {
  /**
   * Ascending on every site this repo watches (a WordPress post id, or the
   * trailing number in a slug) — the fingerprint rides it directly, so a
   * lister must never invent one.
   */
  id: number;
  url: string;
  title: string;
  /**
   * ISO date, or null where the LISTING carries no date (Alpha Research's
   * blog index does not — the ingest fills it in from the post body). Never
   * guessed here.
   */
  publishedAt: string | null;
  kind: "html" | "pdf" | "images";
  /** PDF or image URLs found on the listing itself; the ingest may add more
   *  from the post body. */
  attachments: string[];
}

export interface ListOpts {
  /** Cap on how many of the newest publications to return. */
  limit?: number;
  /** ISO date bounds for an archive walk (both optional, both inclusive). */
  after?: string;
  before?: string;
}

export interface AgencyLister {
  /** The registry id this lister serves — must match `AgencyRegistryEntry.id`. */
  agencyId: string;
  /** Newest-first. The watcher calls this with no args (its default window);
   *  the ingest may narrow it. Never opens an individual post or PDF — see
   *  the plan's "one request per source" rule. */
  listPublications(opts?: ListOpts): Promise<Publication[]>;
  /** Title/category rule for "is this an electoral publication" — decides
   *  what counts toward the watcher's fingerprint and what `polls:fetch`
   *  downloads. */
  isElectoral(p: Publication): boolean;
}
