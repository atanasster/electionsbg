// A polling station's address without its settlement's name in front — the settlement is
// already the page's heading. Shared by the parliamentary and presidential „Топ секции" tiles
// so both print the same address for the same station.

export const stripSettlementFromAddress = (
  address: string | undefined,
  settlement: string | undefined,
) => {
  if (!address) return settlement || "";
  if (!settlement) return address;
  const settlementKey = settlement.replace(/\s+/g, "").toLowerCase();
  const addressKey = address.replace(/\s+/g, "").toLowerCase();
  const idx = addressKey.indexOf(settlementKey);
  if (idx < 0) return address;
  const numSpaces =
    (address.slice(0, settlementKey.length).split(" ").length || 1) - 1;
  const trimmed = address.slice(idx + settlementKey.length + numSpaces + 1);
  return trimmed.trim() || address;
};
