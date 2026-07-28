import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPidAlive, acquireCrawlLock } from "./crawl_lock";

let dir: string;
let lock: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-lock-"));
  lock = path.join(dir, "cr_deeds.sqlite.lock");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("isPidAlive", () => {
  it("reports our own process as alive", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
  it("reports a certainly-dead / invalid pid as not alive", () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(2 ** 30)).toBe(false); // no such process
  });
});

describe("acquireCrawlLock", () => {
  it("writes our pid and releases idempotently", () => {
    const release = acquireCrawlLock(lock);
    expect(Number(fs.readFileSync(lock, "utf8"))).toBe(process.pid);
    release();
    expect(fs.existsSync(lock)).toBe(false);
    expect(() => release()).not.toThrow(); // idempotent
  });

  it("refuses to start when a LIVE other process holds the lock", () => {
    // pid 1 (init) always exists → process.kill(1,0) gives EPERM = alive.
    fs.writeFileSync(lock, "1");
    expect(() => acquireCrawlLock(lock)).toThrow(/already running/);
  });

  it("reclaims a STALE lock left by a dead process", () => {
    fs.writeFileSync(lock, String(2 ** 30)); // dead pid
    const release = acquireCrawlLock(lock); // no throw — reclaimed
    expect(Number(fs.readFileSync(lock, "utf8"))).toBe(process.pid);
    release();
  });

  it("release does not clobber a lock a later crawl has taken", () => {
    const release = acquireCrawlLock(lock);
    fs.writeFileSync(lock, "1"); // simulate a different crawl taking over
    release(); // must NOT delete pid-1's lock
    expect(fs.existsSync(lock)).toBe(true);
    expect(fs.readFileSync(lock, "utf8")).toBe("1");
  });
});
