// A single-writer lock for the CR Deeds crawl. cr_deeds.sqlite is WAL (one writer),
// and the plan (§0.2) is explicit: never run two CR jobs against the one rate-limited
// host — concurrent crawlers fight over the SQLite writer AND throttle each other into
// the block that corrupted the 2026-07 founding run. A stale lock (the holder died) is
// reclaimed, so a killed crawl doesn't wedge the next one. Readers (the projection, the
// founding fold) do NOT take this lock — WAL reads are safe during a crawl.

import fs from "node:fs";

/** True when a process with this pid exists (EPERM = alive but not ours). */
export const isPidAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Acquire the crawl lock at `lockPath`, or throw if a LIVE crawl already holds it.
 * Returns a release fn (idempotent). A lock left by a dead process is reclaimed.
 */
export const acquireCrawlLock = (lockPath: string): (() => void) => {
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (pid !== process.pid && isPidAlive(pid))
      throw new Error(
        `another CR crawl is already running (pid ${pid}) — never run two; they ` +
          `fight over the SQLite writer and throttle the source. Wait for it, or ` +
          `if it is dead remove ${lockPath}.`,
      );
    // else: same pid, or a stale lock from a dead process → reclaim it.
  }
  fs.writeFileSync(lockPath, String(process.pid));

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      // Only remove OUR lock — never clobber a lock a later crawl has taken.
      if (
        fs.existsSync(lockPath) &&
        Number(fs.readFileSync(lockPath, "utf8").trim()) === process.pid
      )
        fs.unlinkSync(lockPath);
    } catch {
      /* best-effort cleanup */
    }
  };
};
