// The structured result a step MAY hand back to the runner.
//
// The runner sets PIPELINE_RESULT_FILE for every step. A script that calls
// reportResult() writes its summary, counts and warnings there, and the run
// report quotes them verbatim — so a summary is the script's own words, never
// the runner's paraphrase of its stdout. Outside a pipeline run the call is a
// no-op, so adopting it changes nothing for a script run by hand.

import fs from "node:fs";

export interface StepResult {
  /** One line: what this run did. */
  summary?: string;
  /** Named counts the report renders as a table. */
  counts?: Record<string, number>;
  /** Did the step change data? `false` lets a gate tell "no-op" from "wrote". */
  changed?: boolean;
  warnings?: string[];
  /** Things the step deliberately did not do, and why. */
  skipped?: { what: string; why: string }[];
}

export const RESULT_ENV = "PIPELINE_RESULT_FILE";

/** Record (merge into) this step's result. Safe to call more than once. */
export const reportResult = (r: StepResult): void => {
  const file = process.env[RESULT_ENV];
  if (!file) return;
  let prev: StepResult = {};
  try {
    prev = readResult(file)?.result ?? {};
  } catch {
    // A previous malformed write is replaced, not merged.
  }
  const merged: StepResult = {
    ...prev,
    ...r,
    counts: { ...prev.counts, ...r.counts },
    warnings: [...(prev.warnings ?? []), ...(r.warnings ?? [])],
    skipped: [...(prev.skipped ?? []), ...(r.skipped ?? [])],
  };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
};

const isStr = (v: unknown): v is string => typeof v === "string";

/** Keep only well-typed fields; name every one dropped. A step that writes
 *  `{"warnings": 3}` must not crash the report renderer downstream. */
export const sanitizeResult = (
  raw: unknown,
): { result: StepResult; problems: string[] } => {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { result: {}, problems: ["not a JSON object"] };
  const r = raw as Record<string, unknown>;
  const out: StepResult = {};
  if (r.summary !== undefined)
    if (isStr(r.summary)) out.summary = r.summary;
    else problems.push("summary is not a string");
  if (r.changed !== undefined)
    if (typeof r.changed === "boolean") out.changed = r.changed;
    else problems.push("changed is not a boolean");
  if (r.counts !== undefined) {
    if (r.counts && typeof r.counts === "object" && !Array.isArray(r.counts)) {
      out.counts = {};
      for (const [k, v] of Object.entries(r.counts))
        if (typeof v === "number" && Number.isFinite(v)) out.counts[k] = v;
        else problems.push(`counts.${k} is not a finite number`);
    } else problems.push("counts is not an object");
  }
  if (r.warnings !== undefined)
    if (Array.isArray(r.warnings)) {
      out.warnings = r.warnings.filter(isStr);
      if (out.warnings.length !== r.warnings.length)
        problems.push("warnings holds a non-string");
    } else problems.push("warnings is not an array");
  if (r.skipped !== undefined)
    if (Array.isArray(r.skipped)) {
      out.skipped = r.skipped.filter(
        (x): x is { what: string; why: string } =>
          !!x &&
          typeof x === "object" &&
          isStr((x as Record<string, unknown>).what) &&
          isStr((x as Record<string, unknown>).why),
      );
      if (out.skipped.length !== r.skipped.length)
        problems.push("skipped holds an entry without string what/why");
    } else problems.push("skipped is not an array");
  return { result: out, problems };
};

/** Read and sanitize a result file; null when absent. Throws only on JSON
 *  that does not parse — the caller reports it, a bad result never fails a
 *  good step. */
export const readResult = (
  file: string,
): { result: StepResult; problems: string[] } | null => {
  if (!fs.existsSync(file)) return null;
  return sanitizeResult(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
};
