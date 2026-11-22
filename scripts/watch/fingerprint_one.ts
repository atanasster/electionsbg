// Fingerprint ONE watch source and print it as a marked JSON line.
//
//   tsx scripts/watch/fingerprint_one.ts <source-id>
//
// The watcher spawns this as a child with the BG-proxy env
// (scripts/lib/bg_egress.ts) when a source fails from the current exit —
// proxy settings are read at process start (NODE_USE_ENV_PROXY), so they
// cannot be switched on inside the running watcher. It writes NO state: the
// parent records the result exactly as it records a direct fingerprint.

import { SOURCES } from "./sources/index";
import { FINGERPRINT_MARK } from "./bg_fallback";

const id = process.argv[2];
const src = SOURCES.find((s) => s.id === id);

const finish = (code: number): void => {
  process.exitCode = code;
  // Same reason as index.ts: some sources leave a handle open; the output is
  // the whole point, so exit once stdout has drained.
  setTimeout(() => process.exit(code), 5_000).unref();
  process.stdout.write("", () => process.exit(code));
};

if (!src) {
  console.error(`unknown watch source: ${id ?? "(none given)"}`);
  finish(2);
} else {
  src.fingerprint().then(
    (fp) => {
      process.stdout.write(`\n${FINGERPRINT_MARK}${JSON.stringify(fp)}\n`);
      finish(0);
    },
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      finish(1);
    },
  );
}
