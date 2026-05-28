// Council ingest — Phase 0 discovery / liveness probe.
//
// Reads data/council/sources.json and runs a HEAD (or shallow GET) against
// each município's indexUrl + samplePdf to confirm the recipe is still
// pointing at a live page. Reports per-município OK / 4xx / 5xx and the
// detected content-type & size, so a recipe that silently rotted (CMS
// migration, URL slug change) is caught BEFORE the scraper runs against
// it and writes nothing.
//
// Usage:
//   npx tsx scripts/council/discover.ts            # check all
//   npx tsx scripts/council/discover.ts --only SOF # check one
//   npx tsx scripts/council/discover.ts --verbose  # include byte counts
//
// This does NOT scrape resolutions — that's scrape.ts (Phase 1). Treat
// discover.ts as the "is the recipe still valid" canary, runnable from
// CI / the watcher if we ever want to fail loud on a 404.

import { readFile } from "node:fs/promises";
import { command, flag, optional, option, run, string } from "cmd-ts";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

type MuniRecipe = {
  name: string;
  tier: "A" | "B" | "C";
  indexUrl: string;
  indexNote?: string;
  fetch: "static" | "playwright";
  format: "pdf-text" | "docx" | "doc" | "html" | "mixed" | "pdf-scan";
  tallyStrategy: string;
  samplePdf?: string;
  perCouncillor?: boolean;
  phase1Defer?: boolean;
  deferReason?: string;
};

type SourcesFile = {
  schemaVersion: number;
  note?: string;
  tallyRegexes: unknown;
  munisByObshtina: Record<string, MuniRecipe>;
  phase3OcrCandidates?: string[];
  phase3Sliven?: MuniRecipe & { obshtinaCode: string };
};

type ProbeResult = {
  url: string;
  status: number;
  size: number;
  contentType: string;
  ms: number;
  err?: string;
};

const probe = async (url: string, timeoutMs = 25000): Promise<ProbeResult> => {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const buf = await res.arrayBuffer();
    return {
      url,
      status: res.status,
      size: buf.byteLength,
      contentType: res.headers.get("content-type") ?? "",
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      url,
      status: 0,
      size: 0,
      contentType: "",
      ms: Date.now() - t0,
      err: e instanceof Error ? e.message : String(e),
    };
  }
};

const verdict = (status: number, size: number): string => {
  if (status === 0) return "ERR ";
  if (status >= 200 && status < 300 && size > 256) return "OK  ";
  if (status >= 200 && status < 300) return "thin";
  if (status >= 300 && status < 400) return "redr";
  if (status === 403 || status === 401) return "block";
  if (status === 404) return "404 ";
  return `${status}`;
};

const cli = command({
  name: "council-discover",
  description: "Probe data/council/sources.json recipes for liveness",
  args: {
    only: option({
      type: optional(string),
      long: "only",
      description: "Probe a single obshtina key only (e.g. SOF)",
    }),
    verbose: flag({
      long: "verbose",
      short: "v",
      description: "Show full URL + bytes + ms + content-type",
    }),
  },
  handler: async (args) => {
    const sourcesPath = join(process.cwd(), "data/council/sources.json");
    const raw = await readFile(sourcesPath, "utf8");
    const file: SourcesFile = JSON.parse(raw);

    const munis = { ...file.munisByObshtina };
    if (file.phase3Sliven)
      munis[file.phase3Sliven.obshtinaCode] = file.phase3Sliven;

    const keys = args.only
      ? Object.keys(munis).filter((k) => k === args.only)
      : Object.keys(munis);

    if (keys.length === 0) {
      console.error(
        `no município matches --only ${args.only}; valid: ${Object.keys(munis).join(", ")}`,
      );
      process.exit(2);
    }

    console.log(
      `→ probing ${keys.length} município(s) from data/council/sources.json\n`,
    );

    let okCount = 0;
    let blockCount = 0;
    let failCount = 0;

    for (const key of keys) {
      const recipe = munis[key];
      const indexProbe = await probe(recipe.indexUrl);
      const indexVerdict = verdict(indexProbe.status, indexProbe.size);
      const samplePdfProbe = recipe.samplePdf
        ? await probe(recipe.samplePdf)
        : null;

      const deferMark = recipe.phase1Defer ? " [DEFER]" : "";
      const tierMark = `[${recipe.tier}]`;
      const summary = `${indexVerdict}  ${key.padEnd(6)} ${tierMark} ${recipe.name}${deferMark}`;

      console.log(summary);
      if (args.verbose || indexVerdict.trim() !== "OK") {
        console.log(
          `       index: ${indexProbe.status} ${indexProbe.size}B ${indexProbe.ms}ms ${indexProbe.contentType.split(";")[0]} — ${recipe.indexUrl}`,
        );
        if (indexProbe.err) console.log(`       err: ${indexProbe.err}`);
      }
      if (samplePdfProbe) {
        const sv = verdict(samplePdfProbe.status, samplePdfProbe.size);
        if (args.verbose || sv.trim() !== "OK") {
          console.log(
            `       sample: ${sv} ${samplePdfProbe.status} ${samplePdfProbe.size}B — ${recipe.samplePdf}`,
          );
        }
      }

      if (indexVerdict.trim() === "OK") okCount++;
      else if (indexVerdict.trim() === "block") blockCount++;
      else failCount++;
    }

    console.log(
      `\n→ ${okCount} OK · ${blockCount} blocked · ${failCount} fail/redirect · ${keys.length} total`,
    );
    if (failCount > 0) {
      console.log(
        `   (recipes that fail need re-discovery before scrape.ts runs them; see phase1Defer flags)`,
      );
    }
  },
});

run(cli, process.argv.slice(2));
