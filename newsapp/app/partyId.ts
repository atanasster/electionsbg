// The party-id charset, ONCE. An id reaches a URL path (`/party/:id`) and a
// data path (`/party/<id>.json`), so every side that mints or trusts one
// reads this — `build_app_data.PARTY_ID_SAFE` is the Python twin, and
// `partyId.test.ts` pins the two regexes to one probe set.
export const PARTY_ID_SAFE = /^[A-Za-z0-9_-]{1,80}$/;

export const isPartyId = (id: unknown): id is string =>
  typeof id === "string" && PARTY_ID_SAFE.test(id);
