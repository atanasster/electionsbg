import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  MANIFEST_NAME,
  candidateIdentity,
  hashBuild,
  verifyManifest,
  writeManifest,
} from "./news_release_manifest";

function repository(): { repo: string; build: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "news-release-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd: repo });
  fs.writeFileSync(path.join(repo, ".gitignore"), "dist-news/\n");
  fs.writeFileSync(path.join(repo, "firebase.json"), "{}\n");
  execFileSync("git", ["add", ".gitignore", "firebase.json"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repo });
  const build = path.join(repo, "dist-news");
  fs.mkdirSync(build);
  fs.writeFileSync(path.join(build, "index.html"), "candidate");
  return { repo, build };
}

describe("news release manifest", () => {
  it("hashes files deterministically and excludes its own manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-release-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "index.html"), "candidate");
    fs.writeFileSync(path.join(root, "assets", "entry.js"), "entry");
    fs.writeFileSync(path.join(root, MANIFEST_NAME), "ignored");
    expect(Object.keys(hashBuild(root))).toEqual(["assets/entry.js", "index.html"]);
  });

  it("fails closed when a gated file changes", () => {
    const { repo, build } = repository();
    writeManifest(build, repo);
    expect(verifyManifest(build, repo)).toBeTruthy();
    fs.writeFileSync(path.join(build, "index.html"), "changed");
    expect(() => verifyManifest(build, repo)).toThrow(/changed after the release gate/);
  });

  it("requires a valid manifest and an index entry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-release-"));
    expect(() => hashBuild(root)).toThrow(/missing index/);
    fs.writeFileSync(path.join(root, "index.html"), "candidate");
    expect(() => verifyManifest(root, root)).toThrow(/manifest missing/);
    fs.writeFileSync(path.join(root, MANIFEST_NAME), "{}");
    expect(() => verifyManifest(root, root)).toThrow(/invalid shape/);
  });

  it("binds the manifest to tracked config and untracked inputs", () => {
    const { repo, build } = repository();
    const manifest = writeManifest(build, repo);
    expect(manifest.candidate).toBe(candidateIdentity(repo));
    expect(verifyManifest(build, repo)).toEqual(manifest);

    fs.writeFileSync(path.join(repo, "firebase.json"), '{"changed":true}\n');
    expect(() => verifyManifest(build, repo)).toThrow(/repository inputs changed/);

    fs.writeFileSync(path.join(repo, "firebase.json"), "{}\n");
    writeManifest(build, repo);
    fs.mkdirSync(path.join(repo, "newsapp"));
    fs.writeFileSync(path.join(repo, "newsapp", "new-release-input.ts"), "export {};\n");
    expect(() => verifyManifest(build, repo)).toThrow(/repository inputs changed/);
  });
});
