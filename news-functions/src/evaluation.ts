type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return {};
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function partyKey(value: Readonly<JsonObject>): string {
  if (typeof value.party_id === "string" && value.party_id)
    return `id:${value.party_id}`;
  return `surface:${String(value.party ?? "")
    .trim()
    .normalize("NFC")
    .toLowerCase()}`;
}

export function normalizeEvaluation(
  requestEvaluation: Readonly<JsonObject>,
  modelLabels: Readonly<JsonObject>,
): JsonObject {
  const normalized: JsonObject = {
    schema_version: 1,
    parties_confirmed_complete: true,
    removed_model_parties: structuredClone(
      array(requestEvaluation.removed_model_parties),
    ),
    public_note: requestEvaluation.public_note ?? null,
  };
  for (const field of ["leaning", "russia_stance"]) {
    const selection = object(requestEvaluation[field]);
    normalized[field] = {
      label: selection.label ?? null,
      disposition:
        selection.label === null
          ? "unable_to_judge"
          : selection.label === modelLabels[field]
            ? "confirmed"
            : "changed",
      evidence: selection.evidence ?? null,
      reason_codes: structuredClone(array(selection.reason_codes)),
    };
  }
  const modelParties = new Map(
    array(modelLabels.party_tones).map((raw) => {
      const item = object(raw);
      return [partyKey(item), item] as const;
    }),
  );
  normalized.party_tones = array(requestEvaluation.party_tones).map((raw) => {
    const item = object(raw);
    const model = modelParties.get(partyKey(item));
    return {
      party: item.party,
      party_id: item.party_id ?? null,
      tone: item.tone,
      evidence: item.evidence,
      disposition: !model
        ? "added"
        : model.tone === item.tone
          ? "confirmed"
          : "changed",
      reason_codes: structuredClone(array(item.reason_codes)),
    };
  });
  return normalized;
}

export function disagreesWithModel(evaluation: Readonly<JsonObject>): boolean {
  for (const field of ["leaning", "russia_stance"]) {
    if (object(evaluation[field]).disposition === "changed") return true;
  }
  if (
    array(evaluation.party_tones).some((raw) => {
      const disposition = object(raw).disposition;
      return disposition === "changed" || disposition === "added";
    })
  )
    return true;
  return array(evaluation.removed_model_parties).length > 0;
}
