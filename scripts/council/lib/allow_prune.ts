// `--allow-prune` argv parsing for scripts/council/rebuild_shards.ts.
//
// It lives in lib/ rather than beside the CLI because `rebuild_shards.ts` calls
// `main()` at module scope: importing that file to test the parser EXECUTES a
// repair against the real data/council/ tree. (Measured — the import ran, and
// only lost the race with vitest's worker teardown.) A pure module has no such
// hazard, and this is also the one piece of the CLI with a rule worth pinning.

/**
 * `--allow-prune` → true (corpus-wide), `--allow-prune=A,B` → a scoped Set,
 * absent → false.
 *
 * ⚠️ An `=` with nothing usable after it is the EMPTY SET, never the bare flag.
 * A shell that ate the value — `--allow-prune=$CODES` with CODES unset — would
 * otherwise silently widen a one-município override to the whole corpus, which
 * is precisely the guard-disable the scoped form exists to avoid.
 */
export const parseAllowPrune = (argv: string[]): boolean | Set<string> => {
  const flag = argv.find(
    (a) => a === "--allow-prune" || a.startsWith("--allow-prune="),
  );
  if (!flag) return false;
  if (!flag.includes("=")) return true;
  return new Set(
    flag
      .slice("--allow-prune=".length)
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
};
