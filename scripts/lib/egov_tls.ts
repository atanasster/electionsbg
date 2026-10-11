// TEMPORARY: data.egov.bg TLS bypass, scoped to that one host.
//
// Since ~2026-10-09 data.egov.bg intermittently serves an EXPIRED certificate
// (node fails with CERT_HAS_EXPIRED on some connections while others to the
// same host succeed — most likely one backend behind the load balancer was
// never renewed). That halted the АОП OCDS ingest, legacy discovery and the
// other egov fetchers two nights running.
//
// Importing this module (for its side effect) wraps globalThis.fetch so that
// requests to data.egov.bg — and ONLY that host — go through an undici Agent
// with certificate verification off. Every other origin keeps Node's default
// dispatcher and full verification; this is the same per-request shape
// scripts/officials/shared.ts uses for register.cacbg.bg, not a process-wide
// NODE_TLS_REJECT_UNAUTHORIZED=0.
//
// The data is public open data and every consumer validates what it parses,
// so the exposure is integrity-on-the-wire for one host, for a bounded time.
//
// REMOVE THIS once data.egov.bg serves a valid chain on every connection:
// delete this file and its imports (grep "lib/egov_tls"). Set
// EGOV_TLS_STRICT=1 to disable the bypass without a code change and check.
import { Agent } from "undici";

const EGOV_HOSTS = new Set(["data.egov.bg"]);
const INSTALLED = Symbol.for("electionsbg.egovTlsBypass");

const hostOf = (input: unknown): string | null => {
  try {
    if (typeof input === "string") return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === "object" && "url" in input) {
      return new URL(String((input as { url: string }).url)).hostname;
    }
  } catch {
    // Relative or malformed — not ours to touch.
  }
  return null;
};

const install = (): void => {
  const g = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (g[INSTALLED] || process.env.EGOV_TLS_STRICT === "1") return;
  g[INSTALLED] = true;

  const insecure = new Agent({ connect: { rejectUnauthorized: false } });
  const original = globalThis.fetch;
  let warned = false;

  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const host = hostOf(input);
    if (!host || !EGOV_HOSTS.has(host)) return original(input, init);
    if (!warned) {
      warned = true;
      console.warn(
        "⚠ egov_tls: certificate verification is OFF for data.egov.bg (temporary bypass — see scripts/lib/egov_tls.ts)",
      );
    }
    // @ts-expect-error: dispatcher is undici-only, not in fetch's typings
    return original(input, { ...init, dispatcher: insecure });
  }) as typeof fetch;
};

install();
