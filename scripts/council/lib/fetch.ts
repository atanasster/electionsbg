// HTTP helpers for council scraping. All sites we hit (município custom
// CMSes) reject the default Node fetch UA — we always send a real Safari
// UA. Keep a deliberate gap between requests to be polite to small-town
// municipal servers.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const POLITE_DELAY_MS = 250;

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const fetchHtml = async (
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
    await sleep(POLITE_DELAY_MS);
  }
};

export const fetchToFile = async (
  url: string,
  filePath: string,
  opts: { timeoutMs?: number } = {},
): Promise<void> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buf);
  } finally {
    clearTimeout(timer);
    await sleep(POLITE_DELAY_MS);
  }
};

/**
 * Resolve a (possibly relative) href against a base URL. Council CMSes
 * commonly emit href="bg/resheniya-2025-godina" instead of an absolute
 * path; new URL() handles that against the page's base.
 */
export const resolveUrl = (href: string, base: string): string =>
  new URL(href, base).toString();
