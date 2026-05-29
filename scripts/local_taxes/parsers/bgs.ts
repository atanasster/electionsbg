// Burgas (Община Бургас) naredba parser.
//
// Burgas publishes both naredbi as Office documents on the council site:
//   - FEES naredba (DOCX): burgascouncil.org/sites/default/files/2024-02/
//     naredba_mestni_danci_i_ceni_na_uslugi_3.docx (carries ТБО)
//   - TAX naredba (DOC): legacy binary .doc format — deferred until we
//     add an antiword/textutil step (Tier A ИПИ already covers the
//     numeric taxes; tourist+dog deferred to next round).
//
// The DOCX helper reuses scripts/council/lib/docx.ts (unzip + XML strip).

import { fetchNaredbaDocx } from "../lib/fetch_docx";
import { buildNaredbaBlock, extractDogTax } from "../lib/extract_naredba";
import type { NaredbaParser } from "../types";

const FEES_NAREDBA_URL =
  "https://burgascouncil.org/sites/default/files/2024-02/naredba_mestni_danci_i_ceni_na_uslugi_3.docx";

export const bgsParser: NaredbaParser = {
  obshtina: "BGS04",
  label: "Община Бургас — Наредба за местните такси",
  url: FEES_NAREDBA_URL,
  documentType: "fees",

  async parse() {
    const { text, hash } = await fetchNaredbaDocx(FEES_NAREDBA_URL, "bgs_fees");
    const block = buildNaredbaBlock(text, {
      year: 2024,
      url: FEES_NAREDBA_URL,
      overrides: {
        // Тарифа Приложение №3 of the Burgas fees naredba (per
        // Protocol №5/19.12.2023): "За жилищни и вилни имоти на граждани,
        // както и за жилищни имоти на предприятия, намиращи се в
        // строителните граници и застроени територии на гр. Бургас и
        // кварталите му...в промил върху данъчната оценка...1.3 ‰"
        tboResidentialRate: 1.3,
        tboResidentialZone: "гр. Бургас + кварталите",
      },
    });
    // Dog tax lives in the FEES naredba — Burgas's TAX naredba is still
    // blocked on a legacy .doc, but дог такса is recoverable from FEES.
    const dt = extractDogTax(text);
    if (dt) block.dogTax = dt;
    return { obshtina: this.obshtina, block, sourceHash: hash };
  },
};
