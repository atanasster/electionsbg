import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageArticles, assertProductionArticles } from "./package.mjs";
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-article-package-"));
  const pub = path.join(root, "public"),
    dist = path.join(root, "dist");
  fs.mkdirSync(path.join(pub, "articles/images/chat-launch"), {
    recursive: true,
  });
  const index = [
    { slug: "published", ogImage: "/articles/images/shared.png" },
    {
      slug: "2026-09-10-popitai-naiasno",
      draft: true,
      draftAssetDirectory: "/articles/images/chat-launch",
    },
    { slug: "other-draft", draft: true },
  ];
  fs.writeFileSync(
    path.join(pub, "articles/index.json"),
    JSON.stringify(index),
  );
  for (const a of index)
    for (const lang of ["bg", "en"])
      fs.writeFileSync(path.join(pub, `articles/${a.slug}-${lang}.md`), a.slug);
  fs.writeFileSync(
    path.join(pub, "articles/images/chat-launch/cover.webp"),
    "draft art",
  );
  fs.cpSync(pub, dist, { recursive: true });
  return { root, pub, dist };
};
test("normal build excludes draft bodies and declared assets, preserves source and passes release guard", () => {
  const f = fixture();
  try {
    packageArticles(f.pub, f.dist);
    assertProductionArticles(f.dist);
    assert.equal(
      fs.existsSync(path.join(f.dist, "articles/other-draft-bg.md")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(f.dist, "articles/images/chat-launch")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(f.pub, "articles/images/chat-launch/cover.webp")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(f.dist, "articles/published-en.md")),
      true,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test("isolated preview includes only the selected draft and cannot pass production guard", () => {
  const f = fixture();
  try {
    packageArticles(f.pub, f.dist, true);
    assert.equal(
      fs.existsSync(
        path.join(f.dist, "articles/2026-09-10-popitai-naiasno-en.md"),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(f.dist, "articles/other-draft-en.md")),
      false,
    );
    assert.throws(() => assertProductionArticles(f.dist), /editorial preview/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test("shared assets fail closed instead of deleting a published article's image", () => {
  const f = fixture();
  try {
    fs.writeFileSync(
      path.join(f.pub, "articles/published-bg.md"),
      "![Shared](/articles/images/chat-launch/cover.webp)",
    );
    assert.throws(() => packageArticles(f.pub, f.dist), /shared/);
    assert.equal(
      fs.existsSync(
        path.join(f.dist, "articles/images/chat-launch/cover.webp"),
      ),
      true,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test("missing build manifest and reintroduced draft body fail release check", () => {
  const f = fixture();
  try {
    assert.throws(() => assertProductionArticles(f.dist));
    packageArticles(f.pub, f.dist);
    fs.writeFileSync(path.join(f.dist, "articles/other-draft-bg.md"), "leak");
    assert.throws(() => assertProductionArticles(f.dist), /draft body/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
