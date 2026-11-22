// Re-fingerprint a watch source through the Bulgarian-egress proxy, in a
// child process (proxy env is only honoured from process start).
// See scripts/lib/bg_egress.ts and CLAUDE.md "Bulgarian egress via the Mac mini".

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bgProxyEnv } from "../lib/bg_egress";
import type { Fingerprint } from "./types";

export const FINGERPRINT_MARK = "@@watch-fingerprint@@";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");

/** Pull the marked Fingerprint out of the child's stdout. */
export const parseFingerprintOutput = (stdout: string): Fingerprint | null => {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(FINGERPRINT_MARK));
  if (!line) return null;
  try {
    const fp = JSON.parse(line.slice(FINGERPRINT_MARK.length)) as Fingerprint;
    return typeof fp?.value === "string" && typeof fp?.detail === "string"
      ? fp
      : null;
  } catch {
    return null;
  }
};

export const fingerprintViaBgProxy = (
  sourceId: string,
  proxyUrl: string,
  timeoutMs = 300_000,
): Promise<Fingerprint> =>
  new Promise((resolve, reject) => {
    const tsx = path.join(REPO, "node_modules/.bin/tsx");
    const child = spawn(
      tsx,
      [path.join(REPO, "scripts/watch/fingerprint_one.ts"), sourceId],
      {
        cwd: REPO,
        env: { ...process.env, ...bgProxyEnv(proxyUrl) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.stderr.on("data", (b: Buffer) => (err += b.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`via BG proxy: timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const fp = parseFingerprintOutput(out);
      if (code === 0 && fp) return resolve(fp);
      const why =
        err
          .split("\n")
          .map((l) => l.trim())
          // Node's own "EnvHttpProxyAgent is experimental" notice names nothing.
          .filter((l) => l && !/UNDICI-EHPA|--trace-warnings/.test(l))
          .at(-1) ?? `exit ${code}`;
      reject(new Error(`via BG proxy: ${why}`));
    });
  });
