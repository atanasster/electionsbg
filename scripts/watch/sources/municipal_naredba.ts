// Per-município Наредба watcher (Tier B for local taxes).
//
// Each município publishes its own Наредба(и). The catalogue of parsers
// lives in scripts/local_taxes/parsers/ and exposes a list of
// (obshtina, url, documentType) tuples. We fingerprint each URL by HEAD
// (content-length + last-modified) so we don't pay for full PDF
// downloads here — the downstream `update-local-taxes` skill does that
// on a flip.
//
// The describe-line names exactly which municípios' source URLs flipped
// since last run, so the operator can run a targeted re-parse:
//   npx tsx scripts/local_taxes/run_naredba.ts SOF00,PDV01
//
// Cadence: weekly. Naredbi typically change in late December (annual
// rate roll) with stragglers through Q1 — weekly catches both windows.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256 } from "../fingerprint";
import { NAREDBA_PARSERS } from "../../local_taxes/parsers";

type PerSourceFp = {
  url: string;
  status?: number;
  length?: string;
  lastModified?: string;
};

const headProbe = async (url: string): Promise<PerSourceFp> => {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; electionsbg-watch/1.0; +https://electionsbg.com)",
        Accept: "application/pdf, */*;q=0.5",
      },
    });
    return {
      url,
      status: res.status,
      length: res.headers.get("content-length") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
    };
  } catch {
    return { url, status: 0 };
  }
};

export const municipalNaredba: WatchSource = {
  id: "municipal_naredba",
  label: "Общински наредби за местни данъци",
  url: "https://www.265obshtini.bg/", // catalogue lives in code; surface ИПИ landing as a useful pointer
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const perObshtina: Record<string, PerSourceFp> = {};
    for (const parser of NAREDBA_PARSERS) {
      perObshtina[parser.obshtina] = await headProbe(parser.url);
    }
    const ordered = Object.keys(perObshtina)
      .sort()
      .map((k) => {
        const v = perObshtina[k];
        return `${k}:${v.status ?? 0}:${v.length ?? ""}:${v.lastModified ?? ""}`;
      })
      .join("|");
    const value = sha256(ordered);
    return {
      value,
      detail: `${NAREDBA_PARSERS.length} município(s) wired`,
      meta: { perObshtina },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevMap =
      (prev.meta?.perObshtina as Record<string, PerSourceFp> | undefined) ?? {};
    const currMap =
      (curr.meta?.perObshtina as Record<string, PerSourceFp> | undefined) ?? {};
    const flipped: string[] = [];
    for (const code of Object.keys(currMap).sort()) {
      const a = prevMap[code];
      const b = currMap[code];
      if (
        !a ||
        a.length !== b.length ||
        a.lastModified !== b.lastModified ||
        a.status !== b.status
      ) {
        flipped.push(code);
      }
    }
    if (flipped.length === 0) return curr.detail;
    return `${flipped.length} naredba(s) re-uploaded: ${flipped.join(", ")}`;
  },
};
