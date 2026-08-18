// The anchoring rules here are the ones that have already caused a near-miss in
// each direction, so each has an arm. Deleting either `^[ \t]*` anchor, or
// making `trailing` unconditional, turns one of these red.
import { describe, expect, it } from "vitest";
import { stripComments } from "./strip_comments";

describe("stripComments", () => {
  it("removes a line-owning // comment and a line-owning block", () => {
    expect(stripComments('  // import { X } from "./y";')).not.toContain(
      "import",
    );
    expect(stripComments('/*\n import { X } from "./y";\n*/')).not.toContain(
      "import",
    );
  });

  it("leaves a URL in a string intact, with the code after it", () => {
    // The unanchored `//` form takes `https://…` and everything after it. This
    // is the one that reported 15 live i18n keys as dead.
    const code = 'const u = "https://x/y"; const k = `pp_reg_seat_${seat}`;';
    expect(stripComments(code)).toContain("pp_reg_seat_");
  });

  it("does not let a slash-star inside a string swallow the code after it", () => {
    // The banner further down is what makes this bite: an unanchored block
    // strip opens at the string's slash-star and closes at the banner's
    // star-slash, taking the template between them. A fixture with no closing
    // star-slash asserts nothing — the non-greedy match simply finds no pair,
    // and the test passes with the anchor removed.
    const code = [
      'const re = "/*";',
      "const k = `pp_reg_seat_${seat}`;",
      "/* an ordinary banner */",
      "const z = 1;",
    ].join("\n");
    expect(stripComments(code)).toContain("pp_reg_seat_");
    expect(stripComments(code)).not.toContain("ordinary banner");
  });

  it("keeps a trailing comment by default and drops it when asked", () => {
    const code = 'import {\n  a, // from "./x"\n} from "./real";';
    expect(stripComments(code)).toContain('"./x"');
    expect(stripComments(code, { trailing: true })).not.toContain('"./x"');
    expect(stripComments(code, { trailing: true })).toContain('"./real"');
  });

  it("trailing:true is the unsafe form — the opt-in is the whole point", () => {
    // Asserted so nobody makes it the default: it eats the URL case above.
    const code = 'const u = "https://x/y"; const k = `pp_reg_seat_${seat}`;';
    expect(stripComments(code, { trailing: true })).not.toContain(
      "pp_reg_seat_",
    );
  });
});
