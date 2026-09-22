// The news-person id charset, ONCE. An id reaches a URL path
// (`/person/:newsPersonId`), a data path (`/person/<id>.json`) and a
// correction link, so every side that mints or trusts one reads this —
// `build_app_data.NEWS_PERSON_ID_SAFE` is the Python twin, and
// `newsPersonId.test.ts` pins the two regexes to one probe set. The failure
// it prevents: the build writes a shard the client refuses to link (a page
// that exists and is unreachable), or the reverse — a dead link.
export const NEWS_PERSON_ID_SAFE = /^[a-z0-9_]{1,64}$/;

export const isNewsPersonId = (id: unknown): id is string =>
  typeof id === "string" && NEWS_PERSON_ID_SAFE.test(id);

/** The id's own character class, for composing into a wider pattern. */
export const NEWS_PERSON_ID_PATTERN = NEWS_PERSON_ID_SAFE.source.slice(1, -1);
