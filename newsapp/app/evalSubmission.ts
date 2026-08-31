import {
  EVAL_LEANING_VALUES,
  EVAL_RUSSIA_VALUES,
  EVAL_TONE_VALUES,
  type EvalPartyTone,
  type EvalTask,
} from "./evals";
import type { Leaning, RussiaStance, Tone } from "./data";

export const EVAL_EVIDENCE_LIMIT = 600;
export const EVAL_NOTE_LIMIT = 600;
export const TURNSTILE_ACTION = "news-evaluation-submit";
export const TURNSTILE_SITE_KEY =
  import.meta.env.VITE_NEWS_EVAL_TURNSTILE_SITE_KEY?.trim() ?? "";

export const EVAL_REASON_CODES = [
  "model_missed_context",
  "model_overweighted_quote",
  "label_too_strong",
  "label_too_weak",
  "neutral_vs_not_applicable",
  "insufficient_public_context",
  "wrong_party_identity",
  "party_missing",
  "party_not_meaningful",
  "tone_misread",
  "other",
] as const;
export type EvalReasonCode = (typeof EVAL_REASON_CODES)[number];
export type RemovedPartyReason =
  | "wrong_party_identity"
  | "party_not_meaningful"
  | "other";
export type ScalarDraftValue<L extends string> = L | "unable" | "";

export const REASON_CODE_LABELS: Record<EvalReasonCode, string> = {
  model_missed_context: "Пропуснат важен контекст",
  model_overweighted_quote: "Цитатът е приет за позиция на автора",
  label_too_strong: "Оценката е твърде силна",
  label_too_weak: "Оценката е твърде слаба",
  neutral_vs_not_applicable: "Неутрално е объркано с неприложимо",
  insufficient_public_context: "Недостатъчен публичен контекст",
  wrong_party_identity: "Грешно разпозната партия",
  party_missing: "Липсва партия",
  party_not_meaningful: "Партията е само спомената инцидентно",
  tone_misread: "Тонът към партията е разчетен грешно",
  other: "Друга конкретна причина",
};

export interface ScalarDraft<L extends string> {
  value: ScalarDraftValue<L>;
  evidence: string;
  reasonCodes: EvalReasonCode[];
}

export interface EvalPartyDraft {
  key: string;
  source: "model" | "added";
  party: string;
  partyId: string | null;
  tone: Tone | "";
  evidence: string;
  reasonCodes: EvalReasonCode[];
}

export interface RemovedPartyDraft {
  party: EvalPartyDraft;
  reasonCode: RemovedPartyReason | "";
}

export interface EvalDraft {
  schemaVersion: 1;
  articleKey: string;
  taskRevision: number;
  updatedAt: string;
  leaning: ScalarDraft<Leaning>;
  russia: ScalarDraft<RussiaStance>;
  parties: EvalPartyDraft[];
  removedParties: RemovedPartyDraft[];
  noParty: boolean;
  publicNote: string;
  attemptFingerprint: string | null;
  idempotencyKey: string | null;
}

export interface ScalarSubmission<L extends string> {
  label: L | null;
  evidence: string | null;
  reason_codes: EvalReasonCode[];
}

export interface EvaluationSubmission {
  leaning: ScalarSubmission<Leaning>;
  russia_stance: ScalarSubmission<RussiaStance>;
  parties_confirmed_complete: true;
  party_tones: Array<{
    party: string;
    party_id: string | null;
    tone: Tone;
    evidence: string;
    reason_codes: EvalReasonCode[];
  }>;
  removed_model_parties: Array<{
    party: string;
    party_id: string | null;
    reason_code: RemovedPartyReason;
  }>;
  public_note: string | null;
}

export interface EvaluationSubmissionRequest {
  schema_version: 1;
  article_key: string;
  base_task_revision: number;
  content_sha256: string;
  analysis_sha256: string;
  idempotency_key: string;
  turnstile_token: string;
  browser_nonce: string | null;
  evaluation: EvaluationSubmission;
}

export interface SubmissionReceipt {
  submission_id: string;
  status: "raw";
  article_key: string;
  task_revision: number;
  submitted_at: string;
  evaluation: {
    leaning: ScalarSubmission<Leaning> & {
      disposition: "confirmed" | "changed" | "unable_to_judge";
    };
    russia_stance: ScalarSubmission<RussiaStance> & {
      disposition: "confirmed" | "changed" | "unable_to_judge";
    };
    parties_confirmed_complete: true;
    party_tones: Array<
      EvaluationSubmission["party_tones"][number] & {
        disposition: "confirmed" | "changed" | "added";
      }
    >;
    removed_model_parties: EvaluationSubmission["removed_model_parties"];
    public_note: string | null;
  };
  model_labels: EvalTask["model_labels"];
}

export interface SubmissionSuccess {
  submission: SubmissionReceipt;
  idempotent: boolean;
}

export class EvaluationSubmissionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly currentRevision: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "EvaluationSubmissionError";
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const bounded = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length <= maximum;
const token = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const exactFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === fields.length && keys.every((key) => fields.includes(key))
  );
};

const modelParties = (task: EvalTask): EvalPartyDraft[] =>
  task.model_labels.party_tones.map((party, index) => ({
    key: `model:${party.party_id ?? `${index}:${party.party}`}`,
    source: "model",
    party: party.party,
    partyId: party.party_id,
    tone: "",
    evidence: "",
    reasonCodes: [],
  }));

export const createEvalDraft = (task: EvalTask): EvalDraft => ({
  schemaVersion: 1,
  articleKey: task.article_key,
  taskRevision: task.task_revision,
  updatedAt: new Date().toISOString(),
  leaning: { value: "", evidence: "", reasonCodes: [] },
  russia: { value: "", evidence: "", reasonCodes: [] },
  parties: modelParties(task),
  removedParties: [],
  noParty: false,
  publicNote: "",
  attemptFingerprint: null,
  idempotencyKey: null,
});

const parseReasonCodes = (value: unknown): EvalReasonCode[] | null =>
  Array.isArray(value) &&
  value.length <= 6 &&
  value.every((item) => EVAL_REASON_CODES.includes(item as EvalReasonCode)) &&
  new Set(value).size === value.length
    ? (value as EvalReasonCode[])
    : null;

const parseScalarDraft = <L extends string>(
  value: unknown,
  labels: readonly L[],
): ScalarDraft<L> | null => {
  const row = object(value);
  const reasonCodes = parseReasonCodes(row?.reasonCodes);
  if (
    !row ||
    !exactFields(row, ["value", "evidence", "reasonCodes"]) ||
    !bounded(row.evidence, EVAL_EVIDENCE_LIMIT) ||
    !reasonCodes ||
    !["", "unable", ...labels].includes(row.value as L)
  ) {
    return null;
  }
  return {
    value: row.value as ScalarDraftValue<L>,
    evidence: row.evidence,
    reasonCodes,
  };
};

const parsePartyDraft = (value: unknown): EvalPartyDraft | null => {
  const row = object(value);
  const reasonCodes = parseReasonCodes(row?.reasonCodes);
  if (
    !row ||
    !exactFields(row, [
      "key",
      "source",
      "party",
      "partyId",
      "tone",
      "evidence",
      "reasonCodes",
    ]) ||
    typeof row.key !== "string" ||
    row.key.length > 400 ||
    !/^(?:model|added):/.test(row.key) ||
    (row.source !== "model" && row.source !== "added") ||
    typeof row.party !== "string" ||
    !row.party.trim() ||
    row.party.length > 160 ||
    (row.partyId !== null &&
      (typeof row.partyId !== "string" ||
        !row.partyId ||
        row.partyId.length > 160)) ||
    !["", ...EVAL_TONE_VALUES].includes(row.tone as Tone) ||
    !bounded(row.evidence, EVAL_EVIDENCE_LIMIT) ||
    !reasonCodes
  ) {
    return null;
  }
  return {
    key: row.key as string,
    source: row.source,
    party: row.party,
    partyId: row.partyId as string | null,
    tone: row.tone as Tone | "",
    evidence: row.evidence,
    reasonCodes,
  };
};

export const parseEvalDraft = (
  value: unknown,
  task: EvalTask,
): EvalDraft | null => {
  const row = object(value);
  const leaning = parseScalarDraft(row?.leaning, EVAL_LEANING_VALUES);
  const russia = parseScalarDraft(row?.russia, EVAL_RUSSIA_VALUES);
  const parties = Array.isArray(row?.parties)
    ? row.parties.map(parsePartyDraft)
    : [];
  const removed = Array.isArray(row?.removedParties)
    ? row.removedParties.map((raw): RemovedPartyDraft | null => {
        const item = object(raw);
        const party = parsePartyDraft(item?.party);
        if (
          !item ||
          !exactFields(item, ["party", "reasonCode"]) ||
          !party ||
          ![
            "",
            "wrong_party_identity",
            "party_not_meaningful",
            "other",
          ].includes(item.reasonCode as string)
        ) {
          return null;
        }
        return {
          party,
          reasonCode: item.reasonCode as RemovedPartyDraft["reasonCode"],
        };
      })
    : [];
  if (
    !row ||
    !exactFields(row, [
      "schemaVersion",
      "articleKey",
      "taskRevision",
      "updatedAt",
      "leaning",
      "russia",
      "parties",
      "removedParties",
      "noParty",
      "publicNote",
      "attemptFingerprint",
      "idempotencyKey",
    ]) ||
    row.schemaVersion !== 1 ||
    row.articleKey !== task.article_key ||
    row.taskRevision !== task.task_revision ||
    typeof row.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(row.updatedAt)) ||
    !leaning ||
    !russia ||
    parties.some((item) => !item) ||
    removed.some((item) => !item) ||
    parties.length + removed.length > 30 ||
    typeof row.noParty !== "boolean" ||
    !bounded(row.publicNote, EVAL_NOTE_LIMIT) ||
    (row.attemptFingerprint !== null &&
      (typeof row.attemptFingerprint !== "string" ||
        row.attemptFingerprint.length > 16_000)) ||
    (row.idempotencyKey !== null && !token(row.idempotencyKey))
  ) {
    return null;
  }
  const typedParties = parties as EvalPartyDraft[];
  const typedRemoved = removed as RemovedPartyDraft[];
  const keys = [...typedParties, ...typedRemoved.map((item) => item.party)].map(
    (item) => item.key,
  );
  if (new Set(keys).size !== keys.length) return null;
  const modelIdentity = new Set(
    task.model_labels.party_tones.map(
      (item) =>
        item.party_id ?? `surface:${item.party.toLocaleLowerCase("bg")}`,
    ),
  );
  const draftModelIdentity = new Set(
    [...typedParties, ...typedRemoved.map((item) => item.party)]
      .filter((item) => item.source === "model")
      .map(
        (item) =>
          item.partyId ?? `surface:${item.party.toLocaleLowerCase("bg")}`,
      ),
  );
  if (
    modelIdentity.size !== draftModelIdentity.size ||
    [...modelIdentity].some((identity) => !draftModelIdentity.has(identity))
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    articleKey: task.article_key,
    taskRevision: task.task_revision,
    updatedAt: row.updatedAt,
    leaning,
    russia,
    parties: typedParties,
    removedParties: typedRemoved,
    noParty: row.noParty,
    publicNote: row.publicNote,
    attemptFingerprint: row.attemptFingerprint as string | null,
    idempotencyKey: row.idempotencyKey as string | null,
  };
};

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const evalDraftStorageKey = (task: EvalTask): string =>
  `news-eval-draft:v1:${encodeURIComponent(task.article_key)}:${task.task_revision}`;

export const loadEvalDraft = (task: EvalTask): EvalDraft | null => {
  try {
    const raw = storage()?.getItem(evalDraftStorageKey(task));
    return raw ? parseEvalDraft(JSON.parse(raw), task) : null;
  } catch {
    return null;
  }
};

export const saveEvalDraft = (task: EvalTask, draft: EvalDraft): boolean => {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(evalDraftStorageKey(task), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
};

export const clearEvalDraft = (task: EvalTask): void => {
  try {
    storage()?.removeItem(evalDraftStorageKey(task));
  } catch {
    // A disabled storage backend should never turn a valid submission into an error.
  }
};

const completionKey = (task: EvalTask): string =>
  `news-eval-complete:v1:${encodeURIComponent(task.article_key)}:${task.task_revision}`;

export const markLocalEvalComplete = (task: EvalTask): void => {
  try {
    storage()?.setItem(completionKey(task), new Date().toISOString());
  } catch {
    // This marker is a local convenience, never proof of an independent evaluator.
  }
};

export const localEvalCompleted = (task: EvalTask): boolean => {
  try {
    return Boolean(storage()?.getItem(completionKey(task)));
  } catch {
    return false;
  }
};

const randomKey = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : [...crypto.getRandomValues(new Uint8Array(24))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");

const BROWSER_NONCE_KEY = "news-eval-browser-nonce:v1";
export const getOrCreateBrowserNonce = (): string | null => {
  try {
    const target = storage();
    if (!target) return null;
    const existing = target.getItem(BROWSER_NONCE_KEY);
    if (token(existing)) return existing;
    const created = randomKey();
    target.setItem(BROWSER_NONCE_KEY, created);
    return created;
  } catch {
    return null;
  }
};

export const newIdempotencyKey = (): string => randomKey();

export interface EvalDraftValidation {
  evaluation: EvaluationSubmission | null;
  errors: string[];
}

const scalarSubmission = <L extends string>(
  draft: ScalarDraft<L>,
  label: string,
  errors: string[],
): ScalarSubmission<L> | null => {
  if (!draft.value) {
    errors.push(`Изберете оценка за ${label}.`);
    return null;
  }
  const evidence = draft.evidence.trim();
  if (draft.value === "unable") {
    return {
      label: null,
      evidence: evidence || null,
      reason_codes: [
        ...new Set<EvalReasonCode>([
          "insufficient_public_context",
          ...draft.reasonCodes,
        ]),
      ],
    };
  }
  if (!evidence) errors.push(`Добавете кратко основание за ${label}.`);
  return {
    label: draft.value,
    evidence,
    reason_codes: draft.reasonCodes,
  };
};

export const validateEvalDraft = (
  task: EvalTask,
  draft: EvalDraft,
): EvalDraftValidation => {
  const errors: string[] = [];
  const leaning = scalarSubmission(
    draft.leaning,
    "политическото рамкиране",
    errors,
  );
  const russia = scalarSubmission(
    draft.russia,
    "позицията спрямо Русия",
    errors,
  );
  const partyTones: EvaluationSubmission["party_tones"] = [];
  const removedModelParties: EvaluationSubmission["removed_model_parties"] = [];
  if (draft.noParty) {
    for (const model of task.model_labels.party_tones) {
      removedModelParties.push({
        party: model.party,
        party_id: model.party_id,
        reason_code: "party_not_meaningful",
      });
    }
  } else {
    const identities = new Set<string>();
    for (const party of draft.parties) {
      const identity = party.partyId
        ? `id:${party.partyId}`
        : `surface:${party.party.trim().normalize("NFC").toLocaleLowerCase("bg")}`;
      if (identities.has(identity)) {
        errors.push(`Партията ${party.party} е добавена повече от веднъж.`);
        continue;
      }
      identities.add(identity);
      if (!party.tone) {
        errors.push(`Изберете тон към ${party.party}.`);
        continue;
      }
      const evidence = party.evidence.trim();
      if (!evidence)
        errors.push(`Добавете кратко основание за ${party.party}.`);
      partyTones.push({
        party: party.party.trim(),
        party_id: party.partyId,
        tone: party.tone,
        evidence,
        reason_codes: party.reasonCodes,
      });
    }
    for (const removed of draft.removedParties) {
      if (!removed.reasonCode) {
        errors.push(`Посочете защо премахвате ${removed.party.party}.`);
        continue;
      }
      removedModelParties.push({
        party: removed.party.party,
        party_id: removed.party.partyId,
        reason_code: removed.reasonCode,
      });
    }
    if (
      task.model_labels.party_tones.length === 0 &&
      partyTones.length === 0 &&
      removedModelParties.length === 0
    ) {
      errors.push("Потвърдете изрично, че няма съществено спомената партия.");
    }
  }
  return {
    evaluation:
      errors.length || !leaning || !russia
        ? null
        : {
            leaning,
            russia_stance: russia,
            parties_confirmed_complete: true,
            party_tones: partyTones,
            removed_model_parties: removedModelParties,
            public_note: draft.publicNote.trim() || null,
          },
    errors,
  };
};

export const evaluationFingerprint = (
  evaluation: EvaluationSubmission,
): string => JSON.stringify(evaluation);

export const buildSubmissionRequest = (
  task: EvalTask,
  evaluation: EvaluationSubmission,
  turnstileToken: string,
  idempotencyKey: string,
  browserNonce: string | null,
): EvaluationSubmissionRequest => ({
  schema_version: 1,
  article_key: task.article_key,
  base_task_revision: task.task_revision,
  content_sha256: task.content_sha256,
  analysis_sha256: task.analysis_sha256,
  idempotency_key: idempotencyKey,
  turnstile_token: turnstileToken,
  browser_nonce: browserNonce,
  evaluation,
});

const parseScalarReceipt = <L extends string>(
  value: unknown,
  labels: readonly L[],
):
  | (ScalarSubmission<L> & {
      disposition: "confirmed" | "changed" | "unable_to_judge";
    })
  | null => {
  const row = object(value);
  const reasons = parseReasonCodes(row?.reason_codes);
  if (
    !row ||
    !exactFields(row, ["label", "disposition", "evidence", "reason_codes"]) ||
    (row.label !== null && !labels.includes(row.label as L)) ||
    (row.evidence !== null && !bounded(row.evidence, EVAL_EVIDENCE_LIMIT)) ||
    !reasons ||
    !["confirmed", "changed", "unable_to_judge"].includes(
      row.disposition as string,
    )
  ) {
    return null;
  }
  if (
    (row.disposition === "unable_to_judge") !== (row.label === null) ||
    (row.disposition !== "unable_to_judge" &&
      (typeof row.evidence !== "string" || row.evidence.length === 0))
  ) {
    return null;
  }
  return {
    label: row.label as L | null,
    evidence: row.evidence as string | null,
    reason_codes: reasons,
    disposition: row.disposition as "confirmed" | "changed" | "unable_to_judge",
  };
};

const parseModelLabels = (value: unknown): EvalTask["model_labels"] | null => {
  const row = object(value);
  if (
    !row ||
    !exactFields(row, ["leaning", "russia_stance", "party_tones"]) ||
    !EVAL_LEANING_VALUES.includes(row.leaning as Leaning) ||
    !EVAL_RUSSIA_VALUES.includes(row.russia_stance as RussiaStance) ||
    !Array.isArray(row.party_tones) ||
    row.party_tones.length > 30
  ) {
    return null;
  }
  const parties = row.party_tones.map((raw): EvalPartyTone | null => {
    const party = object(raw);
    return party &&
      exactFields(party, ["party", "party_id", "tone"]) &&
      typeof party.party === "string" &&
      party.party.length > 0 &&
      party.party.length <= 160 &&
      (party.party_id === null ||
        (typeof party.party_id === "string" &&
          party.party_id.length > 0 &&
          party.party_id.length <= 160)) &&
      EVAL_TONE_VALUES.includes(party.tone as Tone)
      ? {
          party: party.party,
          party_id: party.party_id as string | null,
          tone: party.tone as Tone,
        }
      : null;
  });
  const identities = parties
    .filter((party): party is EvalPartyTone => Boolean(party))
    .map((party) =>
      party.party_id
        ? `id:${party.party_id}`
        : `surface:${party.party.trim().normalize("NFC").toLocaleLowerCase("bg")}`,
    );
  return parties.some((party) => !party) ||
    new Set(identities).size !== identities.length
    ? null
    : {
        leaning: row.leaning as Leaning,
        russia_stance: row.russia_stance as RussiaStance,
        party_tones: parties as EvalPartyTone[],
      };
};

const parseReceiptParties = (
  value: unknown,
): SubmissionReceipt["evaluation"]["party_tones"] | null => {
  if (!Array.isArray(value) || value.length > 30) return null;
  const parsed = value.map((raw) => {
    const row = object(raw);
    const reasons = parseReasonCodes(row?.reason_codes);
    if (
      !row ||
      !exactFields(row, [
        "party",
        "party_id",
        "tone",
        "evidence",
        "disposition",
        "reason_codes",
      ]) ||
      typeof row.party !== "string" ||
      !row.party.trim() ||
      row.party.length > 160 ||
      (row.party_id !== null &&
        (typeof row.party_id !== "string" ||
          row.party_id.length === 0 ||
          row.party_id.length > 160)) ||
      !EVAL_TONE_VALUES.includes(row.tone as Tone) ||
      typeof row.evidence !== "string" ||
      row.evidence.length === 0 ||
      row.evidence.length > EVAL_EVIDENCE_LIMIT ||
      !["confirmed", "changed", "added"].includes(row.disposition as string) ||
      !reasons
    ) {
      return null;
    }
    return {
      party: row.party,
      party_id: row.party_id as string | null,
      tone: row.tone as Tone,
      evidence: row.evidence,
      disposition: row.disposition as "confirmed" | "changed" | "added",
      reason_codes: reasons,
    };
  });
  if (parsed.some((item) => !item)) return null;
  const identities = parsed.map((item) =>
    item!.party_id
      ? `id:${item!.party_id}`
      : `surface:${item!.party.trim().normalize("NFC").toLocaleLowerCase("bg")}`,
  );
  return new Set(identities).size === identities.length
    ? (parsed as SubmissionReceipt["evaluation"]["party_tones"])
    : null;
};

const parseRemovedParties = (
  value: unknown,
): SubmissionReceipt["evaluation"]["removed_model_parties"] | null => {
  if (!Array.isArray(value) || value.length > 30) return null;
  const parsed = value.map((raw) => {
    const row = object(raw);
    if (
      !row ||
      !exactFields(row, ["party", "party_id", "reason_code"]) ||
      typeof row.party !== "string" ||
      !row.party.trim() ||
      row.party.length > 160 ||
      (row.party_id !== null &&
        (typeof row.party_id !== "string" ||
          row.party_id.length === 0 ||
          row.party_id.length > 160)) ||
      !["wrong_party_identity", "party_not_meaningful", "other"].includes(
        row.reason_code as string,
      )
    ) {
      return null;
    }
    return {
      party: row.party,
      party_id: row.party_id as string | null,
      reason_code: row.reason_code as RemovedPartyReason,
    };
  });
  return parsed.some((item) => !item)
    ? null
    : (parsed as SubmissionReceipt["evaluation"]["removed_model_parties"]);
};

const parseSuccess = (
  value: unknown,
  task: EvalTask,
): SubmissionSuccess | null => {
  const root = object(value);
  const receipt = object(root?.submission);
  const evaluation = object(receipt?.evaluation);
  const leaning = parseScalarReceipt(evaluation?.leaning, EVAL_LEANING_VALUES);
  const russia = parseScalarReceipt(
    evaluation?.russia_stance,
    EVAL_RUSSIA_VALUES,
  );
  const modelLabels = parseModelLabels(receipt?.model_labels);
  const parties = parseReceiptParties(evaluation?.party_tones);
  const removed = parseRemovedParties(evaluation?.removed_model_parties);
  if (
    !root ||
    !exactFields(root, ["submission", "idempotent"]) ||
    typeof root.idempotent !== "boolean" ||
    !receipt ||
    !exactFields(receipt, [
      "submission_id",
      "status",
      "article_key",
      "task_revision",
      "submitted_at",
      "evaluation",
      "model_labels",
    ]) ||
    !token(receipt.submission_id) ||
    receipt.status !== "raw" ||
    receipt.article_key !== task.article_key ||
    receipt.task_revision !== task.task_revision ||
    typeof receipt.submitted_at !== "string" ||
    !Number.isFinite(Date.parse(receipt.submitted_at)) ||
    !evaluation ||
    !exactFields(evaluation, [
      "schema_version",
      "leaning",
      "russia_stance",
      "parties_confirmed_complete",
      "party_tones",
      "removed_model_parties",
      "public_note",
    ]) ||
    evaluation.schema_version !== 1 ||
    !leaning ||
    !russia ||
    !modelLabels ||
    !parties ||
    !removed ||
    evaluation.parties_confirmed_complete !== true ||
    !Array.isArray(evaluation.party_tones) ||
    !Array.isArray(evaluation.removed_model_parties) ||
    (evaluation.public_note !== null &&
      !bounded(evaluation.public_note, EVAL_NOTE_LIMIT))
  ) {
    return null;
  }
  return {
    idempotent: root.idempotent,
    submission: {
      submission_id: receipt.submission_id,
      status: "raw",
      article_key: task.article_key,
      task_revision: task.task_revision,
      submitted_at: receipt.submitted_at,
      evaluation: {
        leaning,
        russia_stance: russia,
        parties_confirmed_complete: true,
        party_tones: parties,
        removed_model_parties: removed,
        public_note: evaluation.public_note as string | null,
      },
      model_labels: modelLabels,
    },
  };
};

export const submitEvaluation = async (
  task: EvalTask,
  request: EvaluationSubmissionRequest,
  fetcher: typeof fetch = fetch,
): Promise<SubmissionSuccess> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetcher("/api/news-evals/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(request),
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
  } catch {
    throw new EvaluationSubmissionError("network_error", 0);
  } finally {
    window.clearTimeout(timer);
  }
  const raw = await response.text();
  if (raw.length > 65_536) {
    throw new EvaluationSubmissionError("invalid_response", response.status);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new EvaluationSubmissionError("invalid_response", response.status);
  }
  if (!response.ok) {
    const error = object(object(payload)?.error);
    const code =
      typeof error?.code === "string" ? error.code : "request_failed";
    const currentRevision = Number.isSafeInteger(error?.current_revision)
      ? (error!.current_revision as number)
      : null;
    const retry = Number(response.headers.get("Retry-After"));
    throw new EvaluationSubmissionError(
      code,
      response.status,
      currentRevision,
      Number.isFinite(retry) && retry >= 0 ? retry : null,
    );
  }
  const success = parseSuccess(payload, task);
  if (!success) {
    throw new EvaluationSubmissionError("invalid_response", response.status);
  }
  return success;
};
