import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SITE_LISTERS, dirSlugFor, targetFromUrl } from "./lib/capture";
import { gallup } from "./agencies/gallup";
import type { AgencyLister, Publication } from "./agencies/types";
import {
  rememberPublications,
  readPublicationLedger,
  recordCapture,
} from "./lib/publication_ledger";
import { captureOne } from "./fetch";
import { flagReader } from "./lib/argv";
import { isRealIsoDate } from "../../src/data/polls/fieldwork";

export interface InventoryAgency {
  checkedAt: string;
  lastSuccessfulListing: string | null;
  listingComplete: boolean;
  error: string | null;
  publications: (Publication & {
    electoral: boolean;
    status: "excluded" | "pending" | "captured" | "incomplete";
    error: string | null;
  })[];
}
export interface PublicationInventory {
  after: string;
  before: string;
  agencies: Record<string, InventoryAgency>;
}

/** Reconcile saved evidence before discovery. Never advance processing merely
 * because a watcher has checked a publication. */
export const reconcileCaptures = (root: string, agencyId: string): void => {
  const dir = path.join(root, "raw_data/polls", dirSlugFor(agencyId));
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name, "SOURCE.json");
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const stamp = JSON.parse(fs.readFileSync(file, "utf8")) as {
      url: string;
      sha256: string;
      fetchedAt: string;
      title?: string;
      publishedAt?: string;
      attachmentFailures?: string[];
    };
    if (!stamp.url || !stamp.sha256 || !stamp.fetchedAt)
      throw new Error(`Invalid source stamp: ${file}`);
    recordCapture(
      root,
      agencyId,
      {
        pubId: entry.name.replace(/\.v\d+$/, ""),
        url: stamp.url,
        title: stamp.title ?? null,
        publishedAt: stamp.publishedAt ?? null,
      },
      {
        sha256: stamp.sha256,
        capturedAt: stamp.fetchedAt,
        capturePath: path.relative(root, path.dirname(file)),
        attachmentFailures: stamp.attachmentFailures ?? [],
      },
      true,
    );
  }
};

export const inventoryAgency = async (
  root: string,
  lister: AgencyLister,
  window: { after: string; before: string },
  previous?: InventoryAgency,
  capture?: (publication: Publication) => Promise<void>,
): Promise<InventoryAgency> => {
  const at = new Date().toISOString();
  try {
    reconcileCaptures(root, lister.agencyId);
    const publications = await lister.listPublications({
      ...window,
      archive: true,
    });
    const electoral = publications.filter(lister.isElectoral);
    rememberPublications(
      root,
      lister.agencyId,
      electoral.map((p) => ({
        pubId: String(p.id),
        url: p.url,
        title: p.title,
        publishedAt: p.publishedAt,
      })),
      at,
    );
    const captureErrors = new Map<number, string>();
    if (capture)
      for (const publication of electoral) {
        const record = readPublicationLedger(root, lister.agencyId).find((r) =>
          r.pubIds.includes(String(publication.id)),
        );
        const latest = record?.versions.find(
          (v) => v.sha256 === record.latestHash,
        );
        if (
          latest &&
          latest.attachmentFailures.length === 0 &&
          !record?.errors.capture
        )
          continue;
        try {
          await capture(publication);
        } catch (e) {
          captureErrors.set(
            publication.id,
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    const ledger = readPublicationLedger(root, lister.agencyId);
    return {
      checkedAt: at,
      lastSuccessfulListing: at,
      listingComplete: true,
      error: null,
      publications: publications.map((p) => {
        const eligible = lister.isElectoral(p);
        const record = ledger.find(
          (r) => r.pubIds.includes(String(p.id)) || r.url === p.url,
        );
        const latest = record?.versions.find(
          (v) => v.sha256 === record.latestHash,
        );
        const error =
          captureErrors.get(p.id) ?? record?.errors.capture?.message ?? null;
        return {
          ...p,
          electoral: eligible,
          status: !eligible
            ? "excluded"
            : error || latest?.attachmentFailures.length
              ? "incomplete"
              : latest
                ? "captured"
                : "pending",
          error,
        };
      }),
    };
  } catch (e) {
    return {
      checkedAt: at,
      lastSuccessfulListing: previous?.lastSuccessfulListing ?? null,
      listingComplete: false,
      error: e instanceof Error ? e.message : String(e),
      publications: previous?.publications ?? [],
    };
  }
};

export const main = async (argv: string[]): Promise<void> => {
  const flag = flagReader(argv);
  const after = flag("after");
  const before = flag("before");
  if (
    !after ||
    !before ||
    !isRealIsoDate(after) ||
    !isRealIsoDate(before) ||
    after > before
  )
    throw new Error(
      "Use --after YYYY-MM-DD --before YYYY-MM-DD [--agency ID] [--capture]",
    );
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const all: Record<string, AgencyLister> = { ...SITE_LISTERS, GIB: gallup };
  const agency = flag("agency");
  if (agency && !all[agency]) throw new Error(`Unknown site agency: ${agency}`);
  const file = path.join(
    root,
    "state/polls",
    `inventory-${after}-${before}.json`,
  );
  const result: PublicationInventory = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { after, before, agencies: {} };
  for (const lister of agency ? [all[agency]] : Object.values(all)) {
    result.agencies[lister.agencyId] = await inventoryAgency(
      root,
      lister,
      { after, before },
      result.agencies[lister.agencyId],
      argv.includes("--capture")
        ? async (publication) => {
            const target = targetFromUrl(lister.agencyId, publication.url);
            await captureOne(
              {
                ...target,
                pubId: String(publication.id),
                title: publication.title,
                publishedAt: publication.publishedAt,
              },
              false,
            );
          }
        : undefined,
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(result, null, 2) + "\n");
    fs.renameSync(file + ".tmp", file);
    const state = result.agencies[lister.agencyId];
    console.log(
      `${lister.agencyId}: ${state.listingComplete ? "listed" : "UNAVAILABLE"}, ${state.publications.length} publications, ${state.publications.filter((p) => p.status === "captured").length} captured${state.error ? ` — ${state.error}` : ""}`,
    );
  }
  if (
    Object.values(result.agencies).some(
      (a) =>
        !a.listingComplete ||
        a.publications.some((p) => p.status === "incomplete"),
    )
  )
    process.exitCode = 1;
};
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
