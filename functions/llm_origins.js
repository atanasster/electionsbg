// Exact first-party hosts only. Legacy clients remain allowed during migration
// to the main project; verification still checks the widget hostname and action.
const AI_HOSTNAMES = Object.freeze([
  "naiasno.bg",
  "www.naiasno.bg",
  "ai.naiasno.bg",
  "news.naiasno.bg",
  "ai.electionsbg.com",
  "electionsbg-ai.web.app",
  "electionsbg-ai.firebaseapp.com",
  "electionsbg.com",
  "elections-bg.web.app",
  "elections-bg.firebaseapp.com",
  "electionsbg-staging.web.app",
  "electionsbg-staging.firebaseapp.com",
  "elections-bg--chat-launch-gu0gkopz.web.app",
]);
const AI_ALLOWED_ORIGINS = [
  ...AI_HOSTNAMES.map(
    (host) => new RegExp(`^https://${host.replace(/\./g, "\\.")}$`),
  ),
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];
module.exports = { AI_HOSTNAMES, AI_ALLOWED_ORIGINS };
