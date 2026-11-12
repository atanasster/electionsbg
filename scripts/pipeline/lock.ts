// One pipeline run at a time. Two runs writing data/ or Cloud SQL at once is
// the conflict the prose orchestrator avoided by running skills strictly in
// sequence; the lock makes the same promise across processes.
//
// The lock holds {pid, session, startedAt}. A lock whose pid is gone is stale
// (a crashed or killed run) and is taken over — with the takeover reported,
// never silently.

import fs from "node:fs";
import path from "node:path";
import { LOCK_FILE, readLock } from "./doctor";

export interface Held {
  session: string;
  release: () => void;
  /** Set when a stale lock was taken over. */
  tookOver?: { pid: number; session: string };
}

export class LockHeldError extends Error {
  constructor(
    readonly pid: number,
    readonly session: string,
  ) {
    super(
      `another pipeline run holds the lock: session ${session} (pid ${pid})`,
    );
  }
}

export const acquireLock = (
  session: string,
  file: string = LOCK_FILE,
): Held => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = readLock(file);
  if (prev?.alive) throw new LockHeldError(prev.pid, prev.session);
  if (prev) {
    // Move the stale lock aside with an atomic rename. Of two runs that both
    // saw it stale, exactly one rename succeeds; the other gets ENOENT and
    // simply proceeds to the `wx` create below, which only one of them wins.
    // (A plain `rm` here would let the slower run delete the faster run's
    // FRESH lock.)
    try {
      fs.renameSync(file, `${file}.stale-${process.pid}`);
      fs.rmSync(`${file}.stale-${process.pid}`, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const body = JSON.stringify({
    pid: process.pid,
    session,
    startedAt: new Date().toISOString(),
  });
  try {
    fs.writeFileSync(file, body + "\n", { flag: "wx" });
  } catch (e) {
    // Only "it exists" means another run holds it; anything else (EACCES,
    // ENOSPC) is a real error and must say so.
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const now = readLock(file);
    throw new LockHeldError(now?.pid ?? -1, now?.session ?? "unknown");
  }
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    const cur = readLock(file);
    if (cur?.pid === process.pid) fs.rmSync(file, { force: true });
  };
  process.once("exit", release);
  return {
    session,
    release,
    tookOver: prev ? { pid: prev.pid, session: prev.session } : undefined,
  };
};
