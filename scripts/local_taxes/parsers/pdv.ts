// Plovdiv (Община Пловдив) naredba parser.
//
// Plovdiv publishes its naredbi on the obshtini.bg Angular SPA platform:
//   - FEES naredba (НОАМТЦУ): plovdiv.obshtini.bg/doc/388893 — carries
//     ТБО (Раздел I) + service-fees tariff.
//   - TAX naredba (НОРМД): doc ID not yet identified; until we wire that,
//     property-tax / tourist-tax / dog-tax stay absent for Plovdiv.
//
// Both naredbi are reachable directly via the web-api.apis.bg JSON-API
// bridge (lib/fetch_obshtini_bg.ts) — no Playwright session required.
// Previous parser revision was deferred on the assumption that a session
// login was required; turns out the JSON API responds to plain GET.

import { fetchObshtiniBgDocText } from "../lib/fetch_obshtini_bg";
import { buildNaredbaBlock } from "../lib/extract_naredba";
import type { NaredbaParser } from "../types";

const FEES_NAREDBA_DOC_ID = 388893;
const FEES_NAREDBA_URL = `https://plovdiv.obshtini.bg/doc/${FEES_NAREDBA_DOC_ID}`;

export const pdvParser: NaredbaParser = {
  obshtina: "PDV22",
  label: "Община Пловдив — Наредба за местните такси (НОАМТЦУ)",
  url: FEES_NAREDBA_URL,
  documentType: "fees",

  async parse() {
    const { text, hash } = await fetchObshtiniBgDocText(
      "plovdiv",
      FEES_NAREDBA_DOC_ID,
      "pdv_fees",
    );
    const block = buildNaredbaBlock(text, {
      year: 2025,
      url: FEES_NAREDBA_URL,
    });
    return { obshtina: this.obshtina, block, sourceHash: hash };
  },
};
