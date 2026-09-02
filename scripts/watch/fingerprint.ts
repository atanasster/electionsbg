import { createHash } from "crypto";
import { spawnSync } from "child_process";
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
  // Timeout/abort errors are never retried.
  retries?: number;
  // Disable TLS cert chain verification for this request only. Use only when
  // the upstream is known to serve an incomplete chain. Read-only data!
  insecureTls?: boolean;
  // Fetch through the `curl` binary instead of Node.
  //
  // Sibling of `insecureTls`, for the same class of problem one layer up: some
  // upstreams reject the CLIENT rather than the request. 2020.eufunds.bg sits
  // behind an F5 ASM that fingerprints the TLS/HTTP handshake — measured
  // 2026-09-02, node returns a 245-byte „Request Rejected" or an ASM JS
  // challenge under EVERY header combination tried (the source's own headers,
  // Accept: */*, a full Chrome set, even curl's own UA), while curl with those
  // same headers gets the clean 85KB page. Headers cannot fix a JA3 match.
  //
  // GET only, read-only data, no shell (execFile with an argv array).
  viaCurl?: boolean;
  // AbortSignal for cancellation / timeout. Defaults to a 30-second timeout
  // so a hung upstream can't block the watcher indefinitely.
  signal?: AbortSignal;
  // POST body, for the handful of registers that only answer a form submission
  // (ЦПРС's listFirms.php is the first). Sending one implies method POST; set
  // the Content-Type in `headers`. Still read-only in intent — these are search
  // forms, not mutations — so the retry policy below applies unchanged.
  body?: string;
  method?: "GET" | "POST";
  // Character encoding of the response body, for the pre-UTF-8 registers (АОП's
  // ets.php is windows-1251; the ЦПРС family is the same vintage).
  //
  // ⚠️ `Response.text()` decodes as UTF-8 ALWAYS, per the fetch spec — it does
  // NOT honour the charset in Content-Type. So a cp1251 register decoded through
  // the default path does not throw: it yields a body of replacement characters
  // that parses fine, counts fine, and stores a corpus of mojibake names. Naming
  // the encoding here is the only thing that prevents it.
  encoding?: string;
}

/** `curl -sSL` with the caller's headers. Throws on a non-zero exit so the
 *  caller's retry/`describe` path sees a failure rather than an empty body. */
const curlText = (url: string, headers: Record<string, string>): string => {
  const args = ["-sSL", "--compressed", "--max-time", "45"];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  args.push(url);
  const res = spawnSync("curl", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(`curl exited ${res.status}: ${(res.stderr || "").trim()}`);
  return res.stdout;
};

export const fetchText = async (
  url: string,
  opts: FetchOpts = {},
): Promise<string | null> => {
  const retries = opts.retries ?? 3;
  const signal = opts.signal ?? AbortSignal.timeout(30_000);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) };
      const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
      const init = { headers, signal, method, body: opts.body };
      if (opts.viaCurl) return curlText(url, headers);
      const res = opts.insecureTls
        ? await undiciFetch(url, { ...init, dispatcher: insecureAgent })
        : await fetch(url, init);
      if (res.status === 404 && opts.allow404) return null;
      if (res.status >= 500 && attempt < retries)
        throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return opts.encoding
        ? new TextDecoder(opts.encoding).decode(await res.arrayBuffer())
        : await res.text();
    } catch (e) {
      // Don't retry on abort/timeout — the server is unresponsive, not transiently failing.
      if (e instanceof Error && e.name === "AbortError") throw e;
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
