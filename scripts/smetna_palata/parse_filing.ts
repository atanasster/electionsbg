import {
  PartyFiling,
  PartyFilingExpenses,
  PartyFilingIncome,
} from "@/data/dataTypes";
import { isNumeric } from "@/data/utils";
import fs from "fs";
import { pdf2array } from "pdf2array";

export const parseFiling = async ({
  dataFolder,
}: {
  dataFolder: string;
}): Promise<PartyFiling> => {
  const fromFileName = `${dataFolder}/filing.pdf`;
  const income: PartyFilingIncome = {
    party: {
      monetary: 0,
      nonMonetary: 0,
    },
    donors: {
      monetary: 0,
      nonMonetary: 0,
    },
    candidates: {
      monetary: 0,
      nonMonetary: 0,
    },
    mediaPackage: 0,
  };
  const expenses: PartyFilingExpenses = {
    material: {
      fuel: 0,
      officeSupplies: 0,
      other: 0,
    },
    external: {
      consulting: 0,
      mediaServices: {
        digitalMedia: 0,
        digitalMultiMedia: {
          nationalRadio: 0,
          nationalTV: 0,
          otherRadio: 0,
          otherVisualMedia: 0,
        },
        printedMedia: 0,
      },
      partyMaterials: 0,
      pollingAgencies: 0,
      publicEvents: 0,
      postalExpenses: 0,
      rentalExpenses: 0,
      otherExpenses: 0,
    },
    compensations: 0,
    compensationTaxes: 0,
    taxes: {
      taxOnDonations: 0,
      otherTaxes: 0,
      taxes: 0,
    },
    businessTrips: 0,
    donations: 0,
    mediaPackage: {
      digitalMedia: 0,
      digitalMultiMedia: {
        nationalRadio: 0,
        nationalTV: 0,
        otherRadio: 0,
        otherVisualMedia: 0,
      },
      printedMedia: 0,
    },
  };
  let allPartyMoney = 0;
  let isIncome: boolean = true;
  if (fs.existsSync(fromFileName)) {
    const buffer = fs.readFileSync(fromFileName);
    const data = await pdf2array(new Uint8Array(buffer));
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      if (row.length > 1) {
        const amountStr = row[row.length - 1];
        const subject = row.slice(0, row.length - 1).join(" ");
        if (subject.startsWith("1. Разходи")) {
          isIncome = false;
        }
        if (subject && isNumeric(amountStr)) {
          const amount = subject.endsWith(" т.") ? 0 : parseFloat(amountStr);

          if (!isNaN(amount)) {
            if (isIncome) {
              if (subject.startsWith("1.1")) {
                income.party.monetary = amount;
              } else if (subject.startsWith("1.2 Държавна")) {
                income.party.monetary += amount;
              } else if (subject.startsWith("1.2")) {
                income.party.nonMonetary = amount;
              } else if (subject.startsWith("1.3")) {
                income.party.nonMonetary += amount;
              } else if (subject.startsWith("1.4")) {
                income.party.nonMonetary += amount;
              } else if (subject.startsWith("1.5")) {
                income.party.nonMonetary += amount;
              } else if (subject.startsWith("1.6")) {
                income.party.nonMonetary += amount;
              } else if (subject.startsWith("1.")) {
                allPartyMoney = amount;
              } else if (subject.startsWith("2.1")) {
                income.donors.monetary = amount;
              } else if (subject.startsWith("2.2")) {
                income.donors.nonMonetary = amount;
              } else if (subject.startsWith("3.1")) {
                income.candidates.monetary = amount;
              } else if (subject.startsWith("3.2")) {
                income.candidates.nonMonetary = amount;
              } else if (subject.startsWith("4.")) {
                income.mediaPackage = amount;
                isIncome = false;
              }
            } else {
              //expenses
              if (subject.startsWith("1.1")) {
                expenses.material.officeSupplies = amount;
              } else if (subject.startsWith("1.2")) {
                expenses.material.fuel = amount;
              } else if (subject.startsWith("1.3")) {
                expenses.material.other = amount;
              } else if (subject.startsWith("2.1.1")) {
                expenses.external.mediaServices.printedMedia = amount;
              } else if (subject.startsWith("2.1.2.1")) {
                expenses.external.mediaServices.digitalMultiMedia.nationalTV =
                  amount;
              } else if (subject.startsWith("2.1.2.2")) {
                expenses.external.mediaServices.digitalMultiMedia.otherVisualMedia =
                  amount;
              } else if (subject.startsWith("2.1.2.3")) {
                expenses.external.mediaServices.digitalMultiMedia.nationalRadio =
                  amount;
              } else if (subject.startsWith("2.1.2.4")) {
                expenses.external.mediaServices.digitalMultiMedia.otherRadio =
                  amount;
              } else if (subject.startsWith("2.1.3")) {
                expenses.external.mediaServices.digitalMedia = amount;
              } else if (subject.startsWith("2.2")) {
                expenses.external.pollingAgencies = amount;
              } else if (subject.startsWith("2.3")) {
                expenses.external.consulting = amount;
              } else if (subject.startsWith("2.4")) {
                expenses.external.partyMaterials = amount;
              } else if (subject.startsWith("2.5")) {
                expenses.external.publicEvents = amount;
              } else if (subject.startsWith("2.6")) {
                expenses.external.postalExpenses = amount;
              } else if (subject.startsWith("2.7")) {
                expenses.external.rentalExpenses = amount;
              } else if (subject.startsWith("2.8")) {
                expenses.external.otherExpenses = amount;
              } else if (subject.startsWith("3.")) {
                expenses.compensations = amount;
              } else if (subject.startsWith("4.")) {
                expenses.compensationTaxes = amount;
              } else if (subject.startsWith("5.1")) {
                expenses.taxes.taxOnDonations = amount;
              } else if (subject.startsWith("5.2")) {
                expenses.taxes.otherTaxes = amount;
              } else if (subject.startsWith("5.3")) {
                expenses.taxes.taxes = amount;
              } else if (subject.startsWith("6.")) {
                expenses.businessTrips = amount;
              } else if (subject.startsWith("7.")) {
                expenses.donations = amount;
              } else if (subject.startsWith("8.1.1")) {
                expenses.mediaPackage.printedMedia = amount;
              } else if (subject.startsWith("8.1.2.1")) {
                expenses.mediaPackage.digitalMultiMedia.nationalTV = amount;
              } else if (subject.startsWith("8.1.2.2")) {
                expenses.mediaPackage.digitalMultiMedia.otherVisualMedia =
                  amount;
              } else if (subject.startsWith("8.1.2.3")) {
                expenses.mediaPackage.digitalMultiMedia.nationalRadio = amount;
              } else if (subject.startsWith("8.1.2.4")) {
                expenses.mediaPackage.digitalMultiMedia.otherRadio = amount;
              } else if (subject.startsWith("8.1.3")) {
                expenses.mediaPackage.digitalMedia = amount;
              }
            }
          }
        }
      }
    }
  }
  if (
    allPartyMoney !== 0 &&
    income.party.monetary === 0 &&
    income.party.nonMonetary === 0
  ) {
    income.party.monetary = allPartyMoney;
  }
  return {
    income,
    expenses,
  };
};
