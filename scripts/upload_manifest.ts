// CLI: read/write the ingest→publish handoff at state/upload/pending.json.
// The API lives in scripts/lib/upload-manifest.ts.
//
//   npx tsx scripts/upload_manifest.ts write --session <id> --commit <sha> \
//     --skills update-procurement,update-funds \
//     --paths myarea,data_map.json \
//     --cloud "npm run db:load:pg:cloud" --cloud "npm run db:load:tenders:pg:cloud"
//   npx tsx scripts/upload_manifest.ts show
//   npx tsx scripts/upload_manifest.ts done --session <publish session id>
//
// `write` MERGES into any pending manifest rather than replacing it — see
// mergeManifest's header for why that matters.

import path from "path";
import {
  clearPending,
  csv,
  HISTORY,
  mergeManifest,
  PENDING,
  readPending,
  writePending,
} from "./lib/upload-manifest";

const argv = process.argv.slice(2);
const sub = argv[0];

const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1) return argv[i + 1];
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
};

// Repeatable: --cloud "a" --cloud "b". Order is load-bearing on the cloud side
// (a loader that reads another's output must follow it), so it is preserved.
const repeated = (name: string): string[] =>
  argv.reduce<string[]>((acc, a, i) => {
    if (a === `--${name}` && argv[i + 1]) acc.push(argv[i + 1]);
    return acc;
  }, []);

const rel = (p: string): string => path.relative(process.cwd(), p);

switch (sub) {
  case "write": {
    const manifest = mergeManifest(readPending(), {
      session: flag("session") ?? readPending()?.session ?? "unknown",
      commit: flag("commit"),
      skills: csv(flag("skills")),
      paths: csv(flag("paths")),
      cloudCommands: repeated("cloud"),
      notes: flag("notes"),
    });
    writePending(manifest);
    console.log(
      `✓ upload manifest: ${manifest.skills.length} skill(s), ` +
        `${manifest.paths.length} bucket path(s), ` +
        `${manifest.cloudCommands.length} cloud command(s) → ${rel(PENDING)}`,
    );
    break;
  }
  case "show": {
    const m = readPending();
    if (!m) {
      console.log("No pending upload — nothing to publish.");
      break;
    }
    console.log(JSON.stringify(m, null, 2));
    break;
  }
  case "done": {
    const m = clearPending(flag("session") ?? "unknown");
    console.log(
      m
        ? `✓ published the manifest from ${m.session} → appended to ${rel(HISTORY)}`
        : "No pending upload to clear.",
    );
    break;
  }
  default:
    console.error(
      "usage: upload_manifest.ts write|show|done [--session --commit --skills --paths --cloud --notes]",
    );
    process.exit(2);
}
