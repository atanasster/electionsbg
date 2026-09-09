// Shared `--flag value` reader for every polls/* CLI (fetch/extract/accept/
// restamp/crosscheck) — one definition rather than five near-identical
// private copies that had drifted into existing independently in each file.

/** Bind `argv` once, then read any number of flags off it. Returns
 *  `undefined` for a flag that is absent, trailing with no value, or
 *  immediately followed by another `--flag` (never swallows the next
 *  flag's own name as this one's value — `--agency --force` must not set
 *  `agency: "--force"`). */
export const flagReader =
  (argv: string[]) =>
  (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    return v !== undefined && !v.startsWith("--") ? v : undefined;
  };
