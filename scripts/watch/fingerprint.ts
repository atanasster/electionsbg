import { createHash } from "crypto";
import { Agent, fetch as undiciFetch } from "undici";

export const sha256 = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

export const sha256Short = (input: string | Uint8Array): string =>
  sha256(input).slice(0, 16);

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; electionsbg-watch/1.0; +https://electionsbg.com)",
  Accept: "application/json, text/html;q=0.9, */*;q=0.5",
  "Accept-Language": "bg,en;q=0.7",
};

// Permissive TLS dispatcher for upstreams that serve incomplete certificate
// chains. Node's bundled CA list rejects them; curl/browsers accept them
// because they ship more intermediates. register.cacbg.bg is the case we
// care about — its leaf cert is fine, the chain is incomplete. Only used
// for public read-only fingerprinting requests.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export interface FetchOpts {
  headers?: Record<string, string>;
  // Treat HTTP 404 as a recoverable "not found" rather than throwing — useful
  // when probing for the existence of a record.
  allow404?: boolean;
  // Retry transient failures (network + 5xx) with exponential backoff.
  retries?: number;
  // Disable TLS cert chain verification for this request only. Use only when
  // the upstream is known to serve an incomplete chain. Read-only data!
  insecureTls?: boolean;
}

export const fetchText = async (
  url: string,
  opts: FetchOpts = {},
): Promise<string | null> => {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) };
      const res = opts.insecureTls
        ? await undiciFetch(url, { headers, dispatcher: insecureAgent })
        : await fetch(url, { headers });
      if (res.status === 404 && opts.allow404) return null;
      if (res.status >= 500 && attempt < retries)
        throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
};

export const fetchJson = async <T>(
  url: string,
  opts: FetchOpts = {},
): Promise<T | null> => {
  const headers = {
    "X-Requested-With": "XMLHttpRequest",
    ...(opts.headers ?? {}),
  };
  const text = await fetchText(url, { ...opts, headers });
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // parliament.bg returns the SPA shell (HTML) for unknown /api/v1 paths.
    // Treat as "not found" rather than throwing — the watcher will skip.
    if (opts.allow404) return null;
    throw new Error(`non-JSON response from ${url}: ${text.slice(0, 80)}`);
  }
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// Format a date for human-readable display in the watcher report. UTC schedule
// but Sofia display, per the PRD's open question #4.
export const formatSofia = (iso: string): string => {
  try {
    const fmt = new Intl.DateTimeFormat("bg-BG", {
      timeZone: "Europe/Sofia",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return fmt.format(new Date(iso));
  } catch {
    return iso;
  }
};
