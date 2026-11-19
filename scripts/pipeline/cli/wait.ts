// pnpm run pipeline:wait — block until a pipeline run finishes, for an agent
// that launched `pipeline:nightly` detached and has to wait hours for it.
//
// A single tool call is capped (10 min for Bash) and a Monitor watch expires
// on its own; an agent that sees "expired, no events" tends to end its turn
// with the run still going — which is how the 2026-11-19 nightly routine
// stopped half-way and needed a human "continue". This command is the loop
// body instead: it ALWAYS returns within --max-s with a definite answer, and
// the answer says what to do next.
//
//   pnpm run pipeline:wait [--session <id>] [--newer-than <ISO>] [--max-s 540]
//
//   --session     the session to wait for (default: logs/pipeline/LATEST)
//   --newer-than  only accept a LATEST session started at/after this time —
//                 pass the launch time, so a run that has not yet taken the
//                 lock is not confused with yesterday's finished one
//   --max-s       give up waiting after this many seconds (default 540, under
//                 the 600 s tool cap)
//
// Exit: 0 the run finished (its final line and report path are printed — the
// run's OWN exit code is in that line) · 75 still running: CALL AGAIN · 3 the
// run's process is gone without finishing (killed) · 2 bad arguments, or no
// session appeared in time.

import fs from "node:fs";
import path from "node:path";
import { REPO } from "../state";

const LOGS = path.join(REPO, "logs/pipeline");
const STILL_RUNNING = 75;

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const maxS = Number(opt("--max-s") ?? 540);
const newerThan = opt("--newer-than");
const newerMs = newerThan ? Date.parse(newerThan) : null;
if (!Number.isFinite(maxS) || maxS <= 0 || (newerThan && !newerMs)) {
  console.error(
    "pipeline:wait: usage [--session <id>] [--newer-than <ISO>] [--max-s <seconds>]",
  );
  process.exit(2);
}
const deadline = Date.now() + maxS * 1000;

/** 20261119T224050Z-906c → epoch ms. */
const sessionMs = (s: string): number => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(s);
  return m
    ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    : Number.NaN;
};

interface Status {
  pid: number;
  phase: string;
  updatedAt: string;
  current: {
    seq: number;
    id: string;
    elapsedS?: number;
    startedAt: string;
  } | null;
  counts: Record<string, number>;
}

const read = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const now = (): string => new Date().toISOString().slice(11, 19);

const pickSession = (): string | null => {
  const given = opt("--session");
  if (given) return given;
  try {
    const s = fs.readFileSync(path.join(LOGS, "LATEST"), "utf8").trim();
    if (newerMs !== null && !(sessionMs(s) >= newerMs - 1000)) return null;
    return s || null;
  } catch {
    return null;
  }
};

const lastLines = (file: string, n: number): string[] => {
  try {
    return fs.readFileSync(file, "utf8").trimEnd().split("\n").slice(-n);
  } catch {
    return [];
  }
};

const main = async (): Promise<number> => {
  let session = pickSession();
  while (!session && Date.now() < deadline) {
    await sleep(5000);
    session = pickSession();
  }
  if (!session) {
    console.log(
      `${now()} no run session appeared${newerThan ? ` newer than ${newerThan}` : ""} — check the launch output (another run may hold the lock: exit 3)`,
    );
    return 2;
  }
  const dir = path.join(LOGS, session);
  console.log(
    `${now()} waiting on ${session} · live log ${path.relative(REPO, dir)}/run.log`,
  );

  let lastPhase = "";
  let lastStep = "";
  let lastPrint = 0;
  for (;;) {
    const st = read<Status>(path.join(dir, "status.json"));
    if (st) {
      if (st.phase === "done") {
        for (const l of lastLines(path.join(dir, "run.log"), 4)) console.log(l);
        const report = path.join(
          REPO,
          "state/pipeline/runs",
          session,
          "report.md",
        );
        console.log(
          `FINISHED ${session} · report ${fs.existsSync(report) ? path.relative(REPO, report) : "(none written)"}`,
        );
        return 0;
      }
      if (!alive(st.pid)) {
        console.log(
          `DEAD ${session}: pid ${st.pid} is gone at phase "${st.phase}"${st.current ? `, during ${st.current.seq} ${st.current.id}` : ""} (last update ${st.updatedAt}) — the run was killed; no report. The next nightly names it.`,
        );
        return 3;
      }
      const step = st.current ? `${st.current.seq} ${st.current.id}` : "";
      if (
        st.phase !== lastPhase ||
        step !== lastStep ||
        Date.now() - lastPrint > 120_000
      ) {
        const el = st.current
          ? Math.round((Date.now() - Date.parse(st.current.startedAt)) / 1000)
          : 0;
        console.log(
          `${now()} phase ${st.phase}${step ? ` · step ${step} (${el}s)` : ""} · ${
            Object.entries(st.counts)
              .map(([k, v]) => `${v} ${k}`)
              .join(", ") || "no steps yet"
          }`,
        );
        lastPhase = st.phase;
        lastStep = step;
        lastPrint = Date.now();
      }
    }
    if (Date.now() >= deadline) {
      console.log(
        `STILL RUNNING ${session} — call \`pnpm run pipeline:wait --session ${session}\` again (do not end the turn, do not kill the run)`,
      );
      return STILL_RUNNING;
    }
    await sleep(10_000);
  }
};

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`pipeline:wait: ${e instanceof Error ? e.stack : String(e)}`);
    process.exit(2);
  },
);
