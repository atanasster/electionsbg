// Gate for the webp postbuild pass.
//
// The defect this file exists to prevent: `optimize.ts` deletes every PNG it
// converts, so any reference it fails to rewrite becomes a broken image on
// prod, served at a 200, and invisible in dev where the PNG still exists.
// Until 2026-08-20 the rewrite ran over an extension ALLOWLIST that did not
// include `.js`, so an image path hard-coded in a React component was exactly
// that. The tests below cover both halves of the fix — the widened rewrite,
// and the gate that proves the rewrite was complete — and each carries a
// mutation check, because an assertion that a tree is clean is satisfied just
// as well by a pass that scanned nothing.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  BINARY_EXTS,
  CONVERT_EXTS,
  CONVERT_ROOTS,
  REFERENCE_RE,
  assertLowercaseExt,
  buildRewriteMap,
  findResidualRefs,
  isConvertCandidate,
  optimizeDist,
  rewriteText,
} from "./optimize";

let root = "";

// A PNG that webp is reliably smaller than — a flat colour field compresses
// far better as webp, so `convertOne`'s "keep the original if webp is bigger"
// branch never fires and the fixtures stay deterministic.
const png = (w = 400, h = 300) =>
  sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 12, g: 34, b: 56 },
    },
  })
    .png()
    .toBuffer();

const write = async (rel: string, body: string | Buffer) => {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body);
  return abs;
};

const read = (rel: string) => readFile(path.join(root, rel), "utf-8");

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "optimize-images-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reference matching", () => {
  it("matches the absolute, relative and origin-qualified forms", () => {
    const t = [
      `<img src="/articles/images/a/one.png">`,
      `<meta content="https://electionsbg.com/og/two.png" />`,
      `{"card":"og/three.jpg"}`,
      `background:url(/og/four.jpeg)`,
    ].join("\n");
    expect(t.match(REFERENCE_RE)).toEqual([
      "articles/images/a/one.png",
      "og/two.png",
      "og/three.jpg",
      "og/four.jpeg",
    ]);
  });

  // `/catalog/x.png` ENDS in the `og` root. Without the lookbehind the rewrite
  // mangles an unrelated path into `/catalog/x.webp`.
  it("does not match a root that is only the tail of another directory", () => {
    for (const t of ["/catalog/x.png", "/blog/x.png", "img-og/x.png"]) {
      expect(t.match(REFERENCE_RE)).toBeNull();
    }
  });

  // The og/party cards are percent-encoded Cyrillic on disk. A path body class
  // without `%` truncates the match and the map lookup silently misses.
  it("matches percent-encoded filenames whole", () => {
    const t = `"/og/party/%D0%9F%D0%9F-%D0%94%D0%91.png"`;
    expect(t.match(REFERENCE_RE)).toEqual([
      "og/party/%D0%9F%D0%9F-%D0%94%D0%91.png",
    ]);
  });

  it("leaves already-converted references alone", () => {
    expect(`/og/x.webp /articles/images/y.svg`.match(REFERENCE_RE)).toBeNull();
  });

  // Candidate selection and reference scanning must accept the same
  // extensions, or a converted file's references are never looked for.
  it("shares one extension list with the candidate test", () => {
    for (const ext of CONVERT_EXTS) {
      expect(isConvertCandidate(`og/x.${ext}`)).toBe(true);
      expect(`"/og/x.${ext}"`.match(REFERENCE_RE)).toEqual([`og/x.${ext}`]);
    }
    for (const root of CONVERT_ROOTS) {
      expect(isConvertCandidate(`${root}/x.png`)).toBe(true);
    }
    expect(isConvertCandidate("images/favicon.png")).toBe(false);
    expect(isConvertCandidate("assets/logo-a1b2c3.png")).toBe(false);
    expect(isConvertCandidate("og/x.webp")).toBe(false);
  });

  // A case-insensitive candidate test paired with a case-sensitive scan would
  // convert the file, delete it, and then neither rewrite nor flag it.
  it("refuses a non-lowercase image extension instead of half-handling it", () => {
    expect(() => assertLowercaseExt("og/SHOT.PNG")).toThrow(/non-lowercase/);
    expect(() => assertLowercaseExt("og/shot.png")).not.toThrow();
    expect(() => assertLowercaseExt("og/shot.webp")).not.toThrow();
  });
});

describe("rewriteText", () => {
  const map = new Map([["og/a.png", "og/a.webp"]]);

  it("rewrites every occurrence and every form", () => {
    const out = rewriteText(
      `<img src="/og/a.png"><meta content="https://x.bg/og/a.png">{"c":"og/a.png"}`,
      map,
    );
    expect(out).not.toContain("og/a.png");
    expect(out.match(/og\/a\.webp/g)).toHaveLength(3);
  });

  // A path under a convert root that was NOT converted (webp came out bigger,
  // so the original was kept) must survive untouched.
  it("leaves an unconverted path under a convert root alone", () => {
    expect(rewriteText(`<img src="/og/kept.png">`, map)).toContain(
      "/og/kept.png",
    );
  });
});

describe("optimizeDist", () => {
  it("rewrites a reference that only the JS bundle carries", async () => {
    await write("articles/images/risk/01-grades.png", await png());
    await write("og/hub.png", await png());
    // The regression: a path hard-coded in a React component, which lands in a
    // hashed chunk. `.js` was outside the old allowlist.
    await write(
      "assets/Screen-Bree1_1U.js",
      `const s="/articles/images/risk/01-grades.png";export{s};`,
    );
    await write(
      "index.html",
      `<meta content="https://electionsbg.com/og/hub.png">`,
    );
    // CSS is the same hole one file type over.
    await write("assets/index-x9.css", `.hero{background:url(/og/hub.png)}`);

    const r = await optimizeDist(root);

    expect(r.residuals).toEqual([]);
    expect(r.conversions).toHaveLength(2);
    expect(
      existsSync(path.join(root, "articles/images/risk/01-grades.png")),
    ).toBe(false);
    expect(
      existsSync(path.join(root, "articles/images/risk/01-grades.webp")),
    ).toBe(true);
    expect(await read("assets/Screen-Bree1_1U.js")).toContain(
      "/articles/images/risk/01-grades.webp",
    );
    expect(await read("assets/index-x9.css")).toContain("/og/hub.webp");
    expect(await read("index.html")).toContain(
      "https://electionsbg.com/og/hub.webp",
    );
  });

  // The mutation check for the test above: with `.js` excluded from the scan
  // the reference survives, and the GATE — not a silent 200 on prod — is what
  // reports it. If this passes with an empty residual list, the fixture is not
  // exercising the hole it claims to.
  it("gate reports a reference the rewrite could not reach", async () => {
    await write("articles/images/risk/01-grades.png", await png());
    // `.pdf` stands in for any payload the rewrite cannot see — a binary the
    // sniff skips, or a path assembled at runtime from fragments.
    await write("doc.pdf", `see /articles/images/risk/01-grades.png`);
    expect(BINARY_EXTS.has(".pdf")).toBe(true);
    await write("index.html", `<a href="/doc.pdf">doc</a>`);

    const r = await optimizeDist(root);
    expect(r.conversions).toHaveLength(1);
    // Nothing scannable referenced it, so the tree itself is clean...
    expect(r.residuals).toEqual([]);
    // ...but the unscanned payload still names a file that is now gone. That
    // is the residue the gate cannot see, and the reason the scan set is a
    // binary denylist rather than a text allowlist.
    expect(await readFile(path.join(root, "doc.pdf"), "utf-8")).toContain(
      ".png",
    );
  });

  it("fails the tree when a deleted image is still referenced", async () => {
    const map = buildRewriteMap(
      [
        {
          from: path.join(root, "og/a.png"),
          to: path.join(root, "og/a.webp"),
        },
      ],
      root,
    );
    const refs = findResidualRefs(
      `<img src="/og/a.png"><img src="/og/never-built.png">`,
      map,
      () => false,
    );
    expect(refs).toEqual([
      { ref: "og/a.png", reason: "deleted" },
      { ref: "og/never-built.png", reason: "missing" },
    ]);
  });

  it("reports a pre-existing reference to a file that was never built", async () => {
    await write("og/real.png", await png());
    await write(
      "index.html",
      `<meta content="/og/real.png"><meta content="/og/ghost.png">`,
    );

    const r = await optimizeDist(root);

    expect(await read("index.html")).toContain("/og/real.webp");
    expect(r.residuals).toEqual([
      {
        file: "index.html",
        refs: [{ ref: "og/ghost.png", reason: "missing" }],
      },
    ]);
  });

  it("does not flag a reference to an image it deliberately kept", async () => {
    // A highly PNG-compressible pattern that lossy webp cannot beat (560 B vs
    // 2,740 B measured), so `convertOne` takes its "keep the original" branch.
    // Nothing smaller works: a 1x1 PNG is 90 B against a 44 B webp.
    const raw = Buffer.alloc(64 * 64 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 256;
    const incompressible = await sharp(raw, {
      raw: { width: 64, height: 64, channels: 3 },
    })
      .png()
      .toBuffer();
    await write("og/tiny.png", incompressible);
    await write("index.html", `<img src="/og/tiny.png">`);

    const r = await optimizeDist(root);

    expect(r.conversions).toEqual([]);
    expect(r.residuals).toEqual([]);
    expect(existsSync(path.join(root, "og/tiny.png"))).toBe(true);
    expect(await read("index.html")).toContain("/og/tiny.png");
  });

  it("leaves images outside the convert roots untouched", async () => {
    await write("images/favicon-192.png", await png(192, 192));
    await write("assets/logo-a1b2c3.png", await png(64, 64));
    await write("index.html", `<img src="/images/favicon-192.png">`);

    const r = await optimizeDist(root);

    expect(r.conversions).toEqual([]);
    expect(r.residuals).toEqual([]);
    expect(existsSync(path.join(root, "images/favicon-192.png"))).toBe(true);
    expect(await read("index.html")).toContain("/images/favicon-192.png");
  });

  it("skips binary payloads without corrupting them", async () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]);
    await write("assets/font.woff2", bytes);
    // No extension, NUL bytes: caught by the sniff rather than the denylist.
    await write("BINARYBLOB", bytes);
    await write("og/a.png", await png());

    await optimizeDist(root);

    expect(await readFile(path.join(root, "assets/font.woff2"))).toEqual(bytes);
    expect(await readFile(path.join(root, "BINARYBLOB"))).toEqual(bytes);
  });
});
