// Name the KIND of a step failure from its exit and its log tail.
// Plan: docs/plans/watch-pipeline-scripts-v1.md §2.7.
//
// The class decides three things a reader (human or LLM) would otherwise
// re-derive from the log every time: whether a retry can help, whether the
// failure holds the publish, and where to start looking. It is a hint with
// evidence attached — the matching line is returned, so a wrong class is
// visible in the report rather than trusted.
//
// Order matters: the first matching rule wins, so the specific shapes (a
// Postgres SQLSTATE, a canary) sit above the generic ones (a stack frame).

export type FailureClass =
  | "timeout"
  | "interrupted"
  | "egress"
  | "waf-blocked"
  | "proxy-down"
  | "db-local-down"
  | "db-auth"
  | "lock-timeout"
  | "statement-timeout"
  | "disk"
  | "upstream-shape"
  | "shrink-refused"
  | "gate-failed"
  | "missing-input"
  | "upstream-down"
  | "test-failed"
  | "code-bug"
  | "unknown";

export interface Classification {
  class: FailureClass;
  /** May one automatic retry help? Never true for a class a retry repeats. */
  retryable: boolean;
  /** One line: where to look first. */
  hint: string;
  /** The log line that matched, when a pattern decided it. */
  evidence?: string;
}

interface Rule {
  class: FailureClass;
  re: RegExp;
  retryable: boolean;
  hint: string;
}

/** A Postgres SQLSTATE in SQLSTATE context — `SQLSTATE 53400`, `code: '53400'`,
 *  `(53400)` — never a bare number: a NUMERIC code is also a row count
 *  ("loaded 53400 rows" must not read as a full disk and abort an ingest). */
const sqlstate = (code: string): string =>
  `(?:SQLSTATE\\s*[:=]?\\s*|\\bcode\\b["']?\\s*[:=]\\s*["']?|\\(\\s*)${code}\\b`;

/** What may follow an HTTP status in a fetcher's message: the end of the
 *  line, punctuation, or a word that continues an error sentence — never a
 *  count's unit ("returned 512 rows", "status 503 of 2000 pages"). */
const AFTER_HTTP_STATUS =
  "(?=\\s*(?:$|[:;,.)\\]—–-]|(?:for|from|on|at|when|while|error|Bad|Service|Internal|Gateway|Server)\\b|https?:))";

const RULES: readonly Rule[] = [
  {
    class: "proxy-down",
    re: /Connection terminated unexpectedly|127\.0\.0\.1:5434.*ECONNREFUSED|ECONNREFUSED 127\.0\.0\.1:5434/,
    retryable: false,
    hint: "The Cloud SQL proxy dropped — `nc -z 127.0.0.1 5434`, then `pnpm run db:proxy:cloud`; nothing committed, re-run the step.",
  },
  {
    class: "db-local-down",
    re: /ECONNREFUSED (127\.0\.0\.1|::1|localhost):5433|connect ECONNREFUSED.*5433/,
    retryable: false,
    hint: "Local Postgres is down — `pnpm run db:pg:up`.",
  },
  {
    class: "db-auth",
    re: /\b28P01\b|password authentication failed/,
    retryable: false,
    hint: "Wrong database credentials — usually a cloud DATABASE_URL leaked into a local step, or PGPASSFILE is not the repo's .pgpass.",
  },
  {
    class: "lock-timeout",
    re: /\b55P03\b|lock_timeout|could not obtain lock/,
    retryable: true,
    hint: "A reader or another loader held the lock — retry off-peak; see CLAUDE.md on stage-merge reloads.",
  },
  {
    class: "statement-timeout",
    re: new RegExp(
      `${sqlstate("57014")}|canceling statement due to statement timeout`,
    ),
    retryable: false,
    hint: "A query hit the statement timeout — EXPLAIN it against this database; retrying repeats it.",
  },
  {
    class: "disk",
    re: new RegExp(
      `${sqlstate("53100")}|${sqlstate("53400")}|ENOSPC|No space left on device|could not resize shared memory|temp_file_limit`,
    ),
    retryable: false,
    hint: "Out of disk, /dev/shm or temp_file_limit — `docker builder prune -af`, check the Docker VM disk, or slice the load.",
  },
  {
    class: "waf-blocked",
    re: /Request Rejected|cf-chl|challenge-platform|Just a moment\.\.\.|Attention Required! \| Cloudflare/,
    retryable: false,
    hint: "The upstream's WAF refused this client — see the source's runbook for the manual or curl path; retrying the same client does not help.",
  },
  {
    class: "egress",
    re: /ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|Connect Timeout Error|connect timeout/i,
    retryable: false,
    hint: "A connect timeout — usually the wrong exit country (parliament.bg/МО/ЦИК need non-BG, КЗК/АСП/ГИТ need BG); run `pnpm run pipeline:doctor`.",
  },
  {
    class: "shrink-refused",
    re: /[Rr]efus\w* to (?:shrink|prune)|[Ww]ould shrink|--allow-shrink|\bSHRINK\b/,
    retryable: false,
    hint: "A shrink guard refused the write — find out why the source shrank before passing --allow-shrink.",
  },
  {
    class: "upstream-shape",
    re: /canary (?:mismatch|failed|check failed)|canary\b.*\b(?:expected|got)\b|Unrecogni[sz]ed\w*Error|header not found|unexpected (?:layout|format|column)|schema (?:changed|mismatch)/i,
    retryable: false,
    hint: "The upstream changed shape — fix the parser and re-seed its fixture; re-seed a canary only on a CONFIRMED upstream change.",
  },
  {
    class: "missing-input",
    re: /ENOENT[^\n]*\b(?:raw_data|_cache)\/|no such file or directory[^\n]*\b(?:raw_data|_cache)\/|not found in raw_data|missing input|skip(?:ping)?[^\n]{0,40}(?:absent|missing)/i,
    retryable: false,
    hint: "An input file is missing — check the handler's operator step (a manual download?) before re-running.",
  },
  {
    class: "upstream-down",
    re: new RegExp(
      `\\b(502|503|504)\\b.*(Bad Gateway|Service Unavailable|Gateway Timeout)|HTTP\\/?[\\d.]*\\s+5\\d\\d\\b|\\b(?:returned|status(?: code)?:?|responded with)\\s+5\\d\\d\\b${AFTER_HTTP_STATUS}|\\b500 Internal Server Error|ECONNRESET|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed`,
      "i",
    ),
    retryable: true,
    hint: "The upstream is down or flaky — one retry later; persistent failure means a moved endpoint.",
  },
  {
    class: "test-failed",
    re: /Test Files\s+\d+ failed|Tests\s+\d+ failed|AssertionError|FAIL\s+\|/,
    retryable: false,
    hint: "A test or data gate failed — re-run the red file alone first (data gates are flaky under load), then read its assertion message.",
  },
  {
    class: "code-bug",
    re: /\b(TypeError|ReferenceError|SyntaxError|RangeError):|Cannot find module|ERR_MODULE_NOT_FOUND/,
    retryable: false,
    hint: "A code error in the script — the stack's first frame under scripts/ is where to look.",
  },
];

/** Vitest's own failure markers: its summary, or a ` FAIL  <file>.test.ts` header. */
const VITEST_FAILED =
  /^.*Test Files\s+\d+ failed.*$|^\s*FAIL\s+(?:\|[^|]+\|\s+)?\S+\.test\.tsx?\b.*$/m;

const GATE: Omit<Classification, "evidence"> = {
  class: "gate-failed",
  retryable: false,
  hint: "A declared gate failed — compare its expected and observed values in the report.",
};

/** Classify a failed step. `tail` is the last lines of its combined output. */
export const classify = (input: {
  exitCode: number | null;
  timedOut: boolean;
  tail: string;
  gate?: boolean;
  /** The step's database pin. "Connection terminated unexpectedly" names no
   *  host: under a `local` pin it is the docker Postgres that dropped, not
   *  the Cloud SQL proxy — and the two need opposite fixes. */
  db?: "local" | "cloud" | "inherit";
}): Classification => {
  if (input.timedOut)
    return {
      class: "timeout",
      retryable: false,
      hint: "The step exceeded its timeout and was killed — check whether it hung (no output for a long stretch) or is just slower than its budget.",
    };
  if (input.gate) return { ...GATE };
  // A vitest failure anywhere in the tail decides the class, whatever line
  // came after it: a harmless trailing line ("skipping cleanup: dir
  // missing") must not turn a red suite into missing-input — test-failed is
  // what enables the solo re-run of red files.
  const vitest = input.tail.match(VITEST_FAILED);
  if (vitest) {
    const rule = RULES.find((r) => r.class === "test-failed")!;
    return {
      class: rule.class,
      retryable: rule.retryable,
      hint: rule.hint,
      evidence: vitest[0].trim().slice(0, 400),
    };
  }
  // Lines newest-first, rules in priority order WITHIN a line: the last error
  // printed is usually the cause, and an earlier transient warning should not
  // decide the class. Rule order only breaks a tie on the same line.
  const lines = input.tail.split("\n").reverse();
  for (const line of lines)
    for (const rule of RULES)
      if (rule.re.test(line)) {
        if (
          rule.class === "proxy-down" &&
          input.db === "local" &&
          /Connection terminated unexpectedly/.test(line) &&
          !/5434/.test(line)
        ) {
          const local = RULES.find((r) => r.class === "db-local-down")!;
          return {
            class: local.class,
            retryable: local.retryable,
            hint: `${local.hint} The step is pinned to the local database, so this dropped connection was the docker Postgres (restarted, OOM-killed, or its container removed) — \`docker ps -a | grep electionsbg-pg\`.`,
            evidence: line.trim().slice(0, 300),
          };
        }
        return {
          class: rule.class,
          retryable: rule.retryable,
          hint: rule.hint,
          evidence: line.trim().slice(0, 400),
        };
      }
  return {
    class: "unknown",
    retryable: false,
    hint:
      input.exitCode === null
        ? "Killed by a signal with no recognisable error — read the full log."
        : `Exit ${input.exitCode} with no recognisable error — read the full log.`,
  };
};

/** The most informative single line of a log: the last line that looks like an
 *  error, else the last non-empty line. */
export const firstErrorLine = (tail: string): string | undefined => {
  const lines = tail
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // pnpm's own epilogue ("ELIFECYCLE Command failed with exit code 1") is on
  // nearly every failed `pnpm run` and names nothing — skip it.
  const own = lines.filter(
    (l) => !/ELIFECYCLE|ERR_PNPM_|Command failed with exit code/.test(l),
  );
  const err = [...own]
    .reverse()
    .find((l) =>
      /error|fail|refus|✗|exception|cannot|denied|timed? ?out/i.test(l),
    );
  return (err ?? own.at(-1) ?? lines.at(-1))?.slice(0, 400);
};
