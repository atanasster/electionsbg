// The comment stripper the hub-head gates scan source with.
//
// ⚠ `scripts/lib/strip_comments.ts` CANNOT be reused here, and the reason is specific: it is
// line-anchored, so it leaves a JSX `{/* … */}` block intact — the form these screens' comments
// take almost exclusively. That gate has already produced a false RED from it (a prose comment
// naming `<Title>` read as a render of it).
//
// Shared rather than inlined per gate because the `//` rule below is subtle enough to get wrong
// once per copy, and there were three copies before this file existed.
//
// ⚠ THE LINE-COMMENT RULE IS NOT `^\s*//`. Anchoring to the start of a line leaves a TRAILING
// comment in place, which breaks a scanning gate in BOTH directions — measured on the
// contracts band gate: a trailing `// TODO restore showKpis={false}` satisfied a clause that
// should have failed, and a trailing `// contractsKpis(old)` pushed an occurrence count to 2
// and failed a clause that should have passed. Matching anywhere on the line needs the
// non-colon guard, or every `https://…` in the file loses its tail.
export const stripJsxComments = (src: string): string =>
  src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
