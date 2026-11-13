// One pipeline run at a time. Two runs writing data/ or Cloud SQL at once is
// the conflict the prose orchestrator avoided by running skills strictly in
// sequence; the lock makes the same promise across processes.
//
// The lock holds {pid, session, startedAt, procStart}. A lock whose pid is
// gone — or whose pid now belongs to a process that started at a different
// time (pid reuse) — is stale (a crashed or killed run) and is taken over,
// with the takeover reported, never silently.

import fs from "node:fs";
import path from "node:path";
import { LOCK_FILE, processStart, readLock } from "./doctor";

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

/** A takeover lock older than this was left by a runner that died mid-takeover. */
const TAKEOVER_STALE_MS = 30_000;

/** Create `file` holding `body`, atomically: written to a private temp file
 *  first and then hard-linked into place, so the lock never exists EMPTY (a
 *  reader could otherwise see a half-written lock and call it stale), and
 *  `link` fails with EEXIST when anyone else got there first. */
const createAtomic = (file: string, body: string): boolean => {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, body, { flag: "wx" });
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
};

const readRaw = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

export const acquireLock = (
  session: string,
  file: string = LOCK_FILE,
): Held => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = readLock(file);
  // Re-entrant within ONE process: nightly holds the lock across the watcher,
  // the ingest and the publish it starts, each acquiring under its own
  // session. A process runs its pipeline stages one after another, never two
  // at once, so the outer holder's release is the one that counts.
  if (prev?.alive && prev.pid === process.pid)
    return { session, release: () => {} };
  if (prev?.alive) throw new LockHeldError(prev.pid, prev.session);

  const body =
    JSON.stringify({
      pid: process.pid,
      session,
      startedAt: new Date().toISOString(),
      // Guards against pid reuse — see processStart().
      procStart: processStart(process.pid),
    }) + "\n";

  let won: boolean;
  if (!prev) won = createAtomic(file, body);
  else {
    // Stale takeover, serialised by a lock-of-the-lock created O_EXCL. A bare
    // rename/rm of the stale file is a race: of two runs that both saw it
    // stale, the slower one would move or delete the faster one's FRESH
    // lock, and both would then believe they hold it.
    const guard = `${file}.takeover`;
    let gotGuard = false;
    try {
      fs.writeFileSync(guard, String(process.pid), { flag: "wx" });
      gotGuard = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // A guard left by a runner that died mid-takeover: clear it, and let
      // this attempt lose — the caller re-runs into a clean state.
      try {
        if (Date.now() - fs.statSync(guard).mtimeMs > TAKEOVER_STALE_MS)
          fs.rmSync(guard, { force: true });
      } catch {
        // Gone already.
      }
    }
    if (!gotGuard) {
      const now = readLock(file);
      throw new LockHeldError(now?.pid ?? -1, now?.session ?? "taking over");
    }
    try {
      // Re-check UNDER the guard: someone may have taken it over already.
      const cur = readLock(file);
      if (cur?.alive) throw new LockHeldError(cur.pid, cur.session);
      if (cur) fs.rmSync(file, { force: true });
      won = createAtomic(file, body);
    } finally {
      fs.rmSync(guard, { force: true });
    }
  }
  if (!won) {
    const now = readLock(file);
    throw new LockHeldError(now?.pid ?? -1, now?.session ?? "unknown");
  }
  // Belt and braces: the file on disk must be OURS.
  if (readRaw(file) !== body) {
    const now = readLock(file);
    throw new LockHeldError(now?.pid ?? -1, now?.session ?? "unknown");
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    if (readRaw(file) === body) fs.rmSync(file, { force: true });
  };
  process.once("exit", release);
  return {
    session,
    release,
    tookOver: prev ? { pid: prev.pid, session: prev.session } : undefined,
  };
};
