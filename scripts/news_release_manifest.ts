import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const MANIFEST_NAME = ".release-manifest.json";
const UNTRACKED_RELEASE_PATHS = [
  ".firebaserc",
  "firebase.json",
  "package.json",
  "vite.config.news.ts",
  "news",
  "newsapp",
  "scripts",
  "src",
];
const GIT_BUFFER = 64 * 1024 * 1024;

type ReleaseManifest = {
  schema: 1;
  candidate: string;
  files: Record<string, string>;
};

function walk(root: string, dir = root): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(root, absolute);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    return relative === MANIFEST_NAME ? [] : [relative];
  });
}

export function hashBuild(root: string): Record<string, string> {
  if (!fs.existsSync(path.join(root, "index.html")))
    throw new Error(`news release build is missing index.html: ${root}`);
  return Object.fromEntries(
    walk(root)
      .sort()
      .map((relative) => [
        relative,
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(root, relative)))
          .digest("hex"),
      ]),
  );
}

export function candidateIdentity(repoRoot: string): string {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const changed = execFileSync("git", ["diff", "--name-only", "-z", "HEAD"], {
    cwd: repoRoot,
    maxBuffer: GIT_BUFFER,
  });
  const untracked = execFileSync(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...UNTRACKED_RELEASE_PATHS,
    ],
    {
      cwd: repoRoot,
      maxBuffer: GIT_BUFFER,
    },
  );
  const files = Buffer.concat([changed, untracked])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort()
    .filter((relative, index, all) => relative !== all[index - 1]);
  const state = crypto.createHash("sha256");
  for (const relative of files) {
    state.update(relative).update("\0");
    const absolute = path.join(repoRoot, relative);
    if (!fs.existsSync(absolute)) state.update("<deleted>");
    else if (fs.lstatSync(absolute).isSymbolicLink())
      state.update(`<symlink>${fs.readlinkSync(absolute)}`);
    else state.update(fs.readFileSync(absolute));
    state.update("\0");
  }
  return `${head}+${state.digest("hex")}`;
}

export function writeManifest(root: string, repoRoot: string): ReleaseManifest {
  const manifest: ReleaseManifest = {
    schema: 1,
    candidate: candidateIdentity(repoRoot),
    files: hashBuild(root),
  };
  fs.writeFileSync(
    path.join(root, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export function verifyManifest(root: string, repoRoot: string): ReleaseManifest {
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath))
    throw new Error("release manifest missing; run npm run news:release:gate");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ReleaseManifest;
  if (manifest.schema !== 1 || !manifest.candidate || !manifest.files)
    throw new Error("release manifest has an invalid shape");
  if (candidateIdentity(repoRoot) !== manifest.candidate)
    throw new Error("repository inputs changed after the release gate; run it again");
  const current = hashBuild(root);
  if (JSON.stringify(current) !== JSON.stringify(manifest.files))
    throw new Error("dist-news changed after the release gate; run it again");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const mode = process.argv[2];
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const buildRoot = path.join(repoRoot, "dist-news");
  const manifest =
    mode === "write"
      ? writeManifest(buildRoot, repoRoot)
      : mode === "verify"
        ? verifyManifest(buildRoot, repoRoot)
        : (() => {
            throw new Error("usage: news_release_manifest.ts <write|verify>");
          })();
  console.log(JSON.stringify({ candidate: manifest.candidate, files: Object.keys(manifest.files).length }));
}
