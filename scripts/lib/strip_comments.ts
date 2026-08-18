// Remove comments from source text before scanning it for patterns.
//
// Two static-analysis gates need this for the same reason — prose that MENTIONS
// a pattern is not an occurrence of it — and both have already been burned by a
// naive version, in opposite directions:
//
//   - `scripts/i18n/key_usage.ts` reported 15 live keys as dead when an
//     unanchored block strip started at a slash-star inside a string and
//     swallowed PersonProfileScreen's `pp_reg_seat_${seat}` template.
//   - `src/entryGraph.test.ts` reads a comment that DISCUSSES the forbidden
//     import as a real import — and the commit that added the gate also added
//     three such comments.
//
// Hence one primitive with one option, rather than two copies that drift.

/** Comments that OWN their line — a banner block, or a `//` line — and nothing
 *  else. Both anchors are load-bearing, in the same direction: an unanchored
 *  `//` takes a string's `https://…` and everything after it on that line, and
 *  an unanchored block starts at any slash-star inside a string or a regex and
 *  swallows code up to the next star-slash.
 *
 *  `trailing` additionally removes a same-line `//` comment. That is NOT safe
 *  in general — it is the unanchored form above — so it is opt-in, and a caller
 *  may only set it when a `//` inside a string cannot precede what it scans for
 *  on the same line. The entry-graph gate qualifies: it matches `import … from`
 *  statements, which never share a line with a URL literal. The i18n key scan
 *  does not, and must keep the default. */
export const stripComments = (
  code: string,
  { trailing = false }: { trailing?: boolean } = {},
): string => {
  const out = code
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
  return trailing ? out.replace(/\/\/.*$/gm, " ") : out;
};
