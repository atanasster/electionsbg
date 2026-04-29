// Prebuild step: remove dist/ before vite emits a fresh build.
//
// On macOS, fs.rmSync occasionally races with Spotlight / Finder / vite-preview
// holding handles inside dist and fails with ENOTEMPTY. The fix is to rename
// dist out of the way first (atomic) so the new build can start in a clean
// tree, then delete the renamed copies in a detached background process so
// the rest of the build pipeline isn't blocked on rm.
//
// Also sweeps any orphaned `dist.old-*` directories left by previous crashed
// or interrupted runs — without this, leftovers can accumulate to many GB.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT = path.resolve(".");
const DIST = path.join(PROJECT, "dist");

// Move the active dist/ aside so vite has a clean target to write to.
const toDelete = [];
if (fs.existsSync(DIST)) {
  const staged = `${DIST}.old-${Date.now()}`;
  fs.renameSync(DIST, staged);
  toDelete.push(staged);
}

// Sweep orphans from earlier interrupted runs.
for (const entry of fs.readdirSync(PROJECT)) {
  if (entry.startsWith("dist.old-")) {
    const full = path.join(PROJECT, entry);
    if (!toDelete.includes(full)) toDelete.push(full);
  }
}

if (toDelete.length === 0) process.exit(0);

// Spawn a detached child that outlives this script. The child process re-
// parents to init (PID 1) so it survives the npm script chain finishing,
// and the OS reaps it when it exits. We can't await its completion (that
// would block the build) — but a build that comes through here *next* will
// re-sweep any directories the child failed to finish, so leftovers are
// always cleaned up at most one build later.
const child = spawn(
  process.execPath,
  [
    "-e",
    `
      const fs = require('node:fs');
      const targets = ${JSON.stringify(toDelete)};
      for (const t of targets) {
        // maxRetries here handles transient ENOTEMPTY without us writing
        // our own retry loop; each fs.rmSync retry waits retryDelay ms
        // and we give it 30 chances which is far more than the original
        // setTimeout-based version had.
        try {
          fs.rmSync(t, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
        } catch (e) {
          // Last-resort: leave it on disk for the next build's sweep.
          // Print so the user can see why their dist tree might still
          // contain orphans.
          process.stderr.write('prebuild cleanup failed for ' + t + ': ' + e.message + '\\n');
        }
      }
    `,
  ],
  { detached: true, stdio: "ignore" },
);
child.unref();
