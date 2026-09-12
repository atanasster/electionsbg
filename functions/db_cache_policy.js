// Revision-bound analytics must reach the current snapshot on every request.
const LIVE_QUERY_ROUTES = new Set([
  "funding-query",
  "funding-capabilities",
  "funding-catalog",
  "funding-entities",
  "procurement-query",
  "procurement-capabilities",
]);
const dbCacheControl = (route, status) =>
  LIVE_QUERY_ROUTES.has(route)
    ? "no-store"
    : status === 200
      ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=600"
      : null;
module.exports = { LIVE_QUERY_ROUTES, dbCacheControl };
