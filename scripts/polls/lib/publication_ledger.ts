import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { InboxDraft } from "./draft";

export interface PublicationDiscovery {
  pubId: string;
  url: string;
  title: string | null;
  publishedAt: string | null;
  press?: { guid: string; sourceName: string | null; resolvedUrl?: string };
}

export interface PublicationVersion {
  sha256: string;
  capturePath: string;
  capturedAt: string;
  attachmentFailures: string[];
  drafts: {
    pollId: string;
    race: InboxDraft["race"];
    extractedAt: string;
    draftHash: string;
    refused: string[];
    reviewedAt?: string;
    acceptedAt?: string;
    acceptedDraftHash?: string;
  }[];
}

export interface PublicationRecord extends PublicationDiscovery {
  agencyId: string;
  pubIds: string[];
  discoveredAt: string;
  latestHash: string | null;
  versions: PublicationVersion[];
  failures: { capture: number; extraction: number };
  errors: {
    capture: { message: string; at: string } | null;
    extraction: { message: string; at: string } | null;
  };
  lastError: {
    stage: "capture" | "extraction";
    message: string;
    at: string;
  } | null;
}

const ledgerPath = (root: string, agencyId: string): string => {
  if (!/^[A-Z]+$/.test(agencyId)) throw new Error("Invalid ledger agency ID");
  return path.join(root, "state/polls", `${agencyId}.json`);
};

/** The ledger is independent of a watcher's latest delta and survives unchanged checks. */
export const readPublicationLedger = (
  root: string,
  agencyId: string,
): PublicationRecord[] => {
  const file = ledgerPath(root, agencyId);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const mutate = (
  root: string,
  agencyId: string,
  update: (records: PublicationRecord[]) => void,
  commitCorpus?: () => void,
): void => {
  const file = ledgerPath(root, agencyId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // An overlapping watcher/ingester must retry rather than overwrite another writer.
  const lock = `${file}.lock`;
  fs.mkdirSync(lock);
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    const records = readPublicationLedger(root, agencyId);
    update(records);
    const serialized = JSON.stringify(records, null, 2) + "\n";
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === serialized) {
      commitCorpus?.();
      return;
    }
    fs.writeFileSync(temporary, serialized);
    commitCorpus?.();
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.rmdirSync(lock);
  }
};

const canonicalUrl = (raw: string): string => {
  const url = new URL(raw);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.href;
};

const refreshLastError = (item: PublicationRecord): void => {
  const capture = item.errors.capture;
  const extraction = item.errors.extraction;
  if (extraction && (!capture || extraction.at > capture.at))
    item.lastError = { ...extraction, stage: "extraction" };
  else item.lastError = capture ? { ...capture, stage: "capture" } : null;
};

const discover = (
  records: PublicationRecord[],
  agencyId: string,
  discovery: PublicationDiscovery,
  at: string,
): PublicationRecord => {
  const existing = records.find(
    (item) =>
      item.pubIds.includes(discovery.pubId) ||
      canonicalUrl(item.url) === canonicalUrl(discovery.url),
  );
  if (existing) {
    if (!existing.pubIds.includes(discovery.pubId))
      existing.pubIds.push(discovery.pubId);
    if (discovery.title !== null) existing.title = discovery.title;
    if (discovery.publishedAt !== null)
      existing.publishedAt = discovery.publishedAt;
    if (existing.press && !discovery.press) {
      existing.url = discovery.url;
      existing.press.resolvedUrl = discovery.url;
    }
    return existing;
  }
  const item: PublicationRecord = {
    ...discovery,
    agencyId,
    pubIds: [discovery.pubId],
    discoveredAt: at,
    latestHash: null,
    versions: [],
    failures: { capture: 0, extraction: 0 },
    errors: { capture: null, extraction: null },
    lastError: null,
  };
  records.push(item);
  return item;
};

export const rememberPublications = (
  root: string,
  agencyId: string,
  items: PublicationDiscovery[],
  at: string,
): void => {
  if (items.length === 0) return;
  mutate(root, agencyId, (records) => {
    for (const item of items) discover(records, agencyId, item, at);
  });
};

export const recordCapture = (
  root: string,
  agencyId: string,
  discovery: PublicationDiscovery,
  capture: Omit<PublicationVersion, "drafts">,
  reconcileOnly = false,
): void => {
  mutate(root, agencyId, (records) => {
    const item = discover(records, agencyId, discovery, capture.capturedAt);
    const prior = item.versions.find(
      (version) => version.sha256 === capture.sha256,
    );
    const current = item.versions.find(
      (version) => version.sha256 === item.latestHash,
    );
    // Reconciliation can discover a newer saved capture, but cannot move backward.
    if (
      reconcileOnly &&
      current &&
      Date.parse(capture.capturedAt) <= Date.parse(current.capturedAt)
    ) {
      if (!prior) item.versions.push({ ...capture, drafts: [] });
      return;
    }
    if (prior) Object.assign(prior, capture);
    else item.versions.push({ ...capture, drafts: [] });
    item.latestHash = capture.sha256;
    if (
      reconcileOnly &&
      item.errors.capture &&
      Date.parse(item.errors.capture.at) > Date.parse(capture.capturedAt)
    )
      return;
    if (capture.attachmentFailures.length > 0) {
      item.errors.capture = {
        message: `Attachments unavailable: ${capture.attachmentFailures.join(", ")}`,
        at: capture.capturedAt,
      };
    } else item.errors.capture = null;
    refreshLastError(item);
  });
};

export const recordPublicationFailure = (
  root: string,
  agencyId: string,
  discovery: PublicationDiscovery,
  stage: "capture" | "extraction",
  message: string,
  at: string,
): void => {
  mutate(root, agencyId, (records) => {
    const item = discover(records, agencyId, discovery, at);
    item.failures[stage]++;
    item.errors[stage] = { message, at };
    refreshLastError(item);
  });
};

const hashDraft = (draft: InboxDraft): string =>
  createHash("sha256").update(JSON.stringify(draft)).digest("hex");

export const recordExtraction = (
  root: string,
  agencyId: string,
  pubId: string,
  sha256: string,
  draft: InboxDraft,
  at: string,
): void => {
  mutate(root, agencyId, (records) => {
    const item = records.find((entry) => entry.pubIds.includes(pubId));
    const version = item?.versions.find((entry) => entry.sha256 === sha256);
    if (!item || !version)
      throw new Error(
        `Missing capture in publication ledger: ${agencyId}/${pubId}`,
      );
    const prior = version.drafts.find(
      (entry) => entry.pollId === draft.poll.id && entry.race === draft.race,
    );
    const next = {
      ...prior,
      pollId: draft.poll.id,
      race: draft.race,
      extractedAt: at,
      draftHash: hashDraft(draft),
      refused: draft.refused.map((entry) => entry.field),
    };
    version.drafts = [
      ...version.drafts.filter((entry) => entry !== prior),
      next,
    ];
    item.errors.extraction = null;
    refreshLastError(item);
  });
};

/** Acceptance is the explicit review action; a later changed draft remains pending. */
export const recordAcceptance = (
  root: string,
  draft: InboxDraft,
  at: string,
  commitCorpus?: () => void,
): void => {
  const provenance = draft.poll.provenance;
  if (!provenance) {
    commitCorpus?.();
    return;
  }
  mutate(
    root,
    draft.poll.agencyId,
    (records) => {
      const item = records.find(
        (entry) => canonicalUrl(entry.url) === canonicalUrl(provenance.url),
      );
      const version = item?.versions.find(
        (entry) => entry.sha256 === provenance.sha256,
      );
      // Legacy hand-curated drafts may predate capture-ledger reconciliation.
      if (!version) return;
      const prior = version.drafts.find(
        (entry) => entry.pollId === draft.poll.id && entry.race === draft.race,
      );
      const draftHash = hashDraft(draft);
      const next = {
        ...prior,
        pollId: draft.poll.id,
        race: draft.race,
        extractedAt: prior?.extractedAt ?? at,
        draftHash,
        refused: draft.refused.map((entry) => entry.field),
        reviewedAt: at,
        acceptedAt: at,
        acceptedDraftHash: draftHash,
      };
      version.drafts = [
        ...version.drafts.filter((entry) => entry !== prior),
        next,
      ];
    },
    commitCorpus,
  );
};

/** Capture failures remain queued, including incomplete attachment downloads. */
export const pendingPublications = (
  root: string,
  agencyId: string,
): PublicationRecord[] =>
  readPublicationLedger(root, agencyId).filter((item) => {
    const latest = item.versions.find(
      (version) => version.sha256 === item.latestHash,
    );
    return (
      !latest ||
      latest.attachmentFailures.length > 0 ||
      item.errors.capture !== null
    );
  });
