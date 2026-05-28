// Varna (Община Варна) naredba parser.
//
// Varna publishes both naredbi as direct PDFs:
//   - FEES naredba: varna.bg/upload/20701/NAREDBA_na_ObS_Varna_za_opredelqneto_i_administriraneto_na_mestnite_taksi…
//     (carries ТБО — Раздел I)
//   - TAX naredba: varnacouncil.bg/wp-content/uploads/2017/01/опредeляне-размера-на-местните-данъци-…2014.pdf
//     (older version on file; tourist + dog tax live here when adopted)
//
// At launch we ingest only the FEES naredba — the available TAX-naredba
// PDF on varnacouncil.bg is from 2014 (pre-2016 ЗМДТ amendments), so
// surfacing tourist/dog rates from it would be misleading. Tier A's ИПИ
// data already covers the other tax types reliably.

import { fetchNaredbaPdf } from "../lib/fetch_pdf";
import { buildNaredbaBlock } from "../lib/extract_naredba";
import type { NaredbaParser } from "../types";

const FEES_NAREDBA_URL =
  "https://www.varna.bg/upload/20701/NAREDBA_na_ObS_Varna_za_opredelqneto_i_administriraneto_na_mestnite_taksi_i_ceni_na_uslugi_na_terito.pdf";

export const varParser: NaredbaParser = {
  obshtina: "VAR06",
  label: "Община Варна — Наредба за местните такси",
  url: FEES_NAREDBA_URL,
  documentType: "fees",

  async parse() {
    const { text, hash } = await fetchNaredbaPdf(FEES_NAREDBA_URL, "var_fees");
    const block = buildNaredbaBlock(text, {
      year: 2025,
      url: FEES_NAREDBA_URL,
      overrides: {
        // Чл. 18 of the Varna fees naredba (per amendment in force from
        // 1.01.2025): "за жилищни имоти на граждани и предприятия в
        // размер на 1,5 на хиляда пропорционално върху данъчната оценка"
        tboResidentialRate: 1.5,
        tboResidentialZone: "градско ядро",
      },
    });
    return { obshtina: this.obshtina, block, sourceHash: hash };
  },
};
