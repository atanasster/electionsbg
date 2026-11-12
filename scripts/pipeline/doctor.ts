// Preflight: which of the registry's needs this machine can meet right now.
// Plan: docs/plans/watch-pipeline-scripts-v1.md §2.9.
//
// Every one of these used to be discovered by FAILING half-way through a run:
// the 2026-11-12 session died at its first step because parliament.bg timed
// out behind a Bulgarian VPN exit, and a dead Cloud SQL proxy reads as
// "Connection terminated unexpectedly" mid-load. Checking up front lets the
// planner mark the affected handlers `blocked` with the reason, and run the rest.
//
// Split in two so the rules are testable: gatherFacts() touches the machine,
// evaluate() is pure.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Need } from "./registry";
import {
  PENDING as UPLOAD_PENDING,
  readPending,
  type UploadManifest,
} from "../lib/upload-manifest";
import { PIPELINE_STATE_DIR, REPO } from "./state";

export const LOCK_FILE = path.join(PIPELINE_STATE_DIR, "lock");

export interface Facts {
  /** ISO-3166 alpha-2 of the exit IP, or null when the lookup failed. */
  country: string | null;
  countryError?: string;
  pgLocal: boolean;
  proxy: boolean;
  /** Where raw_data/prices points, and whether that target exists. */
  pricesTarget: string | null;
  pricesMounted: boolean;
  trState: boolean;
  bins: Record<string, boolean>;
  geminiKey: boolean;
  /** A display a headed browser can open on. */
  display: boolean;
  git: {
    /** null when git itself failed; "HEAD" on a detached head. */
    branch: string | null;
    /** rebase / merge / cherry-pick in progress */
    midOperation: string | null;
    /** Tracked files under data/ with uncommitted changes. */
    dirtyUnderData: number;
  };
  lock: { pid: number; session: string; alive: boolean } | null;
  /** null = no manifest on disk. */
  pendingManifest: PendingManifestFact | null;
  /** `df` of the Postgres container's /dev/shm, MB, or null when unknown. */
  shmMb: number | null;
}

export type PendingManifestFact =
  | { ageH: number }
  /** On disk, but unreadable or undatable — never reported as fresh. */
  | { problem: string };

/** Age of a pending manifest, or why it cannot be dated. `null` input means
 *  the file exists but did not parse. */
export const pendingManifestFact = (
  m: UploadManifest | null,
  now: Date,
): PendingManifestFact => {
  if (m === null)
    return { problem: "state/upload/pending.json does not parse" };
  const t = Date.parse(m.createdAt ?? "");
  if (Number.isNaN(t))
    return { problem: "state/upload/pending.json has no valid createdAt" };
  return { ageH: (now.getTime() - t) / 3_600_000 };
};

/** Whether a `.env` file's text sets a non-empty GEMINI_API_KEY. Tolerates
 *  `export`, spaces round `=` and quotes; an empty or `""` value is unset. */
export const envSetsKey = (text: string, key = "GEMINI_API_KEY"): boolean => {
  const re = new RegExp(
    `^\\s*(?:export\\s+)?${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s#]*))`,
    "m",
  );
  const m = text.match(re);
  return Boolean(m && (m[1] ?? m[2] ?? m[3] ?? "").trim());
};

/** `git status --porcelain` → count of TRACKED files with changes. */
export const countTrackedChanges = (porcelain: string): number =>
  porcelain.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("??"))
    .length;

export type Severity = "need" | "info";

export interface Check {
  id: string;
  ok: boolean;
  severity: Severity;
  detail: string;
  /** The registry need this check decides, when it decides one. */
  need?: Need;
}

export interface DoctorResult {
  checkedAt: string;
  checks: Check[];
  /** need → why it is unmet. The planner's `unmet` input. */
  unmet: Map<Need, string>;
}

/** Exit IPs this pipeline is happy with: the registry's two egress needs are
 *  the only thing country decides. */
const BG = "BG";
const MIN_SHM_MB = 256;
const STALE_MANIFEST_H = 48;

export const evaluate = (f: Facts, now: Date): DoctorResult => {
  const checks: Check[] = [];
  const add = (c: Check): void => {
    checks.push(c);
  };

  const where = f.country ?? `unknown (${f.countryError ?? "lookup failed"})`;
  add({
    id: "egress:bg",
    need: "egress:bg",
    severity: "need",
    ok: f.country === BG,
    detail: `exit IP country ${where}; КЗК, АСП and ГИТ answer only a Bulgarian exit`,
  });
  add({
    id: "egress:non-bg",
    need: "egress:non-bg",
    severity: "need",
    ok: f.country !== null && f.country !== BG,
    detail: `exit IP country ${where}; parliament.bg, МО and ЦИК time out behind a Bulgarian exit`,
  });
  add({
    id: "pg-local",
    need: "pg-local",
    severity: "need",
    ok: f.pgLocal,
    detail: f.pgLocal
      ? "docker Postgres answers on 127.0.0.1:5433"
      : "nothing listens on 127.0.0.1:5433 — start it with `pnpm run db:pg:up`",
  });
  add({
    id: "headed",
    need: "headed",
    severity: "need",
    ok: f.display,
    detail: f.display
      ? "a display is available for headed Playwright"
      : "no display (SSH session or no DISPLAY) — headed crawls cannot open",
  });
  add({
    id: "drive:prices",
    need: "drive:prices",
    severity: "need",
    ok: f.pricesMounted,
    detail: f.pricesMounted
      ? `raw_data/prices → ${f.pricesTarget}`
      : `raw_data/prices → ${f.pricesTarget ?? "(missing)"} is not reachable — mount the external drive`,
  });
  add({
    id: "tr-state",
    need: "tr-state",
    severity: "need",
    ok: f.trState,
    detail: f.trState
      ? "raw_data/tr/state.sqlite present"
      : "raw_data/tr/state.sqlite missing — run `pnpm run tr:daily-refresh` first",
  });
  for (const bin of ["pdftotext", "unzip"] as const)
    add({
      id: `bin:${bin}`,
      need: `bin:${bin}`,
      severity: "need",
      ok: f.bins[bin] ?? false,
      detail: f.bins[bin] ? `${bin} on PATH` : `${bin} not on PATH`,
    });
  add({
    id: "gemini",
    need: "gemini",
    severity: "need",
    ok: f.geminiKey,
    detail: f.geminiKey
      ? "GEMINI_API_KEY is set"
      : "GEMINI_API_KEY is not set (env or .env.local)",
  });

  // Not needs of any handler — they decide the publish half or warn.
  add({
    id: "proxy",
    need: "proxy",
    severity: "need",
    ok: f.proxy,
    detail: f.proxy
      ? "Cloud SQL proxy answers on 127.0.0.1:5434"
      : "Cloud SQL proxy is down — a publish needs `pnpm run db:proxy:cloud`",
  });
  add({
    id: "bin:gsutil",
    severity: "info",
    ok: f.bins.gsutil ?? false,
    detail: f.bins.gsutil
      ? "gsutil on PATH"
      : "gsutil not on PATH — bucket publish cannot run",
  });
  add({
    id: "git",
    severity: "info",
    ok: f.git.branch === "main" && f.git.midOperation === null,
    detail:
      f.git.midOperation !== null
        ? `a ${f.git.midOperation} is in progress — commits would land inside it`
        : `on ${
            f.git.branch === null
              ? "(git failed)"
              : f.git.branch === "HEAD"
                ? "a detached HEAD"
                : f.git.branch
          }; ${f.git.dirtyUnderData} tracked file(s) under data/ with uncommitted changes`,
  });
  add({
    id: "lock",
    severity: "info",
    ok: f.lock === null || !f.lock.alive,
    detail:
      f.lock === null
        ? "no pipeline run holds the lock"
        : f.lock.alive
          ? `session ${f.lock.session} (pid ${f.lock.pid}) is running`
          : `stale lock from session ${f.lock.session} (pid ${f.lock.pid} is gone) — a runner will take it over`,
  });
  add({
    id: "pending-manifest",
    severity: "info",
    ok:
      f.pendingManifest === null ||
      ("ageH" in f.pendingManifest &&
        f.pendingManifest.ageH < STALE_MANIFEST_H),
    detail:
      f.pendingManifest === null
        ? "no unpublished manifest"
        : "problem" in f.pendingManifest
          ? `${f.pendingManifest.problem} — fix it before a publish reads it`
          : `an unpublished manifest is ${Math.round(f.pendingManifest.ageH)} h old`,
  });
  add({
    id: "pg-shm",
    severity: "info",
    ok: f.shmMb === null || f.shmMb >= MIN_SHM_MB,
    detail:
      f.shmMb === null
        ? "Postgres /dev/shm size unknown"
        : `Postgres /dev/shm is ${f.shmMb} MB${f.shmMb < MIN_SHM_MB ? " — parallel queries fail under test:data load; recreate the container" : ""}`,
  });

  const unmet = new Map<Need, string>();
  for (const c of checks) if (c.need && !c.ok) unmet.set(c.need, c.detail);
  return { checkedAt: now.toISOString(), checks, unmet };
};

// ---------------------------------------------------------------- gathering

export const portOpen = (port: number, timeoutMs = 1500): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean): void => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });

const onPath = (bin: string): boolean => {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Country of the exit IP from Cloudflare's trace endpoint — no account, no
 *  identifying data sent, one `loc=XX` line back. */
export const parseCfTrace = (body: string): string | null =>
  body.match(/^loc=([A-Z]{2})$/m)?.[1] ?? null;

export const lookupCountry = async (): Promise<{
  country: string | null;
  error?: string;
}> => {
  try {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { country: null, error: `HTTP ${res.status}` };
    const country = parseCfTrace(await res.text());
    return country ? { country } : { country: null, error: "no loc= line" };
  } catch (e) {
    return { country: null, error: e instanceof Error ? e.message : String(e) };
  }
};

const git = (...args: string[]): string | null => {
  try {
    return execFileSync("git", args, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
};

const midOperation = (): string | null => {
  const gitDir = git("rev-parse", "--git-dir");
  if (!gitDir) return null;
  const abs = path.resolve(REPO, gitDir);
  for (const [file, name] of [
    ["rebase-merge", "rebase"],
    ["rebase-apply", "rebase"],
    ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
  ] as const)
    if (fs.existsSync(path.join(abs, file))) return name;
  return null;
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists, we just may not signal it.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const readLock = (
  file: string = LOCK_FILE,
): { pid: number; session: string; alive: boolean } | null => {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      pid?: unknown;
      session?: unknown;
    };
    const pid = typeof raw.pid === "number" ? raw.pid : -1;
    return {
      pid,
      session: typeof raw.session === "string" ? raw.session : "unknown",
      alive: pid > 0 && pidAlive(pid),
    };
  } catch {
    return { pid: -1, session: "unreadable lock file", alive: false };
  }
};

const geminiKey = (): boolean => {
  if (process.env.GEMINI_API_KEY?.trim()) return true;
  const env = path.join(REPO, ".env.local");
  return fs.existsSync(env) && envSetsKey(fs.readFileSync(env, "utf8"));
};

/** macOS: only a process inside the logged-in GUI session ("Aqua") can open a
 *  headed browser — a LaunchDaemon or an SSH login is "System"/"Background". */
const macGuiSession = (): boolean => {
  if (process.env.SSH_CONNECTION) return false;
  try {
    return (
      execFileSync("launchctl", ["managername"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim() === "Aqua"
    );
  } catch {
    return false;
  }
};

const shmMb = (): number | null => {
  try {
    const out = execFileSync(
      "docker",
      ["exec", "electionsbg-pg", "df", "-m", "/dev/shm"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    );
    const n = Number(out.trim().split("\n").pop()?.split(/\s+/)[1]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

export const gatherFacts = async (now: Date): Promise<Facts> => {
  const [{ country, error }, pgLocal, proxy] = await Promise.all([
    lookupCountry(),
    portOpen(5433),
    portOpen(5434),
  ]);
  const pricesLink = path.join(REPO, "raw_data/prices");
  let pricesTarget: string | null = null;
  try {
    pricesTarget = fs.lstatSync(pricesLink).isSymbolicLink()
      ? fs.readlinkSync(pricesLink)
      : pricesLink;
  } catch {
    pricesTarget = null;
  }
  const status = git("status", "--porcelain", "--", "data");
  const pendingManifest = fs.existsSync(UPLOAD_PENDING)
    ? pendingManifestFact(readPending(), now)
    : null;
  return {
    country,
    countryError: error,
    pgLocal,
    proxy,
    pricesTarget,
    pricesMounted: fs.existsSync(pricesLink), // follows the symlink
    trState: fs.existsSync(path.join(REPO, "raw_data/tr/state.sqlite")),
    bins: Object.fromEntries(
      ["pdftotext", "unzip", "gsutil"].map((b) => [b, onPath(b)]),
    ),
    geminiKey: geminiKey(),
    display:
      process.platform === "darwin"
        ? macGuiSession()
        : Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
    git: {
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      midOperation: midOperation(),
      dirtyUnderData: status ? countTrackedChanges(status) : 0,
    },
    lock: readLock(),
    pendingManifest,
    shmMb: pgLocal ? shmMb() : null,
  };
};

export const runDoctor = async (now = new Date()): Promise<DoctorResult> =>
  evaluate(await gatherFacts(now), now);

export const renderDoctor = (r: DoctorResult): string => {
  const lines = [`# Pipeline doctor — ${r.checkedAt}`];
  for (const c of r.checks)
    lines.push(
      `${c.ok ? "ok  " : c.severity === "need" ? "FAIL" : "warn"} ${c.id.padEnd(17)} ${c.detail}`,
    );
  lines.push(
    r.unmet.size
      ? `\n${r.unmet.size} need(s) unmet: ${[...r.unmet.keys()].join(", ")} — handlers needing them will be planned as blocked.`
      : "\nAll needs met.",
  );
  return lines.join("\n") + "\n";
};
