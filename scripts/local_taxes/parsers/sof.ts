// Sofia (Столична община) naredba parser.
//
// Sofia maintains two naredbi:
//   1. **TAX naredba** — sofia.obshtini.bg/doc/385434 — published on an
//      Angular SPA that resists curl-style scraping. Tourist + dog tax
//      live here. Deferred until we add a Playwright fallback.
//   2. **FEES naredba** — published as a direct PDF in the iisda registry
//      at /adm_services/service_regulatory_file/24499_137312 (640 KB,
//      stable). Carries the ТБО chapter (Раздел I) — this is what we
//      ingest here.
//
// What ships:
//   - ТБО basis flag (promil — confirmed in Чл. 18 + Чл. 22 wording).
//   - Note that the per-year rate is set by an annual SOS resolution,
//     not in the naredba itself. The `rate` field stays unset until we
//     wire a separate council-decision feed.
//
// What's TODO:
//   - Tourist + dog tax — wait on the obshtini.bg fetch path.
//   - Per-year residential ТБО rate — Сос Решение № 1036 of 18.12.2025
//     sets the 2026 rates; pulling from council.sofia.bg is a follow-up.

import { fetchNaredbaPdf } from "../lib/fetch_pdf";
import { buildNaredbaBlock } from "../lib/extract_naredba";
import type { NaredbaParser } from "../types";

const FEES_NAREDBA_URL =
  "https://iisda.government.bg/adm_services/service_regulatory_file/24499_137312";

export const sofParser: NaredbaParser = {
  obshtina: "SOF00",
  label: "Столична община — Наредба за местните такси (НОАМТЦУПСО)",
  url: FEES_NAREDBA_URL,
  documentType: "fees",

  async parse() {
    const { text, hash } = await fetchNaredbaPdf(FEES_NAREDBA_URL, "sof_fees");
    const block = buildNaredbaBlock(text, {
      year: 2026,
      url: FEES_NAREDBA_URL,
    });
    return { obshtina: this.obshtina, block, sourceHash: hash };
  },
};
