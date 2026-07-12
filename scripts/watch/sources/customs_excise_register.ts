// Excise-warehouse register watcher — Агенция „Митници" publishes the licensed
// excise warehouse keepers (лицензирани складодържатели и данъчни складове) via
// the BACIS REST endpoint (an HTML table). It changes as licences are issued or
// terminated — a slow drip, so cadence is monthly.
//
// Fingerprint = sha256 over the sorted set of `EIK|status` rows (not the raw
// HTML, which carries volatile formatting/whitespace). A flip means an operator
// was added, terminated, or re-licensed — re-run the ingest
// (`npm run customs:excise-register`) to rewrite data/customs/excise_register.json.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

// Plain HTTP (no TLS) — a bare fetch is all the ingest uses too. If BACIS ever
// moves to HTTPS with an incomplete chain, add an undici tolerant dispatcher here.
const SRC = "http://extlb.bacis.customs.bg/BACIS/seam/resource/rest/licensing";
const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; +https://electionsbg.com)";

const rowSignatures = (html: string): string[] => {
  const strip = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const out: string[] = [];
  for (const r of html.split(/<tr[ >]/i).slice(1)) {
    const c = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      strip(m[1]),
    );
    if (c.length < 8 || !/^\d{9,13}$/.test(c[2])) continue;
    out.push(`${c[2]}|${c[7]}`); // EIK|status
  }
  return out.sort();
};

export const customsExciseRegister: WatchSource = {
  id: "customs_excise_register",
  label:
    'Агенция "Митници" — регистър на лицензираните акцизни складодържатели',
  url: SRC,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    let sigs: string[] = [];
    try {
      const res = await fetch(SRC, {
        headers: { "User-Agent": UA, Accept: "*/*" },
        redirect: "follow",
      });
      sigs = rowSignatures(await res.text());
    } catch (e) {
      return {
        value: `err:${(e as Error).message.slice(0, 40)}`,
        detail: "fetch failed",
      };
    }
    const active = sigs.filter((s) => /Валиден/i.test(s)).length;
    const value = createHash("sha256")
      .update(sigs.join("\n"))
      .digest("hex")
      .slice(0, 16);
    return {
      value,
      detail: `${sigs.length} licences (${active} active) · hash ${value}`,
      meta: { total: sigs.length, active },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as { total?: number; active?: number };
    const c = (curr.meta ?? {}) as { total?: number; active?: number };
    const dActive = (c.active ?? 0) - (p.active ?? 0);
    const dTotal = (c.total ?? 0) - (p.total ?? 0);
    const parts: string[] = [];
    if (dActive) parts.push(`${dActive > 0 ? "+" : ""}${dActive} active`);
    if (dTotal) parts.push(`${dTotal > 0 ? "+" : ""}${dTotal} total`);
    const delta = parts.length ? ` (${parts.join(", ")})` : "";
    return `Register changed${delta} — run \`npm run customs:excise-register\`.`;
  },
};
