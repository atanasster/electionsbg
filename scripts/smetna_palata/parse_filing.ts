import { PartyIncome } from "@/data/dataTypes";
import fs from "fs";
import { pdf2array } from "pdf2array";

export const parseFiling = async ({
  dataFolder,
}: {
  dataFolder: string;
}): Promise<PartyIncome | undefined> => {
  const fromFileName = `${dataFolder}/filing.pdf`;
  if (!fs.existsSync(fromFileName)) {
    return undefined;
  }
  const buffer = fs.readFileSync(fromFileName);
  const data = await pdf2array(new Uint8Array(buffer));
  let partyMonetary = 0;
  let partyNonMonetary = 0;

  let donorsMonetary = 0;
  let donorsNonMonetary = 0;
  let candidatesMonetary = 0;
  let candidatesNonMonetary = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row.length > 1) {
      const amount = parseFloat(row[row.length - 1]);
      const subject = row.slice(0, row.length - 1).join(" ");
      if (subject.startsWith("4.") || subject.startsWith("1. Разходи")) {
        break;
      }
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
        } else if (subject.startsWith("2.1")) {
          donorsMonetary = amount;
        } else if (subject.startsWith("2.2")) {
          donorsNonMonetary = amount;
        } else if (subject.startsWith("3.1")) {
          candidatesMonetary = amount;
        } else if (subject.startsWith("3.2")) {
          candidatesNonMonetary = amount;
        }
      }
    }
  }
  return {
    candidatesMonetary,
    candidatesNonMonetary,
    donorsMonetary,
    donorsNonMonetary,
    partyMonetary,
    partyNonMonetary,
  };
};
