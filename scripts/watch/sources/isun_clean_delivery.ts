// Watch the two ИСУН clean-delivery listings. Maps to `update-funds`.
//
// The fingerprint is each listing's OWN PAGER — „Страница (1/398)" and
// „(1/1359)" — not the rendered rows and not the export. That choice is what
// makes this watcher work at all against this host:
//
//   • The export is behind an F5 WAF that refuses automated downloads
//     intermittently (isun_download.ts documents the same wall), so a watcher
//     that downloaded the XLSX would report noise, not news.
//   • The pager is a single number on the listing HTML, it moves by exactly one
//     page per ~25 newly-closed projects, and it is the same number the ingest
//     uses to prove an export is complete rather than capped.
//
// ⚠️ A WAF challenge is NOT „zero pages". Both refusal shapes this host serves —
// the „Please enable JavaScript" ASM challenge and the 245-byte „Request
// Rejected" — are HTTP 200, so `res.ok` is blind to them. They are detected and
// thrown, so the watcher's own source-down path reports a probe failure instead
// of a collapse to nothing, which on THIS dataset would read as „every project
// lost its clean-delivery status".

import { createHash } from "crypto";
import type { Fingerprint, WatchSource } from "../types";
import { fetchText } from "../fingerprint";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PAGES = [
  {
    key: "contracts",
    label: "Проекти без наложени финансови корекции",
    url: "https://2020.eufunds.bg/bg/0/0/ExecutedContracts?ShowRes=True",
  },
  {
    key: "beneficiaries",
    label: "Бенефициенти без ФК",
    url: "https://2020.eufunds.bg/bg/0/0/BeneficiaryWithoutFinancialCorrections?ShowRes=True",
  },
] as const;

/** The listing renders „Страница (1/398)", HTML-escaped. Decode the numeric
 *  entities first — the Cyrillic arrives as `&#x421;…` and a plain regex over the
 *  raw body silently matches nothing, which would look like a layout change. */
const pageCount = (html: string): number | null => {
  const decoded = html.replace(/&#x([0-9A-Fa-f]+);/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  const m = /Страница\s*\((\d+)\/(\d+)\)/u.exec(decoded);
  return m ? Number(m[2]) : null;
};

const isRefusal = (html: string): boolean =>
  html.includes("Please enable JavaScript") ||
  html.includes("Request Rejected");

export const isunCleanDelivery: WatchSource = {
  id: "isun_clean_delivery",
  label: "ИСУН 2020 — приключени без финансова корекция (2020.eufunds.bg)",
  url: PAGES[0].url,
  cadence: "weekly",
  // Projects close continuously, but a page only turns over every ~25 of them.
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    const parts: string[] = [];
    for (const p of PAGES) {
      const html = await fetchText(p.url, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
        },
        retries: 3,
      });
      if (html === null || isRefusal(html))
        throw new Error(
          `ИСУН ${p.key} listing refused by the WAF — a probe failure, not an ` +
            `empty register. It clears on its own; retry later.`,
        );
      const n = pageCount(html);
      if (n === null || n < 1)
        throw new Error(
          `ИСУН ${p.key} listing has no „Страница (x/y)" pager — the layout ` +
            `changed, and the ingest's completeness check reads the same number.`,
        );
      parts.push(`${p.key}=${n}`);
    }
    return {
      value: createHash("sha256").update(parts.join("|")).digest("hex"),
      detail: `${parts.join(" · ")} page(s) of 25`,
      meta: Object.fromEntries(parts.map((s) => s.split("="))),
    };
  },
};
