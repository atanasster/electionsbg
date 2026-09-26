// Record a reviewed exclusion on a captured publication so the durable queue can finish.
//
//   npm run polls:exclude -- --agency AR --pub 912 --race presidential --reason "Round-two exit poll"
//   npm run polls:exclude -- --from-reconciliation     # migrate state/polls/historical-reconciliation.json
//
// An exclusion binds to the publication's CURRENT source hash and one race. A
// changed source reopens review; excluding one race leaves the other's work pending.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flagReader } from "./lib/argv";
import type { InboxDraft } from "./lib/draft";
import {
  readPublicationLedger,
  recordExclusion,
} from "./lib/publication_ledger";

type Race = InboxDraft["race"];
const RACES: readonly Race[] = ["parliamentary", "presidential"];

interface ReconciledPublication {
  agencyId: string;
  pubId: string;
  status: string;
  reason: string;
}

/**
 * Which races a reviewed reconciliation status resolves. `excluded` means the
 * publication is not a pre-election survey at all (exit poll, retrospective,
 * statement), so neither race has anything to accept. `other_race` and
 * `other_question` were reviewed for the PRESIDENTIAL race only — any
 * parliamentary draft stays pending for its own review. `missing_metadata`
 * and `accepted` need no exclusion.
 */
export const reconciledRaces = (status: string): Race[] => {
  if (status === "excluded") return [...RACES];
  if (status === "other_race" || status === "other_question")
    return ["presidential"];
  return [];
};

const excludeOne = (
  root: string,
  agencyId: string,
  pubId: string,
  race: Race,
  reason: string,
  at: string,
): "recorded" | "unchanged" | "missing" | "accepted" => {
  const record = readPublicationLedger(root, agencyId).find((r) =>
    r.pubIds.includes(pubId),
  );
  const version = record?.versions.find((v) => v.sha256 === record.latestHash);
  if (!record || !version) return "missing";
  const prior = version.exclusions?.find((e) => e.race === race);
  if (prior?.reason === reason) return "unchanged";
  if (version.drafts.some((d) => d.race === race && d.acceptedAt))
    return "accepted";
  recordExclusion(root, agencyId, pubId, version.sha256, race, reason, at);
  return "recorded";
};

export const applyReconciliation = (root: string) => {
  const file = path.join(root, "state/polls/historical-reconciliation.json");
  const reconciliation = JSON.parse(fs.readFileSync(file, "utf8")) as {
    reviewedAt: string;
    publications: ReconciledPublication[];
  };
  const tally: Record<string, number> = {};
  const problems: string[] = [];
  for (const p of reconciliation.publications)
    for (const race of reconciledRaces(p.status)) {
      const outcome = excludeOne(
        root,
        p.agencyId,
        p.pubId,
        race,
        p.reason,
        reconciliation.reviewedAt,
      );
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      if (outcome === "missing" || outcome === "accepted")
        problems.push(`${p.agencyId}/${p.pubId}/${race}: ${outcome}`);
    }
  return { tally, problems };
};

export const main = (argv: string[], root: string): void => {
  if (argv.includes("--from-reconciliation")) {
    const { tally, problems } = applyReconciliation(root);
    console.log(JSON.stringify(tally));
    for (const p of problems) console.warn(`  not excluded — ${p}`);
    return;
  }
  const flag = flagReader(argv);
  const agency = flag("agency");
  const pub = flag("pub");
  const race = flag("race") as Race | undefined;
  const reason = flag("reason");
  if (!agency || !pub || !race || !RACES.includes(race) || !reason?.trim()) {
    console.error(
      "usage: polls:exclude -- --agency <ID> --pub <pubId> --race parliamentary|presidential --reason <text>",
    );
    process.exitCode = 1;
    return;
  }
  const outcome = excludeOne(
    root,
    agency,
    pub,
    race,
    reason,
    new Date().toISOString().slice(0, 10),
  );
  if (outcome === "missing" || outcome === "accepted") {
    console.error(
      outcome === "missing"
        ? `${agency}/${pub}: no captured version in the ledger — capture it first`
        : `${agency}/${pub}/${race}: already accepted — correct the corpus instead of excluding`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${agency}/${pub}/${race}: ${outcome}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(
    process.argv.slice(2),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  );
