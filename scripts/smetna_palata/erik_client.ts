// Tiny cookie-aware HTTP client for erik.bulnao.government.bg.
//
// ЕРИК's DataTables JSON endpoints return an empty body unless the request
// carries the session cookie handed out by a prior GET, and the filing-PDF
// download additionally needs an anti-forgery token+cookie pair minted on the
// AfterElectionSub page. This client keeps a single cookie jar across calls so
// both the scraper and the watcher can talk to the site with plain global fetch
// (no Playwright, no auth).

import { ERIK_BASE, UA } from "./erik_config";

type Jar = Map<string, string>;

const parseSetCookie = (jar: Jar, res: Response): void => {
  // Node's fetch exposes multiple Set-Cookie headers via getSetCookie().
  const raw =
    (
      res.headers as unknown as { getSetCookie?: () => string[] }
    ).getSetCookie?.() ??
    (res.headers.get("set-cookie")
      ? [res.headers.get("set-cookie") as string]
      : []);
  for (const line of raw) {
    const first = line.split(";", 1)[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
};

const cookieHeader = (jar: Jar): string =>
  Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

// Only attach a Cookie header when the jar is non-empty. An EMPTY `Cookie:`
// header makes ЕРИК's WAF return 403 (curl tolerates it, Node's fetch doesn't).
const withCookie = (
  jar: Jar,
  headers: Record<string, string>,
): Record<string, string> => {
  const c = cookieHeader(jar);
  return c ? { ...headers, Cookie: c } : headers;
};

export type ErikClient = {
  /** GET a page, updating the cookie jar. Returns the response text. */
  get(path: string): Promise<string>;
  /** POST form-urlencoded, returns parsed JSON (DataTables shape). */
  postJson<T>(
    path: string,
    form: Record<string, string | number | boolean>,
  ): Promise<T>;
  /** POST form-urlencoded, returns the raw response (for binary downloads). */
  postRaw(
    path: string,
    form: Record<string, string | number | boolean>,
  ): Promise<Response>;
};

const toBody = (form: Record<string, string | number | boolean>): string =>
  Object.entries(form)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join("&");

export const createErikClient = (): ErikClient => {
  const jar: Jar = new Map();
  const abs = (p: string) => (p.startsWith("http") ? p : `${ERIK_BASE}${p}`);
  // ЕРИК hands out the session cookie on a GET and rejects (403) cold POSTs.
  // Track the last page visited so POSTs carry a browser-like Referer.
  let referer = `${ERIK_BASE}/`;

  const get = async (path: string): Promise<string> => {
    const res = await fetch(abs(path), {
      headers: withCookie(jar, {
        "User-Agent": UA,
        "Accept-Language": "bg-BG,bg",
      }),
    });
    parseSetCookie(jar, res);
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    referer = abs(path);
    return res.text();
  };

  const postRaw = async (
    path: string,
    form: Record<string, string | number | boolean>,
  ): Promise<Response> => {
    const res = await fetch(abs(path), {
      method: "POST",
      headers: withCookie(jar, {
        "User-Agent": UA,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept-Language": "bg-BG,bg",
        Referer: referer,
      }),
      body: toBody(form),
    });
    parseSetCookie(jar, res);
    return res;
  };

  const postJson = async <T>(
    path: string,
    form: Record<string, string | number | boolean>,
  ): Promise<T> => {
    const res = await postRaw(path, form);
    if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`POST ${path} → non-JSON (${text.slice(0, 80)})`);
    }
  };

  return { get, postJson, postRaw };
};
