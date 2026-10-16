// Count words with Bulgarian singular agreement — „1 договор", „2 договора" —
// shared by the transport sub-pages so no tile reads „1 договора".

export const contractsWord = (n: number, bg: boolean): string =>
  n === 1 ? (bg ? "договор" : "contract") : bg ? "договора" : "contracts";

export const bodiesWord = (n: number, bg: boolean): string =>
  n === 1 ? (bg ? "структура" : "body") : bg ? "структури" : "bodies";
