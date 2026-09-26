import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";

const readOwner = (file: string): string | null => {
  try {
    return fs.readlinkSync(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    // The pre-ownership writer locked with mkdir; its directory names no owner to check.
    if (code === "EINVAL")
      throw new Error(
        `Ledger lock ${file} predates owner records; remove it once no polls writer is running`,
      );
    throw error;
  }
};
const deadOwner = (owner: string): boolean => {
  const [host, pidText] = owner.split("|");
  const pid = Number(pidText);
  if (host !== os.hostname() || !Number.isInteger(pid) || pid <= 0)
    return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
};

/** Atomic ownership; a recovery lock serializes checks before removing a dead owner. */
export const acquireLedgerLock = (file: string, depth = 0): (() => void) => {
  if (depth > 8)
    throw new Error(`Too many interrupted lock recoveries: ${file}`);
  const owner = `${os.hostname()}|${process.pid}|${randomUUID()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // A symlink publishes ownership atomically, without an empty-owner window.
      fs.symlinkSync(owner, file);
      return () => {
        if (readOwner(file) === owner) fs.unlinkSync(file);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const previous = readOwner(file);
    if (previous === null) continue;
    if (!deadOwner(previous))
      throw new Error(`Ledger writer is active: ${file}`);
    const releaseRecovery = acquireLedgerLock(`${file}.recovery`, depth + 1);
    try {
      // Other recoverers cannot replace this owner between this check and unlink.
      if (readOwner(file) === previous && deadOwner(previous))
        fs.unlinkSync(file);
    } finally {
      releaseRecovery();
    }
  }
  throw new Error(`Ledger lock changed repeatedly; retry: ${file}`);
};
