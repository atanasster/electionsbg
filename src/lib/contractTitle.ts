// Splits an АОП contract title into its main subject and an optional
// "Обособена позиция N: …" lot qualifier. These titles follow a predictable
// shape — "<subject> …, Обособена позиция N: <lot detail>" — so the header can
// render the subject as the heading and demote the lot to a muted sub-line
// instead of welding both into one oversized serif block. When no lot marker
// is present the whole string comes back as `main` (the caller then clamps it).

export interface ContractTitleParts {
  main: string;
  lotLabel?: string; // e.g. "Обособена позиция 1"
  lotDetail?: string; // text after the colon
}

// Matches an optional leading comma/space, the literal lot label with its
// number (no colon in between), then the separating colon. Lazy `[^:]*?`
// guarantees we split on the colon that belongs to the lot marker, not an
// earlier colon in the subject.
const LOT_RE = /[\s,]*(Обособена позиция[^:]*?):\s*/;

export const splitContractTitle = (
  title: string | null | undefined,
): ContractTitleParts => {
  const trimmed = (title ?? "").trim();
  const m = trimmed.match(LOT_RE);
  if (!m || m.index === undefined) return { main: trimmed };

  const main = trimmed
    .slice(0, m.index)
    .replace(/[\s,]+$/, "")
    .trim();
  const lotDetail = trimmed.slice(m.index + m[0].length).trim();
  // Never leave the heading empty (title that opens with the lot marker).
  if (!main) return { main: trimmed };

  return { main, lotLabel: m[1].trim(), lotDetail: lotDetail || undefined };
};
