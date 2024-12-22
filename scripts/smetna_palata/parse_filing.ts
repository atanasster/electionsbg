import { PartyFiling } from "@/data/dataTypes";
import { isNumeric } from "@/data/utils";
import fs from "fs";
import { pdf2array } from "pdf2array";

export const parseFiling = async ({
  dataFolder,
}: {
  dataFolder: string;
}): Promise<PartyFiling> => {
  const fromFileName = `${dataFolder}/filing.pdf`;
  let partyMonetary = 0;
  let partyNonMonetary = 0;

  let donorsMonetary = 0;
  let donorsNonMonetary = 0;
  let candidatesMonetary = 0;
  let candidatesNonMonetary = 0;
  let mediaPackage = 0;
  let allPartyMoney = 0;
  if (fs.existsSync(fromFileName)) {
    const buffer = fs.readFileSync(fromFileName);
    const data = await pdf2array(new Uint8Array(buffer));
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      if (row.length > 1) {
        const amountStr = row[row.length - 1];
        const subject = row.slice(0, row.length - 1).join(" ");
        if (subject.startsWith("1. Разходи")) {
          break;
        }
        if (isNumeric(amountStr)) {
          const amount = parseFloat(amountStr);

          if (subject && !isNaN(amount)) {
            if (subject.startsWith("1.1")) {
              partyMonetary = amount;
            } else if (subject.startsWith("1.2 Държавна")) {
              partyMonetary += amount;
            } else if (subject.startsWith("1.2")) {
              partyNonMonetary = amount;
            } else if (subject.startsWith("1.3")) {
              partyNonMonetary += amount;
            } else if (subject.startsWith("1.4")) {
              partyNonMonetary += amount;
            } else if (subject.startsWith("1.5")) {
              partyNonMonetary += amount;
            } else if (subject.startsWith("1.6")) {
              partyNonMonetary += amount;
            } else if (subject.startsWith("1.")) {
              allPartyMoney = amount;
            } else if (subject.startsWith("2.1")) {
              donorsMonetary = amount;
            } else if (subject.startsWith("2.2")) {
              donorsNonMonetary = amount;
            } else if (subject.startsWith("3.1")) {
              candidatesMonetary = amount;
            } else if (subject.startsWith("3.2")) {
              candidatesNonMonetary = amount;
            } else if (subject.startsWith("4.")) {
              mediaPackage = amount;
            }
          }
        }
      }
    }
  }
  if (allPartyMoney !== 0 && partyMonetary === 0 && partyNonMonetary === 0) {
    partyMonetary = allPartyMoney;
  }
  return {
    candidatesMonetary,
    candidatesNonMonetary,
    donorsMonetary,
    donorsNonMonetary,
    partyMonetary,
    partyNonMonetary,
    mediaPackage,
  };
};
