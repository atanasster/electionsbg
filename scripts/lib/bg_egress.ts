// The Bulgarian-egress fallback: an HTTP proxy on a machine at home in
// Bulgaria (a Mac mini on an A1 residential line, tinyproxy on :8118, reached
// over the LAN or Tailscale). When the operator travels, the sources that
// answer only a Bulgarian exit (КЗК, АСП, ГИТ, data.egov.bg, …) fail from the
// laptop; the watcher and the pipeline retry them through this proxy instead.
//
// It is a FALLBACK, never the default path: a source is tried direct first and
// only a failure (or a need the doctor could meet only through the proxy)
// routes it here. Nothing in this module carries a credential — the proxy
// admits only LAN + tailnet clients (see CLAUDE.md, "Bulgarian egress via the
// Mac mini").
//
// What the proxy env reaches: Node's global fetch and node:https (via
// NODE_USE_ENV_PROXY=1, Node ≥ 22.21), curl and most CLIs (HTTPS_PROXY).
// What it does NOT reach: Playwright/Chromium, which ignores proxy env vars.

import net from "node:net";

/** Tried in order; the tailnet name first (works from anywhere), then the LAN
 *  mDNS name (works at home even with Tailscale down). */
export const BG_PROXY_DEFAULTS: readonly string[] = [
  "http://mac:8118",
  "http://Brooks-Mac-mini.local:8118",
];

/** Override: a comma-separated list of proxy URLs, or `off` to disable. */
export const BG_PROXY_ENV = "BG_EGRESS_PROXY";
/** Set in a proxied child's env, so a fallback never stacks on a fallback. */
export const BG_VIA_ENV = "BG_EGRESS_VIA";

/** Hosts that must never go through the home proxy: local databases, Google
 *  Cloud (bucket, Cloud SQL admin), GitHub, model APIs. */
export const BG_NO_PROXY = [
  "localhost",
  "127.0.0.1",
  "::1",
  ".googleapis.com",
  ".google.com",
  ".gstatic.com",
  "github.com",
  ".github.com",
  ".githubusercontent.com",
  ".anthropic.com",
  ".openrouter.ai",
].join(",");

export const bgProxyCandidates = (
  env: NodeJS.ProcessEnv = process.env,
): string[] => {
  const raw = env[BG_PROXY_ENV]?.trim();
  if (!raw) return [...BG_PROXY_DEFAULTS];
  if (/^(off|0|false|no|none)$/i.test(raw)) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^https?:\/\//.test(s) ? s : `http://${s}`));
};

/** host:port of a proxy URL, for log lines. */
export const proxyLabel = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return url;
  }
};

/** Does anything accept a TCP connection at the proxy's host:port? */
export const tcpOpen = (url: string, timeoutMs = 2500): Promise<boolean> =>
  new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const sock = net.connect({
      host: u.hostname,
      port: Number(u.port || 80),
    });
    const done = (ok: boolean): void => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });

let cached: Promise<string | null> | undefined;

/** The first reachable BG proxy, or null. Probed once per process. */
export const findBgProxy = (
  env: NodeJS.ProcessEnv = process.env,
  probe: (url: string) => Promise<boolean> = tcpOpen,
): Promise<string | null> => {
  if (viaBgProxy(env)) return Promise.resolve(null);
  cached ??= (async () => {
    for (const c of bgProxyCandidates(env)) if (await probe(c)) return c;
    return null;
  })();
  return cached;
};

/** Set to 1 to use the fallback even when this machine already exits via
 *  Bulgaria (testing the path from home). */
export const BG_FORCE_ENV = "BG_EGRESS_FORCE";

/** Is the fallback worth trying from an exit in `country`? Not from a
 *  Bulgarian exit: at home the mini sits on the same line, so a retry there
 *  only repeats the failure (and a hung source costs its timeout twice).
 *  An unknown country (lookup failed) does qualify. */
export const bgFallbackApplies = (
  country: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean => country !== "BG" || env[BG_FORCE_ENV] === "1";

let exitCached: Promise<string | null> | undefined;

/** ISO country of this machine's exit IP (Cloudflare's trace endpoint — no
 *  account, nothing identifying sent), or null when the lookup fails. */
export const exitCountry = (): Promise<string | null> => {
  exitCached ??= (async () => {
    try {
      const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return (await res.text()).match(/^loc=([A-Z]{2})$/m)?.[1] ?? null;
    } catch {
      return null;
    }
  })();
  return exitCached;
};

/** The proxy to fall back to from THIS machine, or null when there is none or
 *  falling back would not help (already Bulgarian, already proxied). */
export const findBgFallback = async (
  env: NodeJS.ProcessEnv = process.env,
  deps: {
    country?: () => Promise<string | null>;
    probe?: (url: string) => Promise<boolean>;
  } = {},
): Promise<string | null> => {
  if (viaBgProxy(env) || bgProxyCandidates(env).length === 0) return null;
  if (!bgFallbackApplies(await (deps.country ?? exitCountry)(), env))
    return null;
  return findBgProxy(env, deps.probe);
};

/** Tests only. */
export const resetBgProxyCache = (): void => {
  cached = undefined;
  exitCached = undefined;
};

/** The env that routes a child process through the BG proxy. */
export const bgProxyEnv = (url: string): NodeJS.ProcessEnv => ({
  HTTPS_PROXY: url,
  HTTP_PROXY: url,
  https_proxy: url,
  http_proxy: url,
  NODE_USE_ENV_PROXY: "1",
  NO_PROXY: BG_NO_PROXY,
  no_proxy: BG_NO_PROXY,
  [BG_VIA_ENV]: url,
});

export const viaBgProxy = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env[BG_VIA_ENV]);

/** An HTTP status that reads as "this client/IP is refused": 403 Forbidden or
 *  451 Unavailable For Legal Reasons, in a fetcher's error context — never a
 *  bare number ("loaded 403 rows"). */
const REFUSED_STATUS =
  /\b(?:HTTP\/?[\d.]*\s+|status(?:\s+code)?:?\s*|returned\s+|responded with\s+)(?:403|451)\b|\b403 Forbidden\b|\b451 Unavailable\b|geo-?block/i;

/** Failure classes a different exit IP can plausibly fix. A WAF refusal is in
 *  the set on purpose: the same client from a Bulgarian residential IP is
 *  often admitted where a foreign one is not. */
const RETRY_CLASSES = new Set(["egress", "waf-blocked", "upstream-down"]);

export const bgRetryWorthy = (
  failureClass: string | undefined,
  tail: string,
): boolean =>
  (failureClass !== undefined && RETRY_CLASSES.has(failureClass)) ||
  REFUSED_STATUS.test(tail);
