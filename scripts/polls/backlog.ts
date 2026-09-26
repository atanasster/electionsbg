import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  readPublicationLedger,
  type PublicationRecord,
} from "./lib/publication_ledger";

export const publicationStatus = (record: PublicationRecord): string => {
  if (record.errors.capture) return "capture_error";
  const latest = record.versions.find((v) => v.sha256 === record.latestHash);
  if (!latest) return "pending_capture";
  if (latest.attachmentFailures.length) return "incomplete_capture";
  const active = latest.drafts.filter(
    (d) => !latest.exclusions?.some((e) => e.race === d.race),
  );
  const excluded = latest.exclusions?.length ?? 0;
  if (excluded && !active.length) return "excluded";
  if (record.errors.extraction) return "extraction_error";
  if (!active.length) return "pending_extraction";
  if (active.every((d) => d.acceptedAt && d.acceptedDraftHash === d.draftHash))
    return excluded ? "reviewed" : "accepted";
  return "pending_review";
};

export const buildBacklog = (root: string) => {
  const directory = path.join(root, "state/polls");
  const agencies = fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter((f) => /^[A-Z]+\.json$/.test(f))
        .map((f) => f.slice(0, -5))
    : [];
  return agencies.flatMap((agency) =>
    readPublicationLedger(root, agency).map((record) => {
      const latest = record.versions.find(
        (v) => v.sha256 === record.latestHash,
      );
      return {
        agencyId: agency,
        publicationId: record.pubId,
        url: record.url,
        title: record.title,
        publishedAt: record.publishedAt,
        status: publicationStatus(record),
        error: record.lastError?.message ?? null,
        exclusions: latest?.exclusions ?? [],
        refused: latest?.drafts.flatMap((d) => d.refused) ?? [],
        drafts:
          latest?.drafts.map((d) => ({ id: d.pollId, race: d.race })) ?? [],
      };
    }),
  );
};
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  console.log(JSON.stringify(buildBacklog(root), null, 2));
}
